// content.ts - Handles copy events within webpages only

let isProcessing = false;
let isExtensionEnabled = true;

// Get initial state
chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
  if (response && typeof response.enabled === 'boolean') {
    isExtensionEnabled = response.enabled;
  }
});

// Listen for state changes
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'stateChanged') {
    isExtensionEnabled = request.enabled;
  }
});

// Process clipboard after copy event
async function interceptClipboard() {
  if (!isExtensionEnabled || isProcessing) return;
  
  try {
    isProcessing = true;
    
    // Read clipboard content
    const clipboardText = await navigator.clipboard.readText();
    
    if (!clipboardText) return;
    
    // Send to background for processing
    chrome.runtime.sendMessage(
      { action: 'processCopiedText', text: clipboardText },
      async (response) => {
        if (response?.processed) {
          // Write randomized URL back to clipboard
          await navigator.clipboard.writeText(response.randomizedUrl);
          
          // Show notification
          showNotification('UTM parameters randomized!');
          
          console.log('UTM Randomizer: Replaced', response.originalUrl, 'with', response.randomizedUrl);
        }
      }
    );
  } catch (error) {
    // Clipboard access denied or other error
    console.debug('UTM Randomizer: Could not access clipboard:', error);
  } finally {
    isProcessing = false;
  }
}

// Show in-page notification
function showNotification(message: string) {
  // Remove any existing notification
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

// Monitor copy events within the webpage
document.addEventListener('copy', () => {
  // Small delay to ensure clipboard is updated
  setTimeout(interceptClipboard, 50);
});

// Also monitor keyboard shortcuts for copy
document.addEventListener('keydown', (event) => {
  // Ctrl+C or Cmd+C
  if ((event.ctrlKey || event.metaKey) && event.key === 'c' && !event.shiftKey && !event.altKey) {
    // Only process if text is selected
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      setTimeout(interceptClipboard, 50);
    }
  }
  
  // Ctrl+X or Cmd+X (cut)
  if ((event.ctrlKey || event.metaKey) && event.key === 'x' && !event.shiftKey && !event.altKey) {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      setTimeout(interceptClipboard, 50);
    }
  }
});

console.log('UTM Randomizer: Content script loaded and monitoring copy events');