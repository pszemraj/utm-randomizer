// background.ts - Service worker with Offscreen API for reliable clipboard monitoring

import { randomizeUTMParameters } from './utm-randomizer';
import { isValidURL, hasUTMParameters } from './utils';

let offscreenCreating: Promise<void> | null = null;
let isEnabled = true;
let processedUrls = new Set<string>();
let stats = {
  countTotal: 0,
  lastRandomized: 0
};

// Load stats from storage
chrome.storage.local.get(['countTotal', 'lastRandomized'], (data) => {
  if (data.countTotal) stats.countTotal = data.countTotal;
  if (data.lastRandomized) stats.lastRandomized = data.lastRandomized;
});

// Ensure offscreen document exists
async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  
  // Check if already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [offscreenUrl]
  });
  
  if (existingContexts.length > 0) {
    return;
  }
  
  // Create if doesn't exist
  if (offscreenCreating) {
    await offscreenCreating;
  } else {
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD' as chrome.offscreen.Reason],
      justification: 'Monitor clipboard for URLs with UTM parameters to randomize them'
    });
    
    await offscreenCreating;
    offscreenCreating = null;
  }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('UTM Randomizer 2.0 initialized with Offscreen API');
  
  // Create context menu
  chrome.contextMenus.create({
    id: 'randomize-utm',
    title: 'Randomize UTM Parameters',
    contexts: ['selection', 'link']
  });
  
  // Ensure offscreen document
  await ensureOffscreenDocument();
});

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'clipboard-content') {
    handleClipboardContent(message.text);
    sendResponse({ received: true });
  } else if (message.action === 'toggleExtension') {
    isEnabled = !isEnabled;
    sendResponse({ enabled: isEnabled });
    // Notify all tabs about state change
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'stateChanged', enabled: isEnabled }).catch(() => {});
        }
      });
    });
  } else if (message.action === 'getState') {
    sendResponse({ 
      enabled: isEnabled,
      stats: stats
    });
  }
  
  return true; // Keep channel open
});

// Process clipboard content
async function handleClipboardContent(text: string) {
  if (!isEnabled || !text) return;
  
  // Skip if recently processed
  if (processedUrls.has(text)) {
    console.log('URL recently processed, skipping');
    return;
  }
  
  // Check if valid URL with tracking params
  if (!isValidURL(text) || !hasUTMParameters(text)) {
    return;
  }
  
  console.log('Detected URL with UTM parameters:', text);
  
  // Randomize the URL
  const randomized = randomizeUTMParameters(text);
  
  if (randomized === text) {
    console.log('No changes made to URL');
    return;
  }
  
  // Mark as processed
  processedUrls.add(text);
  processedUrls.add(randomized);
  
  // Clear after 3 seconds
  setTimeout(() => {
    processedUrls.delete(text);
    processedUrls.delete(randomized);
  }, 3000);
  
  // Write back to clipboard via offscreen document
  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      type: 'write-clipboard',
      text: randomized
    });
    
    // Update stats
    stats.countTotal++;
    stats.lastRandomized = Date.now();
    chrome.storage.local.set({
      countTotal: stats.countTotal,
      lastRandomized: stats.lastRandomized
    });
    
    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'UTM Randomizer',
      message: 'UTM parameters randomized!',
      priority: 1
    });
    
    console.log('Successfully randomized to:', randomized);
  } catch (error) {
    console.error('Failed to write clipboard:', error);
  }
}

// Also check clipboard on tab/window focus changes
chrome.tabs.onActivated.addListener(async () => {
  if (!isEnabled) return;
  
  // Ensure offscreen document and trigger immediate check
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: 'read-clipboard' }).catch(() => {});
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || !isEnabled) return;
  
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: 'read-clipboard' }).catch(() => {});
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'randomize-utm') {
    const text = info.linkUrl || info.selectionText;
    if (text && hasUTMParameters(text)) {
      const randomized = randomizeUTMParameters(text);
      
      // Write to clipboard via offscreen
      await ensureOffscreenDocument();
      await chrome.runtime.sendMessage({
        type: 'write-clipboard',
        text: randomized
      });
      
      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'UTM Randomizer',
        message: 'UTM parameters randomized!',
        priority: 1
      });
    }
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'randomize-clipboard' && isEnabled) {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ type: 'read-clipboard' }).catch(() => {});
  }
});

// Handle extension icon click (for popup or manual trigger)
chrome.action.onClicked.addListener(async () => {
  // If we have a popup, this won't fire. Otherwise, manual clipboard check
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: 'read-clipboard' }).catch(() => {});
});

console.log('UTM Randomizer background service initialized');