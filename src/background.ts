import { isExtensionMessage, type ExtensionMessage, type ToastPayload, type WatchConfig } from './lib/messages';
import { hasTrackingParams, rewriteUrl } from './lib/rewrite';
import { createOrReadSecret, describeMode, loadSettings, watchSettings, type Settings } from './lib/settings';

const MENU_COPY_LINK = 'copy-clean-link';
const MENU_COPY_PAGE = 'copy-clean-page';
const COMMAND_COPY_PAGE = 'copy-clean-page-url';
const WEB_PAGES = ['http://*/*', 'https://*/*'];

/** Context menu labels, worded for the current mode. */
function menuTitles(mode: Settings['mode']): Record<typeof MENU_COPY_LINK | typeof MENU_COPY_PAGE, string> {
  const { copyLink, copyPage } = describeMode(mode);
  return { [MENU_COPY_LINK]: copyLink, [MENU_COPY_PAGE]: copyPage };
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

let secretPromise: Promise<string> | null = null;

/** The per-install key; created here and nowhere else, once per worker lifetime at most. */
function secret(): Promise<string> {
  secretPromise ??= createOrReadSecret().catch((error: unknown) => {
    secretPromise = null;
    throw error;
  });
  return secretPromise;
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

// The offscreen document is the service worker's clipboard (it has no DOM of its own). It stays
// open while the background clipboard watcher is on and is created on demand otherwise. Every
// operation on it is serialized, because only one offscreen document may exist at a time.
let offscreenQueue: Promise<unknown> = Promise.resolve();

/** Runs `task` after every earlier offscreen operation has finished. */
function withOffscreen<T>(task: () => Promise<T>): Promise<T> {
  const result = offscreenQueue.then(task);
  offscreenQueue = result.catch(() => undefined);
  return result;
}

/** Whether the offscreen document currently exists. */
async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

/** Creates the offscreen document unless it already exists. */
async function ensureOffscreen(): Promise<void> {
  if (!(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Write cleaned links to the clipboard and watch it for links with tracking parameters',
    });
  }
}

/** Sends a message to the offscreen document and checks that it succeeded. */
async function tellOffscreen(message: ExtensionMessage): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!(typeof response === 'object' && response !== null && 'ok' in response && response.ok === true)) {
    throw new Error(`Offscreen document rejected ${message.type}`);
  }
}

/** The background watcher's configuration for the given settings, or null when it should be off. */
async function watchConfigFor(settings: Settings): Promise<WatchConfig | null> {
  return settings.enabled && settings.watchClipboard ? { mode: settings.mode, key: await secret() } : null;
}

/** Starts, reconfigures, or stops the background clipboard watcher to match the current settings. */
function syncWatcher(): Promise<void> {
  return withOffscreen(async () => {
    const config = await watchConfigFor(await loadSettings());
    if (config) {
      await ensureOffscreen();
      await tellOffscreen({ type: 'watch-config', config });
    } else if (await hasOffscreen()) {
      await chrome.offscreen.closeDocument();
    }
  }).catch((error: unknown) => {
    console.debug('UTM Randomizer: could not update the clipboard watcher', error);
  });
}

/** Puts `text` on the clipboard through the offscreen document. */
function writeClipboard(text: string): Promise<void> {
  return withOffscreen(async () => {
    await ensureOffscreen();
    try {
      await tellOffscreen({ type: 'offscreen-copy', text });
    } finally {
      // Keep the document only while the watcher needs it.
      if (!(await watchConfigFor(await loadSettings()))) {
        await chrome.offscreen.closeDocument();
      }
    }
  });
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
  const result = rewriteUrl(url, { mode: settings.mode, key: await secret() });
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
    const { emoji, done } = describeMode(settings.mode);
    const message = result
      ? `${emoji} Link copied, tracking ${done}`
      : hasTrackingParams(url)
        ? `${emoji} Link copied, tracking already ${done}`
        : '📋 Link copied (no tracking found)';
    await notifyTab(tabId, { message }, true);
  }
}

/** Shows a background watcher rewrite in the tab the user is looking at. */
async function notifyActiveTab(toast: ToastPayload): Promise<void> {
  if (!(await loadSettings()).notify) {
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) {
    const message: ExtensionMessage = { type: 'toast', toast };
    // Pages without a content script (browser pages, the Web Store) simply get no toast.
    await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => undefined);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void createMenus();
  void secret();
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
  void syncWatcher();
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

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: { ok: boolean; secret?: string }) => void) => {
    if (!isExtensionMessage(message)) {
      return false;
    }
    switch (message.type) {
      case 'rewritten': {
        void countRewrites(message.urls);
        const tabId = sender.tab?.id;
        if (message.relayToast && tabId !== undefined) {
          const toast: ExtensionMessage = { type: 'toast', toast: message.relayToast };
          chrome.tabs.sendMessage(tabId, toast, { frameId: 0 }).catch(() => undefined);
        } else if (message.relayToast) {
          // From the background clipboard watcher: the user may be looking at any tab.
          void notifyActiveTab(message.relayToast);
        }
        return false;
      }
      case 'count':
        void countRewrites(message.urls);
        return false;
      case 'get-secret':
        secret().then(
          (value) => {
            sendResponse({ ok: true, secret: value });
          },
          () => {
            sendResponse({ ok: false });
          },
        );
        return true;
      case 'ignore-clipboard':
        // Undo in a page: make sure the background watcher does not rewrite the restored link again.
        void withOffscreen(async () => {
          if (await hasOffscreen()) {
            await tellOffscreen({ type: 'watch-ignore', text: message.text });
          }
        })
          .then(
            () => true,
            () => false,
          )
          .then((ok) => {
            sendResponse({ ok });
          });
        return true;
      default:
        return false;
    }
  },
);

// The worker restarts often; each start makes sure the watcher matches the settings (for example
// after the browser discarded the offscreen document).
void syncWatcher();
