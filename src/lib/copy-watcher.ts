import { hasRewritableClipboard, rewriteHtml } from './clipboard-html';
import { rewriteText, type RewriteOptions } from './rewrite';
import type { ClipboardWrite } from './messages';
import type { Settings } from './settings';
import { createSeed } from './prng';

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
    observeOnly?: boolean,
  ) => Promise<void>;
  /** Called after each rewrite, to show a notification and count it. */
  onRewrite: (event: RewriteEvent, write?: ClipboardWrite) => void | Promise<void>;
  /** False once the extension was reloaded or removed; the watcher then shuts itself down. */
  isContextValid?: () => boolean;
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

// Clipboard checks (ms after an actual copy or a control with a pre-gesture baseline).
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
 * - Copy controls and context menus compare against the clipboard before the gesture.
 * - `clipboardchange` (Chrome 144+) supplies observations to the focused background watcher;
 *   the event alone does not prove that a fresh copy occurred on this page.
 */
export function startCopyWatcher(deps: WatcherDeps): CopyWatcher {
  const { clipboard, getSettings, onRewrite } = deps;
  const isContextValid = deps.isContextValid ?? (() => true);
  const supportsChangeEvent = clipboard !== null && 'onclipboardchange' in clipboard;

  /** A synchronous output awaiting registration with the shared coordinator. */
  let lastWritten: ClipboardSnapshot | null = null;
  let generation = 0;
  let restoring = false;
  let sweep: AbortController | null = null;
  let pendingIntent: Promise<string> | null = null;
  const listeners = new AbortController();

  /** Whether to act on events; shuts the watcher down once the extension context is gone. */
  function active(): boolean {
    if (!isContextValid()) {
      stop();
      return false;
    }
    return getSettings().enabled;
  }

  /** New page interactions cancel older reads without authorizing clipboard writes. */
  function markIntent(event: Event): void {
    if (!event.isTrusted) return;
    invalidate();
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

    const options: RewriteOptions = { mode: getSettings().mode, key: createSeed(), baseUrl: location.href };
    const result = original ? rewriteText(original, { ...options, embedded }) : null;
    const rewrittenHtml = html ? rewriteHtml(html, options) : null;
    if (!result && !rewrittenHtml) {
      return false;
    }

    const before = { text: original, html, types: Array.from(data.types) };
    event.preventDefault();
    if (result) {
      data.setData('text/plain', result.text);
    }
    if (rewrittenHtml) {
      data.setData('text/html', rewrittenHtml.html);
    }
    lastWritten = {
      text: data.getData('text/plain'),
      html: data.types.includes('text/html') ? data.getData('text/html') : null,
      types: Array.from(data.types),
    };
    const written = lastWritten;
    const acknowledgement = onRewrite(
      {
        original,
        rewritten: result?.text ?? original,
        urls: Math.max(result?.urls ?? 0, rewrittenHtml?.urls ?? 0),
        ...(data.types.some((type) => type !== 'text/plain') ? { undoable: false } : {}),
      },
      { before, after: { ...written, types: [...written.types] } },
    );
    void Promise.resolve(acknowledgement)
      .catch(() => undefined)
      .finally(() => {
        if (lastWritten === written) lastWritten = null;
      });
    return true;
  }

  /** Whether two clipboard payloads contain the same text, HTML, and flavors. */
  function sameSnapshot(left: ClipboardSnapshot, right: ClipboardSnapshot): boolean {
    return (
      left.text === right.text &&
      left.html === right.html &&
      left.types.length === right.types.length &&
      left.types.every((type) => right.types.includes(type))
    );
  }

  /** Reads supported flavors and expires suppression without clearing a newer write. */
  async function readClipboard(source: WatchedClipboard, job = generation): Promise<ClipboardSnapshot | null> {
    const written = lastWritten;
    const items = await source.read();
    // An empty clipboard is a complete baseline, unlike an unreadable or unsupported payload.
    if (items.length === 0) {
      if (generation === job && lastWritten === written) lastWritten = null;
      return { text: '', html: null, types: [] };
    }
    const item = items[0];
    if (items.length !== 1 || !item || item.types.some((type) => type !== 'text/plain' && type !== 'text/html')) {
      return null;
    }
    const types = item.types;
    const text = types.includes('text/plain') ? await (await item.getType('text/plain')).text() : '';
    const html = types.includes('text/html') ? await (await item.getType('text/html')).text() : null;
    const snapshot = { text, html, types };
    if (generation === job && lastWritten === written && written && !sameSnapshot(snapshot, written)) {
      lastWritten = null;
    }
    return snapshot;
  }

  /**
   * Reads candidate text; the offscreen writer checks the current snapshot before any write.
   *
   * @param embedded Also rewrite links inside longer plain-only text; HTML is handled by the coordinator.
   * @param baseline Clipboard flavors before a polling gesture; unchanged contents are left alone.
   * @param job Local generation that cancels stale reads after newer intent or configuration.
   * @param pageCopy Whether a copy event or changed pre-gesture snapshot authorized this read.
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
      epoch = await (pageCopy ? (pendingIntent ??= deps.invalidateReads()) : deps.beginRead());
      if (generation !== job || listeners.signal.aborted || !active()) return false;
      snapshot = await readClipboard(clipboard, job);
    } catch {
      return false;
    }
    if (generation !== job || !document.hasFocus() || !active()) {
      return false;
    }
    // Keep the background candidate: removing a web-custom flavor is invisible to synthetic paste.
    if (!snapshot) return false;
    const { text, html, types } = snapshot;
    if (lastWritten && sameSnapshot(snapshot, lastWritten)) return true;
    const observeOnly =
      Boolean(baseline && sameSnapshot(snapshot, baseline)) ||
      !hasRewritableClipboard(text, html, embedded, pageCopy ? location.href : undefined);
    try {
      if (observeOnly) await deps.reconcile(text, embedded, baseline?.text, types, epoch, pageCopy, true);
      else await deps.reconcile(text, embedded, baseline?.text, types, epoch, pageCopy);
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
    pendingIntent ??= deps.invalidateReads();
    void pendingIntent.catch(() => undefined);
    void (async () => {
      let previous: ClipboardSnapshot | null | undefined;
      try {
        previous = await baseline?.();
        if (baseline && previous === null) return;
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
    })().finally(() => {
      if (sweep === controller) {
        sweep = null;
        pendingIntent = null;
      }
    });
  }

  const options = { capture: true, signal: listeners.signal };
  for (const type of ['pointerdown', 'keydown', 'contextmenu'] as const) {
    window.addEventListener(type, markIntent, options);
  }
  window.addEventListener(
    'blur',
    (event) => {
      if (event.isTrusted) invalidate();
    },
    { signal: listeners.signal },
  );

  for (const type of ['copy', 'cut'] as const) {
    window.addEventListener(
      type,
      (event) => {
        if (!event.isTrusted || !active()) return;
        markIntent(event);
        pendingIntent = deps.invalidateReads();
        void pendingIntent.catch(() => undefined);
        const job = generation;
        // Runs after previously registered page handlers. Handlers added during dispatch may run later.
        const late = (lateEvent: ClipboardEvent) => {
          if (lateEvent === event) {
            onCopy(event);
          }
        };
        window.addEventListener(type, late, { once: true, signal: listeners.signal });
        // Check stopped events and fallback copies after every page handler and the default action finish.
        setTimeout(() => {
          window.removeEventListener(type, late);
          if (generation === job && clipboard && !restoring && !listeners.signal.aborted && active()) {
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
        if (!event.isTrusted || restoring || !active()) {
          return;
        }
        if (types?.some((type) => type !== 'text/plain' && type !== 'text/html')) {
          invalidate();
          lastWritten = null;
          return;
        }
        // An authorized sweep already owns this copy; observers must not cancel its baseline read.
        if (pendingIntent || sweep || !getSettings().watchClipboard) return;
        // The coordinator preserves HTML and cleans both representations; plain-only prose needs this flag.
        void rewriteClipboard(Boolean(types && !types.includes('text/html')), undefined, undefined, false);
      },
      { signal: listeners.signal },
    );
  }
  if (clipboard) {
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
    lastWritten = null;
  }

  /** Cancels pending reconciliation when newer intent, Undo, or configuration supersedes it. */
  function invalidate(): void {
    generation += 1;
    sweep?.abort();
    sweep = null;
    pendingIntent = null;
  }

  /** Writes `text` to the clipboard and marks it as ours so it is not rewritten again. */
  async function restore(text: string): Promise<void> {
    invalidate();
    restoring = true;
    try {
      await deps.restore(text);
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
