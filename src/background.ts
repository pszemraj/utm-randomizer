import { type ExtensionMessage, type WatchConfig } from './lib/messages';
import { DEFAULT_SETTINGS, loadSettings, watchSettings } from './lib/settings';

const WINDOW_TYPES: `${chrome.windows.WindowType}`[] = ['normal', 'popup', 'devtools'];
let offscreenQueue: Promise<unknown> = Promise.resolve();
/** Invalidates queued watcher configuration on settings or window-focus changes. */
let automaticRevision = 0;
/** Focus events are authoritative; the initial window query only establishes startup state. */
let focused: boolean | undefined;

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

/** Starts, reconfigures, or suspends polling; focus regain always takes a baseline. */
function syncWatcher(): Promise<void> {
  const revision = automaticRevision;
  return withOffscreen(async () => {
    const settings = await loadSettings();
    if (focused === undefined) {
      const window = await chrome.windows.getLastFocused({ windowTypes: WINDOW_TYPES });
      if (revision !== automaticRevision) return;
      focused = window.focused;
    }
    if (revision !== automaticRevision) return;
    const config: WatchConfig | null = settings.enabled && focused ? { mode: settings.mode } : null;
    if (settings.enabled) {
      await ensureOffscreen();
      if (revision !== automaticRevision) return;
      await tellOffscreen({ type: 'watch-config', config });
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
  (windowId) => {
    automaticRevision += 1;
    focused = windowId !== chrome.windows.WINDOW_ID_NONE;
    if (!focused) {
      // Flush directly: a pending settings lookup must not delay the last focused observation.
      void tellOffscreen({ type: 'offscreen-blur' }).catch(() => undefined);
    } else {
      void syncWatcher();
    }
  },
  { windowTypes: WINDOW_TYPES },
);
watchSettings(() => void syncWatcher());
void syncWatcher();
