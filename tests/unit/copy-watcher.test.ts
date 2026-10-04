// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startCopyWatcher,
  type CopyWatcher,
  type WatchedClipboard,
  type WatcherDeps,
} from '../../src/lib/copy-watcher';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/settings';
import { rewriteUrl } from '../../src/lib/rewrite';
import { isExtensionMessage } from '../../src/lib/messages';

const EPOCH = '00000000-0000-4000-8000-000000000001';
const TRACKED = 'https://example.com/page?id=7&utm_source=newsletter&fbclid=IwAR3abc';
const CLEAN = 'https://example.com/page?id=7';

/** Async Clipboard API stand-in; `modern` exposes the `clipboardchange` event like Chrome 144+. */
class FakeClipboard extends EventTarget implements WatchedClipboard {
  text = '';
  html = '';
  types = ['text/plain'];
  writes: string[] = [];

  constructor(modern: boolean) {
    super();
    if (modern) {
      Object.defineProperty(this, 'onclipboardchange', { value: null });
    }
  }

  /** Current fake clipboard text. */
  readText(): Promise<string> {
    return Promise.resolve(this.text);
  }

  /** Native format inventory and a text snapshot; reads can be delayed independently in tests. */
  read(): ReturnType<WatchedClipboard['read']> {
    const text = this.readText();
    const html = this.html;
    return Promise.resolve([
      {
        types: [...this.types],
        getType: async (type) => new Blob([type === 'text/html' ? html : await text], { type }),
      },
    ]);
  }

  /** Replaces the fake clipboard text and records the write. */
  writeText(text: string): Promise<void> {
    this.text = text;
    this.writes.push(text);
    return Promise.resolve();
  }

  /** Something (the page, the browser) replaced the clipboard contents. */
  change(text: string, types: string[] = ['text/plain']): void {
    this.text = text;
    this.types = types;
    this.dispatchEvent(trusted(Object.assign(new Event('clipboardchange'), { types })));
  }
}

let watcher: CopyWatcher | undefined;
let settings: Settings;
let reconcile: ReturnType<typeof vi.fn<WatcherDeps['reconcile']>>;
let restore: ReturnType<typeof vi.fn<WatcherDeps['restore']>>;
let invalidateReads: ReturnType<typeof vi.fn<WatcherDeps['invalidateReads']>>;
let beginRead: ReturnType<typeof vi.fn<WatcherDeps['beginRead']>>;

/** Starts a watcher in Remove mode with controllable coordinator acknowledgements. */
function start(clipboard: FakeClipboard | null, overrides: Partial<Settings> = {}, isContextValid = () => true) {
  settings = { ...DEFAULT_SETTINGS, mode: 'strip', ...overrides };
  reconcile = vi.fn<WatcherDeps['reconcile']>().mockResolvedValue(undefined);
  restore = vi.fn<WatcherDeps['restore']>().mockResolvedValue(undefined);
  invalidateReads = vi.fn<WatcherDeps['invalidateReads']>().mockResolvedValue(EPOCH);
  beginRead = vi.fn<WatcherDeps['beginRead']>().mockResolvedValue(EPOCH);
  watcher = startCopyWatcher({
    clipboard,
    reconcile,
    restore,
    beginRead,
    invalidateReads,
    getSettings: () => settings,
    isContextValid,
  });
  return watcher;
}

/** A cancelable, bubbling copy or cut event with an empty DataTransfer, like the browser dispatches. */
function copyEvent(type: 'copy' | 'cut' = 'copy'): ClipboardEvent {
  return trusted(new ClipboardEvent(type, { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
}

/** Selects the whole text content of an element or text field. */
function selectText(element: Element): void {
  if (element instanceof HTMLTextAreaElement) {
    element.focus();
    element.setSelectionRange(0, element.value.length);
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Simulates an unrelated trusted page interaction, which cancels pending reads. */
function interact(): void {
  document.body.dispatchEvent(trusted(new PointerEvent('pointerdown', { bubbles: true })));
}

/** Lets pending clipboard reads and writes (chained promises) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  watcher?.stop();
  watcher = undefined;
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('copy events', () => {
  it.each([true, false])(
    'defers selected text-field copying to the coordinator (clipboardchange %s)',
    async (modern) => {
      vi.useFakeTimers();
      const clipboard = new FakeClipboard(modern);
      start(clipboard, { watchClipboard: false });
      document.body.innerHTML = '<textarea></textarea>';
      const field = document.querySelector('textarea');
      if (!field) throw new Error('missing fixture');
      field.value = TRACKED;
      selectText(field);
      const event = copyEvent();
      field.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(event.clipboardData?.types).toEqual([]);
      expect(reconcile).not.toHaveBeenCalled();
      clipboard.change(TRACKED);
      await vi.advanceTimersByTimeAsync(500);
      expect(reconcile).toHaveBeenCalledWith(TRACKED, true, undefined, ['text/plain'], EPOCH, true);
      expect(clipboard.writes).toEqual([]);
      expect(field.value).toBe(TRACKED);
    },
  );

  it.each(['textarea', 'input'])('leaves a shadow %s copy untouched without a native format reader', async (tag) => {
    vi.useFakeTimers();
    start(null);
    const host = document.createElement('div');
    document.body.append(host);
    const field = document.createElement(tag) as HTMLTextAreaElement | HTMLInputElement;
    host.attachShadow({ mode: 'open' }).append(field);
    field.value = 'Read ' + TRACKED + ' today';
    field.focus();
    field.setSelectionRange(0, field.value.length);
    const event = trusted(
      new ClipboardEvent('copy', {
        clipboardData: new DataTransfer(),
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
    field.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(500);
    expect(event.defaultPrevented).toBe(false);
    expect(event.clipboardData?.types).toEqual([]);
    expect(field.value).toContain(TRACKED);
    expect(invalidateReads).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'reconciles rich native copies after their complete payload exists (clipboardchange %s)',
    async (modern) => {
      vi.useFakeTimers();
      const clipboard = new FakeClipboard(modern);
      start(clipboard, { watchClipboard: false });
      const html = '<a href="https://destination.example/item"><b>' + TRACKED + '</b></a>';
      document.body.innerHTML = html;
      const anchor = document.querySelector('a');
      if (!anchor) throw new Error('missing fixture');
      selectText(anchor);
      const event = copyEvent();
      anchor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(event.clipboardData?.types).toEqual([]);
      clipboard.html = html;
      clipboard.change(TRACKED, ['text/plain', 'text/html']);
      await vi.advanceTimersByTimeAsync(500);
      expect(reconcile).toHaveBeenCalledWith(TRACKED, true, undefined, ['text/plain', 'text/html'], EPOCH, true);
      expect(clipboard.html).toBe(html);
      expect(anchor.outerHTML).toContain('https://destination.example/item');
    },
  );

  it.each(['copy', 'cut'] as const)('preserves native %s and delegates embedded plain-text links', async (type) => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(true);
    start(clipboard, { watchClipboard: false });
    document.body.innerHTML = '<textarea></textarea>';
    const field = document.querySelector('textarea');
    if (!field) throw new Error('missing fixture');
    const prose = 'Read ' + TRACKED + ' today';
    field.value = prose;
    selectText(field);
    const event = copyEvent(type);
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(event.clipboardData?.types).toEqual([]);
    clipboard.change(prose);
    await vi.advanceTimersByTimeAsync(500);
    expect(reconcile).toHaveBeenCalledWith(prose, true, undefined, ['text/plain'], EPOCH, true);
    expect(clipboard.writes).toEqual([]);
  });

  it.each(['text/html', 'web application/custom'])(
    'leaves page-supplied %s untouched during dispatch and inspects all native flavors',
    async (type) => {
      vi.useFakeTimers();
      const clipboard = new FakeClipboard(true);
      start(clipboard, { watchClipboard: false });
      const extra = type === 'text/html' ? '<a href="' + TRACKED + '">Share</a>' : 'opaque payload';
      const event = copyEvent();
      document.addEventListener(
        'copy',
        (copy) => {
          copy.preventDefault();
          copy.clipboardData?.setData('text/plain', TRACKED);
          copy.clipboardData?.setData(type, extra);
        },
        { once: true },
      );
      document.body.dispatchEvent(event);
      expect(event.clipboardData?.getData('text/plain')).toBe(TRACKED);
      expect(event.clipboardData?.getData(type)).toBe(extra);
      clipboard.html = type === 'text/html' ? extra : '';
      clipboard.change(TRACKED, ['text/plain', type]);
      await vi.advanceTimersByTimeAsync(500);
      if (type === 'text/html')
        expect(reconcile).toHaveBeenCalledWith(TRACKED, true, undefined, ['text/plain', type], EPOCH, true);
      else expect(reconcile).not.toHaveBeenCalled();
      expect(clipboard.writes).toEqual([]);
    },
  );

  it('does not mutate a trusted page copy when the coordinator rejects browser focus', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(true);
    start(clipboard, { watchClipboard: false });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    invalidateReads.mockRejectedValue(new Error('Chrome is not focused'));
    const event = copyEvent();
    event.preventDefault();
    event.clipboardData?.setData('text/plain', TRACKED);
    event.clipboardData?.setData('text/html', '<a href="' + TRACKED + '">Share</a>');
    document.body.dispatchEvent(event);
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(500);
    expect(event.clipboardData?.getData('text/plain')).toBe(TRACKED);
    expect(event.clipboardData?.getData('text/html')).toContain(TRACKED);
    expect(reconcile).not.toHaveBeenCalled();
    expect(clipboard.writes).toEqual([]);
  });

  it('does nothing while paused', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(true);
    start(clipboard, { enabled: false });
    const event = copyEvent();
    document.body.dispatchEvent(event);
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(500);
    expect(event.defaultPrevented).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
    expect(invalidateReads).not.toHaveBeenCalled();
  });
});

/** Happy DOM has no browser input source; trusted fixtures model it separately from synthetic attack events. */
function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

/** A read whose completion the test controls to model clipboard work arriving out of order. */
function pendingRead() {
  let resolve!: (text: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('clipboard reconciliation', () => {
  it('does not authorize a clipboard change after ordinary gestures or Paste', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard, { watchClipboard: false });
    interact();
    document.body.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true })));
    clipboard.change(TRACKED);
    await flush();
    expect(invalidateReads).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([true, false])('requires a changed full copy-control baseline (clipboardchange %s)', async (modern) => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(modern);
    clipboard.text = 'A product';
    clipboard.html = `<a href="${TRACKED}">Original</a>`;
    clipboard.types = ['text/plain', 'text/html'];
    start(clipboard, { watchClipboard: false });
    document.body.innerHTML = '<button>Copy link</button>';
    const button = document.querySelector('button');
    button?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    await vi.advanceTimersByTimeAsync(200);
    expect(reconcile.mock.calls.every((call) => call[6] === true)).toBe(true);
    reconcile.mockClear();
    clipboard.html = `<a href="${TRACKED}">Changed</a>`;
    clipboard.change('A product', ['text/plain', 'text/html']);
    await vi.advanceTimersByTimeAsync(200);
    expect(reconcile).toHaveBeenCalledWith('A product', false, 'A product', ['text/plain', 'text/html'], EPOCH, true);
  });

  it('cancels a copy-control baseline when the page loses focus', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(true);
    start(clipboard, { watchClipboard: false });
    const baseline = pendingRead();
    vi.spyOn(clipboard, 'readText').mockReturnValueOnce(baseline.promise);
    document.body.innerHTML = '<button>Copy link</button>';
    document.querySelector('button')?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    window.dispatchEvent(trusted(new Event('blur')));
    baseline.resolve('before');
    clipboard.change(TRACKED);
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([true, false].flatMap((modern) => ['no items', 'empty item'].map((shape) => ({ modern, shape }))))(
    'recognizes an empty clipboard baseline ($shape, clipboardchange $modern)',
    async ({ modern, shape }) => {
      vi.useFakeTimers();
      const clipboard = new FakeClipboard(modern);
      start(clipboard, { watchClipboard: false });
      vi.spyOn(clipboard, 'read').mockResolvedValueOnce(
        shape === 'no items'
          ? []
          : [{ types: [], getType: () => Promise.reject(new Error('An empty item has no flavors')) }],
      );
      document.body.innerHTML = '<button>Copy link</button>';
      document.querySelector('button')?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
      clipboard.change(TRACKED);
      await vi.advanceTimersByTimeAsync(200);
      expect(reconcile).toHaveBeenCalledWith(TRACKED, false, '', ['text/plain'], EPOCH, true);
    },
  );
  it('treats a clipboard change after ordinary typing as background observation', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    for (const key of ['h', 'e', 'l', 'l', 'o', 'ArrowLeft', 'Shift', 'Tab']) {
      document.body.dispatchEvent(trusted(new KeyboardEvent('keydown', { key, bubbles: true })));
    }
    expect(invalidateReads).not.toHaveBeenCalled();
    expect(beginRead).not.toHaveBeenCalled();
    beginRead.mockResolvedValue('00000000-0000-4000-8000-000000000002');
    clipboard.change(TRACKED);
    await flush();
    expect(invalidateReads).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledWith(
      TRACKED,
      true,
      undefined,
      ['text/plain'],
      '00000000-0000-4000-8000-000000000002',
      false,
    );
    expect(beginRead).toHaveBeenCalledOnce();
  });

  it.each([
    { key: 'c', ctrlKey: true },
    { key: 'x', metaKey: true },
    { key: 'u', altKey: true },
    { key: 'Enter' },
    { key: ' ' },
    { key: 'ContextMenu' },
    { key: 'F10', shiftKey: true },
  ])('does not authorize copying from a keydown alone: $key', (init) => {
    start(new FakeClipboard(true));
    invalidateReads.mockReturnValue(new Promise(() => undefined));
    document.body.dispatchEvent(trusted(new KeyboardEvent('keydown', { ...init, bubbles: true })));
    document.body.dispatchEvent(trusted(new KeyboardEvent('keydown', { ...init, bubbles: true })));
    expect(invalidateReads).not.toHaveBeenCalled();
  });

  it('binds page reads to their acknowledged intent instead of adopting a newer shared generation', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(true);
    start(clipboard, { watchClipboard: false });
    let acknowledge!: (epoch: string) => void;
    invalidateReads.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          acknowledge = resolve;
        }),
    );
    document.body.dispatchEvent(copyEvent());
    clipboard.change(TRACKED);
    await vi.advanceTimersByTimeAsync(50);
    expect(invalidateReads).toHaveBeenCalledOnce();
    expect(beginRead).not.toHaveBeenCalled();
    beginRead.mockResolvedValue('00000000-0000-4000-8000-000000000005');
    acknowledge('00000000-0000-4000-8000-000000000004');
    await flush();
    expect(reconcile).toHaveBeenCalledWith(
      TRACKED,
      true,
      undefined,
      ['text/plain'],
      '00000000-0000-4000-8000-000000000004',
      true,
    );
    expect(beginRead).not.toHaveBeenCalled();
  });

  it('advances shared intent even when a native copy needs no rewrite', () => {
    start(new FakeClipboard(true), { watchClipboard: false });
    document.body.innerHTML = '<textarea>https://example.com/functional?si=abcdefgh</textarea>';
    const field = document.querySelector('textarea');
    if (!field) throw new Error('Missing field');
    selectText(field);
    const event = copyEvent();
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(invalidateReads).toHaveBeenCalledOnce();
    expect(beginRead).not.toHaveBeenCalled();
  });

  it('keeps paused intent local instead of starting coordinator operations', () => {
    start(null, { enabled: false });
    interact();
    document.body.dispatchEvent(copyEvent());
    expect(invalidateReads).not.toHaveBeenCalled();
  });

  it('requires a complete native inventory for background inspection', async () => {
    const clipboard = new FakeClipboard(true);
    const current = start(clipboard);
    clipboard.text = TRACKED;
    clipboard.types = ['text/plain', 'web application/custom'];
    expect(await current.inspect()).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
    expect(clipboard.writes).toEqual([]);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    expect(await current.inspect()).toBe(false);
  });

  it('does not inspect for a disabled whole-clipboard watcher', async () => {
    const current = start(new FakeClipboard(true), { watchClipboard: false });
    expect(await current.inspect()).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it.each([
    { text: 'private message without links', html: '' },
    { text: 'https://example.com/item?id=42', html: '' },
    { text: 'A product', html: '<a href="https://example.com/item?id=42">A product</a>' },
  ])('reports unrelated page clipboard observations without rewriting: $text', async ({ text, html }) => {
    const clipboard = new FakeClipboard(true);
    const current = start(clipboard);
    interact();
    clipboard.html = html;
    clipboard.change(text, html ? ['text/plain', 'text/html'] : ['text/plain']);
    await flush();
    const types = html ? ['text/plain', 'text/html'] : ['text/plain'];
    expect(reconcile).toHaveBeenCalledWith(text, !html, undefined, types, EPOCH, false, true);
    expect(await current.inspect()).toBe(true);
    expect(reconcile).toHaveBeenLastCalledWith(text, true, undefined, types, EPOCH, false, true);
  });

  it('delegates current clipboard text without writing from the page', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    clipboard.change(TRACKED);
    await flush();
    expect(reconcile).toHaveBeenCalledWith(TRACKED, true, undefined, ['text/plain'], EPOCH, false);
    expect(clipboard.writes).toEqual([]);
  });

  it('keeps tracked links eligible, including plausible decoy inputs', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard, { mode: 'decoy' });
    interact();
    clipboard.change(TRACKED);
    await flush();
    expect(reconcile).toHaveBeenCalledWith(TRACKED, true, undefined, ['text/plain'], EPOCH, false);
    const decoy = rewriteUrl(TRACKED, { mode: 'decoy', key: 'test-key' })?.url;
    if (!decoy) throw new Error('Missing decoy link');
    clipboard.change(decoy);
    await flush();
    expect(reconcile).toHaveBeenLastCalledWith(decoy, true, undefined, ['text/plain'], EPOCH, false);
  });

  it('retains page context for proven relative copies without attributing background relative links', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(true);
    const current = start(clipboard);
    vi.stubGlobal('location', { href: 'https://example.com/page' });
    try {
      document.body.innerHTML = '<button>Copy link</button>';
      document.querySelector('button')?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
      clipboard.change('/item?utm_source=email');
      await vi.advanceTimersByTimeAsync(150);
      expect(reconcile).toHaveBeenCalledWith('/item?utm_source=email', false, '', ['text/plain'], EPOCH, true);
      reconcile.mockClear();
      expect(await current.inspect()).toBe(true);
      expect(reconcile).toHaveBeenCalledWith(
        '/item?utm_source=email',
        true,
        undefined,
        ['text/plain'],
        EPOCH,
        false,
        true,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['image/png', 'Files', 'application/custom'])('leaves mixed %s formats alone', async (type) => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    clipboard.change(TRACKED, ['text/plain', type]);
    await flush();
    expect(reconcile).not.toHaveBeenCalled();
    clipboard.change(TRACKED);
    await flush();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('requests format-aware reconciliation for HTML-only links', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    clipboard.html = `<a href="${TRACKED}">A product</a>`;
    clipboard.change('A product', ['text/plain', 'text/html']);
    await flush();
    expect(reconcile).toHaveBeenCalledWith('A product', false, undefined, ['text/plain', 'text/html'], EPOCH, false);
  });

  it('rejects synthetic copy, gesture and clipboard-change events', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard, { watchClipboard: false });
    const data = new DataTransfer();
    data.setData('text/plain', TRACKED);
    const copy = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
    copy.preventDefault();
    document.body.dispatchEvent(copy);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    clipboard.change(TRACKED);
    await flush();
    expect(reconcile).not.toHaveBeenCalled();
    expect(data.getData('text/plain')).toBe(TRACKED);
    expect(invalidateReads).not.toHaveBeenCalled();
    interact();
    clipboard.dispatchEvent(Object.assign(new Event('clipboardchange'), { types: ['text/plain'] }));
    await flush();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('invalidates an older read when a newer change completes first', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    const old = pendingRead();
    const recent = pendingRead();
    vi.spyOn(clipboard, 'readText').mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    clipboard.change(TRACKED);
    await flush();
    const newer = 'https://example.com/newer?utm_source=email';
    clipboard.change(newer);
    recent.resolve(newer);
    await flush();
    old.resolve(TRACKED);
    await flush();
    expect(reconcile.mock.calls).toEqual([[newer, true, undefined, ['text/plain'], EPOCH, false]]);
  });

  it.each(['Undo', 'stop', 'settings', 'new intent', 'ordinary typing', 'blur'])(
    'invalidates a pending read on %s',
    async (action) => {
      const clipboard = new FakeClipboard(true);
      const current = start(clipboard);
      interact();
      const read = pendingRead();
      vi.spyOn(clipboard, 'readText').mockReturnValueOnce(read.promise);
      clipboard.change(TRACKED);
      await flush();
      if (action === 'Undo') await current.restore(TRACKED);
      else if (action === 'stop') current.stop();
      else if (action === 'settings') current.invalidate();
      else if (action === 'blur') window.dispatchEvent(trusted(new Event('blur')));
      else if (action === 'ordinary typing') {
        document.body.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'a', bubbles: true })));
        expect(invalidateReads).not.toHaveBeenCalled();
      } else interact();
      read.resolve(TRACKED);
      await flush();
      expect(reconcile).not.toHaveBeenCalled();
      expect(clipboard.writes).toEqual([]);
    },
  );

  it('fails Undo when the coordinator does not acknowledge it', async () => {
    const clipboard = new FakeClipboard(true);
    const current = start(clipboard);
    restore.mockRejectedValueOnce(new Error('worker terminated'));
    await expect(current.restore(TRACKED)).rejects.toThrow('worker terminated');
    expect(clipboard.writes).toEqual([]);
  });

  it('stops after context removal', async () => {
    const clipboard = new FakeClipboard(true);
    let valid = true;
    start(clipboard, {}, () => valid);
    interact();
    valid = false;
    clipboard.change(TRACKED);
    await flush();
    valid = true;
    interact();
    clipboard.change(TRACKED);
    await flush();
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('gesture reconciliation', () => {
  it('reconciles the final payload from a page handler registered during dispatch', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard, { watchClipboard: false });
    document.body.innerHTML = `<textarea>${TRACKED}</textarea>`;
    const field = document.querySelector('textarea');
    if (!field) throw new Error('Missing field');
    selectText(field);
    let beforeOverwrite = '';
    document.addEventListener(
      'copy',
      () => {
        window.addEventListener(
          'copy',
          (event) => {
            beforeOverwrite = event.clipboardData?.getData('text/plain') ?? '';
            event.clipboardData?.setData('text/plain', TRACKED);
            event.preventDefault();
          },
          { once: true },
        );
      },
      { capture: true, once: true },
    );
    const event = copyEvent();
    field.dispatchEvent(event);
    clipboard.text = event.clipboardData?.getData('text/plain') ?? '';
    expect(beforeOverwrite).toBe('');
    expect(clipboard.text).toBe(TRACKED);
    await vi.advanceTimersByTimeAsync(500);
    expect(reconcile).toHaveBeenCalledWith(TRACKED, true, undefined, ['text/plain'], EPOCH, true);
  });

  it('compares HTML as well as text with the pre-gesture baseline', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    clipboard.text = 'A product';
    clipboard.types = ['text/plain', 'text/html'];
    clipboard.html = '<a href="https://example.com/old?utm_source=email">A product</a>';
    start(clipboard);
    document.body.innerHTML = '<button id="copy">Copy link</button>';
    const button = document.getElementById('copy');
    button?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile.mock.calls.every((call) => call[6] === true)).toBe(true);
    reconcile.mockClear();

    button?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    await flush();
    clipboard.html = '<a href="https://example.com/new?utm_source=email">A product</a>';
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).toHaveBeenCalledWith('A product', false, 'A product', ['text/plain', 'text/html'], EPOCH, true);
  });

  it.each([true, false])('reconciles a trusted copy whose propagation stopped (clipboardchange %s)', async (modern) => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(modern);
    start(clipboard);
    document.body.innerHTML = '<textarea id="field"></textarea>';
    const field = document.getElementById('field');
    if (!field) throw new Error('missing fixture');
    field.addEventListener('copy', (event) => event.stopImmediatePropagation());
    field.dispatchEvent(copyEvent());
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(500);
    expect(reconcile).toHaveBeenCalledWith(TRACKED, true, undefined, ['text/plain'], EPOCH, true);
  });

  it('never starts reconciliation from a synthetic click', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard);
    document.body.innerHTML = '<button id="copy">Copy link</button>';
    document.getElementById('copy')?.click();
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([
    { size: 'short', baseline: 'previous contents' },
    { size: 'oversized', baseline: 'x'.repeat(150_000) },
  ])('cleans legacy copies after a $size prior clipboard value', async ({ baseline }) => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    clipboard.text = baseline;
    start(clipboard, { watchClipboard: false });
    reconcile.mockImplementation(async (text, embedded, previous, types, epoch, pageCopy) => {
      const request = { type: 'reconcile-clipboard', text, embedded, baseline: previous, types, epoch, pageCopy };
      const forwarded = {
        ...request,
        type: 'offscreen-reconcile',
        config: { mode: settings.mode },
      };
      if (!isExtensionMessage(request) || !isExtensionMessage(forwarded)) throw new Error('Rejected reconciliation');
      const result = rewriteUrl(text, { mode: settings.mode });
      if (result) await clipboard.writeText(result.url);
    });
    document.body.innerHTML = '<button id="copy">Copy link</button>';
    document.getElementById('copy')?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).toHaveBeenCalledWith(TRACKED, false, baseline, ['text/plain'], EPOCH, true);
    expect(clipboard.writes).toEqual([CLEAN]);
  });

  it.each([
    {
      name: 'InvalidStateError',
      message: "Failed to execute 'getType' on 'ClipboardItem': Clipboard data has changed",
      changed: true,
    },
    { name: 'NotAllowedError', message: 'Read permission denied', changed: false },
  ])('handles a baseline $name without losing an observed clipboard change', async ({ name, message, changed }) => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard);
    vi.spyOn(clipboard, 'read').mockResolvedValueOnce([
      { types: ['text/plain'], getType: () => Promise.reject(new DOMException(message, name)) },
    ]);
    document.body.innerHTML = '<button id="copy">Copy link</button>';
    document.getElementById('copy')?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(3000);
    if (changed) {
      expect(reconcile).toHaveBeenCalledWith(TRACKED, false, undefined, ['text/plain'], EPOCH, true);
    } else {
      expect(reconcile).not.toHaveBeenCalled();
    }
  });

  it('leaves an unchanged legacy clipboard alone and cancels pending sweeps on stop', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    clipboard.text = TRACKED;
    const current = start(clipboard);
    document.body.innerHTML = '<button id="copy">Copy link</button>';
    const button = document.getElementById('copy');
    button?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile.mock.calls.every((call) => call[6] === true)).toBe(true);
    reconcile.mockClear();
    button?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    current.stop();
    clipboard.text = 'later contents';
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
