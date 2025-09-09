// content.ts - Improved content script with better clipboard handling

let isProcessing = false;
let lastProcessedUrl: string | null = null;
let lastProcessedTime = 0;
const DEBOUNCE_TIME = 500; // Prevent rapid re-processing

// Debounced clipboard check
function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

async function checkClipboard() {
  if (isProcessing) return;
  
  const now = Date.now();
  if (now - lastProcessedTime < DEBOUNCE_TIME) return;
  
  try {
    isProcessing = true;
    const text = await navigator.clipboard.readText();
    
    // Skip if same URL was just processed
    if (text === lastProcessedUrl) return;
    
    // Send to background for processing
    chrome.runtime.sendMessage(
      { action: 'checkAndRandomize', text },
      async (response) => {
        if (response?.processed) {
          lastProcessedUrl = response.randomizedUrl;
          lastProcessedTime = Date.now();
          
          await navigator.clipboard.writeText(response.randomizedUrl);
          showNotification('UTM parameters randomized! 🎲');
          console.log('UTM Randomizer: Replaced', response.originalUrl, 'with', response.randomizedUrl);
        }
      }
    );
  } catch (error) {
    // User denied clipboard access or other error
    console.debug('UTM Randomizer: Clipboard access failed:', error);
  } finally {
    isProcessing = false;
  }
}

const debouncedCheck = debounce(checkClipboard, 100);

function showNotification(message: string) {
  // Remove any existing notifications first
  const existing = document.querySelector('.utm-randomizer-notification');
  if (existing) existing.remove();
  
  const notification = document.createElement('div');
  notification.className = 'utm-randomizer-notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #4CAF50, #45a049);
    color: white;
    padding: 14px 24px;
    border-radius: 8px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    opacity: 0;
    transform: translateY(-10px);
    transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    pointer-events: none;
    user-select: none;
  `;
  
  document.body.appendChild(notification);
  
  // Trigger animation
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateY(0)';
  });
  
  // Auto remove with fade out
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(-10px)';
    setTimeout(() => notification.remove(), 300);
  }, 2500);
}

// Monitor copy events with better handling
document.addEventListener('copy', () => {
  // Only process if text is selected (not images, etc.)
  const selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    debouncedCheck();
  }
});

// Keyboard shortcut monitoring with proper key detection
document.addEventListener('keydown', (event) => {
  // Ctrl+C or Cmd+C
  if ((event.ctrlKey || event.metaKey) && event.key === 'c' && !event.shiftKey && !event.altKey) {
    debouncedCheck();
  }
  
  // Ctrl+X or Cmd+X (cut operation)
  if ((event.ctrlKey || event.metaKey) && event.key === 'x' && !event.shiftKey && !event.altKey) {
    debouncedCheck();
  }
});

// Also monitor paste events to check if user is pasting a URL
document.addEventListener('paste', async () => {
  // Small delay to process after paste completes
  setTimeout(debouncedCheck, 50);
});

// Monitor focus events - useful for when user switches tabs after copying from address bar
document.addEventListener('focus', () => {
  // Check clipboard when page gains focus
  debouncedCheck();
}, true);

// Listen for visibility changes
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    debouncedCheck();
  }
});

console.log('UTM Randomizer: Content script loaded and monitoring clipboard events');