/** Options for {@link showToast}. */
export interface ToastOptions {
  /** Text shown in the notification. */
  message: string;
  /** Adds an Undo button that calls this; the notification reports whether it succeeded. */
  onUndo?: () => Promise<void>;
  /**
   * How long the notification stays up: 4.5 s by default with Undo, 2.5 s without. Hovering or
   * focusing it pauses the countdown.
   */
  durationMs?: number;
}

/** Tag name of the element that hosts the notification's shadow root. */
export const TOAST_TAG = 'utm-randomizer-toast';

// Inline declarations on the host beat page stylesheets; the popover UA styles would otherwise center it.
const HOST_STYLE = [
  'all: initial',
  'position: fixed',
  'inset: auto auto 16px 16px',
  'z-index: 2147483647',
  'display: block',
  'margin: 0',
  'padding: 0',
  'border: 0',
  'background: transparent',
  'overflow: visible',
  'max-width: calc(100vw - 32px)',
]
  .map((declaration) => `${declaration} !important;`)
  .join(' ');

const SHADOW_CSS = `
  :host { color-scheme: dark; }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px 9px 14px;
    border-radius: 10px;
    background: rgb(28 30 33 / 0.96);
    color: #f2f3f5;
    font: 500 13px/1.35 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.28), 0 0 0 1px rgb(255 255 255 / 0.08);
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 160ms ease, transform 160ms ease;
  }
  .toast.visible { opacity: 1; transform: none; }
  .message { overflow-wrap: anywhere; }
  button {
    all: unset;
    cursor: pointer;
    border-radius: 6px;
    font: inherit;
    line-height: 1;
  }
  button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
  .undo { padding: 5px 8px; color: #8ab4f8; font-weight: 600; }
  .undo:hover { background: rgb(138 180 248 / 0.14); }
  .close { padding: 3px 6px; font-size: 16px; opacity: 0.7; }
  .close:hover { opacity: 1; background: rgb(255 255 255 / 0.08); }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; transform: none; } }
`;

let activeToast: { host: HTMLElement; timer: number } | null = null;

/** Removes the notification currently on screen, if any, and cancels its timer. */
function removeActiveToast(): void {
  if (activeToast) {
    window.clearTimeout(activeToast.timer);
    activeToast.host.remove();
    activeToast = null;
  }
}

/** Shows a small notification in the page's top layer, isolated from page styles by a shadow root. */
export function showToast({ message, onUndo, durationMs = onUndo ? 4500 : 2500 }: ToastOptions): void {
  removeActiveToast();

  const host = document.createElement(TOAST_TAG);
  host.style.cssText = HOST_STYLE;
  host.setAttribute('popover', 'manual');
  const root = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHADOW_CSS);
  root.adoptedStyleSheets = [sheet];

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const text = document.createElement('span');
  text.className = 'message';
  text.textContent = message;
  toast.append(text);

  const hide = () => {
    toast.classList.remove('visible');
    window.setTimeout(() => {
      if (activeToast?.host === host) {
        removeActiveToast();
      }
    }, 180);
  };

  const state = { host, timer: 0 };
  const schedule = (ms: number) => {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(hide, ms);
  };

  if (onUndo) {
    const undo = document.createElement('button');
    undo.className = 'undo';
    undo.textContent = 'Undo';
    undo.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      undo.remove();
      onUndo().then(
        () => {
          text.textContent = 'Original link restored';
        },
        () => {
          text.textContent = 'Could not restore the original link';
        },
      );
      schedule(1600);
    });
    toast.append(undo);
  }

  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', hide, { once: true });
  toast.append(close);

  // Hovering or focusing the toast keeps it open.
  toast.addEventListener('pointerenter', () => window.clearTimeout(state.timer));
  toast.addEventListener('pointerleave', () => schedule(1500));
  toast.addEventListener('focusin', () => window.clearTimeout(state.timer));

  root.append(toast);
  document.documentElement.append(host);
  try {
    host.showPopover();
  } catch {
    // Top layer unavailable (e.g. inside an SVG document); the fixed position still works.
  }

  activeToast = state;
  schedule(durationMs);
  requestAnimationFrame(() => toast.classList.add('visible'));
}
