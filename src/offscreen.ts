// offscreen.ts - Secure offscreen document for clipboard operations
// Only performs operations when explicitly requested, no continuous polling

// Read clipboard once when requested
async function readClipboard(): Promise<string> {
  try {
    // Try modern API first
    return await navigator.clipboard.readText();
  } catch {
    // Fallback to execCommand
    const textarea = document.getElementById('clipboard-fallback') as HTMLTextAreaElement;
    if (!textarea) return '';
    
    textarea.value = '';
    textarea.focus();
    textarea.select();
    
    try {
      if (document.execCommand('paste')) {
        return textarea.value;
      }
    } catch {
      // Clipboard access denied
    }
    return '';
  }
}

// Write to clipboard
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback to execCommand
    const textarea = document.getElementById('clipboard-fallback') as HTMLTextAreaElement;
    if (!textarea) return false;
    
    textarea.value = text;
    textarea.select();
    return document.execCommand('copy');
  }
}

// Handle messages from service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'read-clipboard-once') {
    // Read clipboard once and return
    readClipboard().then(text => {
      sendResponse({ text });
    });
    return true;
  }
  
  if (request.type === 'write-clipboard') {
    writeClipboard(request.text).then(success => {
      sendResponse({ success });
    });
    return true;
  }
});

console.log('Offscreen document ready for clipboard operations');