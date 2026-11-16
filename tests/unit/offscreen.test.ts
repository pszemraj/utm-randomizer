// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { isExtensionMessage } from '../../src/lib/messages';

const TRACKED = 'https://example.com/page?utm_source=linkedin';
const CLEAN = 'https://example.com/page';
const CONFIG = { mode: 'strip' as const, focused: true };
const WORKER = { id: 'extension-id' };

/** Time until an ordinary poll looks again at clipboard text of this length, plus the poll that notices. */
function rereadPause(text: string): number {
  return text.length / 5 + 200;
}

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
    if (command === 'paste' || command === 'pasteAndMatchStyle') {
      reads(command);
      const data = new DataTransfer();
      for (const type of clipboard.types) {
        if (command === 'pasteAndMatchStyle' && type !== 'text/plain') continue;
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

it('clears a pending retry when the same text becomes a focus-regain baseline', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- hides the first rich inspection
  const command = document.execCommand.bind(document);
  let unavailable = true;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && unavailable) {
      unavailable = false;
      return true;
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves ordinary reads and writes
    return command(name);
  });
  message({ type: 'watch-config', config: CONFIG });
  expect(writes).not.toHaveBeenCalled();
  message({ type: 'watch-config', config: { ...CONFIG, focused: false }, skipFinalTick: true });
  message({ type: 'watch-config', config: CONFIG, baseline: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(TRACKED);
  expect(writes).not.toHaveBeenCalled();
});

it.each([false, true])('keeps empty tracking values observed across mode changes (baseline %s)', async (baseline) => {
  const { clipboard, message, writes } = await start();
  const config = { mode: 'hybrid' as const, focused: true };
  message({ type: 'watch-config', config });
  const original = 'https://example.com/page?utm_source=';
  clipboard.text = original;
  message({ type: 'watch-config', config, baseline });
  message({ type: 'watch-config', config: CONFIG });
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard.text).toBe(original);
  expect(writes).not.toHaveBeenCalled();

  clipboard.text = `${original}&id=42`;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe('https://example.com/page?id=42');
  expect(writes).toHaveBeenCalledOnce();
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
  clipboard.text = `${TRACKED}&utm_medium=email`;
  clipboard.html = `<a href="${clipboard.text}">Fresh copy</a>`;
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

it.each(['raced', 'intended', 'original'] as const)(
  'processes a fresh entry after different data wins read-back (restore %s)',
  async (restore) => {
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

    if (restore === 'intended') clipboard.text = intended;
    if (restore === 'original') clipboard.text = TRACKED;
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

it.each(['strip', 'silly'] as const)(
  'recognizes intended output after unavailable verification and inspection (%s)',
  async (mode) => {
    const { clipboard, message, writes, requestFocus } = await start();
    const config = { mode, focused: true };
    message({ type: 'watch-config', config });
    clipboard.text = TRACKED;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- hides verification and the next rich inspection
    const command = document.execCommand.bind(document);
    let hiddenPastes = 0;
    vi.spyOn(document, 'execCommand').mockImplementation((name) => {
      if (name === 'paste' && hiddenPastes > 0) {
        hiddenPastes -= 1;
        return true;
      }
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves the clipboard write and ordinary reads
      const result = command(name);
      if (name === 'copy') hiddenPastes = 2;
      return result;
    });

    message({ type: 'watch-config', config });
    const output = clipboard.text;
    expect(output).not.toBe(TRACKED);
    expect(writes).toHaveBeenCalledOnce();
    expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(0);

    message({ type: 'watch-config', config });
    await vi.advanceTimersByTimeAsync(1000);
    expect(clipboard.text).toBe(output);
    expect(writes).toHaveBeenCalledOnce();
    expect(requestFocus.mock.calls.filter(([payload]) => payload.type === 'rewrite-complete')).toHaveLength(1);
  },
);

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

it('bounds unavailable initial rich reads and accepts a different text afterward', async () => {
  const { clipboard, reads, writes } = await start();
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- makes only rich inspection unavailable
  const command = document.execCommand.bind(document);
  let unavailable = true;
  const richReads = vi.fn();
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && unavailable) {
      richReads();
      return true;
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves ordinary polling and recovered reads
    return command(name);
  });
  reads.mockClear();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(richReads).toHaveBeenCalledTimes(2);
  expect(writes).not.toHaveBeenCalled();
  unavailable = false;
  clipboard.text = 'https://example.com/newer?utm_source=email';
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe('https://example.com/newer');
  expect(writes).toHaveBeenCalledOnce();
});

it.each([{ failures: [1, 3] }, { failures: [2, 3] }])(
  'shares the retry limit across mixed rich-read failures (%j)',
  async ({ failures }) => {
    const { clipboard, writes } = await start();
    clipboard.text = TRACKED;
    clipboard.html = `<a href="${TRACKED}">link</a>`;
    clipboard.types = ['text/plain', 'text/html'];
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- fails inspection and safety reads in either order
    const command = document.execCommand.bind(document);
    let richReads = 0;
    vi.spyOn(document, 'execCommand').mockImplementation((name) => {
      if (name === 'paste' && failures.includes(++richReads)) return true;
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves successful reads and writes
      return command(name);
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes).not.toHaveBeenCalled();
    expect(clipboard.text).toBe(TRACKED);
    expect(richReads).toBe(3);
  },
);

it('keeps a focus-regain baseline pending until the clipboard can be read', async () => {
  const { clipboard, message, writes } = await start();
  message({ type: 'watch-config', config: null });
  clipboard.text = TRACKED;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- makes only the immediate regain baseline unavailable
  const command = document.execCommand.bind(document);
  let unavailable = true;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'pasteAndMatchStyle' && unavailable) {
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

it.each(['baseline', 'output'] as const)(
  'releases the previous %s after new text is observed but its rich read fails',
  async (previous) => {
    const { clipboard, message, writes } = await start();
    const mode = { mode: 'silly' as const, focused: true };
    clipboard.text = TRACKED;
    message({ type: 'watch-config', config: mode, baseline: previous === 'baseline' });
    const prior = clipboard.text;
    const previousWrites = writes.mock.calls.length;
    clipboard.text = 'https://example.com/newer?utm_source=email';
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- makes the new entry's first rich read unavailable
    const command = document.execCommand.bind(document);
    let unavailable = true;
    vi.spyOn(document, 'execCommand').mockImplementation((name) => {
      if (name === 'paste' && unavailable) {
        unavailable = false;
        return true;
      }
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves plain polling and subsequent reads
      return command(name);
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(writes).toHaveBeenCalledTimes(previousWrites);
    clipboard.text = prior;
    await vi.advanceTimersByTimeAsync(200);
    expect(clipboard.text).not.toBe(prior);
    expect(writes).toHaveBeenCalledTimes(previousWrites + 1);
  },
);

it.each(['image/png', 'Files', 'application/custom'])('preserves detectable non-text format %s', async (type) => {
  const { clipboard, writes } = await start();
  clipboard.text = TRACKED;
  clipboard.types.push(type);
  const original = { ...clipboard, types: [...clipboard.types] };
  await vi.advanceTimersByTimeAsync(1000);
  expect(clipboard).toEqual(original);
  expect(writes).not.toHaveBeenCalled();
});

it('polls image-only contents without reading rich clipboard data', async () => {
  const { clipboard, reads, writes } = await start();
  clipboard.text = '';
  clipboard.types = ['image/png'];
  reads.mockClear();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads).toHaveBeenCalledTimes(50);
  expect(reads.mock.calls.every(([command]) => command === 'pasteAndMatchStyle')).toBe(true);
  expect(clipboard.types).toEqual(['image/png']);
  expect(writes).not.toHaveBeenCalled();
});

it.each(['private unrelated text', 'https://example.com/page?keep=42'])(
  'does not read HTML or other formats for ineligible text: %s',
  async (text) => {
    const { clipboard, reads, writes } = await start();
    clipboard.text = text;
    clipboard.html = '<p>private HTML</p>';
    clipboard.types = ['text/plain', 'text/html'];
    reads.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads.mock.calls.every(([command]) => command === 'pasteAndMatchStyle')).toBe(true);
    expect(clipboard.html).toBe('<p>private HTML</p>');
    expect(writes).not.toHaveBeenCalled();
  },
);

it.each([
  ['prose', `https://example.com/page?id=42\n${'A paragraph. '.repeat(7400)}`],
  ['functional URL', `https://example.com/?${Array<string>(16000).fill('id=00').join('&')}`],
])('classifies unchanged ineligible %s once without retaining earlier entries', async (_kind, text) => {
  const { clipboard, writes } = await start();
  const rewrite = await import('../../src/lib/rewrite');
  const classify = vi.spyOn(rewrite, 'rewriteText');
  clipboard.text = text;
  await vi.advanceTimersByTimeAsync(1000);
  expect(classify).toHaveBeenCalledOnce();
  expect(writes).not.toHaveBeenCalled();

  clipboard.text = 'different unrelated contents';
  await vi.advanceTimersByTimeAsync(rereadPause(text));
  expect(classify).toHaveBeenCalledTimes(2);
  clipboard.text = text;
  await vi.advanceTimersByTimeAsync(200);
  expect(classify).toHaveBeenCalledTimes(3);
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(rereadPause(text));
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
  expect(classify).toHaveBeenCalledTimes(4);
  clipboard.text = text;
  await vi.advanceTimersByTimeAsync(200);
  expect(classify).toHaveBeenCalledTimes(5);
  expect(clipboard.text).toBe(text);
  expect(writes).toHaveBeenCalledOnce();
});

it('does not fingerprint oversized clipboard text or block a smaller new link', async () => {
  const { clipboard, writes } = await start();
  const prng = await import('../../src/lib/prng');
  const fingerprint = vi.spyOn(prng, 'compactSeed');
  const oversized = 'x'.repeat(200_000);
  clipboard.text = oversized;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fingerprint).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(rereadPause(oversized));
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it('re-reads long clipboard text in proportion to its length', async () => {
  const { clipboard, reads, writes } = await start();
  clipboard.text = 'x'.repeat(1000);
  reads.mockClear();
  await vi.advanceTimersByTimeAsync(2000);
  expect(reads).toHaveBeenCalledTimes(10);
  clipboard.text = 'x'.repeat(10_000);
  reads.mockClear();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads).toHaveBeenCalledTimes(5);
  expect(writes).not.toHaveBeenCalled();
});

it('cleans a link copied during a long-text pause when the pause ends', async () => {
  const { clipboard, reads, writes } = await start();
  clipboard.text = 'x'.repeat(10_000);
  await vi.advanceTimersByTimeAsync(200);
  reads.mockClear();
  clipboard.text = TRACKED;
  await vi.advanceTimersByTimeAsync(1800);
  expect(reads).not.toHaveBeenCalled();
  expect(clipboard.text).toBe(TRACKED);
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();
});

it('takes final ticks and focus-regain baselines during a long-text pause', async () => {
  const { clipboard, message, writes } = await start();
  clipboard.text = 'x'.repeat(100_000);
  await vi.advanceTimersByTimeAsync(200);
  clipboard.text = TRACKED;
  expect(message({ type: 'watch-flush' })).toHaveBeenCalledWith({ ok: true });
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledOnce();

  clipboard.text = 'y'.repeat(100_000);
  await vi.advanceTimersByTimeAsync(200);
  message({ type: 'watch-config', config: { ...CONFIG, focused: false } });
  clipboard.text = TRACKED;
  message({ type: 'watch-config', config: CONFIG });
  expect(clipboard.text).toBe(TRACKED);
  // A skipped baseline would stay pending and absorb this fresh copy instead of cleaning it.
  clipboard.text = `${TRACKED}&utm_medium=email`;
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(CLEAN);
  expect(writes).toHaveBeenCalledTimes(2);
});

it('retries a pending long link without waiting out its pause', async () => {
  const { clipboard, writes } = await start();
  const id = 'x'.repeat(5000);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- hides the first rich inspection
  const command = document.execCommand.bind(document);
  let unavailable = true;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && unavailable) {
      unavailable = false;
      return true;
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves ordinary reads and writes
    return command(name);
  });
  clipboard.text = `${TRACKED}&id=${id}`;
  await vi.advanceTimersByTimeAsync(400);
  expect(clipboard.text).toBe(`${CLEAN}?id=${id}`);
  expect(writes).toHaveBeenCalledOnce();
});

it('inspects a link with an image once instead of loading its image on every poll', async () => {
  const { clipboard, reads, writes } = await start();
  clipboard.text = TRACKED;
  clipboard.types = ['text/plain', 'image/png'];
  reads.mockClear();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads.mock.calls.filter(([command]) => command === 'paste')).toHaveLength(1);
  expect(clipboard.text).toBe(TRACKED);
  expect(clipboard.types).toContain('image/png');
  expect(writes).not.toHaveBeenCalled();
});

it('baselines eligible image text without reading its rich formats on each focus regain', async () => {
  const { clipboard, message, reads, writes } = await start();
  clipboard.text = TRACKED;
  clipboard.types = ['text/plain', 'image/png'];
  reads.mockClear();
  for (let regain = 0; regain < 5; regain += 1) {
    message({ type: 'watch-config', config: CONFIG, baseline: true });
    await vi.advanceTimersByTimeAsync(200);
  }
  expect(reads.mock.calls.every(([command]) => command === 'pasteAndMatchStyle')).toBe(true);
  expect(clipboard.text).toBe(TRACKED);
  expect(clipboard.types).toContain('image/png');
  expect(writes).not.toHaveBeenCalled();
});

it('ignores HTML-only changes while the observed link text stays unchanged', async () => {
  const { clipboard, message, reads, writes } = await start();
  clipboard.text = TRACKED;
  message({ type: 'watch-config', config: CONFIG, baseline: true });
  reads.mockClear();
  clipboard.html = '<a>different HTML</a>';
  clipboard.types = ['text/plain', 'text/html'];
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads.mock.calls.every(([command]) => command === 'pasteAndMatchStyle')).toBe(true);
  expect(clipboard.text).toBe(TRACKED);
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

it('preserves newer text that arrives between the plain read and rich inspection', async () => {
  const { clipboard, writes } = await start();
  clipboard.text = TRACKED;
  const newer = 'https://other.example/newer?utm_source=email&id=7';
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- replaces the clipboard before its first rich read
  const command = document.execCommand.bind(document);
  let replaced = false;
  vi.spyOn(document, 'execCommand').mockImplementation((name) => {
    if (name === 'paste' && !replaced) {
      replaced = true;
      clipboard.text = newer;
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- preserves the clipboard commands around the race
    return command(name);
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe(newer);
  expect(writes).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(clipboard.text).toBe('https://other.example/newer?id=7');
  expect(writes).toHaveBeenCalledOnce();
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
