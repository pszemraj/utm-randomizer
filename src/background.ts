import { isExtensionMessage, isWorkerSender, type ExtensionMessage, type WatchConfig } from './lib/messages';
import { createSeed } from './lib/prng';
import { rewriteUrl } from './lib/rewrite';
import { DEFAULT_SETTINGS, describeMode, loadSettings, watchSettings, type Settings } from './lib/settings';

const MENU_COPY_LINK = 'copy-clean-link';
const MENU_COPY_PAGE = 'copy-clean-page';
const COMMAND_COPY_PAGE = 'copy-clean-page-url';
const WEB_PAGES = ['http://*/*', 'https://*/*'];
const WINDOW_TYPES: `${chrome.windows.WindowType}`[] = ['normal', 'popup', 'devtools'];
let badgeTimer: ReturnType<typeof setTimeout> | undefined;

/** Context menu labels for the selected mode. */
function menuTitles(mode: Settings['mode']): Record<typeof MENU_COPY_LINK | typeof MENU_COPY_PAGE, string> {
  const { copyLink, copyPage } = describeMode(mode);
  return { [MENU_COPY_LINK]: copyLink, [MENU_COPY_PAGE]: copyPage };
}

/** Recreates the explicit copy actions. */
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

/** Serializes increments of lifetime and browser-session rewrite counters. */
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
    .catch((error: unknown) => console.debug('UTM Randomizer: could not update stats', error));
  return statsQueue;
}

let offscreenQueue: Promise<unknown> = Promise.resolve();
/** Invalidates queued automatic work on settings or window-focus changes. */
let automaticRevision = 0;
/** Invalidates queued explicit actions on window-focus changes. */
let focusRevision = 0;

/** Runs an operation after previous offscreen operations finish. */
function withOffscreen<T>(task: () => Promise<T>): Promise<T> {
  const result = offscreenQueue.then(task);
  offscreenQueue = result.catch(() => undefined);
  return result;
}

/** Whether the clipboard document exists. */
async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

/** Creates the sole extension-owned clipboard reader and writer. */
async function ensureOffscreen(): Promise<void> {
  if (!(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Read and rewrite copied URLs while Chrome is focused',
    });
  }
}

/** Requires an acknowledgement from the clipboard coordinator. */
async function tellOffscreen(message: ExtensionMessage): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!(typeof response === 'object' && response !== null && 'ok' in response && response.ok === true)) {
    throw new Error(`Offscreen document rejected ${message.type}`);
  }
}

/** Starts, reconfigures, or suspends polling; focus regain always takes a baseline. */
function syncWatcher(suspend = false): Promise<void> {
  const revision = automaticRevision;
  return withOffscreen(async () => {
    const settings = await loadSettings();
    const focused = !suspend && (await chrome.windows.getLastFocused({ windowTypes: WINDOW_TYPES })).focused;
    if (!suspend && revision !== automaticRevision) return;
    const config: WatchConfig | null = settings.enabled && focused ? { mode: settings.mode } : null;
    if (settings.enabled) {
      await ensureOffscreen();
      if (!suspend && revision !== automaticRevision) return;
      await tellOffscreen({ type: 'watch-config', config });
    } else if (await hasOffscreen()) {
      await tellOffscreen({ type: 'watch-config', config: null });
    }
  }).catch((error: unknown) => console.debug('UTM Randomizer: could not update the clipboard watcher', error));
}

/** Detects an unreported focus loss before authorizing clipboard access. */
async function focusedWindow(): Promise<chrome.windows.Window> {
  const revision = automaticRevision;
  const window = await chrome.windows.getLastFocused({ windowTypes: WINDOW_TYPES });
  if (!window.focused && revision === automaticRevision) {
    automaticRevision += 1;
    focusRevision += 1;
    void syncWatcher(true);
  }
  return window;
}

/** Focus-gates explicit Copy and Undo operations through the sole writer. */
function performClipboardOperation(message: ExtensionMessage, revision = focusRevision): Promise<void> {
  return withOffscreen(async () => {
    await ensureOffscreen();
    const focused = await focusedWindow();
    if (!focused.focused || revision !== focusRevision) throw new Error('Chrome clipboard focus changed');
    await tellOffscreen(message);
  });
}

/** Puts an explicit URL copy on the clipboard. */
function writeClipboard(text: string, revision = focusRevision): Promise<void> {
  return performClipboardOperation({ type: 'offscreen-copy', text }, revision);
}

/** Shows a brief toolbar indication only while Chrome is focused, never a system notification. */
async function notify(ok = true): Promise<void> {
  const revision = focusRevision;
  if (
    !(await loadSettings()).notify ||
    !(await chrome.windows.getLastFocused({ windowTypes: WINDOW_TYPES })).focused ||
    revision !== focusRevision
  )
    return;
  clearTimeout(badgeTimer);
  await chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e7d32' : '#c62828' });
  await chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  badgeTimer = setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
  }, 2000);
}

/** Copies a menu or shortcut URL using fresh randomness even while automatic cleaning is paused. */
async function copyCleanLink(url: string): Promise<void> {
  const revision = focusRevision;
  const settings = await loadSettings();
  const result = rewriteUrl(url, { mode: settings.mode, key: createSeed() });
  try {
    await writeClipboard(result?.url ?? url, revision);
  } catch {
    await notify(false);
    return;
  }
  if (result) await countRewrites(1);
  await notify();
}

/** Identifies the extension's clipboard coordinator. */
function isOffscreenSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    sender.url === chrome.runtime.getURL('offscreen.html')
  );
}

/** Identifies this extension's popup. */
function isPopupSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html');
}

/** Acknowledges queued operations without reporting success after a rejected write. */
function acknowledge(operation: Promise<void>, sendResponse: (response: { ok: boolean }) => void): void {
  operation.then(
    () => sendResponse({ ok: true }),
    () => sendResponse({ ok: false }),
  );
}

chrome.runtime.onInstalled.addListener(() => {
  void createMenus();
  void chrome.storage.local.remove(['sessionCount', 'secret']);
});
chrome.runtime.onStartup.addListener(() => {
  void createMenus();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(DEFAULT_SETTINGS).some((key) => key in changes)) automaticRevision += 1;
});
chrome.windows.onFocusChanged.addListener(
  (windowId) => {
    automaticRevision += 1;
    focusRevision += 1;
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // Deliver the final tick directly, without waiting behind settings or explicit-copy work.
      void tellOffscreen({ type: 'offscreen-blur' }).catch(() => undefined);
    } else {
      void syncWatcher();
    }
  },
  { windowTypes: WINDOW_TYPES },
);
watchSettings((settings) => {
  void syncWatcher();
  for (const [id, title] of Object.entries(menuTitles(settings.mode))) {
    chrome.contextMenus.update(id, { title }).catch(() => undefined);
  }
});
chrome.contextMenus.onClicked.addListener((info) => {
  const url =
    info.menuItemId === MENU_COPY_LINK ? info.linkUrl : info.menuItemId === MENU_COPY_PAGE ? info.pageUrl : undefined;
  if (url) void copyCleanLink(url);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === COMMAND_COPY_PAGE && tab?.url && /^https?:/i.test(tab.url)) void copyCleanLink(tab.url);
});
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: { ok: boolean }) => void) => {
  if (!isExtensionMessage(message)) {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      ['rewritten', 'count', 'copy-clipboard', 'undo-clipboard'].includes(String(message.type))
    )
      sendResponse({ ok: false });
    return false;
  }
  switch (message.type) {
    case 'rewritten':
      if (!isOffscreenSender(sender)) {
        sendResponse({ ok: false });
        return false;
      }
      void countRewrites(message.urls);
      void notify();
      return false;
    case 'count':
      if (!isPopupSender(sender)) {
        sendResponse({ ok: false });
        return false;
      }
      void countRewrites(message.urls);
      return false;
    case 'copy-clipboard':
      if (!isPopupSender(sender)) {
        sendResponse({ ok: false });
        return false;
      }
      acknowledge(writeClipboard(message.text), sendResponse);
      return true;
    case 'undo-clipboard':
      if (!isPopupSender(sender)) {
        sendResponse({ ok: false });
        return false;
      }
      acknowledge(performClipboardOperation({ type: 'offscreen-restore' }), sendResponse);
      return true;
    case 'offscreen-copy':
    case 'offscreen-restore':
    case 'offscreen-blur':
    case 'watch-config':
      if (!isWorkerSender(sender)) sendResponse({ ok: false });
      return false;
  }
});
void syncWatcher();
