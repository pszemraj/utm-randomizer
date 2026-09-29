import { startCopyWatcher, type WatchedClipboard } from './lib/copy-watcher';
import { isExtensionMessage, type ExtensionMessage, type ToastPayload } from './lib/messages';
import { DEFAULT_SETTINGS, describeMode, loadSettings, watchSettings, type Settings } from './lib/settings';
import { showToast } from './lib/toast';

let settings: Settings = DEFAULT_SETTINGS;
void loadSettings().then((loaded) => {
  settings = loaded;
});
const unwatchSettings = watchSettings((updated) => {
  settings = updated;
});

const isTopFrame = window === window.top;
// The async Clipboard API only exists in secure contexts; copy events still work without it.
const clipboard: WatchedClipboard | null =
  window.isSecureContext && 'clipboard' in navigator ? navigator.clipboard : null;

function isContextValid(): boolean {
  // chrome.runtime.id disappears once the extension is reloaded, updated, or removed.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime can vanish with the context
  return Boolean(chrome.runtime?.id);
}

function send(message: ExtensionMessage): void {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Extension context invalidated (reloaded or removed); stats for this rewrite are skipped.
  }
}

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
  isContextValid,
  onRewrite: ({ original, urls }) => {
    const { emoji, verb } = describeMode(settings.mode);
    const payload: ToastPayload | undefined = settings.notify
      ? { message: `${emoji} Tracking ${verb}${urls > 1 ? ` in ${urls} links` : ''}`, undoText: original }
      : undefined;
    if (payload && isTopFrame) {
      toast(payload);
    }
    send({ type: 'rewritten', urls, relayToast: isTopFrame ? undefined : payload });
  },
});

if (isTopFrame) {
  const onMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (shown: boolean) => void,
  ) => {
    if (!isContextValid()) {
      chrome.runtime.onMessage.removeListener(onMessage);
      unwatchSettings();
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
