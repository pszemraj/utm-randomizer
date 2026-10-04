import { isExtensionMessage, isOffscreenSender, type ExtensionMessage } from './lib/messages';
import { DEFAULT_SETTINGS, loadSettings, watchSettings, type Settings } from './lib/settings';

const WINDOW_TYPES: `${chrome.windows.WindowType}`[] = ['normal', 'popup', 'devtools'];
let offscreenQueue: Promise<unknown> = Promise.resolve();
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

/** Queries real focus without waiting for clipboard-document lifecycle work. */
async function refreshFocus(): Promise<void> {
  const revision = automaticRevision;
  const settings = await settingsReady;
  if (!settings.enabled || revision !== automaticRevision) return;
  const window = await chrome.windows.getLastFocused({ windowTypes: WINDOW_TYPES });
  if (revision !== automaticRevision) return;
  await tellOffscreen({ type: 'watch-config', config: { mode: settings.mode, focused: window.focused } });
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
    } else if (await hasOffscreen()) {
      if (revision !== automaticRevision) return;
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
  if (!(typeof message === 'object' && message !== null && 'type' in message && message.type === 'watch-focus'))
    return false;
  if (!isExtensionMessage(message) || !isOffscreenSender(sender)) {
    sendResponse({ ok: false });
    return false;
  }
  void refreshFocus().then(
    () => sendResponse({ ok: true }),
    () => sendResponse({ ok: false }),
  );
  return true;
});
watchSettings((settings) => {
  settingsReady = Promise.resolve(settings);
  void syncWatcher();
});
settingsReady = loadSettings();
void syncWatcher();
