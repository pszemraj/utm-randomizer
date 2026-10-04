// The offscreen document owns every automatic clipboard read, decision, and write.
import { isExtensionMessage, isWorkerSender, type ClipboardSnapshot, type WatchConfig } from './lib/messages';
import { rewriteText } from './lib/rewrite';
import { createSeed } from './lib/prng';

/** Maximum ordinary polling delay while Chrome is in use. */
const POLL_MS = 200;
let config: WatchConfig | null = null;
let timer = 0;
/** One current entry; different observed contents replace both identities. */
let entry: { before: string; after?: string } | null = null;

/** Finds the extension-owned clipboard sink. */
function field(): HTMLTextAreaElement {
  const textarea = document.querySelector('textarea');
  if (!textarea) throw new Error('offscreen.html has no textarea');
  return textarea;
}

/** Reads clipboard text and detectable formats without inserting their contents into the document. */
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
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- offscreen documents cannot use the focused async reader
  document.execCommand('paste');
  textarea.removeEventListener('paste', onPaste);
  return snapshot;
}

/** Identifies the current entry by text and detectable accompanying formats. */
function identity(snapshot: ClipboardSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Excludes detectable images, files, and custom formats from URL processing. */
function supported(snapshot: ClipboardSnapshot): boolean {
  return (
    snapshot.types.includes('text/plain') &&
    snapshot.types.every((type) => type === 'text/plain' || type === 'text/html' || type === 'text/uri-list')
  );
}

/** Builds the deliberately plain-text result of a URL copy. */
function plainText(text: string): ClipboardSnapshot {
  return { text, html: null, types: ['text/plain'] };
}

/** Writes a URL and records Chrome's actual read-back, so its own output stays untouched. */
function writeClipboard(snapshot: ClipboardSnapshot, before: string): boolean {
  const textarea = field();
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData?.setData('text/plain', snapshot.text);
  };
  textarea.value = snapshot.text;
  textarea.select();
  textarea.addEventListener('copy', onCopy, { once: true });
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- extension-owned synchronous clipboard writer
  const ok = document.execCommand('copy');
  textarea.removeEventListener('copy', onCopy);
  textarea.value = '';
  if (ok) {
    const landed = readClipboard() ?? snapshot;
    entry = { before, after: identity(landed) };
  }
  return ok;
}

/** Performs one synchronous read, whole-URL decision, write, and read-back. */
function tick(baseline = false): void {
  const snapshot = readClipboard();
  if (!snapshot) return;
  const current = identity(snapshot);
  if (current === (entry?.after ?? entry?.before)) return;
  const previous = entry;
  entry = { before: current };
  if (baseline || previous === null || !config || !supported(snapshot)) return;
  const result = rewriteText(snapshot.text, { ...config, key: createSeed() });
  if (!result) return;
  const latest = readClipboard();
  if (!latest || identity(latest) !== current) return;
  if (!writeClipboard(plainText(result.text), current)) {
    entry = previous;
    return;
  }
}

/** Starts or stops automatic processing; only a new focused interval takes a baseline. */
function configure(next: WatchConfig | null): void {
  const starting = config === null && next !== null;
  config = next;
  window.clearInterval(timer);
  if (starting) tick(true);
  if (next) timer = window.setInterval(tick, POLL_MS);
}

/** Flushes the end of the focused interval before stopping, without attributing the entry's source. */
function blur(): void {
  if (config) tick();
  configure(null);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: { ok: boolean }) => void) => {
  if (!(
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    ['offscreen-blur', 'watch-config'].includes(String(message.type))
  ))
    return false;
  if (!isExtensionMessage(message) || !isWorkerSender(sender)) {
    sendResponse({ ok: false });
    return false;
  }
  switch (message.type) {
    case 'offscreen-blur':
      blur();
      sendResponse({ ok: true });
      break;
    case 'watch-config':
      configure(message.config);
      sendResponse({ ok: true });
      break;
  }
  return false;
});
