import { startAddressBarCleaner, type AddressBarCleaner } from './lib/address-bar';
import { startCopyWatcher, type WatchedClipboard } from './lib/copy-watcher';
import { isExtensionMessage, type ExtensionMessage, type ToastPayload } from './lib/messages';
import {
  DEFAULT_SETTINGS,
  describeMode,
  loadSettings,
  requestSecret,
  watchSecret,
  watchSettings,
  type Settings,
} from './lib/settings';
import { showToast } from './lib/toast';

let settings: Settings = DEFAULT_SETTINGS;
let key: string | null = null;
let addressBar: AddressBarCleaner | null = null;

const isTopFrame = window === window.top;
// The async Clipboard API only exists in secure contexts; copy events still work without it.
const clipboard: WatchedClipboard | null =
  window.isSecureContext && 'clipboard' in navigator ? navigator.clipboard : null;

/** Set once a settings change arrives, so the initial load cannot overwrite it with older values. */
let settingsUpdated = false;

// Settings and key load separately: the key can take a round trip to the service worker, and
// settings must not wait for it.
void loadSettings().then((loaded) => {
  if (!settingsUpdated) {
    settings = loaded;
  }
  addressBar?.clean();
});
void requestSecret()
  .catch(() => null)
  .then((loaded) => {
    key ??= loaded;
    addressBar?.clean();
  });
const unwatchSettings = watchSettings((updated) => {
  settingsUpdated = true;
  settings = updated;
  addressBar?.clean();
});
const unwatchSecret = watchSecret((updated) => {
  key = updated;
});

/** False once the extension was reloaded, updated, or removed (`chrome.runtime.id` disappears). */
function isContextValid(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime can vanish with the context
  return Boolean(chrome.runtime?.id);
}

/** Fire-and-forget message to the service worker. */
function send(message: ExtensionMessage): void {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Extension context invalidated (reloaded or removed); stats for this rewrite are skipped.
  }
}

/** Shows a notification in this frame; its Undo restores the original clipboard text. */
function toast(payload: ToastPayload): void {
  const { undoText } = payload;
  try {
    showToast({
      message: payload.message,
      onUndo: undoText ? () => watcher.restore(undoText) : undefined,
    });
  } catch (error) {
    // Documents that cannot host the toast, e.g. XML files.
    console.debug('UTM Randomizer: could not show notification', error);
  }
}

const watcher = startCopyWatcher({
  clipboard,
  getSettings: () => settings,
  getKey: () => key,
  isContextValid,
  beforeRestore: async (text) => {
    // The background clipboard watcher would otherwise rewrite the restored link right away.
    const message: ExtensionMessage = { type: 'ignore-clipboard', text };
    await chrome.runtime.sendMessage(message).catch(() => undefined);
  },
  onRewrite: ({ original, urls }) => {
    const { emoji, done } = describeMode(settings.mode);
    const payload: ToastPayload | undefined = settings.notify
      ? { message: `${emoji} Tracking ${done}${urls > 1 ? ` in ${urls} links` : ''}`, undoText: original }
      : undefined;
    if (payload && isTopFrame) {
      toast(payload);
    }
    send({ type: 'rewritten', urls, relayToast: isTopFrame ? undefined : payload });
  },
});

if (isTopFrame) {
  // Only the top frame's URL is shown in the address bar.
  addressBar = startAddressBarCleaner({
    isContextValid,
    getOptions: () =>
      settings.enabled && settings.cleanAddressBar && key !== null ? { mode: settings.mode, key } : null,
  });

  const onMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (shown: boolean) => void,
  ) => {
    if (!isContextValid()) {
      chrome.runtime.onMessage.removeListener(onMessage);
      unwatchSettings();
      unwatchSecret();
      return;
    }
    if (isExtensionMessage(message) && message.type === 'toast') {
      toast(message.toast);
      // Answer so the worker knows a toast was shown and skips its badge fallback.
      sendResponse(true);
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
}
