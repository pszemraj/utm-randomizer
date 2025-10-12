import { randomizeTrackingParameters } from './utm-randomizer';

const NOTIFICATION_MESSAGE = 'Tracking parameters randomized! 🎲';
const POINTER_CHECK_DELAYS = [120, 320, 640, 1100, 1850, 2600];
const COPY_EVENT_DELAYS = [40, 140, 320];
const COPY_KEYWORDS = [
  'copy',
  'clipboard',
  'share',
  'link',
  'url',
  'invite',
  'permalink',
  'perma-link',
  'copylink',
  'copy-link',
  'sharelink',
  'share-link',
  'copy-url',
];

let sweepInProgress = false;
let lastClipboardValue: string | null = null;
let baselineInitialized = false;
let pointerCandidate = false;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function lowerOrEmpty(value: string | null | undefined): string {
  return value ? value.toLowerCase() : '';
}

function elementHasCopyIntent(element: Element): boolean {
  const texts: string[] = [];

  const attributes = ['data-tooltip', 'data-title', 'data-original-title', 'title', 'aria-label', 'aria-description', 'data-testid'];
  attributes.forEach(attr => {
    const value = element.getAttribute(attr);
    if (value) {
      texts.push(value);
    }
  });

  if (element instanceof HTMLAnchorElement || element instanceof HTMLButtonElement) {
    texts.push(element.innerText || element.textContent || '');
  }

  if (element instanceof HTMLElement) {
    texts.push(element.id);
    texts.push(element.className);
    const dataCopy = element.getAttribute('data-copy');
    if (dataCopy) {
      texts.push(dataCopy);
    }
  }

  return texts.some(text => {
    const lower = lowerOrEmpty(text);
    return COPY_KEYWORDS.some(keyword => lower.includes(keyword));
  });
}

function isInteractiveElement(element: Element): boolean {
  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true;
  }

  if (element instanceof HTMLElement) {
    const role = element.getAttribute('role');
    if (role && ['button', 'menuitem', 'option', 'link', 'switch', 'tab'].includes(role.toLowerCase())) {
      return true;
    }

    if (typeof element.onclick === 'function' || element.tabIndex >= 0) {
      return true;
    }

    const classList = Array.from(element.classList);
    if (classList.some(cls => cls.toLowerCase().includes('button') || cls.toLowerCase().includes('copy'))) {
      return true;
    }
  }

  return false;
}

function shouldMonitorPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  let current: Element | null = target;
  let depth = 0;
  while (current && depth < 5) {
    if (elementHasCopyIntent(current) || isInteractiveElement(current)) {
      return true;
    }
    current = current.parentElement;
    depth += 1;
  }

  return false;
}

function showNotification(message: string) {
  const existing = document.getElementById('__utm-randomizer-toast');
  if (existing) {
    existing.remove();
  }

  const notification = document.createElement('div');
  notification.id = '__utm-randomizer-toast';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4CAF50;
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 2147483647;
    font-family: Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    opacity: 0;
    transition: opacity 0.25s ease;
  `;

  document.body.appendChild(notification);
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
  });

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      notification.remove();
    }, 250);
  }, 2600);
}

async function tryMutateClipboard(trigger: 'copy-event' | 'pointer-click'): Promise<boolean> {
  if (document.hidden || !document.hasFocus()) {
    return false;
  }

  let clipboardText: string;
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch (error) {
    return false;
  }

  if (!baselineInitialized) {
    baselineInitialized = true;
    lastClipboardValue = clipboardText;
    return false;
  }

  if (clipboardText === lastClipboardValue) {
    return false;
  }

  const randomized = randomizeTrackingParameters(clipboardText);
  if (randomized === clipboardText) {
    lastClipboardValue = clipboardText;
    return false;
  }

  try {
    await navigator.clipboard.writeText(randomized);
    lastClipboardValue = randomized;
    showNotification(NOTIFICATION_MESSAGE);
    console.log('UTM Randomizer:', trigger, 'replaced clipboard content');
    return true;
  } catch (error) {
    console.error('UTM Randomizer: Failed to write randomized URL to clipboard', error);
    return false;
  }
}

async function runClipboardSweep(trigger: 'copy-event' | 'pointer-click', delays: number[]) {
  if (sweepInProgress) {
    return;
  }

  sweepInProgress = true;
  try {
    for (const delay of delays) {
      await wait(delay);
      const mutated = await tryMutateClipboard(trigger);
      if (mutated) {
        // Remember new baseline so subsequent iterations catch any site-overwrites.
        // Do not break; some sites rewrite the clipboard again later in the sequence.
        continue;
      }
    }
  } finally {
    sweepInProgress = false;
  }
}

document.addEventListener(
  'copy',
  () => {
    runClipboardSweep('copy-event', COPY_EVENT_DELAYS);
  },
  true,
);

document.addEventListener(
  'pointerdown',
  (event) => {
    pointerCandidate = shouldMonitorPointerTarget(event.target);
  },
  true,
);

document.addEventListener(
  'click',
  (event) => {
    const isCandidate = pointerCandidate || shouldMonitorPointerTarget(event.target);
    pointerCandidate = false;
    if (!isCandidate) {
      return;
    }
    if (document.hidden || !document.hasFocus()) {
      return;
    }
    runClipboardSweep('pointer-click', POINTER_CHECK_DELAYS);
  },
  true,
);

(async () => {
  try {
    const initial = await navigator.clipboard.readText();
    lastClipboardValue = initial;
    baselineInitialized = true;
  } catch {
    baselineInitialized = true;
  }
})();

console.log('UTM Randomizer: Content script loaded with clipboard sweep mode');
