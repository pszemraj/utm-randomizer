// background.ts - Proper implementation with clipboard monitoring
import { randomizeUTMParameters } from './utm-randomizer';

// Use chrome.clipboard API for monitoring (requires Chrome 116+)
// Fallback to content script injection for older versions

let isEnabled = true;
let processedUrls = new Set<string>();

// Clear processed URLs periodically to prevent memory bloat
setInterval(() => {
  processedUrls.clear();
}, 60000); // Clear every minute

chrome.runtime.onInstalled.addListener(() => {
  console.log('UTM Randomizer extension installed');
  
  // Set up context menu for manual triggering
  chrome.contextMenus.create({
    id: 'randomize-utm',
    title: 'Randomize UTM Parameters',
    contexts: ['selection', 'link']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'randomize-utm') {
    const text = info.linkUrl || info.selectionText;
    if (text && hasUTMParameters(text)) {
      const randomized = randomizeUTMParameters(text);
      // Copy to clipboard
      copyToClipboard(randomized, tab?.id);
    }
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkAndRandomize') {
    const { text } = request;
    
    // Dedup check
    if (processedUrls.has(text)) {
      sendResponse({ processed: false });
      return;
    }
    
    if (isValidURL(text) && hasUTMParameters(text)) {
      const randomized = randomizeUTMParameters(text);
      processedUrls.add(text);
      
      // Add to processed set with auto-cleanup
      setTimeout(() => processedUrls.delete(text), 5000);
      
      sendResponse({ 
        processed: true, 
        originalUrl: text,
        randomizedUrl: randomized 
      });
    } else {
      sendResponse({ processed: false });
    }
  } else if (request.action === 'toggleExtension') {
    isEnabled = !isEnabled;
    sendResponse({ enabled: isEnabled });
  }
  
  return true; // Keep channel open for async response
});

// Monitor tab focus changes to check clipboard
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!isEnabled) return;
  
  try {
    // Inject content script to check clipboard
    await chrome.scripting.executeScript({
      target: { tabId: activeInfo.tabId },
      func: checkClipboardInPage
    });
  } catch (error) {
    // Tab might not be ready or is a chrome:// page
    console.debug('Cannot inject script:', error);
  }
});

// Handle keyboard shortcut command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'randomize-clipboard' && isEnabled) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: checkClipboardInPage
        });
      } catch (error) {
        console.debug('Cannot inject script:', error);
      }
    }
  }
});

// Function to inject for clipboard checking
function checkClipboardInPage() {
  navigator.clipboard.readText()
    .then(text => {
      chrome.runtime.sendMessage({ 
        action: 'checkAndRandomize', 
        text: text 
      }, response => {
        if (response?.processed) {
          navigator.clipboard.writeText(response.randomizedUrl)
            .then(() => {
              // Show notification
              showNotification('UTM parameters randomized! 🎲');
            });
        }
      });
    })
    .catch(err => console.debug('Clipboard read failed:', err));
}

function copyToClipboard(text: string, tabId?: number) {
  if (tabId) {
    chrome.scripting.executeScript({
      target: { tabId },
      func: (textToCopy: string) => {
        navigator.clipboard.writeText(textToCopy);
      },
      args: [text]
    });
  }
}

function showNotification(message: string) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon48.png',
    title: 'UTM Randomizer',
    message: message,
    priority: 1
  });
}

function isValidURL(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
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