// The offscreen document owns every automatic clipboard read, decision, and write.
import { isExtensionMessage, isWorkerSender, type ClipboardSnapshot, type WatchConfig } from './lib/messages';
import { rewriteText } from './lib/rewrite';
import { createSeed } from './lib/prng';

/** Maximum ordinary polling delay while Chrome is in use. */
const POLL_MS = 200;
let config: WatchConfig | null = null;
let timer = 0;
let checkingFocus = false;
let baselinePending = false;
/** Last eligible link text; unrelated clipboard contents are never retained. */
let observedText: string | null = null;
/** One current entry; `pending` permits one retry and `intended` recognizes a delayed successful write. */
let entry: { before: string; after?: string; intended?: string; pending?: boolean } | null = null;

/** Finds the extension-owned clipboard sink. */
function field(): HTMLTextAreaElement {
  const textarea = document.querySelector('textarea');
  if (!textarea) throw new Error('offscreen.html has no textarea');
  return textarea;
}

/** Reads plain text alone for polling, or all detectable formats before processing a link. */
function readClipboard(command: 'paste' | 'pasteAndMatchStyle' = 'paste'): ClipboardSnapshot | null {
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
  document.execCommand(command);
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

/** Keeps one identity eligible once while remembering any output whose verification was unavailable. */
function recordRetry(before: string, retrying: boolean, intended?: string): void {
  entry = {
    before,
    ...(intended === undefined ? {} : { intended }),
    ...(retrying ? {} : { pending: true }),
  };
}

/** Writes a URL, verifies the result when possible, and bounds inconclusive retries. */
function writeClipboard(snapshot: ClipboardSnapshot, before: string, retrying: boolean): boolean {
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
    const expected = identity(snapshot);
    const landed = readClipboard();
    const observed = landed ? identity(landed) : null;
    if (observed === expected) {
      entry = { before, after: expected };
      observedText = snapshot.text;
      void chrome.runtime.sendMessage({ type: 'rewrite-complete' }).catch(() => undefined);
    } else if (observed === null) {
      recordRetry(before, retrying, expected);
    } else if (observed === before || landed?.text.trim() === snapshot.text) {
      recordRetry(observed, retrying);
    } else {
      // A different external entry is classified afresh instead of retaining unrelated clipboard data.
      entry = null;
      observedText = null;
    }
  }
  return ok;
}

/** Performs one synchronous read, eligible-text decision, write, and read-back. */
function tick(baseline = false): void {
  if (baseline) baselinePending = true;
  // Full paste can load native images before onPaste runs; polling must stay text-only.
  const plain = readClipboard('pasteAndMatchStyle');
  if (!plain) return;
  if (!baselinePending && plain.text === observedText && !entry?.pending) return;
  const result = config ? rewriteText(plain.text, { ...config, key: createSeed() }) : null;
  const confirming = entry?.intended !== undefined && entry.intended === identity(plainText(plain.text));
  if (!result && !confirming) {
    entry = null;
    observedText = null;
    baselinePending = false;
    return;
  }
  if (baselinePending) {
    baselinePending = false;
    observedText = plain.text;
    entry = null;
    return;
  }
  const snapshot = readClipboard();
  if (!snapshot) {
    const current = identity(plain);
    const retrying = entry?.pending === true && current === entry.before;
    const intended = confirming ? entry?.intended : undefined;
    observedText = plain.text;
    recordRetry(current, retrying, intended);
    return;
  }
  if (snapshot.text !== plain.text) {
    entry = null;
    observedText = null;
    return;
  }
  observedText = snapshot.text;
  const current = identity(snapshot);
  if (current === entry?.after) return;
  if (current === entry?.intended) {
    entry = { before: entry.before, after: current };
    void chrome.runtime.sendMessage({ type: 'rewrite-complete' }).catch(() => undefined);
    return;
  }
  if (!entry?.pending && entry?.after === undefined && current === entry?.before) return;
  const retrying = entry?.pending === true && current === entry.before;
  entry = { before: current };
  if (!config || !supported(snapshot) || !result) return;
  const latest = readClipboard();
  if (!latest) {
    recordRetry(current, retrying);
    return;
  }
  const latestIdentity = identity(latest);
  if (latestIdentity !== current) {
    entry = null;
    observedText = null;
    return;
  }
  if (!writeClipboard(plainText(result.text), current, retrying)) {
    recordRetry(current, retrying);
    return;
  }
}

/** Queries Chrome focus before the next clipboard observation, without overlapping requests. */
function checkFocus(): void {
  if (checkingFocus) return;
  checkingFocus = true;
  void chrome.runtime
    .sendMessage({ type: 'watch-focus' })
    .catch(() => undefined)
    .finally(() => {
      checkingFocus = false;
    });
}

/** Applies queried focus: flush on blur, baseline on regain, and process ordinary focused ticks. */
function configure(next: WatchConfig | null, baseline = false, skipFinalTick = false): void {
  const wasFocused = config?.focused === true;
  const focused = next?.focused === true;
  if (wasFocused && next !== null && !focused && !skipFinalTick) tick();
  config = next;
  if (focused) tick(baseline || !wasFocused);
  if (next && !timer) timer = window.setInterval(checkFocus, POLL_MS);
  if (!next) {
    window.clearInterval(timer);
    timer = 0;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: { ok: boolean }) => void) => {
  if (!(
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    ['watch-config', 'watch-flush'].includes(String(message.type))
  ))
    return false;
  if (!isExtensionMessage(message) || !isWorkerSender(sender)) {
    sendResponse({ ok: false });
    return false;
  }
  switch (message.type) {
    case 'watch-config':
      configure(message.config, message.baseline, message.skipFinalTick);
      sendResponse({ ok: true });
      break;
    case 'watch-flush':
      if (config?.focused) tick();
      sendResponse({ ok: true });
      break;
  }
  return false;
});
