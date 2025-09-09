// offscreen.ts - Hidden document with DOM access for clipboard monitoring

let lastClipboard = '';
let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollRate = 500; // Check every 500ms (less aggressive than 250ms)

// Modern Clipboard API
async function readClipboardModern(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch (error) {
    console.debug('Modern clipboard API failed:', error);
    return null;
  }
}

// Legacy execCommand fallback
function readClipboardLegacy(): string | null {
  const textarea = document.getElementById('clipboard-fallback') as HTMLTextAreaElement;
  if (!textarea) return null;
  
  textarea.value = '';
  textarea.focus();
  textarea.select();
  
  try {
    if (document.execCommand('paste')) {
      return textarea.value;
    }
  } catch (error) {
    console.debug('Legacy clipboard method failed:', error);
  }
  return null;
}

// Try both methods
async function readClipboard(): Promise<string> {
  // Try modern API first
  let text = await readClipboardModern();
  
  // Fallback to legacy if needed
  if (text === null) {
    text = readClipboardLegacy();
  }
  
  return text || '';
}

// Write to clipboard
async function writeClipboard(text: string): Promise<boolean> {
  try {
    // Try modern API
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    // Fallback to legacy
    const textarea = document.getElementById('clipboard-fallback') as HTMLTextAreaElement;
    if (!textarea) return false;
    
    textarea.value = text;
    textarea.select();
    return document.execCommand('copy');
  }
}

// Start polling clipboard
function startPolling() {
  if (pollInterval) return;
  
  console.log('Starting clipboard polling at', pollRate, 'ms intervals');
  
  pollInterval = setInterval(async () => {
    const text = await readClipboard();
    
    if (text && text !== lastClipboard) {
      console.log('Clipboard changed, checking:', text.substring(0, 50) + '...');
      lastClipboard = text;
      
      // Send to service worker for processing
      chrome.runtime.sendMessage({
        type: 'clipboard-content',
        text: text
      });
    }
  }, pollRate);
}

// Stop polling
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('Stopped clipboard polling');
  }
}

// Handle messages from service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'read-clipboard') {
    readClipboard().then(text => {
      sendResponse({ text });
    });
    return true; // Keep channel open for async response
  }
  
  if (request.type === 'write-clipboard') {
    writeClipboard(request.text).then(success => {
      sendResponse({ success });
    });
    return true;
  }
  
  if (request.type === 'start-polling') {
    startPolling();
    sendResponse({ started: true });
  }
  
  if (request.type === 'stop-polling') {
    stopPolling();
    sendResponse({ stopped: true });
  }
  
  if (request.type === 'set-poll-rate') {
    pollRate = request.rate || 500;
    if (pollInterval) {
      stopPolling();
      startPolling();
    }
    sendResponse({ rate: pollRate });
  }
});

// Auto-start polling when document loads
startPolling();
console.log('Offscreen document initialized - clipboard monitoring active');