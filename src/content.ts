import { startCopyWatcher, type WatchedClipboard } from './lib/copy-watcher';
import {
  isClipboardEpoch,
  isExtensionMessage,
  isWorkerSender,
  sendNotification,
  type ExtensionMessage,
  type ToastPayload,
} from './lib/messages';
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
    watcher.invalidate();
  }
});
void requestSecret()
  .catch(() => null)
  .then((loaded) => {
    key ??= loaded;
    watcher.invalidate();
  });
const unwatchSettings = watchSettings((updated) => {
  settingsUpdated = true;
  settings = updated;
  watcher.invalidate();
});
const unwatchSecret = watchSecret((updated) => {
  key = updated;
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
  getKey: () => key,
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
  onRewrite: async ({ original, urls, undoable }, write) => {
    const { emoji, done } = describeMode(settings.mode);
    const payload: ToastPayload | undefined = settings.notify
      ? {
          message: `${emoji} Tracking ${done}${urls > 1 ? ` in ${urls} links` : ''}`,
          undoText: undoable === false ? undefined : original,
        }
      : undefined;
    if (payload && isTopFrame) {
      toast(payload);
    }
    if (write) {
      // The browser commits clipboardData after event dispatch and the native default action.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await coordinate({
        type: 'rewritten',
        urls,
        relayToast: isTopFrame ? undefined : payload,
        clipboard: write,
      });
    } else {
      sendNotification({ type: 'rewritten', urls, relayToast: isTopFrame ? undefined : payload });
    }
  },
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
      unwatchSecret();
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
