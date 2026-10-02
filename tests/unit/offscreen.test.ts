// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionMessage } from '../../src/lib/messages';
import { rewriteUrl } from '../../src/lib/rewrite';

const TRACKED = 'https://example.com/page?utm_source=newsletter';
const CLEAN = 'https://example.com/page';
const CONFIG = { mode: 'strip' as const, key: 'test' };
const WORKER = { id: 'extension-id' };

/** Clipboard flavors presented by one fake synchronous paste. */
interface FakeClipboard {
  text: string;
  html: string | null;
  types: string[];
  nativeTypes?: string[];
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  Reflect.deleteProperty(document, 'execCommand');
  document.body.innerHTML = '';
});

/** Starts the actual offscreen coordinator with controllable clipboard flavors and timers. */
async function start() {
  vi.useFakeTimers();
  document.body.innerHTML = '<textarea></textarea>';
  const textarea = document.querySelector('textarea');
  if (!textarea) throw new Error('Missing clipboard field');
  const clipboard: FakeClipboard = { text: 'baseline', html: null, types: ['text/plain'] };
  let onMessage:
    | ((
        message: unknown,
        sender: chrome.runtime.MessageSender,
        respond: (response: { ok: boolean; epoch?: number }) => void,
      ) => void)
    | undefined;
  const inspector = { enabled: true };
  const sendMessage = vi.fn<(message: ExtensionMessage) => Promise<unknown>>((payload) => {
    if (payload.type !== 'inspect-clipboard') return Promise.resolve(undefined);
    if (!inspector.enabled) return Promise.resolve({ ok: false });
    const types = clipboard.nativeTypes ?? clipboard.types;
    if (types.some((type) => type !== 'text/plain' && type !== 'text/html')) return Promise.resolve({ ok: true });
    let epoch = -1;
    onMessage?.({ type: 'offscreen-epoch' }, WORKER, (value) => {
      epoch = value.epoch ?? -1;
    });
    let response = { ok: false };
    onMessage?.(
      { type: 'offscreen-reconcile', text: clipboard.text, embedded: true, config: CONFIG, types, epoch },
      WORKER,
      (value) => {
        response = value;
      },
    );
    return Promise.resolve(response);
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: WORKER.id,
      getURL: (path: string) => `chrome-extension://${WORKER.id}/${path}`,
      sendMessage,
      onMessage: {
        addListener(listener: NonNullable<typeof onMessage>) {
          onMessage = listener;
        },
      },
    },
  });
  const writes = vi.fn();
  const execCommand = (command: string) => {
    if (command === 'paste') {
      const data = new DataTransfer();
      for (const type of clipboard.types) {
        data.setData(
          type,
          type === 'text/html' ? (clipboard.html ?? '') : type === 'text/plain' ? clipboard.text : 'opaque',
        );
      }
      textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }));
    } else if (command === 'copy') {
      const data = new DataTransfer();
      textarea.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, cancelable: true }));
      clipboard.text = data.getData('text/plain');
      clipboard.html = data.types.includes('text/html') ? data.getData('text/html') : null;
      clipboard.types = Array.from(data.types);
      clipboard.nativeTypes = undefined;
      writes();
    }
    return true;
  };
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  await import('../../src/offscreen');
  if (!onMessage) throw new Error('Missing offscreen listener');
  const listener = onMessage;
  const message = (payload: unknown, sender: chrome.runtime.MessageSender = WORKER) => {
    const response = vi.fn();
    listener(payload, sender, response);
    return response;
  };
  message({ type: 'watch-config', config: CONFIG });
  const readEpoch = () => {
    let epoch = -1;
    listener({ type: 'offscreen-epoch' }, WORKER, (response) => {
      epoch = response.epoch ?? -1;
    });
    return epoch;
  };
  return { clipboard, sendMessage, message, writes, inspector, readEpoch };
}

it('writes explicit generated and unchanged links beyond the rewrite input limit', async () => {
  const { clipboard, message } = await start();
  const input = `https://example.com/?${Array<string>(6000).fill('utm_source=x').join('&')}`;
  const rewritten = rewriteUrl(input, { mode: 'decoy', key: 'test-key' })?.url;
  expect(input.length).toBeLessThan(100_000);
  expect(rewritten?.length).toBeGreaterThan(100_000);
  if (!rewritten) throw new Error('Missing rewritten link');
  const unchanged = `https://example.com/?data=${'x'.repeat(100_001)}`;
  for (const text of [rewritten, unchanged]) {
    expect(message({ type: 'offscreen-copy', text })).toHaveBeenCalledWith({ ok: true });
    expect(clipboard.text).toBe(text);
  }
});

it.each([undefined, 'https://example.com/page', 'https://www.youtube.com/feed'])(
  'uses the originating page context for relative text and HTML (%s)',
  async (baseUrl) => {
    const { clipboard, message, readEpoch } = await start();
    const original = '/watch?v=1&si=abcdefgh&utm_source=email';
    clipboard.text = original;
    clipboard.html = `<a href="${original}">A video</a>`;
    clipboard.types = ['text/plain', 'text/html'];
    message({
      type: 'offscreen-reconcile',
      epoch: readEpoch(),
      types: clipboard.types,
      text: original,
      embedded: false,
      config: CONFIG,
      baseUrl,
    });
    const expected =
      baseUrl === undefined ? original : baseUrl.includes('youtube.com') ? '/watch?v=1' : '/watch?v=1&si=abcdefgh';
    expect(clipboard.text).toBe(expected);
    const html = new DOMParser().parseFromString(clipboard.html, 'text/html');
    expect(html.querySelector('a')?.getAttribute('href')).toBe(expected);
    expect(html.querySelector('a')?.textContent).toBe('A video');
    expect(clipboard.types).toEqual(['text/plain', 'text/html']);
  },
);

it('atomically restores and suppresses Undo across reconfiguration, then expires after another copy', async () => {
  const { clipboard, sendMessage, message, readEpoch } = await start();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(750);
  clipboard.text = CLEAN;
  message({ type: 'offscreen-restore', text: TRACKED });
  message({ type: 'watch-config', config: null });
  message({ type: 'watch-config', config: CONFIG });
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: TRACKED,
    embedded: true,
    config: CONFIG,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(sendMessage).not.toHaveBeenCalled();

  clipboard.text = 'another copy';
  await vi.advanceTimersByTimeAsync(750);
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(CLEAN);
});

it('rewrites a pending candidate normally', async () => {
  const { clipboard, sendMessage } = await start();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(750);
  expect(clipboard.text).toBe(TRACKED);
  await vi.advanceTimersByTimeAsync(250);
  expect(clipboard.text).toBe(CLEAN);
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'rewritten', urls: 1 }));
});

it('leaves the clipboard untouched without a focused native reader, then retries when one is available', async () => {
  const { clipboard, writes, sendMessage, inspector } = await start();
  inspector.enabled = false;
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(1750);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
  expect(sendMessage.mock.calls.filter(([payload]) => payload.type === 'inspect-clipboard')).toHaveLength(2);
  inspector.enabled = true;
  await vi.advanceTimersByTimeAsync(750);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it('preserves native web-custom formats even when synthetic paste exposes only plain text', async () => {
  const { clipboard, writes, message, readEpoch } = await start();
  clipboard.text = TRACKED;
  clipboard.nativeTypes = ['text/plain', 'web application/custom'];
  await vi.advanceTimersByTimeAsync(1750);
  expect(clipboard.text).toBe(TRACKED);
  expect(clipboard.nativeTypes).toContain('web application/custom');
  expect(writes).not.toHaveBeenCalled();
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    text: TRACKED,
    embedded: true,
    config: CONFIG,
    types: clipboard.nativeTypes,
  });
  expect(writes).not.toHaveBeenCalled();
});

it('expires Undo suppression after observing a formats-only clipboard change', async () => {
  const { clipboard, writes, message } = await start();
  message({ type: 'offscreen-restore', text: TRACKED });
  writes.mockClear();
  clipboard.types = ['text/plain', 'image/png'];
  await vi.advanceTimersByTimeAsync(750);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
  clipboard.types = ['text/plain'];
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it.each(['image/png', 'Files', 'application/custom'])(
  'preserves a format-only %s change during the grace period',
  async (type) => {
    const { clipboard, writes, message, readEpoch } = await start();
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(750);
    clipboard.types.push(type);
    await vi.advanceTimersByTimeAsync(250);
    message({
      type: 'offscreen-reconcile',
      epoch: readEpoch(),
      types: clipboard.types,
      text: TRACKED,
      embedded: true,
      config: CONFIG,
    });
    expect(clipboard.text).toBe(TRACKED);
    expect(clipboard.types).toContain(type);
    expect(writes).not.toHaveBeenCalled();
  },
);

it('rejects stale reconciliation without overwriting the newer clipboard contents', async () => {
  const { clipboard, writes, message, readEpoch } = await start();
  clipboard.text = 'a newer copy';
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: TRACKED,
    embedded: true,
    config: CONFIG,
  });
  expect(clipboard.text).toBe('a newer copy');
  expect(writes).not.toHaveBeenCalled();
});

it('expires Undo suppression only when a fresh copy has a different observed baseline', async () => {
  const { clipboard, message, readEpoch } = await start();
  message({ type: 'offscreen-restore', text: TRACKED });
  message({ type: 'watch-config', config: null });
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: TRACKED,
    embedded: true,
    config: CONFIG,
  });
  expect(clipboard.text).toBe(TRACKED);
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: CLEAN,
    embedded: true,
    config: CONFIG,
    baseline: 'another copy',
  });
  expect(clipboard.text).toBe(TRACKED);
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: TRACKED,
    embedded: true,
    config: CONFIG,
  });
  expect(clipboard.text).toBe(TRACKED);
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: TRACKED,
    embedded: true,
    config: CONFIG,
    baseline: 'another copy',
  });
  expect(clipboard.text).toBe(CLEAN);
});

it('rejects another frame’s pre-Undo read before its baseline can clear suppression', async () => {
  const { clipboard, message, readEpoch, writes } = await start();
  const staleEpoch = readEpoch();
  message({ type: 'offscreen-restore', text: TRACKED });
  writes.mockClear();
  message({
    type: 'offscreen-reconcile',
    text: TRACKED,
    embedded: true,
    config: CONFIG,
    types: clipboard.types,
    epoch: staleEpoch,
    baseline: 'another copy',
  });
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
  message({
    type: 'offscreen-reconcile',
    text: TRACKED,
    embedded: true,
    config: CONFIG,
    types: clipboard.types,
    epoch: readEpoch(),
    baseline: 'another copy',
  });
  expect(clipboard.text).toBe(CLEAN);
});

it('invalidates pending reads on worker reconfiguration while retaining Undo suppression', async () => {
  const { clipboard, message, readEpoch, writes } = await start();
  message({ type: 'offscreen-restore', text: TRACKED });
  const staleEpoch = readEpoch();
  message({ type: 'watch-config', config: null });
  message({ type: 'watch-config', config: CONFIG });
  expect(readEpoch()).toBeGreaterThan(staleEpoch);
  writes.mockClear();
  message({
    type: 'offscreen-reconcile',
    text: TRACKED,
    embedded: true,
    config: CONFIG,
    types: clipboard.types,
    epoch: staleEpoch,
    baseline: 'another copy',
  });
  message({
    type: 'offscreen-reconcile',
    text: TRACKED,
    embedded: true,
    config: CONFIG,
    types: clipboard.types,
    epoch: readEpoch(),
  });
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
});

it('invalidates pending automatic reads when an explicit copy is committed', async () => {
  const { clipboard, message, readEpoch, writes } = await start();
  const staleEpoch = readEpoch();
  message({ type: 'offscreen-copy', text: TRACKED });
  writes.mockClear();
  message({
    type: 'offscreen-reconcile',
    text: TRACKED,
    embedded: true,
    config: CONFIG,
    types: clipboard.types,
    epoch: staleEpoch,
  });
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
});

it.each([
  ['A product', ['text/plain', 'text/html']],
  ['', ['text/html']],
])('reconciles HTML-only hrefs while preserving the existing flavors (%s)', async (text, types) => {
  const { clipboard, sendMessage, message, readEpoch } = await start();
  clipboard.text = text;
  clipboard.html = `<a href="${TRACKED}"><b>A product</b></a>`;
  clipboard.types = types;
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text,
    embedded: false,
    config: CONFIG,
    tabId: 7,
  });
  expect(clipboard.text).toBe(text);
  expect(clipboard.html).toBe(`<a href="${CLEAN}"><b>A product</b></a>`);
  expect(clipboard.types).toEqual(types);
  const notification = sendMessage.mock.calls[0]?.[0];
  expect(notification?.type).toBe('rewritten');
  if (notification?.type !== 'rewritten') throw new Error('Missing rewrite notification');
  expect(notification.tabId).toBe(7);
  expect(notification.relayToast?.undoText).toBeUndefined();
});

it('detects an HTML-only payload change during polling', async () => {
  const { clipboard } = await start();
  clipboard.text = 'baseline';
  clipboard.html = `<a href="${TRACKED}">Product</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.html).toBe(`<a href="${CLEAN}">Product</a>`);
});

it('preserves HTML and plain text when both representations need rewriting', async () => {
  const { clipboard, message, readEpoch } = await start();
  clipboard.text = TRACKED;
  clipboard.html = `<style>p { color: red; }</style><p><a href="${TRACKED}">${TRACKED}</a></p>`;
  clipboard.types = ['text/plain', 'text/html'];
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: TRACKED,
    embedded: false,
    config: CONFIG,
  });
  expect(clipboard.text).toBe(CLEAN);
  expect(clipboard.html).toBe(`<style>p { color: red; }</style><p><a href="${CLEAN}">${CLEAN}</a></p>`);
  expect(clipboard.types).toEqual(['text/plain', 'text/html']);
});

it('checks formats again immediately before committing an automatic write', async () => {
  const { clipboard, message, writes, readEpoch } = await start();
  clipboard.text = TRACKED;
  clipboard.html = `<a href="${TRACKED}">Product</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  const parser = new DOMParser();
  const parse = parser.parseFromString.bind(parser);
  vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation((text, type) => {
    clipboard.types.push('image/png');
    return parse(text, type);
  });
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: TRACKED,
    embedded: true,
    config: CONFIG,
  });
  expect(clipboard.text).toBe(TRACKED);
  expect(clipboard.types).toContain('image/png');
  expect(writes).not.toHaveBeenCalled();
});

it('leaves oversized HTML alone before parsing it', async () => {
  const { clipboard, message, writes, readEpoch } = await start();
  const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
  clipboard.html = `<a href="${TRACKED}">${'x'.repeat(100_000)}</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  message({
    type: 'offscreen-reconcile',
    epoch: readEpoch(),
    types: clipboard.types,
    text: 'baseline',
    embedded: false,
    config: CONFIG,
  });
  expect(parse).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
});

it.each([
  { type: 'offscreen-copy' },
  { type: 'offscreen-restore', text: 1 },
  { type: 'watch-config', config: { mode: 'invalid', key: 'test' } },
  { type: 'offscreen-reconcile', epoch: 1, types: ['text/plain'], text: TRACKED, embedded: 'true', config: CONFIG },
  { type: 'offscreen-reconcile', epoch: 1, text: TRACKED, embedded: true, config: CONFIG },
  { type: 'offscreen-reconcile', types: ['text/plain'], text: TRACKED, embedded: true, config: CONFIG },
])('rejects malformed control messages without touching the clipboard ($type)', async (payload) => {
  const { clipboard, writes, message } = await start();
  expect(message(payload)).toHaveBeenCalledWith({ ok: false });
  expect(clipboard.text).toBe('baseline');
  expect(writes).not.toHaveBeenCalled();
});

it('rejects tab-origin control messages and leaves unrelated requests unanswered', async () => {
  const { clipboard, writes, message } = await start();
  expect(
    message({ type: 'offscreen-copy', text: TRACKED }, { ...WORKER, tab: { id: 1 } as chrome.tabs.Tab }),
  ).toHaveBeenCalledWith({ ok: false });
  expect(
    message({ type: 'get-secret' } satisfies ExtensionMessage, { ...WORKER, tab: { id: 1 } as chrome.tabs.Tab }),
  ).not.toHaveBeenCalled();
  expect(clipboard.text).toBe('baseline');
  expect(writes).not.toHaveBeenCalled();
});
