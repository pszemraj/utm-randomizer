import { randomizeUTMParameters } from './utm-randomizer';

let isProcessing = false;

function isValidURL(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function hasUTMParameters(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    return utmKeys.some(key => params.has(key));
  } catch {
    return false;
  }
}

async function interceptClipboard() {
  if (isProcessing) return;
  
  try {
    isProcessing = true;
    
    // Read clipboard content
    const clipboardText = await navigator.clipboard.readText();
    
    if (isValidURL(clipboardText) && hasUTMParameters(clipboardText)) {
      console.log('UTM Randomizer: Found URL with UTM parameters:', clipboardText);
      
      const randomizedURL = randomizeUTMParameters(clipboardText);
      
      if (randomizedURL !== clipboardText) {
        // Write the randomized URL back to clipboard
        await navigator.clipboard.writeText(randomizedURL);
        console.log('UTM Randomizer: Replaced with:', randomizedURL);
        
        // Show a brief notification
        showNotification('UTM parameters randomized! 🎲');
      }
    }
  } catch (error) {
    console.error('UTM Randomizer: Error processing clipboard:', error);
  } finally {
    isProcessing = false;
  }
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

console.log('UTM Randomizer: Content script loaded');