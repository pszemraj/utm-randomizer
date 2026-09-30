import { createLoopGuard } from './loop-guard';
import { rewriteText, rewriteUrl, type RewriteOptions } from './rewrite';
import type { Settings } from './settings';

/** The subset of `navigator.clipboard` the watcher uses. */
export interface WatchedClipboard extends EventTarget {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

/** Reported through {@link WatcherDeps.onRewrite} after each rewrite. */
export interface RewriteEvent {
  /** Clipboard text before the rewrite; what Undo restores. */
  original: string;
  /** Clipboard text after the rewrite. */
  rewritten: string;
  /** Number of links that changed. */
  urls: number;
}

/** Everything {@link startCopyWatcher} needs from its environment; tests pass fakes. */
export interface WatcherDeps {
  /** `navigator.clipboard`, or null where the async Clipboard API is unavailable (insecure contexts). */
  clipboard: WatchedClipboard | null;
  /** Current settings; read on every event so changes apply immediately. */
  getSettings: () => Settings;
  /** The per-install key that seeds replacement values, or null while it is still loading. */
  getKey: () => string | null;
  /**
   * Called before Undo puts the original back, so other watchers (the background clipboard watcher)
   * leave it alone instead of rewriting it again.
   */
  beforeRestore?: (text: string) => Promise<void>;
  /** Called after each rewrite, to show a notification and count it. */
  onRewrite: (event: RewriteEvent) => void;
  /** False once the extension was reloaded or removed; the watcher then shuts itself down. */
  isContextValid?: () => boolean;
  /** Monotonic clock in milliseconds; defaults to `performance.now()`. */
  now?: () => number;
}

/** Handle returned by {@link startCopyWatcher}. */
export interface CopyWatcher {
  /** Puts `text` back on the clipboard without rewriting it again (the toast's Undo). */
  restore(text: string): Promise<void>;
  /** Removes every listener and cancels pending clipboard checks. */
  stop(): void;
}

/** A clipboard change this soon after the user interacted with the page is attributed to the page. */
const INTENT_WINDOW_MS = 10_000;
// Clipboard checks (ms after the gesture) for browsers without the `clipboardchange` event (Chrome < 144).
const SWEEP_AFTER_COPY = [40, 150, 400];
const SWEEP_AFTER_CLICK = [120, 350, 800, 1600, 2800];
const SWEEP_AFTER_CONTEXT_MENU = [400, 1000, 2000, 3500, 5500, 8000];

const SELECTABLE_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel']);
const COPY_HINT = /copy|clipboard/i;
const INTERACTIVE_ROLES = new Set(['button', 'menuitem', 'option', 'link', 'switch', 'tab']);

/** The `clipboardchange` event (Chrome 144+), which the DOM typings may not include yet. */
interface ClipboardChangeLike extends Event {
  /** MIME types now on the clipboard. */
  types?: readonly string[];
}

/** Text the default copy action would put on the clipboard. `plain` is true for form fields (no HTML flavor). */
function selectedText(): { text: string; plain: boolean } | null {
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && SELECTABLE_INPUT_TYPES.has(active.type))
  ) {
    const { selectionStart, selectionEnd, value } = active;
    if (selectionStart === null || selectionEnd === null || selectionStart === selectionEnd) {
      return null;
    }
    return { text: value.slice(selectionStart, selectionEnd), plain: true };
  }
  const text = window.getSelection()?.toString() ?? '';
  return text ? { text, plain: false } : null;
}

/** Rewrites links in an HTML clipboard flavor (hrefs and visible link text). Returns null when unchanged. */
function rewriteHtml(html: string, options: RewriteOptions): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const result = rewriteUrl(anchor.getAttribute('href') ?? '', options);
    if (result) {
      anchor.setAttribute('href', result.url);
      changed = true;
    }
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const result = rewriteText(text.data, { ...options, embedded: true });
    if (result) {
      text.data = result.text;
      changed = true;
    }
  }
  return changed ? doc.body.innerHTML : null;
}

/**
 * Whether a click target is plausibly a "Copy link" control: a button, link, or menu item, or an
 * element whose id, class, label, or tooltip mentions copying. Checks up to five ancestors.
 */
function looksLikeCopyControl(target: EventTarget | null): boolean {
  let element = target instanceof Element ? target : null;
  for (let depth = 0; element && depth < 5; depth += 1, element = element.parentElement) {
    const hints = [
      element.id,
      typeof element.className === 'string' ? element.className : '',
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-tooltip'),
      element.getAttribute('data-testid'),
    ];
    if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) {
      hints.push(element.textContent);
    }
    if (hints.some((hint) => hint && COPY_HINT.test(hint))) {
      return true;
    }
    const role = element.getAttribute('role');
    if (
      element instanceof HTMLButtonElement ||
      element instanceof HTMLAnchorElement ||
      (role !== null && INTERACTIVE_ROLES.has(role))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Watches for links being copied on the page and rewrites their tracking parameters.
 *
 * - `copy`/`cut` events are rewritten synchronously through `clipboardData` (covers Ctrl+C,
 *   `execCommand('copy')` buttons, and pages that set clipboard data themselves).
 * - `clipboardchange` (Chrome 144+) catches everything else written while the page is in use:
 *   `navigator.clipboard.writeText` buttons and the browser's "Copy link address".
 * - Without `clipboardchange`, the clipboard is polled briefly after copy-like gestures.
 */
export function startCopyWatcher(deps: WatcherDeps): CopyWatcher {
  const { clipboard, getSettings, getKey, onRewrite } = deps;
  const isContextValid = deps.isContextValid ?? (() => true);
  const now = deps.now ?? (() => performance.now());
  const supportsChangeEvent = clipboard !== null && 'onclipboardchange' in clipboard;

  let lastIntent = Number.NEGATIVE_INFINITY;
  /** The last text this watcher put on the clipboard; never rewritten again. */
  let lastWritten: string | null = null;
  const loopGuard = createLoopGuard(now, () => location.href);
  let restoring = false;
  let sweep: AbortController | null = null;
  const listeners = new AbortController();

  /** Current rewrite options, or null while replacement values cannot be computed yet. */
  const rewriteOptions = (): RewriteOptions | null => {
    const { mode } = getSettings();
    const key = getKey();
    return key === null && mode !== 'strip' ? null : { mode, key: key ?? '', baseUrl: location.href };
  };

  /** Whether to act on events; shuts the watcher down once the extension context is gone. */
  function active(): boolean {
    if (!isContextValid()) {
      stop();
      return false;
    }
    return getSettings().enabled;
  }

  /** Records a user interaction with this page (click, key, context menu, copy). */
  function markIntent(): void {
    lastIntent = now();
  }

  /**
   * Rewrites a copy or cut while it is being dispatched, through `event.clipboardData`.
   *
   * @returns Whether the event's clipboard data was rewritten.
   */
  function onCopy(event: ClipboardEvent): boolean {
    const data = event.clipboardData;
    if (restoring || !data || !active()) {
      return false;
    }

    let original: string;
    let embedded: boolean;
    let html: string | null = null;
    if (event.defaultPrevented) {
      // The page put its own data on the clipboard.
      original = data.getData('text/plain');
      html = data.types.includes('text/html') ? data.getData('text/html') : null;
      embedded = true;
    } else if (event.type === 'copy') {
      const selection = selectedText();
      if (!selection) {
        return false;
      }
      original = selection.text;
      // Replacing a rich selection would drop its formatting, so only lone links are rewritten there.
      embedded = selection.plain;
    } else {
      // Canceling a native cut would also cancel the deletion; leave it to the async path.
      return false;
    }

    const options = rewriteOptions();
    if (!options) {
      return false;
    }
    const result = original ? rewriteText(original, { ...options, embedded }) : null;
    const rewrittenHtml = html ? rewriteHtml(html, options) : null;
    if (!result && !rewrittenHtml) {
      return false;
    }

    event.preventDefault();
    if (result) {
      data.setData('text/plain', result.text);
      lastWritten = result.text;
    }
    if (rewrittenHtml) {
      data.setData('text/html', rewrittenHtml);
    }
    onRewrite({ original, rewritten: result?.text ?? original, urls: result?.urls ?? 1 });
    return true;
  }

  /**
   * Reads the clipboard and writes back a rewritten version if it holds tracked links.
   *
   * @param embedded Also rewrite links inside longer text (only safe for plain-text clipboard contents).
   */
  async function rewriteClipboard(embedded: boolean): Promise<void> {
    if (!clipboard || document.hidden || !document.hasFocus()) {
      return;
    }
    let text: string;
    try {
      text = await clipboard.readText();
    } catch {
      return;
    }
    const options = rewriteOptions();
    if (!text || text === lastWritten || !options || !active() || loopGuard.blocks(text)) {
      return;
    }
    const result = rewriteText(text, { ...options, embedded });
    if (!result) {
      return;
    }
    try {
      await clipboard.writeText(result.text);
    } catch {
      return;
    }
    lastWritten = result.text;
    loopGuard.record(text, result.text);
    onRewrite({ original: text, rewritten: result.text, urls: result.urls });
  }

  /** Checks the clipboard at each offset (ms after the gesture); a newer gesture cancels the sweep. */
  function runSweep(offsets: number[]): void {
    sweep?.abort();
    const controller = new AbortController();
    sweep = controller;
    void (async () => {
      let elapsed = 0;
      for (const offset of offsets) {
        await new Promise((resolve) => setTimeout(resolve, offset - elapsed));
        elapsed = offset;
        if (controller.signal.aborted) {
          return;
        }
        await rewriteClipboard(false);
      }
    })();
  }

  const options = { capture: true, signal: listeners.signal };
  for (const type of ['pointerdown', 'keydown', 'contextmenu'] as const) {
    window.addEventListener(type, markIntent, options);
  }

  const afterPageHandlers = (event: ClipboardEvent) => {
    const handled = onCopy(event);
    if (!handled && !supportsChangeEvent && clipboard && !restoring && active()) {
      runSweep(SWEEP_AFTER_COPY);
    }
  };
  for (const type of ['copy', 'cut'] as const) {
    window.addEventListener(
      type,
      (event) => {
        markIntent();
        // A window listener added now runs last in this event's bubble phase, after every page handler
        // (including page listeners on window) has put its data on the clipboard.
        const late = (lateEvent: ClipboardEvent) => {
          if (lateEvent === event) {
            afterPageHandlers(event);
          }
        };
        window.addEventListener(type, late, { once: true, signal: listeners.signal });
        // Propagation may be stopped before the bubble phase; drop the listener once dispatch is over.
        setTimeout(() => window.removeEventListener(type, late), 0);
      },
      options,
    );
  }

  if (clipboard && supportsChangeEvent) {
    clipboard.addEventListener(
      'clipboardchange',
      (event) => {
        const types = (event as ClipboardChangeLike).types;
        if (restoring || !active() || now() - lastIntent > INTENT_WINDOW_MS) {
          return;
        }
        if (types && types.length > 0 && !types.includes('text/plain')) {
          return;
        }
        // Rich clipboard content would lose its formatting, so embedded links are only rewritten in plain text.
        void rewriteClipboard(Boolean(types && !types.includes('text/html')));
      },
      { signal: listeners.signal },
    );
  } else if (clipboard) {
    window.addEventListener(
      'click',
      (event) => {
        if (active() && looksLikeCopyControl(event.target)) {
          runSweep(SWEEP_AFTER_CLICK);
        }
      },
      options,
    );
    window.addEventListener(
      'contextmenu',
      (event) => {
        if (active() && event.target instanceof Element && event.target.closest('a[href], img')) {
          runSweep(SWEEP_AFTER_CONTEXT_MENU);
        }
      },
      options,
    );
  }

  /** Removes every listener and cancels pending clipboard checks. */
  function stop(): void {
    listeners.abort();
    sweep?.abort();
  }

  /** Writes `text` to the clipboard and marks it as ours so it is not rewritten again. */
  async function restore(text: string): Promise<void> {
    lastWritten = text;
    await deps.beforeRestore?.(text);
    if (clipboard) {
      await clipboard.writeText(text);
      return;
    }
    // Insecure contexts have no async Clipboard API; fall back to a synthetic copy.
    restoring = true;
    const write = (event: ClipboardEvent) => {
      event.preventDefault();
      event.clipboardData?.setData('text/plain', text);
    };
    document.addEventListener('copy', write, { once: true, capture: true });
    try {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only clipboard write without the async API
      if (!document.execCommand('copy')) {
        throw new Error('Copy command was rejected');
      }
    } finally {
      document.removeEventListener('copy', write, { capture: true });
      restoring = false;
    }
  }

  return { restore, stop };
}
