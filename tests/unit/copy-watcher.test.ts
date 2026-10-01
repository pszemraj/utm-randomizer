// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startCopyWatcher,
  type CopyWatcher,
  type RewriteEvent,
  type WatchedClipboard,
} from '../../src/lib/copy-watcher';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/settings';

const TRACKED = 'https://example.com/page?id=7&utm_source=newsletter&fbclid=IwAR3abc';
const CLEAN = 'https://example.com/page?id=7';

/** Async Clipboard API stand-in; `modern` exposes the `clipboardchange` event like Chrome 144+. */
class FakeClipboard extends EventTarget implements WatchedClipboard {
  text = '';
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

  /** Replaces the fake clipboard text and records the write. */
  writeText(text: string): Promise<void> {
    this.text = text;
    this.writes.push(text);
    return Promise.resolve();
  }

  /** Something (the page, the browser) replaced the clipboard contents. */
  change(text: string, types: string[] = ['text/plain']): void {
    this.text = text;
    this.dispatchEvent(Object.assign(new Event('clipboardchange'), { types }));
  }
}

let watcher: CopyWatcher | undefined;
let settings: Settings;
let rewrites: RewriteEvent[];
let now: number;
let key: string | null;

/** Starts a watcher in Remove mode (simple expected output) with a controllable clock; records rewrites. */
function start(clipboard: FakeClipboard | null, overrides: Partial<Settings> = {}, isContextValid = () => true) {
  settings = { ...DEFAULT_SETTINGS, mode: 'strip', ...overrides };
  rewrites = [];
  now = 100_000;
  key = 'test-key';
  watcher = startCopyWatcher({
    clipboard,
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
  return new ClipboardEvent(type, { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
}

/** Selects the whole text content of `element`. */
function selectText(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Simulates the user clicking on the page, which opens the watcher's intent window. */
function interact(): void {
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
}

/** Lets pending clipboard reads and writes (chained promises) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  watcher?.stop();
  watcher = undefined;
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

describe('copy events', () => {
  it('rewrites a selected link synchronously', () => {
    start(new FakeClipboard(true));
    document.body.innerHTML = `<p id="link">${TRACKED}</p>`;
    const paragraph = document.getElementById('link');
    if (!paragraph) throw new Error('missing fixture');
    selectText(paragraph);

    const event = copyEvent();
    paragraph.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.clipboardData?.getData('text/plain')).toBe(CLEAN);
    expect(rewrites).toEqual([{ original: TRACKED, rewritten: CLEAN, urls: 1 }]);
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
    document.body.innerHTML = `<p id="link">${TRACKED}</p>`;
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
    document.body.innerHTML = `<p id="link">${TRACKED}</p>`;
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

describe('clipboardchange', () => {
  it('rewrites links the page wrote while the user was interacting with it', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    clipboard.change(TRACKED);
    await flush();

    expect(clipboard.text).toBe(CLEAN);
    expect(clipboard.writes).toEqual([CLEAN]);
    expect(rewrites).toHaveLength(1);
  });

  it('ignores changes long after the last interaction', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    now += 60_000;
    clipboard.change(TRACKED);
    await flush();

    expect(clipboard.writes).toHaveLength(0);
  });

  it('ignores non-text content and does not loop on its own writes', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    clipboard.change(TRACKED, ['image/png']);
    await flush();
    expect(clipboard.writes).toHaveLength(0);

    clipboard.change(TRACKED);
    await flush();
    clipboard.change(clipboard.text);
    await flush();
    expect(clipboard.writes).toEqual([CLEAN]);
  });

  it("rewrites a fresh copy of the same link, but not another watcher's rewrite of it", async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    clipboard.change(TRACKED);
    await flush();
    // The copy button is clicked again right away: the original is back and is cleaned again.
    interact();
    clipboard.change(TRACKED);
    await flush();
    expect(clipboard.writes).toEqual([CLEAN, CLEAN]);

    // Another tracked version of the link, as a watcher that disagrees would write it, is left alone...
    const otherRewrite = 'https://example.com/page?id=7&utm_source=reddit&fbclid=IwAR9xyz';
    clipboard.change(otherRewrite);
    await flush();
    expect(clipboard.text).toBe(otherRewrite);

    // ...until the loop guard's window has passed.
    now += 6_000;
    clipboard.change(otherRewrite);
    await flush();
    expect(clipboard.text).toBe(CLEAN);
  });

  it('only rewrites links embedded in text when the clipboard holds plain text', async () => {
    const clipboard = new FakeClipboard(true);
    start(clipboard);
    interact();
    clipboard.change(`Look: ${TRACKED}`, ['text/plain', 'text/html']);
    await flush();
    expect(clipboard.writes).toHaveLength(0);

    clipboard.change(`Look: ${TRACKED}`, ['text/plain']);
    await flush();
    expect(clipboard.writes).toEqual([`Look: ${CLEAN}`]);
  });

  it('restores the original on undo without rewriting it again', async () => {
    const clipboard = new FakeClipboard(true);
    const copyWatcher = start(clipboard);
    interact();
    clipboard.change(TRACKED);
    await flush();

    await copyWatcher.restore(TRACKED);
    clipboard.change(TRACKED);
    await flush();

    expect(clipboard.text).toBe(TRACKED);
    expect(rewrites).toHaveLength(1);
  });

  it.each(['ordinary text', ''])(
    'cleans a fresh copy after Undo and a different clipboard value (%s)',
    async (text) => {
      const clipboard = new FakeClipboard(true);
      const copyWatcher = start(clipboard, { watchClipboard: false });
      interact();
      clipboard.change(TRACKED);
      await flush();
      await copyWatcher.restore(TRACKED);
      clipboard.change(text);
      await flush();
      clipboard.change(TRACKED);
      await flush();

      expect(clipboard.text).toBe(CLEAN);
      expect(clipboard.writes).toEqual([CLEAN, TRACKED, CLEAN]);
    },
  );

  it('clears Undo suppression after copying non-text content', async () => {
    const clipboard = new FakeClipboard(true);
    const copyWatcher = start(clipboard, { watchClipboard: false });
    interact();
    await copyWatcher.restore(TRACKED);
    clipboard.change('', ['image/png']);
    clipboard.change(TRACKED);
    await flush();

    expect(clipboard.writes).toEqual([TRACKED, CLEAN]);
  });

  it('tells other watchers about Undo before restoring the original', async () => {
    const clipboard = new FakeClipboard(true);
    const order: string[] = [];
    watcher = startCopyWatcher({
      clipboard,
      getSettings: () => ({ ...DEFAULT_SETTINGS, mode: 'strip' }),
      getKey: () => 'test-key',
      onRewrite: () => undefined,
      beforeRestore: (text) => {
        order.push(`ignore ${text}`);
        return Promise.resolve();
      },
    });
    const write = clipboard.writeText.bind(clipboard);
    clipboard.writeText = (text) => {
      order.push(`write ${text}`);
      return write(text);
    };

    await watcher.restore(TRACKED);

    expect(order).toEqual([`ignore ${TRACKED}`, `write ${TRACKED}`]);
  });

  it('shuts down once the extension context is gone', async () => {
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
    expect(clipboard.writes).toHaveLength(0);
  });
});

describe('without clipboardchange (Chrome < 144)', () => {
  it.each(['copy', 'cut'] as const)('polls after a page stops %s propagation', async (type) => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard, { watchClipboard: false });
    document.body.innerHTML = `<textarea id="field">${TRACKED}</textarea>`;
    const field = document.getElementById('field');
    if (!(field instanceof HTMLTextAreaElement)) throw new Error('missing fixture');
    field.focus();
    field.select();
    field.addEventListener(type, (event) => event.stopPropagation());
    const event = copyEvent(type);
    field.dispatchEvent(event);
    // The browser's default copy/cut action writes after event dispatch.
    clipboard.text = TRACKED;

    await vi.advanceTimersByTimeAsync(500);

    expect(event.defaultPrevented).toBe(false);
    expect(clipboard.writes).toEqual([CLEAN]);
    expect(rewrites).toHaveLength(1);
  });

  it('does not start a delayed propagation fallback after the watcher stops', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    const copyWatcher = start(clipboard);
    const read = vi.spyOn(clipboard, 'readText');
    document.body.innerHTML = '<textarea id="field"></textarea>';
    const field = document.getElementById('field');
    if (!field) throw new Error('missing fixture');
    field.addEventListener('copy', (event) => event.stopPropagation());
    field.dispatchEvent(copyEvent());
    clipboard.text = TRACKED;
    copyWatcher.stop();

    await vi.advanceTimersByTimeAsync(500);

    expect(read).not.toHaveBeenCalled();
    expect(clipboard.writes).toHaveLength(0);
  });

  it('expires Undo suppression when the next gesture observes different clipboard text', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    const copyWatcher = start(clipboard, { watchClipboard: false });
    await copyWatcher.restore(TRACKED);
    clipboard.text = 'ordinary text';
    document.body.innerHTML = '<button id="share">Copy link</button>';
    document.getElementById('share')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(3000);

    expect(clipboard.writes).toEqual([TRACKED, CLEAN]);
  });

  it('does not let an earlier gesture baseline clear a newer Undo', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    const copyWatcher = start(clipboard, { watchClipboard: false });
    clipboard.text = CLEAN;
    document.body.innerHTML = '<button id="undo">Undo</button>';
    const button = document.getElementById('undo');
    if (!button) throw new Error('missing fixture');
    button.addEventListener('click', () => void copyWatcher.restore(TRACKED));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3000);

    expect(clipboard.writes).toEqual([TRACKED]);
    expect(clipboard.text).toBe(TRACKED);
  });

  it.each(['click', 'contextmenu'])('leaves an existing clipboard link alone after an unrelated %s', async (type) => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    clipboard.text = TRACKED;
    start(clipboard, { watchClipboard: false });
    document.body.innerHTML = `<a id="control" href="${TRACKED}">article</a>`;
    document.getElementById('control')?.dispatchEvent(new MouseEvent(type, { bubbles: true }));

    await vi.advanceTimersByTimeAsync(8500);

    expect(clipboard.text).toBe(TRACKED);
    expect(clipboard.writes).toHaveLength(0);
  });

  it('captures the baseline before a button immediately writes a link', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard);
    document.body.innerHTML = '<button id="share">Copy link</button>';
    const button = document.getElementById('share');
    if (!button) throw new Error('missing fixture');
    button.addEventListener('click', () => void clipboard.writeText(TRACKED));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.advanceTimersByTimeAsync(3000);

    expect(clipboard.text).toBe(CLEAN);
    expect(clipboard.writes).toEqual([TRACKED, CLEAN]);
  });

  it('catches delayed writes and a fresh copy of the same link', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard);
    document.body.innerHTML = '<button id="share">Copy link</button>';
    const button = document.getElementById('share');
    if (!button) throw new Error('missing fixture');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(2000);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(3000);

    expect(clipboard.writes).toEqual([CLEAN, CLEAN]);
  });

  it('polls the clipboard after a click on a copy button', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard);
    document.body.innerHTML = '<button id="share">Copy link</button>';
    document.getElementById('share')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    clipboard.text = TRACKED;

    await vi.advanceTimersByTimeAsync(3000);

    expect(clipboard.text).toBe(CLEAN);
    expect(clipboard.writes).toEqual([CLEAN]);
  });

  it('polls after the context menu opens on a link (Copy link address)', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard);
    document.body.innerHTML = `<a id="link" href="${TRACKED}">article</a>`;
    document.getElementById('link')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    await vi.advanceTimersByTimeAsync(1500);
    clipboard.text = TRACKED;
    await vi.advanceTimersByTimeAsync(1000);

    expect(clipboard.text).toBe(CLEAN);
  });

  it('ignores clicks on things that are not controls', async () => {
    vi.useFakeTimers();
    const clipboard = new FakeClipboard(false);
    start(clipboard);
    clipboard.text = TRACKED;
    document.body.innerHTML = '<p id="plain">text</p>';
    document.getElementById('plain')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.advanceTimersByTimeAsync(3000);

    expect(clipboard.writes).toHaveLength(0);
  });
});
