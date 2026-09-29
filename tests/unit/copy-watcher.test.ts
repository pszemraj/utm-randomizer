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

  readText(): Promise<string> {
    return Promise.resolve(this.text);
  }

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

function start(clipboard: FakeClipboard | null, overrides: Partial<Settings> = {}, isContextValid = () => true) {
  settings = { ...DEFAULT_SETTINGS, mode: 'strip', ...overrides };
  rewrites = [];
  now = 100_000;
  watcher = startCopyWatcher({
    clipboard,
    getSettings: () => settings,
    onRewrite: (event) => rewrites.push(event),
    isContextValid,
    now: () => now,
  });
  return watcher;
}

function copyEvent(type: 'copy' | 'cut' = 'copy'): ClipboardEvent {
  return new ClipboardEvent(type, { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
}

function selectText(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function interact(): void {
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
}

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

  it('uses randomize mode when configured', () => {
    start(new FakeClipboard(true), { mode: 'randomize' });
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
