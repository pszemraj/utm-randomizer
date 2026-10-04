// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionMessage } from '../../src/lib/messages';
import { rewriteUrl } from '../../src/lib/rewrite';

const TRACKED = 'https://example.com/page?utm_source=linkedin';
const CLEAN = 'https://example.com/page';
const CONFIG = { mode: 'strip' as const };
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
    | ((message: unknown, sender: chrome.runtime.MessageSender, respond: (response: { ok: boolean }) => void) => void)
    | undefined;
  const sendMessage = vi.fn<(message: ExtensionMessage) => Promise<unknown>>(() => Promise.resolve(undefined));
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
  return { clipboard, sendMessage, message, writes };
}

it('leaves startup and focus-gain baselines untouched', async () => {
  const { clipboard, message, writes } = await start();
  message({ type: 'watch-config', config: null });
  clipboard.text = TRACKED;
  message({ type: 'watch-config', config: CONFIG });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
});

it('observes a fresh entry across a same-focus worker refresh', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = TRACKED;
  message({ type: 'watch-config', config: CONFIG });
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it('does not rewrite entries while stopped and baselines the next focused interval', async () => {
  const { clipboard, message, writes } = await start();
  message({ type: 'watch-config', config: null });
  clipboard.text = TRACKED;
  clipboard.html = `<a href="${TRACKED}">External copy</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  await vi.advanceTimersByTimeAsync(1000);
  message({ type: 'watch-config', config: CONFIG });
  await vi.advanceTimersByTimeAsync(1000);
  expect(writes).not.toHaveBeenCalled();
  clipboard.html = `<a href="${TRACKED}">Fresh copy</a>`;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(clipboard.html).toBeNull();
  expect(writes).toHaveBeenCalledOnce();
});

it('processes an entry copied after the last poll on blur and stops afterward', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = TRACKED;
  expect(message({ type: 'offscreen-blur' })).toHaveBeenCalledWith({ ok: true });
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).toHaveBeenCalledOnce();
});

it('pauses without flushing an entry copied since the last poll', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = TRACKED;
  message({ type: 'watch-config', config: null });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
});

it('rewrites a fresh URL without a website reader and leaves its output stable', async () => {
  const { clipboard, sendMessage, writes } = await start();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'rewritten', urls: 1 }));
  await vi.advanceTimersByTimeAsync(50 * 200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it.each(['decoy', 'silly', 'hybrid'] as const)(
  'replaces plausible input on each fresh copy without an output loop (%s)',
  async (mode) => {
    const { clipboard, message, writes } = await start();
    message({ type: 'watch-config', config: { mode } });
    const results = new Set<string>();
    for (let copy = 0; copy < 8; copy += 1) {
      clipboard.text = TRACKED;
      await vi.advanceTimersByTimeAsync(200);
      expect(clipboard.text).not.toBe(TRACKED);
      results.add(clipboard.text);
      const output = clipboard.text;
      await vi.advanceTimersByTimeAsync(50 * 200);
      expect(clipboard.text).toBe(output);
      expect(writes).toHaveBeenCalledTimes(copy + 1);
    }
    expect(results.size).toBeGreaterThan(1);
  },
);

it('removes tracking deterministically on repeated fresh copies', async () => {
  const { clipboard, writes } = await start();
  for (let copy = 0; copy < 4; copy += 1) {
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(200);
    expect(clipboard.text).toBe(CLEAN);
    expect(writes).toHaveBeenCalledTimes(copy + 1);
  }
});

it.each([false, true])('retains completed output across configuration (HTML %s)', async (rich) => {
  const { clipboard, writes, message } = await start();
  message({ type: 'watch-config', config: { mode: 'decoy' } });
  clipboard.text = TRACKED;
  if (rich) {
    clipboard.html = `<a href="${TRACKED}">${TRACKED}</a>`;
    clipboard.types = ['text/plain', 'text/html'];
  }
  await vi.advanceTimersByTimeAsync(200);
  const output = { ...clipboard };
  message({ type: 'watch-config', config: { mode: 'decoy' } });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard).toEqual(output);
  expect(writes).toHaveBeenCalledOnce();
  clipboard.text = 'another copy';
  await vi.advanceTimersByTimeAsync(200);
  Object.assign(clipboard, output);
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).not.toBe(output.text);
  expect(writes).toHaveBeenCalledTimes(2);
});

it('expires completed output after observing unrelated text', async () => {
  const { clipboard, message, writes } = await start();
  message({ type: 'offscreen-copy', text: TRACKED });
  clipboard.text = 'unrelated contents';
  await vi.advanceTimersByTimeAsync(200);
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledTimes(2);
});

it('normalizes a rewritten single URL to plain text and restores its original text on Undo', async () => {
  const { clipboard, message } = await start();
  const original = ` \t${TRACKED}\r\n`;
  clipboard.text = original;
  clipboard.html = `<a href="${TRACKED}">A link</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(clipboard.html).toBeNull();
  expect(clipboard.types).toEqual(['text/plain']);
  expect(message({ type: 'offscreen-restore' })).toHaveBeenCalledWith({ ok: true });
  expect(clipboard.text).toBe(original);
  expect(clipboard.html).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(original);
});

it('retries an unchanged fresh URL after an automatic write fails', async () => {
  const { clipboard, writes } = await start();
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- exercises synchronous copy failure
  const command = document.execCommand.bind(document);
  let fail = true;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'copy' && fail) {
      fail = false;
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserve normal reads and subsequent writes
    return command(name);
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it('retains the completed record when an Undo write fails', async () => {
  const { clipboard, message } = await start();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- exercises synchronous copy failure
  const command = document.execCommand.bind(document);
  const failedWrite = vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- let reads continue while only the write fails
    return name === 'copy' ? false : command(name);
  });
  expect(message({ type: 'offscreen-restore' })).toHaveBeenCalledWith({ ok: false });
  expect(clipboard.text).toBe(CLEAN);
  failedWrite.mockRestore();
  expect(message({ type: 'offscreen-restore' })).toHaveBeenCalledWith({ ok: true });
  expect(clipboard.text).toBe(TRACKED);
});

it('cannot Undo when a different clipboard entry replaced its output', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  clipboard.text = 'another copy';
  writes.mockClear();
  expect(message({ type: 'offscreen-restore' })).toHaveBeenCalledWith({ ok: false });
  expect(clipboard.text).toBe('another copy');
  expect(writes).not.toHaveBeenCalled();
});

it('retains Undo suppression across focus changes and expires it after another observed copy', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  message({ type: 'offscreen-restore' });
  message({ type: 'watch-config', config: null });
  message({ type: 'watch-config', config: CONFIG });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).toHaveBeenCalledTimes(2);
  clipboard.text = 'another copy';
  await vi.advanceTimersByTimeAsync(200);
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
});

it.each(['image/png', 'Files', 'application/custom'])('preserves detectable non-text format %s', async (type) => {
  const { clipboard, writes, sendMessage } = await start();
  clipboard.text = TRACKED;
  clipboard.types.push(type);
  const original = { ...clipboard, types: [...clipboard.types] };
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard).toEqual(original);
  expect(writes).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});

it('writes an eligible URL as plain text even when the legacy reader hides web-added data', async () => {
  const { clipboard, writes } = await start();
  clipboard.text = TRACKED;
  clipboard.nativeTypes = ['text/plain', 'web application/custom'];
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(clipboard.types).toEqual(['text/plain']);
  expect(clipboard.nativeTypes).toBeUndefined();
  expect(writes).toHaveBeenCalledOnce();
});

it.each([
  'A document with no links',
  'https://example.com/item?id=42',
  'https://cdn.example/report?utm_source=email&Expires=1&Signature=abc&Key-Pair-Id=K',
  `Read ${TRACKED} today`,
  `${TRACKED} ${TRACKED}`,
  `# Report\n\n${TRACKED}\n${'A paragraph. '.repeat(100)}`,
  `[article](${TRACKED})`,
  '',
  '/relative?utm_source=email',
])('leaves non-URL document copies untouched: %s', async (text) => {
  const { clipboard, writes, sendMessage } = await start();
  clipboard.text = text;
  clipboard.html = `<a href="${TRACKED}">${text}</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  clipboard.nativeTypes = ['text/plain', 'text/html', 'web application/custom'];
  const original = { ...clipboard };
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard).toEqual(original);
  expect(writes).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});

it('checks formats again immediately before committing an automatic write', async () => {
  const { clipboard, writes } = await start();
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- tests the synchronous offscreen reader
  const command = document.execCommand.bind(document);
  let reads = 0;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserve the mock before racing its formats
    const result = command(name);
    if (name === 'paste' && ++reads === 1) clipboard.types.push('image/png');
    return result;
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(TRACKED);
  expect(clipboard.types).toContain('image/png');
  expect(writes).not.toHaveBeenCalled();
});

it('writes explicit generated and unchanged links beyond the rewrite input limit', async () => {
  const { clipboard, message } = await start();
  const input = `https://example.com/?${Array<string>(6000).fill('utm_source=x').join('&')}`;
  const rewritten = rewriteUrl(input, { mode: 'decoy', key: 'test-key' })?.url;
  expect(input.length).toBeLessThan(100_000);
  expect(rewritten?.length).toBeGreaterThan(100_000);
  if (!rewritten) throw new Error('Missing rewritten link');
  for (const text of [rewritten, `https://example.com/?data=${'x'.repeat(100_001)}`]) {
    expect(message({ type: 'offscreen-copy', text })).toHaveBeenCalledWith({ ok: true });
    expect(clipboard.text).toBe(text);
  }
});

it.each([{ type: 'offscreen-copy' }, { type: 'watch-config', config: { mode: 'invalid' } }])(
  'rejects malformed control messages without touching the clipboard ($type)',
  async (payload) => {
    const { clipboard, writes, message } = await start();
    expect(message(payload)).toHaveBeenCalledWith({ ok: false });
    expect(clipboard.text).toBe('baseline');
    expect(writes).not.toHaveBeenCalled();
  },
);

it('rejects tab-origin control messages', async () => {
  const { clipboard, writes, message } = await start();
  expect(
    message({ type: 'offscreen-copy', text: TRACKED }, { ...WORKER, tab: { id: 1 } as chrome.tabs.Tab }),
  ).toHaveBeenCalledWith({ ok: false });
  expect(clipboard.text).toBe('baseline');
  expect(writes).not.toHaveBeenCalled();
});
