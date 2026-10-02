import { rewriteHtml } from './clipboard-html';
import { rewriteText, type RewriteOptions } from './rewrite';
import type { Settings } from './settings';

/** The subset of `navigator.clipboard` the watcher uses. */
export interface WatchedClipboard extends EventTarget {
  read(): Promise<readonly Pick<ClipboardItem, 'types' | 'getType'>[]>;
}

/** Reported through {@link WatcherDeps.onRewrite} after each rewrite. */
export interface RewriteEvent {
  /** Clipboard text before the rewrite; what Undo restores. */
  original: string;
  /** Clipboard text after the rewrite. */
  rewritten: string;
  /** Number of links that changed. */
  urls: number;
  /** False when restoring plain text would discard another clipboard format. */
  undoable?: boolean;
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
  restore: (text: string) => Promise<void>;
  /** Current coordinator generation for whole-clipboard inspection without page intent. */
  beginRead: () => Promise<string>;
  /** Advances and returns the shared generation that binds reads to this trusted page intent. */
  invalidateReads: () => Promise<string>;
  /** Ask the offscreen writer to reconcile this text with the current, format-aware clipboard snapshot. */
  reconcile: (
    text: string,
    embedded: boolean,
    baseline: string | undefined,
    types: readonly string[],
    epoch: string,
    pageCopy: boolean,
  ) => Promise<void>;
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
  /** Invalidates pending reads when configuration changes. */
  invalidate(): void;
  /** Inspects full formats for the whole-clipboard watcher, only while its setting is enabled. */
  inspect(): Promise<boolean>;
  /** Removes every listener and cancels pending clipboard checks. */
  stop(): void;
}

/** Supported clipboard flavors observed together through the native Clipboard API. */
interface ClipboardSnapshot {
  text: string;
  html: string | null;
  types: readonly string[];
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
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
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
  /** The last text this watcher wrote; left alone until different clipboard contents are observed. */
  let lastWritten: string | null = null;
  let generation = 0;
  let restoring = false;
  let sweep: AbortController | null = null;
  let pendingIntent: Promise<string> | null = null;
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
  function markIntent(event: Event): void {
    if (!event.isTrusted) return;
    invalidate();
    lastIntent = now();
    if (active()) {
      pendingIntent = deps.invalidateReads();
      void pendingIntent.catch(() => undefined);
    }
  }

  /**
   * Rewrites a copy or cut while it is being dispatched, through `event.clipboardData`.
   *
   * @returns Whether the event's clipboard data was rewritten.
   */
  function onCopy(event: ClipboardEvent): boolean {
    const data = event.clipboardData;
    if (!event.isTrusted || restoring || !data || !active()) {
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
      // Native rich copies must create their full payload before format-aware reconciliation.
      if (!selection?.plain) {
        return false;
      }
      original = selection.text;
      embedded = true;
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
      data.setData('text/html', rewrittenHtml.html);
    }
    onRewrite({
      original,
      rewritten: result?.text ?? original,
      urls: Math.max(result?.urls ?? 0, rewrittenHtml?.urls ?? 0),
      ...(data.types.some((type) => type !== 'text/plain') ? { undoable: false } : {}),
    });
    return true;
  }

  /** Reads supported flavors and expires text suppression without clearing a newer write. */
  async function readClipboard(source: WatchedClipboard, job = generation): Promise<ClipboardSnapshot | null> {
    const written = lastWritten;
    const items = await source.read();
    const item = items[0];
    if (
      items.length !== 1 ||
      !item ||
      item.types.length === 0 ||
      item.types.some((type) => type !== 'text/plain' && type !== 'text/html')
    ) {
      return null;
    }
    const types = item.types;
    const text = types.includes('text/plain') ? await (await item.getType('text/plain')).text() : '';
    const html = types.includes('text/html') ? await (await item.getType('text/html')).text() : null;
    if (generation === job && lastWritten === written && text !== written) {
      lastWritten = null;
    }
    return { text, html, types };
  }

  /**
   * Reads candidate text; the offscreen writer checks the current snapshot before any write.
   *
   * @param embedded Also rewrite links inside longer plain-only text; HTML is handled by the coordinator.
   * @param baseline Clipboard flavors before a polling gesture; unchanged contents are left alone.
   * @param job Local generation that cancels stale reads after newer intent or configuration.
   * @param pageCopy Whether page intent supplies a base URL for relative links.
   */
  async function rewriteClipboard(
    embedded: boolean,
    baseline?: ClipboardSnapshot | null,
    job = ++generation,
    pageCopy = true,
  ): Promise<boolean> {
    if (!clipboard || document.hidden || !document.hasFocus()) {
      return false;
    }
    let snapshot: ClipboardSnapshot | null;
    let epoch: string;
    try {
      epoch = await (pageCopy && pendingIntent ? pendingIntent : deps.beginRead());
      if (generation !== job || listeners.signal.aborted || !active()) return false;
      snapshot = await readClipboard(clipboard, job);
    } catch {
      return false;
    }
    if (generation !== job || !active()) {
      return false;
    }
    // Keep the background candidate: removing a web-custom flavor is invisible to synthetic paste.
    if (!snapshot) return false;
    const { text, html, types } = snapshot;
    if (
      text === baseline?.text &&
      html === baseline.html &&
      types.length === baseline.types.length &&
      types.every((type) => baseline.types.includes(type))
    )
      return true;
    // A synchronous text rewrite says nothing about a later HTML target with the same label.
    if (html === null && text === lastWritten) return true;
    const options: RewriteOptions = { mode: 'strip', baseUrl: pageCopy ? location.href : undefined };
    if (
      !rewriteText(text, { ...options, embedded: embedded || html !== null }) &&
      (html === null || !rewriteHtml(html, options))
    )
      return true;
    try {
      await deps.reconcile(text, embedded, baseline?.text, types, epoch, pageCopy);
    } catch {
      return false;
    }
    return true;
  }

  /** Checks after a gesture; an optional pre-gesture read distinguishes a new copy from existing text. */
  function runSweep(offsets: number[], baseline?: () => Promise<ClipboardSnapshot | null>): void {
    sweep?.abort();
    const job = ++generation;
    const controller = new AbortController();
    sweep = controller;
    void (async () => {
      let previous: ClipboardSnapshot | null | undefined;
      try {
        previous = await baseline?.();
      } catch (error) {
        // Chromium invalidates lazy format reads when a new copy replaces their snapshot.
        // That proves the clipboard changed, so keep the scheduled polls without the old baseline.
        if (!(
          error instanceof DOMException &&
          error.name === 'InvalidStateError' &&
          error.message.includes('Clipboard data has changed')
        ))
          return;
      }
      let elapsed = 0;
      for (const offset of offsets) {
        await new Promise((resolve) => setTimeout(resolve, offset - elapsed));
        elapsed = offset;
        if (controller.signal.aborted || generation !== job) {
          return;
        }
        await rewriteClipboard(false, previous, job);
      }
    })();
  }

  const options = { capture: true, signal: listeners.signal };
  for (const type of ['pointerdown', 'keydown', 'contextmenu'] as const) {
    window.addEventListener(type, markIntent, options);
  }

  for (const type of ['copy', 'cut'] as const) {
    window.addEventListener(
      type,
      (event) => {
        if (!event.isTrusted) return;
        markIntent(event);
        let reachedBubble = false;
        // Runs after previously registered page handlers. Handlers added during dispatch may run later.
        const late = (lateEvent: ClipboardEvent) => {
          if (lateEvent === event) {
            reachedBubble = true;
            onCopy(event);
          }
        };
        window.addEventListener(type, late, { once: true, signal: listeners.signal });
        // Check stopped events and fallback copies after every page handler and the default action finish.
        setTimeout(() => {
          window.removeEventListener(type, late);
          if (
            (!reachedBubble || !supportsChangeEvent) &&
            clipboard &&
            !restoring &&
            !listeners.signal.aborted &&
            active()
          ) {
            runSweep(SWEEP_AFTER_COPY);
          }
        }, 0);
      },
      options,
    );
  }

  if (clipboard && supportsChangeEvent) {
    clipboard.addEventListener(
      'clipboardchange',
      (event) => {
        const types = (event as ClipboardChangeLike).types;
        if (!event.isTrusted || restoring || !active() || now() - lastIntent > INTENT_WINDOW_MS) {
          return;
        }
        if (types?.some((type) => type !== 'text/plain' && type !== 'text/html')) {
          invalidate();
          lastWritten = null;
          return;
        }
        // The coordinator preserves HTML and cleans both representations; plain-only prose needs this flag.
        void rewriteClipboard(Boolean(types && !types.includes('text/html')));
      },
      { signal: listeners.signal },
    );
  } else if (clipboard) {
    window.addEventListener(
      'click',
      (event) => {
        if (event.isTrusted && active() && looksLikeCopyControl(event.target)) {
          runSweep(SWEEP_AFTER_CLICK, () => readClipboard(clipboard));
        }
      },
      options,
    );
    window.addEventListener(
      'contextmenu',
      (event) => {
        if (event.isTrusted && active() && event.target instanceof Element && event.target.closest('a[href], img')) {
          runSweep(SWEEP_AFTER_CONTEXT_MENU, () => readClipboard(clipboard));
        }
      },
      options,
    );
  }

  /** Removes every listener and cancels pending clipboard checks. */
  function stop(): void {
    listeners.abort();
    invalidate();
  }

  /** Cancels pending reconciliation when newer intent, Undo, or configuration supersedes it. */
  function invalidate(): void {
    generation += 1;
    sweep?.abort();
  }

  /** Writes `text` to the clipboard and marks it as ours so it is not rewritten again. */
  async function restore(text: string): Promise<void> {
    invalidate();
    restoring = true;
    try {
      await deps.restore(text);
      lastWritten = text;
    } finally {
      restoring = false;
    }
  }

  /** Answers the worker's request for a complete format inspection without requiring page intent. */
  function inspect(): Promise<boolean> {
    return active() && getSettings().watchClipboard
      ? rewriteClipboard(true, undefined, undefined, false)
      : Promise.resolve(false);
  }

  return { restore, stop, invalidate, inspect };
}
