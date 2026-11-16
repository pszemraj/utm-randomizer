import { isOffscreenSender, isWorkerMessage, type CoordinatorMessage } from './lib/messages';
import { isSettingsChange, loadSettings, type Settings } from './lib/settings';
import { CONFIRMATION_MS, STALL_CONFIRM_MS, STALL_MS } from './lib/timing';

const WINDOW_TYPES: `${chrome.windows.WindowType}`[] = ['normal', 'popup', 'devtools'];
/** Action-button states; `none` restores the default appearance. */
const BADGES = {
  none: { text: '', title: 'UTM Randomizer', color: null },
  success: { text: '✓', title: 'Your link was randomized.', color: '#2e7d32' },
  stalled: {
    text: '!',
    title: 'UTM Randomizer is not cleaning: the clipboard is not responding. If this stays, restart the browser.',
    color: '#b3261e',
  },
} as const;
/** Name of an action-button state. */
type Badge = keyof typeof BADGES;
const LEGACY_LOCAL_KEYS = ['totalCount', 'sessionCount'];
let offscreenQueue: Promise<unknown> = Promise.resolve();
let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
/** Chrome-owned badge state can outlive this worker, so startup assumes a leftover badge and clears it. */
let badge: Badge = 'success';
let badgeRevision = 0;
let badgeQueue: Promise<unknown> = Promise.resolve();
let stallTimer: ReturnType<typeof setTimeout> | undefined;
/** Counts messages from the clipboard document, so a stall report overtaken by one is dropped. */
let watcherHeardCount = 0;
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
async function tellOffscreen(message: CoordinatorMessage): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!(typeof response === 'object' && response !== null && 'ok' in response && response.ok === true)) {
    throw new Error(`Offscreen document rejected ${message.type}`);
  }
}

/** Serializes badge changes so a late write cannot survive a newer state. */
function setBadge(next: Badge): Promise<void> {
  const revision = ++badgeRevision;
  badge = next;
  const { text, title, color } = BADGES[next];
  const result = badgeQueue.then(async () => {
    if (revision !== badgeRevision) return;
    await Promise.all([
      ...(color ? [chrome.action.setBadgeBackgroundColor({ color })] : []),
      chrome.action.setBadgeText({ text }),
      chrome.action.setTitle({ title }),
    ]);
  });
  badgeQueue = result.catch(() => undefined);
  return result;
}

/** Clears the transient Chrome-only success indicator; a stall report stays until the watcher is heard again. */
async function clearConfirmation(): Promise<void> {
  clearTimeout(confirmationTimer);
  confirmationTimer = undefined;
  if (badge !== 'success') return;
  await setBadge('none');
}

/** Restarts the wait for the clipboard document's next message while cleaning is enabled. */
function expectWatcher(): void {
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    // A resumed system can fire this before the document's next check, so wait once more before reporting.
    stallTimer = setTimeout(() => void reportStall().catch(() => undefined), STALL_CONFIRM_MS);
  }, STALL_MS);
}

/** Records a message from the clipboard document and withdraws any stall report. */
function watcherHeard(): void {
  watcherHeardCount += 1;
  expectWatcher();
  if (badge === 'stalled') void setBadge('none').catch(() => undefined);
}

/** Stops expecting the clipboard document while cleaning is off. */
function releaseWatcher(): void {
  clearTimeout(stallTimer);
  stallTimer = undefined;
  if (badge === 'stalled') void setBadge('none').catch(() => undefined);
}

/** Handles a silent clipboard document: recreates a lost one, or reports one whose synchronous read is blocked. */
async function reportStall(): Promise<void> {
  const expectedSettingsRevision = settingsRevision;
  const expectedHeardCount = watcherHeardCount;
  const settings = await settingsReady;
  const exists = await hasOffscreen();
  if (!settings.enabled || expectedSettingsRevision !== settingsRevision || expectedHeardCount !== watcherHeardCount)
    return;
  if (!exists) {
    void syncWatcher();
    return;
  }
  // A blocked read cannot be interrupted, and closing or reloading does not release it.
  clearTimeout(confirmationTimer);
  confirmationTimer = undefined;
  await setBadge('stalled');
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
  clearTimeout(confirmationTimer);
  const shown = setBadge('success');
  const revision = badgeRevision;
  await shown;
  if (revision !== badgeRevision) return;
  confirmationTimer = setTimeout(() => {
    if (revision === badgeRevision) void clearConfirmation().catch(() => undefined);
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
      // NONE also fires for native Chrome menus. Require an observed blur so menu copies remain eligible.
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
    if (baseline && expectedFocusRevision === focusRevision) baselineRequired = false;
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
      expectWatcher();
      await ensureOffscreen();
      if (revision !== settingsRevision) return;
      await refreshFocus(false);
    } else {
      releaseWatcher();
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
  if (!isSettingsChange(changes, area)) return;
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
    } else if (potentialBlur !== null) {
      // A regain that overtakes the NONE query may have hidden a real short blur behind a focused result.
      baselineRequired = true;
      potentialBlur = null;
    }
    void refreshFocus().catch((error: unknown) =>
      console.debug('UTM Randomizer: could not check browser focus', error),
    );
  },
  { windowTypes: WINDOW_TYPES },
);
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: { ok: boolean }) => void) => {
  if (!(typeof message === 'object' && message !== null && 'type' in message)) return false;
  if (!isWorkerMessage(message) || !isOffscreenSender(sender)) {
    sendResponse({ ok: false });
    return false;
  }
  watcherHeard();
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
  }
});
settingsReady = loadSettings();
void clearConfirmation().catch(() => undefined);
void syncWatcher();
