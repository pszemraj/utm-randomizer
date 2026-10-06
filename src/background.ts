import { isExtensionMessage, isOffscreenSender, type ExtensionMessage } from './lib/messages';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from './lib/settings';

const WINDOW_TYPES: `${chrome.windows.WindowType}`[] = ['normal', 'popup', 'devtools'];
const DEFAULT_ACTION_TITLE = 'UTM Randomizer';
const SUCCESS_ACTION_TITLE = 'Your link was randomized.';
const CONFIRMATION_MS = 1800;
const LEGACY_LOCAL_KEYS = ['totalCount', 'sessionCount'];
let offscreenQueue: Promise<unknown> = Promise.resolve();
let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
let confirmationRevision = 0;
/** Chrome-owned badge state can outlive this worker, so startup must conservatively clear it. */
let confirmationVisible = true;
let confirmationQueue: Promise<unknown> = Promise.resolve();
/** Invalidates queued watcher configuration when persisted settings change. */
let settingsRevision = 0;
/** Orders real focus events and prevents a delayed blur from erasing a later regain baseline. */
let focusRevision = 0;
let focusDelivery: Promise<unknown> = Promise.resolve();
let baselineRequired = false;
let potentialBlur: { revision: number; flushed: Promise<boolean> } | null = null;
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
  const expectedSettingsRevision = settingsRevision;
  const expectedFocusRevision = focusRevision;
  const settings = await settingsReady;
  if (!settings.enabled || expectedSettingsRevision !== settingsRevision || expectedFocusRevision !== focusRevision)
    return;
  const focused = await browserFocused();
  if (!focused || expectedSettingsRevision !== settingsRevision || expectedFocusRevision !== focusRevision) return;
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

/** Requests the blur event's final clipboard tick before an asynchronous focus query can lag behind it. */
async function flushPotentialBlur(expectedFocusRevision: number): Promise<boolean> {
  const expectedSettingsRevision = settingsRevision;
  const settings = await settingsReady;
  if (!settings.enabled || expectedSettingsRevision !== settingsRevision || expectedFocusRevision !== focusRevision)
    return false;
  try {
    await tellOffscreen({ type: 'watch-flush' });
    return true;
  } catch {
    return false;
  }
}

/** Queries real focus in request order and permits one watcher recovery after a failed delivery. */
function refreshFocus(recover = true): Promise<void> {
  const expectedSettingsRevision = settingsRevision;
  const expectedFocusRevision = focusRevision;
  const flush = potentialBlur?.revision === expectedFocusRevision ? potentialBlur.flushed : Promise.resolve(false);
  const query = browserFocused().then(
    (focused) => ({ ok: true as const, focused }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const result = focusDelivery.then(async () => {
    const outcome = await query;
    const flushed = await flush;
    if (!outcome.ok) throw outcome.error;
    const settings = await settingsReady;
    if (expectedFocusRevision !== focusRevision) {
      if (!outcome.focused) baselineRequired = true;
      return;
    }
    if (!settings.enabled || expectedSettingsRevision !== settingsRevision) return;
    if (!outcome.focused) {
      baselineRequired = true;
      void clearConfirmation().catch(() => undefined);
    }
    const baseline = outcome.focused && baselineRequired;
    try {
      await tellOffscreen({
        type: 'watch-config',
        config: { mode: settings.mode, focused: outcome.focused },
        ...(baseline ? { baseline: true } : {}),
        ...(!outcome.focused && flushed ? { skipFinalTick: true } : {}),
      });
    } catch (error) {
      // Queue recovery after this delivery settles; awaiting it here can deadlock lifecycle synchronization.
      if (recover) void syncWatcher();
      throw error;
    }
    if (potentialBlur?.revision === expectedFocusRevision) potentialBlur = null;
    if (baseline) baselineRequired = false;
  });
  focusDelivery = result.catch(() => undefined);
  return result;
}

/** Applies on/off and mode changes and creates the clipboard document when enabled. */
function syncWatcher(): Promise<void> {
  const revision = settingsRevision;
  return withOffscreen(async () => {
    const settings = await settingsReady;
    if (revision !== settingsRevision) return;
    if (settings.enabled) {
      await ensureOffscreen();
      if (revision !== settingsRevision) return;
      await refreshFocus(false);
    } else {
      await clearConfirmation();
      if (revision !== settingsRevision) return;
      const exists = await hasOffscreen();
      if (revision !== settingsRevision || !exists) return;
      await tellOffscreen({ type: 'watch-config', config: null });
    }
  }).catch((error: unknown) => console.debug('UTM Randomizer: could not update the clipboard watcher', error));
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'update') return;
  void chrome.storage.local
    .remove(LEGACY_LOCAL_KEYS)
    .catch((error: unknown) => console.debug('UTM Randomizer: could not remove legacy counters', error));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(DEFAULT_SETTINGS).some((key) => key in changes)) return;
  settingsRevision += 1;
  // Publish the pending read immediately so a poll cannot pair the new revision with old settings.
  settingsReady = loadSettings();
  void syncWatcher();
});
chrome.windows.onFocusChanged.addListener(
  (windowId) => {
    focusRevision += 1;
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      potentialBlur = { revision: focusRevision, flushed: flushPotentialBlur(focusRevision) };
    }
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
    case 'watch-flush':
    case 'watch-config':
      sendResponse({ ok: false });
      return false;
  }
});
settingsReady = loadSettings();
void clearConfirmation().catch(() => undefined);
void syncWatcher();
