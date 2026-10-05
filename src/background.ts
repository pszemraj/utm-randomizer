import { isExtensionMessage, isOffscreenSender, type ExtensionMessage } from './lib/messages';
import { DEFAULT_SETTINGS, loadSettings, watchSettings, type Settings } from './lib/settings';

const WINDOW_TYPES: `${chrome.windows.WindowType}`[] = ['normal', 'popup', 'devtools'];
const DEFAULT_ACTION_TITLE = 'UTM Randomizer';
const SUCCESS_ACTION_TITLE = 'Your link was randomized.';
const CONFIRMATION_MS = 1800;
let offscreenQueue: Promise<unknown> = Promise.resolve();
let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
let confirmationRevision = 0;
let confirmationVisible = false;
let confirmationQueue: Promise<unknown> = Promise.resolve();
/** Invalidates queued watcher configuration on settings or window-focus changes. */
let automaticRevision = 0;
/** Replaced on settings changes; ordinary focus checks do not read storage. */
let settingsReady: Promise<Settings>;

/** Serializes offscreen creation and configuration. */
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

/** Serializes badge changes so a late success write cannot survive a newer blur. */
function updateConfirmation(visible: boolean, revision: number): Promise<void> {
  const result = confirmationQueue.then(async () => {
    if (revision !== confirmationRevision || visible !== confirmationVisible) return;
    if (visible) {
      await Promise.all([
        chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' }),
        chrome.action.setBadgeText({ text: '✓' }),
        chrome.action.setTitle({ title: SUCCESS_ACTION_TITLE }),
      ]);
    } else {
      await Promise.all([
        chrome.action.setBadgeText({ text: '' }),
        chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE }),
      ]);
    }
  });
  confirmationQueue = result.catch(() => undefined);
  return result;
}

/** Clears the transient Chrome-only success indicator. */
async function clearConfirmation(): Promise<void> {
  const revision = ++confirmationRevision;
  clearTimeout(confirmationTimer);
  confirmationTimer = undefined;
  if (!confirmationVisible) return;
  confirmationVisible = false;
  await updateConfirmation(false, revision);
}

/** Shows a brief success indicator only when a Chrome window is still focused. */
async function showConfirmation(): Promise<void> {
  const focusRevision = automaticRevision;
  const settings = await settingsReady;
  if (!settings.enabled || focusRevision !== automaticRevision) return;
  const focused = await browserFocused();
  if (!focused || focusRevision !== automaticRevision) return;
  const revision = ++confirmationRevision;
  clearTimeout(confirmationTimer);
  confirmationVisible = true;
  await updateConfirmation(true, revision);
  if (revision !== confirmationRevision) return;
  confirmationTimer = setTimeout(() => {
    if (revision === confirmationRevision) void clearConfirmation().catch(() => undefined);
  }, CONFIRMATION_MS);
}

/** Whether any tracked Chrome window currently has focus. */
async function browserFocused(): Promise<boolean> {
  const windows = await chrome.windows.getAll({ windowTypes: WINDOW_TYPES });
  return windows.some((window) => window.focused);
}

/** Queries real focus without waiting for clipboard-document lifecycle work. */
async function refreshFocus(): Promise<void> {
  const revision = automaticRevision;
  const settings = await settingsReady;
  if (!settings.enabled || revision !== automaticRevision) return;
  const focused = await browserFocused();
  if (revision !== automaticRevision) return;
  if (!focused) void clearConfirmation().catch(() => undefined);
  await tellOffscreen({ type: 'watch-config', config: { mode: settings.mode, focused } });
}

/** Applies on/off and mode changes and creates the clipboard document when enabled. */
function syncWatcher(): Promise<void> {
  const revision = automaticRevision;
  return withOffscreen(async () => {
    const settings = await settingsReady;
    if (revision !== automaticRevision) return;
    if (settings.enabled) {
      await ensureOffscreen();
      if (revision !== automaticRevision) return;
      await refreshFocus();
    } else {
      await clearConfirmation();
      if (revision !== automaticRevision) return;
      const exists = await hasOffscreen();
      if (revision !== automaticRevision || !exists) return;
      await tellOffscreen({ type: 'watch-config', config: null });
    }
  }).catch((error: unknown) => console.debug('UTM Randomizer: could not update the clipboard watcher', error));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(DEFAULT_SETTINGS).some((key) => key in changes)) automaticRevision += 1;
});
chrome.windows.onFocusChanged.addListener(
  () => {
    automaticRevision += 1;
    void refreshFocus().catch((error: unknown) =>
      console.debug('UTM Randomizer: could not check browser focus', error),
    );
  },
  { windowTypes: WINDOW_TYPES },
);
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: { ok: boolean }) => void) => {
  if (!(typeof message === 'object' && message !== null && 'type' in message)) return false;
  if (!isExtensionMessage(message) || !isOffscreenSender(sender)) {
    sendResponse({ ok: false });
    return false;
  }
  switch (message.type) {
    case 'watch-focus':
      void refreshFocus().then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false }),
      );
      return true;
    case 'rewrite-complete':
      sendResponse({ ok: true });
      void showConfirmation().catch((error: unknown) =>
        console.debug('UTM Randomizer: could not show rewrite confirmation', error),
      );
      return false;
    case 'watch-config':
      sendResponse({ ok: false });
      return false;
  }
});
watchSettings((settings) => {
  settingsReady = Promise.resolve(settings);
  void syncWatcher();
});
settingsReady = loadSettings();
void syncWatcher();
