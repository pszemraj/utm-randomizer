// background.ts - Proper implementation with clipboard monitoring
import { randomizeUTMParameters } from './utm-randomizer';
import { isValidURL, hasUTMParameters } from './utils';

// Use chrome.clipboard API for monitoring (requires Chrome 116+)
// Fallback to content script injection for older versions

let isEnabled = true;
let processedUrls = new Set<string>();

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
    console.log('Checking URL:', text);
    
    // Dedup check - clear after 2 seconds to allow re-processing
    if (processedUrls.has(text)) {
      console.log('URL recently processed, skipping for now');
      sendResponse({ processed: false });
      return;
    }
    
    const isValid = isValidURL(text);
    const hasUTM = hasUTMParameters(text);
    console.log('Valid URL:', isValid, 'Has UTM:', hasUTM);
    
    if (isValid && hasUTM) {
      const randomized = randomizeUTMParameters(text);
      console.log('Randomized:', randomized);
      processedUrls.add(text);
      
      // Add to processed set with auto-cleanup after 2 seconds
      setTimeout(() => processedUrls.delete(text), 2000);
      
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
    // Broadcast state change to all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'stateChanged', enabled: isEnabled }).catch(() => {});
        }
      });
    });
  } else if (request.action === 'getState') {
    sendResponse({ enabled: isEnabled });
  } else if (request.action === 'showNotification') {
    showNotification(request.message || 'UTM parameters randomized! 🎲');
    sendResponse({ success: true });
  } else if (request.action === 'userActivity' && isEnabled) {
    // User interacted with page - check clipboard
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]?.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: checkClipboardInPage
          });
        } catch {
          // Ignore errors
        }
      }
    });
    sendResponse({ success: true });
  }
  
  return true; // Keep channel open for async response
});

// Monitor tab focus changes to check clipboard
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!isEnabled) return;
  
  try {
    // Immediately check clipboard on tab switch
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

// Also check clipboard when window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || !isEnabled) return;
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: checkClipboardInPage
      });
    } catch (error) {
      console.debug('Cannot inject on window focus:', error);
    }
  }
});

// Check clipboard on tab updates (page navigation)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isEnabled) {
    console.log('Tab updated, checking clipboard...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: checkClipboardInPage
      });
    } catch (error) {
      console.debug('Cannot inject on tab update:', error);
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
              // Show notification using Chrome notifications API via message
              chrome.runtime.sendMessage({ 
                action: 'showNotification',
                message: 'UTM parameters randomized! 🎲'
              });
            });
        }
      });
    })
    .catch(() => {}); // Silently fail - this is called frequently
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