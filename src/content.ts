import { randomizeTrackingParameters } from './utm-randomizer';

const clipboardSupported =
  typeof navigator !== 'undefined' &&
  typeof navigator.clipboard !== 'undefined' &&
  typeof navigator.clipboard.readText === 'function';

const NOTIFICATION_MESSAGE = 'Tracking parameters randomized! 🎲';
const POINTER_CHECK_DELAYS = [120, 320, 640, 1100, 1850, 2600];
const COPY_EVENT_DELAYS = [40, 140, 320];
const COPY_KEYWORDS = [
  'copy',
  'clipboard',
  'copylink',
  'copy-link',
  'copy_link',
  'copy-url',
  'copy_url',
  'copyurl',
  'copy-to-clipboard',
  'copytoclipboard',
];

let sweepAbortController: AbortController | null = null;
let lastClipboardValue: string | null = null;
let baselineInitialized = false;
let pointerCandidate = false;
let extensionEnabled = true;

// Load initial enabled state from storage
chrome.storage.local.get(['enabled']).then((result) => {
  extensionEnabled = result.enabled !== false;
});

// Listen for changes to enabled state
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled !== undefined) {
    extensionEnabled = changes.enabled.newValue !== false;
  }
});

async function incrementStats() {
  const result = await chrome.storage.local.get(['totalCount', 'sessionCount']);
  await chrome.storage.local.set({
    totalCount: (result.totalCount || 0) + 1,
    sessionCount: (result.sessionCount || 0) + 1,
  });
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeoutId);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }
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

  // Create message span
  const messageSpan = document.createElement('span');
  messageSpan.textContent = message;

  // Create dismiss button
  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = '\u00d7'; // × character
  dismissBtn.setAttribute('aria-label', 'Dismiss notification');
  dismissBtn.style.cssText = `
    background: none;
    border: none;
    color: inherit;
    font-size: 18px;
    cursor: pointer;
    padding: 0 0 0 12px;
    opacity: 0.7;
    line-height: 1;
  `;
  dismissBtn.addEventListener('mouseenter', () => {
    dismissBtn.style.opacity = '1';
  });
  dismissBtn.addEventListener('mouseleave', () => {
    dismissBtn.style.opacity = '0.7';
  });

  notification.appendChild(messageSpan);
  notification.appendChild(dismissBtn);

  // Neutral colors that work in light/dark mode, bottom-left to avoid conflicts
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    background: rgba(50, 50, 50, 0.95);
    color: #f0f0f0;
    padding: 10px 14px;
    border-radius: 6px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    opacity: 0;
    transition: opacity 0.2s ease;
    display: flex;
    align-items: center;
    max-width: 300px;
    pointer-events: auto;
  `;

  document.body.appendChild(notification);
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
  });

  // Shorter duration: 1.8s instead of 2.6s
  const timeoutId = setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 200);
  }, 1800);

  // Clear timeout if manually dismissed
  dismissBtn.addEventListener(
    'click',
    () => {
      clearTimeout(timeoutId);
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 200);
    },
    { once: true },
  );
}

function stripWrappingCharacters(value: string): string {
  return value.replace(/^[<"'`]+/, '').replace(/[>"'`]+$/, '');
}

function resolveUrlFromClipboard(raw: string): string | null {
  const trimmed = stripWrappingCharacters(raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, ''));
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const attempts: Array<{ candidate: string; useDocumentBase: boolean }> = [];
  const pushed = new Set<string>();

  const pushAttempt = (candidate: string, useDocumentBase = false) => {
    if (!candidate || pushed.has(`${candidate}|${useDocumentBase}`)) {
      return;
    }
    pushed.add(`${candidate}|${useDocumentBase}`);
    attempts.push({ candidate, useDocumentBase });
  };

  pushAttempt(trimmed);

  if (/^www\./i.test(trimmed)) {
    pushAttempt(`https://${trimmed}`);
  }

  if (trimmed.startsWith('//')) {
    pushAttempt(`https:${trimmed}`);
  }

  if (trimmed.startsWith('/')) {
    pushAttempt(trimmed, true);
  }

  if (trimmed.startsWith('?') || trimmed.startsWith('#')) {
    pushAttempt(trimmed, true);
  }

  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    pushAttempt(trimmed, true);
  }

  if (!trimmed.includes('://') && /^[a-z0-9.-]+\.[a-z]{2,}([/?#:]|$)/i.test(trimmed)) {
    pushAttempt(`https://${trimmed}`);
  }

  for (const { candidate, useDocumentBase } of attempts) {
    try {
      const url = useDocumentBase ? new URL(candidate, window.location.href) : new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString();
      }
    } catch {
      // Ignore parse failures and continue attempting alternatives
    }
  }

  return null;
}

async function tryMutateClipboard(): Promise<boolean> {
  if (!extensionEnabled) {
    return false;
  }

  if (document.hidden || !document.hasFocus()) {
    return false;
  }

  let clipboardText: string;
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch (error) {
    console.debug('UTM Randomizer: Clipboard read failed', error);
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

  const resolvedUrl = resolveUrlFromClipboard(clipboardText);
  if (!resolvedUrl) {
    lastClipboardValue = clipboardText;
    return false;
  }

  const randomized = randomizeTrackingParameters(resolvedUrl);
  if (randomized === resolvedUrl) {
    lastClipboardValue = clipboardText;
    return false;
  }

  try {
    await navigator.clipboard.writeText(randomized);
    lastClipboardValue = randomized;
    await incrementStats();
    showNotification(NOTIFICATION_MESSAGE);
    return true;
  } catch (error) {
    console.debug('UTM Randomizer: Failed to write randomized URL to clipboard', error);
    return false;
  }
}

async function runClipboardSweep(delays: number[]) {
  // Cancel any in-progress sweep
  if (sweepAbortController) {
    sweepAbortController.abort();
  }

  sweepAbortController = new AbortController();
  const signal = sweepAbortController.signal;

  try {
    for (const delay of delays) {
      await wait(delay, signal);

      if (signal.aborted) {
        return;
      }

      const mutated = await tryMutateClipboard();
      if (mutated) {
        // Remember new baseline so subsequent iterations catch any site-overwrites.
        // Do not break; some sites rewrite the clipboard again later in the sequence.
        continue;
      }
    }
  } catch (error) {
    // AbortError is expected when a new sweep cancels this one
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.debug('UTM Randomizer: Sweep cancelled for new operation');
      return;
    }
    throw error;
  } finally {
    // Only clear if this is still the current controller
    if (sweepAbortController?.signal === signal) {
      sweepAbortController = null;
    }
  }
}

if (clipboardSupported) {
  document.addEventListener(
    'copy',
    () => {
      runClipboardSweep(COPY_EVENT_DELAYS);
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
      runClipboardSweep(POINTER_CHECK_DELAYS);
    },
    true,
  );

  (async () => {
    try {
      const initial = await navigator.clipboard.readText();
      lastClipboardValue = initial;
      baselineInitialized = true;
    } catch (error) {
      console.debug('UTM Randomizer: Initial clipboard read failed', error);
      baselineInitialized = true;
    }
  })();

  console.debug('UTM Randomizer: Content script loaded');
} else {
  console.debug('UTM Randomizer: Clipboard API not available');
}
