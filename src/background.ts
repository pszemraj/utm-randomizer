import { isExtensionMessage, type ExtensionMessage, type ToastPayload } from './lib/messages';
import { rewriteUrl } from './lib/rewrite';
import { describeMode, loadSettings, watchSettings, type Settings } from './lib/settings';

const MENU_COPY_LINK = 'copy-clean-link';
const MENU_COPY_PAGE = 'copy-clean-page';
const COMMAND_COPY_PAGE = 'copy-clean-page-url';
const WEB_PAGES = ['http://*/*', 'https://*/*'];

/** Context menu labels, worded for the current mode. */
function menuTitles(mode: Settings['mode']): Record<typeof MENU_COPY_LINK | typeof MENU_COPY_PAGE, string> {
  return mode === 'strip'
    ? { [MENU_COPY_LINK]: 'Copy link without tracking', [MENU_COPY_PAGE]: 'Copy page link without tracking' }
    : {
        [MENU_COPY_LINK]: 'Copy link with tracking randomized',
        [MENU_COPY_PAGE]: 'Copy page link with tracking randomized',
      };
}

/** (Re)creates the context menu entries; safe to call repeatedly. */
async function createMenus(): Promise<void> {
  const titles = menuTitles((await loadSettings()).mode);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_COPY_LINK,
    title: titles[MENU_COPY_LINK],
    contexts: ['link'],
    targetUrlPatterns: WEB_PAGES,
  });
  chrome.contextMenus.create({
    id: MENU_COPY_PAGE,
    title: titles[MENU_COPY_PAGE],
    contexts: ['page'],
    documentUrlPatterns: WEB_PAGES,
  });
}

let statsQueue: Promise<void> = Promise.resolve();

/**
 * Adds `urls` to the lifetime total (local storage) and the browser-session count (session
 * storage). Increments are serialized so concurrent tabs cannot lose counts.
 */
function countRewrites(urls: number): Promise<void> {
  statsQueue = statsQueue
    .then(async () => {
      const [{ totalCount }, { sessionCount }] = await Promise.all([
        chrome.storage.local.get('totalCount'),
        chrome.storage.session.get('sessionCount'),
      ]);
      await Promise.all([
        chrome.storage.local.set({ totalCount: (Number(totalCount) || 0) + urls }),
        chrome.storage.session.set({ sessionCount: (Number(sessionCount) || 0) + urls }),
      ]);
    })
    .catch((error: unknown) => {
      console.debug('UTM Randomizer: could not update stats', error);
    });
  return statsQueue;
}

let clipboardQueue: Promise<void> = Promise.resolve();

/**
 * Puts `text` on the clipboard. Service workers have no DOM, so the write goes through a
 * short-lived offscreen document. Writes are serialized because only one offscreen document may
 * exist at a time.
 */
function writeClipboard(text: string): Promise<void> {
  const write = async () => {
    // A worker restart can leave the previous document behind.
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: 'Write cleaned links to the clipboard',
      });
    }
    try {
      const message: ExtensionMessage = { type: 'offscreen-copy', text };
      const response: unknown = await chrome.runtime.sendMessage(message);
      if (!(typeof response === 'object' && response !== null && 'ok' in response && response.ok === true)) {
        throw new Error('Clipboard write was rejected');
      }
    } finally {
      await chrome.offscreen.closeDocument();
    }
  };
  const result = clipboardQueue.then(write);
  clipboardQueue = result.catch(() => undefined);
  return result;
}

/** Shows `text` on the toolbar icon for two seconds in the given tab. */
async function flashBadge(tabId: number, text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
  }, 2000);
}

/** Shows a toast in the tab's top frame; falls back to the toolbar badge where no content script runs. */
async function notifyTab(tabId: number | undefined, toast: ToastPayload, ok: boolean): Promise<void> {
  if (tabId === undefined || tabId < 0) {
    return;
  }
  const message: ExtensionMessage = { type: 'toast', toast };
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch {
    await flashBadge(tabId, ok ? '✓' : '!', ok ? '#2e7d32' : '#c62828').catch(() => undefined);
  }
}

/** Copies `url` with its tracking parameters rewritten (explicit user action: menu or shortcut). */
async function copyCleanLink(url: string, tabId: number | undefined): Promise<void> {
  const settings = await loadSettings();
  const result = rewriteUrl(url, { mode: settings.mode });
  const { emoji, verb } = describeMode(settings.mode);
  try {
    await writeClipboard(result?.url ?? url);
  } catch (error) {
    console.debug('UTM Randomizer: copy failed', error);
    await notifyTab(tabId, { message: 'Could not copy the link' }, false);
    return;
  }
  if (result) {
    await countRewrites(1);
  }
  if (settings.notify) {
    const message = result ? `${emoji} Link copied, tracking ${verb}` : '📋 Link copied (no tracking found)';
    await notifyTab(tabId, { message }, true);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void createMenus();
  // Version 1 kept a never-reset "session" counter in local storage.
  void chrome.storage.local.remove('sessionCount');
});

// Menus normally persist, but recreating them on startup is cheap insurance (createMenus is idempotent).
chrome.runtime.onStartup.addListener(() => {
  void createMenus();
});

watchSettings((settings) => {
  const titles = menuTitles(settings.mode);
  for (const [id, title] of Object.entries(titles)) {
    chrome.contextMenus.update(id, { title }).catch(() => undefined);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url =
    info.menuItemId === MENU_COPY_LINK ? info.linkUrl : info.menuItemId === MENU_COPY_PAGE ? info.pageUrl : undefined;
  if (url) {
    void copyCleanLink(url, tab?.id);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === COMMAND_COPY_PAGE && tab?.url && /^https?:/i.test(tab.url)) {
    void copyCleanLink(tab.url, tab.id);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isExtensionMessage(message)) {
    return false;
  }
  if (message.type === 'rewritten') {
    void countRewrites(message.urls);
    const tabId = sender.tab?.id;
    if (message.relayToast && tabId !== undefined) {
      const toast: ExtensionMessage = { type: 'toast', toast: message.relayToast };
      chrome.tabs.sendMessage(tabId, toast, { frameId: 0 }).catch(() => undefined);
    }
  } else if (message.type === 'count') {
    void countRewrites(message.urls);
  }
  return false;
});
