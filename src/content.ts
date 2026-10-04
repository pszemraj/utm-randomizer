import { startCopyWatcher, type WatchedClipboard } from './lib/copy-watcher';
import {
  isClipboardEpoch,
  isExtensionMessage,
  isWorkerSender,
  type ExtensionMessage,
  type ToastPayload,
} from './lib/messages';
import { DEFAULT_SETTINGS, loadSettings, watchSettings, type Settings } from './lib/settings';
import { showToast } from './lib/toast';

let settings: Settings = DEFAULT_SETTINGS;

const isTopFrame = window === window.top;
// Automatic rewriting needs the native format reader, available only in secure contexts.
const clipboard: WatchedClipboard | null =
  window.isSecureContext && 'clipboard' in navigator ? navigator.clipboard : null;

/** Set once a settings change arrives, so the initial load cannot overwrite it with older values. */
let settingsUpdated = false;

void loadSettings().then((loaded) => {
  if (!settingsUpdated) {
    settings = loaded;
    watcher.invalidate();
  }
});
const unwatchSettings = watchSettings((updated) => {
  settingsUpdated = true;
  settings = updated;
  watcher.invalidate();
});

/** False once the extension was reloaded, updated, or removed (`chrome.runtime.id` disappears). */
function isContextValid(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime can vanish with the context
  return Boolean(chrome.runtime?.id);
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
  isContextValid,
  restore: (text) => coordinate({ type: 'restore-clipboard', text }),
  invalidateReads: () => clipboardEpoch('clipboard-intent'),
  beginRead: () => clipboardEpoch('clipboard-epoch'),
  reconcile: (text, embedded, baseline, types, epoch, pageCopy, observeOnly) =>
    coordinate({
      type: 'reconcile-clipboard',
      text,
      embedded,
      baseline,
      types: [...types],
      epoch,
      pageCopy,
      observeOnly,
    }),
});

/** Obtains the generation acknowledged for a new trusted intent or a whole-clipboard inspection. */
async function clipboardEpoch(type: 'clipboard-intent' | 'clipboard-epoch'): Promise<string> {
  const response: unknown = await chrome.runtime.sendMessage({ type } satisfies ExtensionMessage);
  if (!(
    typeof response === 'object' &&
    response !== null &&
    'ok' in response &&
    response.ok === true &&
    'epoch' in response &&
    isClipboardEpoch(response.epoch)
  )) {
    throw new Error('Clipboard coordinator did not acknowledge the read');
  }
  return response.epoch;
}

/** Requires the shared clipboard writer to acknowledge the operation before reporting success. */
async function coordinate(message: ExtensionMessage): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!(typeof response === 'object' && response !== null && 'ok' in response && response.ok === true)) {
    throw new Error('Clipboard coordinator rejected the operation');
  }
}

if (isTopFrame) {
  const onMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (shown: boolean | { ok: boolean }) => void,
  ) => {
    if (!isContextValid()) {
      chrome.runtime.onMessage.removeListener(onMessage);
      unwatchSettings();
      return;
    }
    if (!isWorkerSender(sender) || !isExtensionMessage(message)) return false;
    if (message.type === 'inspect-clipboard') {
      void watcher.inspect().then((ok) => sendResponse({ ok }));
      return true;
    }
    if (message.type === 'toast') {
      toast(message.toast);
      // Answer so the worker knows a toast was shown and skips its badge fallback.
      sendResponse(true);
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
}
