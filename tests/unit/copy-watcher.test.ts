// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startCopyWatcher,
  type CopyWatcher,
  type RewriteEvent,
  type WatchedClipboard,
  type WatcherDeps,
} from '../../src/lib/copy-watcher';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/settings';

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
let rewrites: RewriteEvent[];
let now: number;
let key: string | null;
let reconcile: ReturnType<typeof vi.fn<WatcherDeps['reconcile']>>;
let restore: ReturnType<typeof vi.fn<WatcherDeps['restore']>>;

/** Starts a watcher in Remove mode (simple expected output) with a controllable clock; records rewrites. */
function start(clipboard: FakeClipboard | null, overrides: Partial<Settings> = {}, isContextValid = () => true) {
  settings = { ...DEFAULT_SETTINGS, mode: 'strip', ...overrides };
  rewrites = [];
  now = 100_000;
  key = 'test-key';
  reconcile = vi.fn<WatcherDeps['reconcile']>().mockResolvedValue(undefined);
  restore = vi.fn<WatcherDeps['restore']>().mockResolvedValue(undefined);
  watcher = startCopyWatcher({
    clipboard,
    reconcile,
    restore,
    beginRead: () => Promise.resolve(0),
    getSettings: () => settings,
    getKey: () => key,
    onRewrite: (event) => rewrites.push(event),
    isContextValid,
    now: () => now,
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

/** Simulates the user clicking on the page, which opens the watcher's intent window. */
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
  it('rewrites a selected text-field link synchronously', () => {
    start(new FakeClipboard(true));
    document.body.innerHTML = `<textarea id="link">${TRACKED}</textarea>`;
    const paragraph = document.getElementById('link');
    if (!paragraph) throw new Error('missing fixture');
    selectText(paragraph);

    const event = copyEvent();
    paragraph.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.clipboardData?.getData('text/plain')).toBe(CLEAN);
    expect(rewrites).toEqual([{ original: TRACKED, rewritten: CLEAN, urls: 1 }]);
  });

  it.each([true, false])('reconciles a native rich lone link after copy (clipboardchange %s)', async (modern) => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(modern);
    start(clipboard);
    document.body.innerHTML = `<a id="link" href="https://destination.example/item"><b>${TRACKED}</b></a>`;
    const anchor = document.getElementById('link');
    if (!anchor) throw new Error('missing fixture');
    selectText(anchor);

    const event = copyEvent();
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(event.clipboardData?.types).toEqual([]);
    expect(rewrites).toHaveLength(0);

    clipboard.html = anchor.outerHTML;
    clipboard.change(TRACKED, ['text/plain', 'text/html']);
    await vi.advanceTimersByTimeAsync(500);
    expect(reconcile).toHaveBeenCalledWith(TRACKED, false, undefined, ['text/plain', 'text/html'], 0, true);
    expect(clipboard.html).toBe(anchor.outerHTML);
  });

  it('leaves rich selections with embedded links to the browser', () => {
    start(new FakeClipboard(true));
    document.body.innerHTML = `<p id="text">Read ${TRACKED} today</p>`;
    const paragraph = document.getElementById('text');
    if (!paragraph) throw new Error('missing fixture');
    selectText(paragraph);

    const event = copyEvent();
    paragraph.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(rewrites).toHaveLength(0);
  });

  it('rewrites embedded links copied from a text field', () => {
    start(new FakeClipboard(true));
    document.body.innerHTML = `<textarea id="field">Read ${TRACKED} today</textarea>`;
    const field = document.getElementById('field');
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('missing fixture');
    field.focus();
    field.setSelectionRange(0, field.value.length);

    const event = copyEvent();
    field.dispatchEvent(event);

    expect(event.clipboardData?.getData('text/plain')).toBe(`Read ${CLEAN} today`);
  });

  it('rewrites data a page put on the clipboard itself, including its HTML flavor', () => {
    start(new FakeClipboard(true));
    const page = new AbortController();
    document.addEventListener(
      'copy',
      (event) => {
        event.preventDefault();
        event.clipboardData?.setData('text/plain', TRACKED);
        event.clipboardData?.setData('text/html', `<a href="${TRACKED.replace(/&/g, '&amp;')}">Share</a>`);
      },
      { signal: page.signal },
    );
    // A page listener on window registered after the extension still runs before the rewrite.
    window.addEventListener(
      'copy',
      (event) => {
        event.clipboardData?.setData('text/plain', `${TRACKED}&utm_medium=late`);
      },
      { signal: page.signal },
    );

    const event = copyEvent();
    document.body.dispatchEvent(event);
    page.abort();

    expect(event.clipboardData?.getData('text/plain')).toBe(CLEAN);
    expect(event.clipboardData?.getData('text/html')).toBe(`<a href="${CLEAN}">Share</a>`);
  });

  it.each([
    { type: 'application/x-example', payload: 'opaque payload' },
    { type: 'text/html', payload: '' },
    { type: undefined, payload: '' },
  ])('offers plain-text Undo only without an additional $type format', ({ type, payload }) => {
    start(new FakeClipboard(true));
    const event = copyEvent();
    event.preventDefault();
    event.clipboardData?.setData('text/plain', TRACKED);
    if (type) event.clipboardData?.setData(type, payload);

    document.body.dispatchEvent(event);

    expect(event.clipboardData?.getData('text/plain')).toBe(CLEAN);
    expect(event.clipboardData?.types).toEqual(type ? ['text/plain', type] : ['text/plain']);
    if (type) expect(event.clipboardData?.getData(type)).toBe(payload);
    expect(rewrites).toEqual([{ original: TRACKED, rewritten: CLEAN, urls: 1, ...(type ? { undoable: false } : {}) }]);
  });

  it('never cancels a native cut', () => {
    start(new FakeClipboard(true));
    document.body.innerHTML = `<p id="link">${TRACKED}</p>`;
    const paragraph = document.getElementById('link');
    if (!paragraph) throw new Error('missing fixture');
    selectText(paragraph);

    const event = copyEvent('cut');
    paragraph.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing while paused', () => {
    start(new FakeClipboard(true), { enabled: false });
    document.body.innerHTML = `<p id="link">${TRACKED}</p>`;
    const paragraph = document.getElementById('link');
    if (!paragraph) throw new Error('missing fixture');
    selectText(paragraph);

    const event = copyEvent();
    paragraph.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(rewrites).toHaveLength(0);
  });

  it('uses decoys when configured', () => {
    start(new FakeClipboard(true), { mode: 'decoy' });
    document.body.innerHTML = `<textarea id="link">${TRACKED}</textarea>`;
    const paragraph = document.getElementById('link');
    if (!paragraph) throw new Error('missing fixture');
    selectText(paragraph);

    const event = copyEvent();
    paragraph.dispatchEvent(event);

    const copied = new URL(event.clipboardData?.getData('text/plain') ?? '');
    expect(copied.searchParams.get('id')).toBe('7');
    expect(copied.searchParams.get('utm_source')).not.toBe('newsletter');
    expect(copied.searchParams.get('fbclid')).not.toBe('IwAR3abc');
    expect(copied.searchParams.get('fbclid')).toHaveLength('IwAR3abc'.length);
  });

  it('waits for the key before producing decoys, but removes without it', () => {
    start(new FakeClipboard(true), { mode: 'decoy' });
    key = null;
    document.body.innerHTML = `<textarea id="link">${TRACKED}</textarea>`;
    const paragraph = document.getElementById('link');
    if (!paragraph) throw new Error('missing fixture');
    selectText(paragraph);

    const decoyEvent = copyEvent();
    paragraph.dispatchEvent(decoyEvent);
    expect(decoyEvent.defaultPrevented).toBe(false);

    settings = { ...settings, mode: 'strip' };
    const stripEvent = copyEvent();
    paragraph.dispatchEvent(stripEvent);
    expect(stripEvent.clipboardData?.getData('text/plain')).toBe(CLEAN);
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
  it('requires a complete native inventory for background inspection', async () => {
    const clipboard = new FakeClipboard(true);
    const current = start(clipboard);
    clipboard.text = TRACKED;
    clipboard.types = ['text/plain', 'web application/custom'];
    expect(await current.inspect()).toBe(true);
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
  it('delegates current clipboard text without writing from the page', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    clipboard.change(TRACKED);
    await flush();
    expect(reconcile).toHaveBeenCalledWith(TRACKED, true, undefined, ['text/plain'], 0, true);
    expect(clipboard.writes).toEqual([]);
    expect(rewrites).toEqual([]);
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
    clipboard.change('A product', ['text/plain', 'text/html']);
    await flush();
    expect(reconcile).toHaveBeenCalledWith('A product', false, undefined, ['text/plain', 'text/html'], 0, true);
  });

  it('reconciles changed HTML even when plain text matches a synchronous rewrite', async () => {
    const clipboard = new FakeClipboard(true);
    const current = start(clipboard);
    const event = copyEvent();
    event.preventDefault();
    event.clipboardData?.setData('text/plain', TRACKED);
    event.clipboardData?.setData('text/html', `<a href="${TRACKED}">${TRACKED}</a>`);
    document.body.dispatchEvent(event);
    expect(event.clipboardData?.getData('text/plain')).toBe(CLEAN);

    clipboard.html = '<a href="https://example.com/other?utm_source=email">New target</a>';
    clipboard.change(CLEAN, ['text/plain', 'text/html']);
    await flush();
    expect(reconcile).toHaveBeenCalledWith(CLEAN, false, undefined, ['text/plain', 'text/html'], 0, true);
    reconcile.mockClear();
    await current.inspect();
    expect(reconcile).toHaveBeenCalledWith(CLEAN, true, undefined, ['text/plain', 'text/html'], 0, false);
  });

  it('rejects synthetic copy, gesture and clipboard-change events', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    const data = new DataTransfer();
    data.setData('text/plain', TRACKED);
    const copy = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
    copy.preventDefault();
    document.body.dispatchEvent(copy);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    clipboard.change(TRACKED);
    await flush();
    expect(reconcile).not.toHaveBeenCalled();
    expect(rewrites).toEqual([]);
    expect(data.getData('text/plain')).toBe(TRACKED);
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
    clipboard.change('newer contents');
    recent.resolve('newer contents');
    await flush();
    old.resolve(TRACKED);
    await flush();
    expect(reconcile.mock.calls).toEqual([['newer contents', true, undefined, ['text/plain'], 0, true]]);
  });

  it.each(['Undo', 'stop', 'settings', 'new intent'])('invalidates a pending read on %s', async (action) => {
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
    else interact();
    read.resolve(TRACKED);
    await flush();
    expect(reconcile).not.toHaveBeenCalled();
    expect(clipboard.writes).toEqual([]);
  });

  it('fails Undo when the coordinator does not acknowledge it', async () => {
    const clipboard = new FakeClipboard(true);
    const current = start(clipboard);
    restore.mockRejectedValueOnce(new Error('worker terminated'));
    await expect(current.restore(TRACKED)).rejects.toThrow('worker terminated');
    expect(clipboard.writes).toEqual([]);
  });

  it('ignores expired intent and stops after context removal', async () => {
    const clipboard = new FakeClipboard(true);
    let valid = true;
    start(clipboard, {}, () => valid);
    interact();
    now += 60_000;
    clipboard.change(TRACKED);
    await flush();
    expect(reconcile).not.toHaveBeenCalled();
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
    expect(reconcile).not.toHaveBeenCalled();

    button?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    await flush();
    clipboard.html = '<a href="https://example.com/new?utm_source=email">A product</a>';
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).toHaveBeenCalledWith('A product', false, 'A product', ['text/plain', 'text/html'], 0, true);
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
    clipboard.text = 'A product';
    await vi.advanceTimersByTimeAsync(500);
    expect(reconcile).toHaveBeenCalledWith('A product', false, undefined, ['text/plain'], 0, true);
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

  it('compares legacy copies with the pre-gesture baseline', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    clipboard.text = 'previous contents';
    start(clipboard);
    document.body.innerHTML = '<button id="copy">Copy link</button>';
    document.getElementById('copy')?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).toHaveBeenCalledWith(TRACKED, false, 'previous contents', ['text/plain'], 0, true);
    expect(clipboard.writes).toEqual([]);
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
      expect(reconcile).toHaveBeenCalledWith(TRACKED, false, undefined, ['text/plain'], 0, true);
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
    expect(reconcile).not.toHaveBeenCalled();
    button?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    current.stop();
    clipboard.text = 'later contents';
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
