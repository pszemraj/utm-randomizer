// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { isExtensionMessage } from '../../src/lib/messages';

const TRACKED = 'https://example.com/page?utm_source=linkedin';
const CLEAN = 'https://example.com/page';
const CONFIG = { mode: 'strip' as const, focused: true };
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
  let workerConfig: import('../../src/lib/messages').WatchConfig | null = CONFIG;
  const requestFocus = vi.fn((message: import('../../src/lib/messages').ExtensionMessage) => {
    if (message.type === 'watch-focus') {
      onMessage?.({ type: 'watch-config', config: workerConfig }, WORKER, () => undefined);
    }
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: WORKER.id,
      getURL: (path: string) => `chrome-extension://${WORKER.id}/${path}`,
      sendMessage: requestFocus,
      onMessage: {
        addListener(listener: NonNullable<typeof onMessage>) {
          onMessage = listener;
        },
      },
    },
  });
  const writes = vi.fn();
  const reads = vi.fn();
  const execCommand = (command: string) => {
    if (command === 'paste') {
      reads();
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
    const response = vi.fn<(response: { ok: boolean }) => void>();
    listener(payload, sender, response);
    if (response.mock.calls[0]?.[0].ok && isExtensionMessage(payload) && payload.type === 'watch-config') {
      workerConfig = payload.config;
    }
    return response;
  };
  message({ type: 'watch-config', config: CONFIG });
  return { clipboard, message, writes, reads, requestFocus };
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

it('takes an untouched baseline when the worker marks a same-focus regain', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = TRACKED;
  message({ type: 'watch-config', config: CONFIG, baseline: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
});

it('takes an immediate final tick when a potential blur event is reported', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = TRACKED;
  expect(message({ type: 'watch-flush' })).toHaveBeenCalledWith({ ok: true });
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it('checks focus without reading the clipboard while unfocused, then baselines the next interval', async () => {
  const { clipboard, message, writes, reads, requestFocus } = await start();
  message({ type: 'watch-config', config: { ...CONFIG, focused: false } });
  const previousReads = reads.mock.calls.length;
  clipboard.text = TRACKED;
  clipboard.html = `<a href="${TRACKED}">External copy</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads).toHaveBeenCalledTimes(previousReads);
  expect(requestFocus).toHaveBeenCalledTimes(5);
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
  expect(message({ type: 'watch-config', config: { ...CONFIG, focused: false } })).toHaveBeenCalledWith({ ok: true });
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
  const { clipboard, writes, requestFocus } = await start();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
  expect(requestFocus).toHaveBeenCalledWith({ type: 'rewrite-complete' });
  await vi.advanceTimersByTimeAsync(50 * 200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it('waits for a focus check without overlapping requests or retaining an older clipboard candidate', async () => {
  const { clipboard, writes, requestFocus } = await start();
  let release!: () => void;
  requestFocus.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
  );
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(1000);
  expect(requestFocus).toHaveBeenCalledOnce();
  expect(writes).not.toHaveBeenCalled();
  clipboard.text = 'https://example.com/newer?utm_source=linkedin';
  release();
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe('https://example.com/newer');
  expect(writes).toHaveBeenCalledOnce();
});

it.each(['decoy', 'silly', 'hybrid'] as const)(
  'replaces plausible input on each fresh copy without an output loop (%s)',
  async (mode) => {
    const { clipboard, message, writes } = await start();
    message({ type: 'watch-config', config: { mode, focused: true } });
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
  message({ type: 'watch-config', config: { mode: 'decoy', focused: true } });
  clipboard.text = TRACKED;
  if (rich) {
    clipboard.html = `<a href="${TRACKED}">${TRACKED}</a>`;
    clipboard.types = ['text/plain', 'text/html'];
  }
  await vi.advanceTimersByTimeAsync(200);
  const output = { ...clipboard };
  message({ type: 'watch-config', config: { mode: 'decoy', focused: true } });
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
  const { clipboard, writes } = await start();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  clipboard.text = 'unrelated contents';
  await vi.advanceTimersByTimeAsync(200);
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledTimes(2);
});

it('normalizes rewritten clipboard text to plain text', async () => {
  const { clipboard } = await start();
  const original = `Read ${TRACKED} today`;
  clipboard.text = original;
  clipboard.html = `<a href="${TRACKED}">A link</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(`Read ${CLEAN} today`);
  expect(clipboard.html).toBeNull();
  expect(clipboard.types).toEqual(['text/plain']);
});

it.each([false, true])(
  'processes a fresh entry after different data wins read-back (restore intended output %s)',
  async (restoreIntended) => {
    const { clipboard, message, writes, requestFocus } = await start();
    const raced = 'https://example.com/newer?utm_source=email';
    message({ type: 'watch-config', config: { mode: 'silly', focused: true } });
    clipboard.text = TRACKED;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- races the synchronous write and read-back
    const command = document.execCommand.bind(document);
    let intended = '';
    let pasteCount = 0;
    vi.spyOn(document, 'execCommand').mockImplementation((name) => {
      if (name === 'paste' && ++pasteCount === 3) clipboard.text = raced;
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves the clipboard harness around the race
      const result = command(name);
      if (name === 'copy') intended = clipboard.text;
      return result;
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(clipboard.text).toBe(raced);
    expect(intended).not.toBe('');
    expect(writes).toHaveBeenCalledOnce();
    expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(0);

    if (restoreIntended) clipboard.text = intended;
    const nextInput = clipboard.text;
    await vi.advanceTimersByTimeAsync(200);
    expect(clipboard.text).not.toBe(nextInput);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(1);
  },
);

it.each(['html', 'newline'] as const)(
  'bounds retries when automatic write read-back gains %s data',
  async (variant) => {
    const { clipboard, message, writes, requestFocus } = await start();
    message({ type: 'watch-config', config: { mode: 'hybrid', focused: true } });
    clipboard.text = TRACKED;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- alters synchronous read-back after each write
    const command = document.execCommand.bind(document);
    vi.spyOn(document, 'execCommand').mockImplementation((name) => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves the clipboard harness before altering read-back
      const result = command(name);
      if (name === 'copy') {
        if (variant === 'html') {
          clipboard.html = `<a href="${clipboard.text}">${clipboard.text}</a>`;
          clipboard.types = ['text/plain', 'text/html'];
        } else {
          clipboard.text += '\n';
        }
      }
      return result;
    });

    await vi.advanceTimersByTimeAsync(20 * 200);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(0);
  },
);

it.each(['strip', 'decoy', 'silly', 'hybrid'] as const)(
  'bounds retries when copy reports success without changing the clipboard (%s)',
  async (mode) => {
    const { clipboard, message, writes, requestFocus } = await start();
    message({ type: 'watch-config', config: { mode, focused: true } });
    clipboard.text = TRACKED;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- simulates a successful command whose write is replaced
    const command = document.execCommand.bind(document);
    vi.spyOn(document, 'execCommand').mockImplementation((name) => {
      if (name !== 'copy') {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves ordinary reads
        return command(name);
      }
      const previous = { ...clipboard, types: [...clipboard.types] };
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- records an attempted write before restoring the clipboard
      const result = command(name);
      Object.assign(clipboard, previous, { types: previous.types });
      return result;
    });

    await vi.advanceTimersByTimeAsync(20 * 200);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(clipboard.text).toBe(TRACKED);
    expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(0);
  },
);

it('bounds retries when a successful copy cannot be read back', async () => {
  const { clipboard, writes, requestFocus } = await start();
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- simulates a lost write followed by unavailable verification
  const command = document.execCommand.bind(document);
  let hideNextPaste = false;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && hideNextPaste) {
      hideNextPaste = false;
      return true;
    }
    if (name !== 'copy') {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves ordinary clipboard reads
      return command(name);
    }
    const previous = { ...clipboard, types: [...clipboard.types] };
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- records the attempted write before restoring the original
    const result = command(name);
    Object.assign(clipboard, previous, { types: previous.types });
    hideNextPaste = true;
    return result;
  });

  await vi.advanceTimersByTimeAsync(20 * 200);
  expect(writes).toHaveBeenCalledTimes(2);
  expect(clipboard.text).toBe(TRACKED);
  expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(0);
});

it('recognizes an intended output after its immediate read-back is unavailable', async () => {
  const { clipboard, message, writes, requestFocus } = await start();
  message({ type: 'watch-config', config: { mode: 'silly', focused: true } });
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- hides only the verification read after a successful write
  const command = document.execCommand.bind(document);
  let hideNextPaste = false;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && hideNextPaste) {
      hideNextPaste = false;
      return true;
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves the clipboard write and ordinary reads
    const result = command(name);
    if (name === 'copy') hideNextPaste = true;
    return result;
  });

  message({ type: 'watch-config', config: CONFIG });
  const output = clipboard.text;
  expect(output).not.toBe(TRACKED);
  expect(writes).toHaveBeenCalledOnce();
  expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(0);

  message({ type: 'watch-config', config: CONFIG });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(output);
  expect(writes).toHaveBeenCalledOnce();
  expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(1);
});

it('keeps a raced new entry eligible after the prior entry exhausts its retry', async () => {
  const { clipboard, message, writes } = await start();
  const raced = 'https://example.com/newer?utm_source=email';
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- races a new copy against the retried write read-back
  const command = document.execCommand.bind(document);
  let copies = 0;
  let raceNextPaste = false;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && raceNextPaste) {
      clipboard.text = raced;
      raceNextPaste = false;
    }
    if (name !== 'copy') {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves ordinary reads around the race
      return command(name);
    }
    copies += 1;
    const previous = { ...clipboard, types: [...clipboard.types] };
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- performs the attempted clipboard write
    const result = command(name);
    if (copies === 1) Object.assign(clipboard, previous, { types: previous.types });
    else if (copies === 2) raceNextPaste = true;
    return result;
  });

  await vi.advanceTimersByTimeAsync(2 * 200);
  expect(clipboard.text).toBe(raced);
  expect(writes).toHaveBeenCalledTimes(2);
  message({ type: 'watch-config', config: CONFIG });
  expect(clipboard.text).toBe('https://example.com/newer');
  expect(writes).toHaveBeenCalledTimes(3);
});

it('settles an entry after two unavailable pre-write safety reads', async () => {
  const { clipboard, writes } = await start();
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- simulates a synchronous reader that twice returns no data
  const command = document.execCommand.bind(document);
  let pasteCount = 0;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && [2, 4].includes(++pasteCount)) return true;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves all other clipboard reads
    return command(name);
  });

  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
});

it('keeps a focus-regain baseline pending until the clipboard can be read', async () => {
  const { clipboard, message, writes } = await start();
  message({ type: 'watch-config', config: null });
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- makes only the immediate regain baseline unavailable
  const command = document.execCommand.bind(document);
  let unavailable = true;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && unavailable) {
      unavailable = false;
      return true;
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves the next successful baseline read
    return command(name);
  });

  message({ type: 'watch-config', config: CONFIG });
  message({ type: 'watch-config', config: CONFIG });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
});

it('processes a recopied URL after different data wins the pre-write safety read', async () => {
  const { clipboard, writes } = await start();
  const raced = 'unrelated newer contents';
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- races the synchronous safety read
  const command = document.execCommand.bind(document);
  let pasteCount = 0;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves the clipboard harness around the race
    const result = command(name);
    if (name === 'paste' && ++pasteCount === 1) clipboard.text = raced;
    return result;
  });

  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(raced);
  expect(writes).not.toHaveBeenCalled();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it('processes a different tracked URL that wins the pre-write safety read', async () => {
  const { clipboard, writes } = await start();
  const raced = 'https://example.com/newer?utm_source=email';
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- races a newer tracked entry against the safety read
  const command = document.execCommand.bind(document);
  let pasteCount = 0;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves the clipboard harness around the race
    const result = command(name);
    if (name === 'paste' && ++pasteCount === 1) clipboard.text = raced;
    return result;
  });

  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(raced);
  expect(writes).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe('https://example.com/newer');
  expect(writes).toHaveBeenCalledOnce();
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

it('does not resurrect an older output suppression after a later write fails', async () => {
  const { clipboard, message, writes } = await start();
  message({ type: 'watch-config', config: { mode: 'silly', focused: true } });
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(200);
  const priorOutput = clipboard.text;
  const later = 'https://example.com/later?utm_source=social';
  clipboard.text = later;
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
  expect(clipboard.text).toBe(later);
  clipboard.text = priorOutput;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).not.toBe(priorOutput);
  expect(writes).toHaveBeenCalledTimes(2);
});

it.each(['image/png', 'Files', 'application/custom'])('preserves detectable non-text format %s', async (type) => {
  const { clipboard, writes } = await start();
  clipboard.text = TRACKED;
  clipboard.types.push(type);
  const original = { ...clipboard, types: [...clipboard.types] };
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard).toEqual(original);
  expect(writes).not.toHaveBeenCalled();
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
  `# Report\n\n${TRACKED}\n${'A paragraph. '.repeat(100)}`,
  '',
  '/relative?utm_source=email',
])('leaves ineligible clipboard copies untouched: %s', async (text) => {
  const { clipboard, writes } = await start();
  clipboard.text = text;
  clipboard.html = `<a href="${TRACKED}">${text}</a>`;
  clipboard.types = ['text/plain', 'text/html'];
  clipboard.nativeTypes = ['text/plain', 'text/html', 'web application/custom'];
  const original = { ...clipboard };
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard).toEqual(original);
  expect(writes).not.toHaveBeenCalled();
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

it.each([{ type: 'watch-config' }, { type: 'watch-config', config: { mode: 'invalid' } }])(
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
    message({ type: 'watch-config', config: null }, { ...WORKER, tab: { id: 1 } as chrome.tabs.Tab }),
  ).toHaveBeenCalledWith({ ok: false });
  expect(clipboard.text).toBe('baseline');
  expect(writes).not.toHaveBeenCalled();
});
