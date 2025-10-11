import { hasTrackingParameters, randomizeTrackingParameters } from './utm-randomizer';

let isProcessing = false;

const NOTIFICATION_MESSAGE = 'Tracking parameters randomized! 🎲';
const REQUEST_EVENT = 'utmRandomizer:request';
const RESPONSE_EVENT = 'utmRandomizer:response';
const COPIED_EVENT = 'utmRandomizer:copied';

interface ClipboardMutationRequestDetail {
  id: string;
  text: string;
}

interface ClipboardMutationResponseDetail {
  id: string;
  text: string;
  changed: boolean;
}

function isValidURL(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function maybeRandomizeURL(original: string): { mutated: string; changed: boolean } {
  if (!isValidURL(original)) {
    return { mutated: original, changed: false };
  }

  if (!hasTrackingParameters(original)) {
    return { mutated: original, changed: false };
  }

  const mutated = randomizeTrackingParameters(original);
  return { mutated, changed: mutated !== original };
}

function showNotification(message: string) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4CAF50;
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 10000;
    font-family: Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    opacity: 0;
    transition: opacity 0.3s ease;
  `;

  document.body.appendChild(notification);

  // Fade in
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
  });

  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

async function interceptClipboard() {
  if (isProcessing) return;

  try {
    isProcessing = true;

    const clipboardText = await navigator.clipboard.readText();
    const { mutated, changed } = maybeRandomizeURL(clipboardText);

    if (changed) {
      console.log('UTM Randomizer: Found URL with tracking parameters:', clipboardText);
      console.log('UTM Randomizer: Replacing with:', mutated);

      await navigator.clipboard.writeText(mutated);
      showNotification(NOTIFICATION_MESSAGE);
    }
  } catch (error) {
    console.error('UTM Randomizer: Error processing clipboard:', error);
  } finally {
    isProcessing = false;
  }
}

function listenForPageRequests() {
  window.addEventListener(REQUEST_EVENT, (event) => {
    const customEvent = event as CustomEvent<ClipboardMutationRequestDetail>;
    const detail = customEvent.detail;
    if (!detail || typeof detail.id !== 'string' || typeof detail.text !== 'string') {
      return;
    }

    const { mutated, changed } = maybeRandomizeURL(detail.text);
    if (changed) {
      showNotification(NOTIFICATION_MESSAGE);
      console.log('UTM Randomizer: Page request intercepted, replacing:', detail.text, '->', mutated);
    }

    const response: ClipboardMutationResponseDetail = {
      id: detail.id,
      text: mutated,
      changed,
    };
    window.dispatchEvent(new CustomEvent<ClipboardMutationResponseDetail>(RESPONSE_EVENT, { detail: response }));
  });

  window.addEventListener(COPIED_EVENT, () => {
    showNotification(NOTIFICATION_MESSAGE);
  });
}

function injectClipboardPatch() {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.textContent = `
    (function() {
      try {
        const clipboard = navigator.clipboard;
        if (!clipboard) {
          return;
        }

        const REQUEST_EVENT = '${REQUEST_EVENT}';
        const RESPONSE_EVENT = '${RESPONSE_EVENT}';
        const COPIED_EVENT = '${COPIED_EVENT}';
        let requestId = 0;

        function requestMutation(text) {
          return new Promise((resolve) => {
            if (typeof text !== 'string') {
              resolve(text);
              return;
            }

            const id = 'utmRandomizer-' + Date.now() + '-' + (requestId += 1);
            const timeout = setTimeout(() => {
              window.removeEventListener(RESPONSE_EVENT, handleResponse, true);
              resolve(text);
            }, 150);

            function handleResponse(event) {
              const detail = event.detail || {};
              if (detail.id !== id) {
                return;
              }
              clearTimeout(timeout);
              window.removeEventListener(RESPONSE_EVENT, handleResponse, true);
              resolve(typeof detail.text === 'string' ? detail.text : text);
            }

            window.addEventListener(RESPONSE_EVENT, handleResponse, true);
            window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { id: id, text: text } }));
          });
        }

        const originalWriteText = typeof clipboard.writeText === 'function'
          ? clipboard.writeText.bind(clipboard)
          : null;
        if (originalWriteText) {
          clipboard.writeText = async function(data) {
            try {
              const mutated = await requestMutation(data);
              return originalWriteText(mutated);
            } catch (error) {
              return originalWriteText(data);
            }
          };
        }

        const originalWrite = typeof clipboard.write === 'function'
          ? clipboard.write.bind(clipboard)
          : null;

        if (originalWrite && typeof ClipboardItem !== 'undefined') {
          clipboard.write = async function(items) {
            if (!Array.isArray(items) || items.length === 0) {
              return originalWrite(items);
            }

            let mutatedAny = false;
            const rewritten = await Promise.all(items.map(async (item) => {
              if (!item || !Array.isArray(item.types) || !item.types.includes('text/plain')) {
                return item;
              }

              try {
                const blob = await item.getType('text/plain');
                const text = await blob.text();
                const mutatedText = await requestMutation(text);
                if (mutatedText === text) {
                  return item;
                }

                mutatedAny = true;
                const typeMap = {};
                await Promise.all(item.types.map(async (type) => {
                  const typeBlob = await item.getType(type);
                  if (type === 'text/plain') {
                    typeMap[type] = new Blob([mutatedText], { type: typeBlob.type || 'text/plain' });
                  } else {
                    typeMap[type] = typeBlob;
                  }
                }));
                return new ClipboardItem(typeMap);
              } catch (error) {
                return item;
              }
            }));

            const result = await originalWrite(rewritten);
            if (mutatedAny) {
              window.dispatchEvent(new CustomEvent(COPIED_EVENT));
            }
            return result;
          };
        }
      } catch (error) {
        console.warn('UTM Randomizer: Failed to patch clipboard APIs', error);
      }
    })();
  `;
  document.documentElement.appendChild(script);
  script.remove();
}

// Monitor copy events
document.addEventListener('copy', () => {
  // Small delay to ensure clipboard is updated
  setTimeout(interceptClipboard, 50);
});

// Also monitor keyboard shortcuts
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
    setTimeout(interceptClipboard, 50);
  }
});

listenForPageRequests();
injectClipboardPatch();
console.log('UTM Randomizer: Content script loaded');
