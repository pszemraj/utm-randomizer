// Offscreen document: the single coordinator for post-copy clipboard writes. Reads and commits
// run synchronously through execCommand because this document never has browser focus.
import { rewriteHtml } from './lib/clipboard-html';
import { createLoopGuard } from './lib/loop-guard';
import { isExtensionMessage, isWorkerSender, sendNotification, type WatchConfig } from './lib/messages';
import { rewriteText } from './lib/rewrite';
import { describeMode } from './lib/settings';

/** How often the clipboard is checked while watching. */
const POLL_MS = 750;
/** Lets synchronous page copy handlers handle their clipboard payload first. */
const GRACE_MS = 250;

/** Clipboard flavors captured together by one synchronous paste. */
interface ClipboardSnapshot {
  text: string;
  html: string | null;
  types: string[];
}

let config: WatchConfig | null = null;
let timer = 0;
let graceTimer = 0;
/** Last observed clipboard payload, including its formats. */
let lastSeen: string | null = null;
/** The exact restored payload remains suppressed until any clipboard flavor changes. */
let ignored: ClipboardSnapshot | null = null;
/** Clipboard payload waiting out the grace period. */
let candidate: ClipboardSnapshot | null = null;
let inspectionPending = false;
/** Invalidates native reads started before Undo, explicit copies, or watcher reconfiguration. */
let epoch = 0;
const loopGuard = createLoopGuard(() => Date.now());

/** The editable element used for clipboard operations. */
function field(): HTMLTextAreaElement {
  const textarea = document.querySelector('textarea');
  if (!textarea) throw new Error('offscreen.html has no textarea');
  return textarea;
}

/** Reads all supported clipboard flavors and records any unsupported ones. */
function readClipboard(): ClipboardSnapshot | null {
  let snapshot: ClipboardSnapshot | null = null;
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const data = event.clipboardData;
    if (!data) return;
    const types = Array.from(data.types).sort();
    snapshot = {
      text: data.getData('text/plain'),
      html: types.includes('text/html') ? data.getData('text/html') : null,
      types,
    };
  };
  const textarea = field();
  textarea.addEventListener('paste', onPaste, { once: true });
  textarea.focus();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- clipboard reads without browser focus
  document.execCommand('paste');
  textarea.removeEventListener('paste', onPaste);
  return snapshot;
}

/** Identifies text and format changes, including an HTML-only change. */
function identity(snapshot: ClipboardSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Whether every clipboard flavor can be preserved by the automatic writer. */
function supported(snapshot: ClipboardSnapshot): boolean {
  return snapshot.types.length > 0 && snapshot.types.every((type) => type === 'text/plain' || type === 'text/html');
}

/** Writes the provided plain-text and HTML flavors together. */
function writeClipboard(snapshot: ClipboardSnapshot): boolean {
  const textarea = field();
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    const data = event.clipboardData;
    if (!data) return;
    if (snapshot.types.includes('text/plain')) data.setData('text/plain', snapshot.text);
    if (snapshot.html !== null) data.setData('text/html', snapshot.html);
  };
  textarea.value = snapshot.text;
  textarea.select();
  textarea.addEventListener('copy', onCopy, { once: true });
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- clipboard writes without browser focus
  const ok = document.execCommand('copy');
  textarea.removeEventListener('copy', onCopy);
  textarea.value = '';
  if (ok) lastSeen = identity(snapshot);
  return ok;
}

/** Creates a plain-text payload for explicit Copy and Undo actions. */
function plainText(text: string): ClipboardSnapshot {
  return { text, html: null, types: ['text/plain'] };
}

/** Whether the current payload is exactly the one restored by Undo. */
function isIgnored(snapshot: ClipboardSnapshot): boolean {
  return ignored !== null && identity(snapshot) === identity(ignored);
}

/** Expires Undo suppression after observing different text or clipboard formats. */
function observe(snapshot: ClipboardSnapshot): void {
  if (!isIgnored(snapshot)) ignored = null;
}

/** Synchronously reads the current clipboard, checks the expected text, and commits a supported rewrite. */
function reconcile(
  text: string,
  embedded: boolean,
  options: WatchConfig,
  types: string[],
  readEpoch: number,
  tabId?: number,
  baseline?: string,
): boolean {
  if (readEpoch !== epoch) return true;
  const snapshot = readClipboard();
  if (!snapshot) return false;
  observe(snapshot);
  if (snapshot.text === text && baseline !== undefined && baseline !== ignored?.text) ignored = null;
  if (
    snapshot.text !== text ||
    isIgnored(snapshot) ||
    !supported(snapshot) ||
    JSON.stringify([...types].sort()) !== JSON.stringify(snapshot.types) ||
    loopGuard.blocks(snapshot.text)
  ) {
    return true;
  }
  const result = rewriteText(snapshot.text, { ...options, embedded: embedded && snapshot.html === null });
  const html = snapshot.html === null ? null : rewriteHtml(snapshot.html, options);
  if (!result && html === null) return true;
  const rewritten = { ...snapshot, text: result?.text ?? snapshot.text, html: html ?? snapshot.html };
  const current = readClipboard();
  if (!current || identity(current) !== identity(snapshot)) return true;
  if (!writeClipboard(rewritten)) return false;
  candidate = null;
  loopGuard.record(snapshot.text, rewritten.text);
  const urls = result?.urls ?? 1;
  const { emoji, done } = describeMode(options.mode);
  sendNotification({
    type: 'rewritten',
    urls,
    tabId,
    relayToast: {
      message: `${emoji} Tracking ${done}${urls > 1 ? ` in ${String(urls)} links` : ''}`,
      // Text-only Undo cannot preserve an HTML payload.
      undoText: snapshot.html === null ? snapshot.text : undefined,
    },
  });
  return true;
}

/** Asks a focused page for the full native format inventory before any automatic write. */
function inspectClipboard(): void {
  if (!candidate || inspectionPending) return;
  const pending = identity(candidate);
  inspectionPending = true;
  void chrome.runtime
    .sendMessage({ type: 'inspect-clipboard' })
    .then((response: unknown) => {
      if (
        typeof response === 'object' &&
        response !== null &&
        'ok' in response &&
        response.ok === true &&
        candidate &&
        identity(candidate) === pending
      ) {
        candidate = null;
      }
    })
    .catch(() => undefined)
    .finally(() => {
      inspectionPending = false;
    });
}

/** Stages changed payloads; synthetic paste alone cannot reveal native web-custom formats. */
function check(): void {
  if (!config) return;
  const snapshot = readClipboard();
  if (!snapshot) return;
  observe(snapshot);
  const current = identity(snapshot);
  if (current !== lastSeen) {
    const previous = lastSeen;
    lastSeen = current;
    candidate = null;
    window.clearTimeout(graceTimer);
    if (previous === null || isIgnored(snapshot) || !supported(snapshot)) return;
    candidate = snapshot;
    graceTimer = window.setTimeout(check, GRACE_MS);
    return;
  }
  inspectClipboard();
}

/** Starts or stops polling while retaining Undo suppression across worker reconfiguration. */
function configure(next: WatchConfig | null): void {
  epoch += 1;
  config = next;
  window.clearInterval(timer);
  window.clearTimeout(graceTimer);
  candidate = null;
  if (next) {
    timer = window.setInterval(check, POLL_MS);
    check();
  } else {
    lastSeen = null;
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (response: { ok: boolean; epoch?: number }) => void) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      !['offscreen-copy', 'offscreen-restore', 'offscreen-reconcile', 'offscreen-epoch', 'watch-config'].includes(
        String(message.type),
      )
    ) {
      return false;
    }
    if (!isExtensionMessage(message) || !isWorkerSender(sender)) {
      sendResponse({ ok: false });
      return false;
    }
    switch (message.type) {
      case 'offscreen-copy':
        epoch += 1;
        candidate = null;
        sendResponse({ ok: writeClipboard(plainText(message.text)) });
        break;
      case 'offscreen-restore': {
        epoch += 1;
        const restored = plainText(message.text);
        ignored = restored;
        candidate = null;
        window.clearTimeout(graceTimer);
        sendResponse({ ok: writeClipboard(restored) });
        break;
      }
      case 'offscreen-reconcile':
        sendResponse({
          ok: reconcile(
            message.text,
            message.embedded,
            message.config,
            message.types,
            message.epoch,
            message.tabId,
            message.baseline,
          ),
        });
        break;
      case 'offscreen-epoch':
        sendResponse({ ok: true, epoch });
        break;
      case 'watch-config':
        configure(message.config);
        sendResponse({ ok: true });
        break;
      default:
        break;
    }
    return false;
  },
);
