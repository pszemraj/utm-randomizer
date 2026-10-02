// Offscreen document: the service worker's clipboard. It writes links for the context menu and
// shortcut, and, while enabled, watches the whole clipboard so links copied anywhere (the address
// bar, other apps, browser pages without content scripts) are rewritten too.
//
// Offscreen documents never have focus, so navigator.clipboard is unusable here; execCommand with
// the extension's clipboardRead/clipboardWrite permissions works regardless of focus.
import { createLoopGuard } from './lib/loop-guard';
import { isExtensionMessage, sendNotification, type WatchConfig } from './lib/messages';
import { rewriteText } from './lib/rewrite';
import { describeMode } from './lib/settings';

/** How often the clipboard is checked while watching. */
const POLL_MS = 750;
/**
 * How long a new link may sit on the clipboard before the watcher rewrites it. Copies made on a web
 * page are rewritten by that page's content script within milliseconds; the grace period lets it go
 * first, so one copy is not handled (and counted) twice.
 */
const GRACE_MS = 250;

/** What a paste of the current clipboard would deliver. */
interface ClipboardSnapshot {
  text: string;
  /** Whether the clipboard holds anything besides plain text (HTML, images, files). */
  rich: boolean;
  /** Whether it holds images or files, which a text write would destroy. */
  binary: boolean;
}

let config: WatchConfig | null = null;
let timer = 0;
/** Plain text last seen on (or written to) the clipboard; null until the first check after starting. */
let lastSeen: string | null = null;
/** Text Undo put back; left alone until the clipboard changes to something else. */
let ignored: string | null = null;
/** New clipboard text waiting out the grace period. */
let candidate: string | null = null;
const loopGuard = createLoopGuard(() => Date.now());

/** The editable element pastes and copies go through. */
function field(): HTMLTextAreaElement {
  const textarea = document.querySelector('textarea');
  if (!textarea) {
    throw new Error('offscreen.html has no textarea');
  }
  return textarea;
}

/** Reads the clipboard through a synthetic paste, without inserting anything. */
function readClipboard(): ClipboardSnapshot | null {
  let snapshot: ClipboardSnapshot | null = null;
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const data = event.clipboardData;
    if (!data) {
      return;
    }
    const types = Array.from(data.types);
    snapshot = {
      text: data.getData('text/plain'),
      rich: types.some((type) => type !== 'text/plain'),
      binary: types.some((type) => type === 'Files' || type.startsWith('image/')),
    };
  };
  const textarea = field();
  textarea.addEventListener('paste', onPaste, { once: true });
  textarea.focus();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only clipboard read available without focus
  document.execCommand('paste');
  textarea.removeEventListener('paste', onPaste);
  return snapshot;
}

/** Puts plain text on the clipboard. */
function writeClipboard(text: string): boolean {
  const textarea = field();
  textarea.value = text;
  textarea.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only clipboard write available without focus
  const ok = document.execCommand('copy');
  textarea.value = '';
  if (ok) {
    lastSeen = text;
  }
  return ok;
}

/** One watcher tick: rewrite the clipboard if it changed to something with tracked links. */
function check(): void {
  if (!config) {
    return;
  }
  const snapshot = readClipboard();
  if (!snapshot) {
    return;
  }
  if (snapshot.text !== lastSeen) {
    const previous = lastSeen;
    lastSeen = snapshot.text;
    candidate = null;
    if (snapshot.text !== ignored) {
      ignored = null;
    }
    // Leave alone what was already on the clipboard when watching started, what Undo restored, and
    // anything a text write would destroy (images, files).
    if (previous === null || ignored !== null || snapshot.binary || !snapshot.text.includes('?')) {
      return;
    }
    candidate = snapshot.text;
    window.setTimeout(check, GRACE_MS);
    return;
  }
  if (candidate === null || snapshot.text !== candidate) {
    return;
  }
  candidate = null;
  if (loopGuard.blocks(snapshot.text)) {
    return;
  }
  // Formatted copies would lose their formatting, so only a lone link is rewritten there.
  const result = rewriteText(snapshot.text, { ...config, embedded: !snapshot.rich });
  if (!result || !writeClipboard(result.text)) {
    return;
  }
  loopGuard.record(snapshot.text, result.text);
  const { emoji, done } = describeMode(config.mode);
  sendNotification({
    type: 'rewritten',
    urls: result.urls,
    relayToast: {
      message: `${emoji} Tracking ${done}${result.urls > 1 ? ` in ${String(result.urls)} links` : ''}`,
      undoText: snapshot.text,
    },
  });
}

/** Starts, reconfigures, or stops the watcher. */
function configure(next: WatchConfig | null): void {
  config = next;
  window.clearInterval(timer);
  if (next) {
    timer = window.setInterval(check, POLL_MS);
    check();
  } else {
    lastSeen = null;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (response: { ok: boolean }) => void) => {
  if (!isExtensionMessage(message)) {
    return false;
  }
  switch (message.type) {
    case 'offscreen-copy':
      sendResponse({ ok: writeClipboard(message.text) });
      break;
    case 'watch-config':
      configure(message.config);
      sendResponse({ ok: true });
      break;
    case 'watch-ignore':
      ignored = message.text;
      sendResponse({ ok: true });
      break;
    default:
      break;
  }
  return false;
});
