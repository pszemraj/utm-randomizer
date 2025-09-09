// background.ts - Secure implementation with offscreen document for address bar copies

import { randomizeUTMParameters } from './utm-randomizer';
import { isValidURL, hasUTMParameters } from './utils';

let offscreenCreating: Promise<void> | null = null;
let isEnabled = true;
let processedUrls = new Set<string>();
let lastCheckedText = '';
let stats = {
  countTotal: 0,
  lastRandomized: 0
};

// Track if Chrome is focused
let isChromeActive = true;

// Load saved state
chrome.storage.local.get(['countTotal', 'lastRandomized', 'enabled'], (data) => {
  if (data.countTotal) stats.countTotal = data.countTotal;
  if (data.lastRandomized) stats.lastRandomized = data.lastRandomized;
  if (typeof data.enabled === 'boolean') isEnabled = data.enabled;
});

// Create offscreen document for clipboard access
async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [offscreenUrl]
  });
  
  if (existingContexts.length > 0) return;
  
  if (offscreenCreating) {
    await offscreenCreating;
  } else {
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD' as chrome.offscreen.Reason],
      justification: 'Check clipboard for URLs with UTM parameters when user interacts with Chrome'
    });
    
    await offscreenCreating;
    offscreenCreating = null;
  }
}

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
  console.log('UTM Randomizer initialized');
  
  // Create context menu
  chrome.contextMenus.create({
    id: 'randomize-utm',
    title: 'Randomize UTM Parameters',
    contexts: ['selection', 'link']
  });
  
  // Create offscreen document
  await ensureOffscreenDocument();
});

// Track Chrome window focus
chrome.windows.onFocusChanged.addListener((windowId) => {
  isChromeActive = windowId !== chrome.windows.WINDOW_ID_NONE;
  
  // When Chrome gains focus, check clipboard once
  if (isChromeActive && isEnabled) {
    setTimeout(() => checkClipboardForAddressBarCopy(), 100);
  }
});

// Check clipboard when user switches tabs (likely copied from address bar)
chrome.tabs.onActivated.addListener(async () => {
  if (!isEnabled || !isChromeActive) return;
  
  // Small delay to let clipboard update
  setTimeout(() => checkClipboardForAddressBarCopy(), 100);
});

// Check clipboard for address bar copies
async function checkClipboardForAddressBarCopy() {
  if (!isEnabled || !isChromeActive) return;
  
  try {
    await ensureOffscreenDocument();
    
    // Read clipboard once
    const response = await chrome.runtime.sendMessage({ type: 'read-clipboard-once' });
    const text = response?.text;
    
    if (!text || text === lastCheckedText) return;
    lastCheckedText = text;
    
    // Check if it's a URL with UTM params
    if (!isValidURL(text) || !hasUTMParameters(text)) return;
    
    // Skip if recently processed
    if (processedUrls.has(text)) return;
    
    console.log('Detected URL with UTM from address bar:', text);
    
    const randomized = randomizeUTMParameters(text);
    if (randomized === text) return;
    
    // Mark as processed
    processedUrls.add(text);
    processedUrls.add(randomized);
    setTimeout(() => {
      processedUrls.delete(text);
      processedUrls.delete(randomized);
    }, 3000);
    
    // Write back to clipboard
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
    
    // Show in-page notification in active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: showInPageNotification,
          args: ['UTM parameters randomized from address bar!']
        });
      } catch (error) {
        // Can't inject into this tab (chrome://, extensions page, etc.)
        // Show badge notification as fallback
        console.log('Cannot show in-page notification, using badge');
        await showBadgeNotification();
      }
    }
    
    console.log('Address bar URL randomized:', randomized);
  } catch (error) {
    console.debug('Could not check clipboard:', error);
  }
}

// Show in-page notification
function showInPageNotification(message: string) {
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
  `;
  
  document.body.appendChild(notification);
  
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateY(0)';
  });
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(-10px)';
    setTimeout(() => notification.remove(), 300);
  }, 2500);
}

// Show badge notification as fallback
async function showBadgeNotification() {
  // Show a badge on the extension icon
  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  
  // Clear badge after 2 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 2000);
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processCopiedText') {
    // Content script detected a copy event within a webpage
    if (!sender.tab || !sender.tab.id || !isChromeActive) {
      sendResponse({ processed: false });
      return true;
    }
    
    const { text } = message;
    
    if (!isEnabled || !isValidURL(text) || !hasUTMParameters(text)) {
      sendResponse({ processed: false });
      return true;
    }
    
    if (processedUrls.has(text)) {
      sendResponse({ processed: false });
      return true;
    }
    
    console.log('Processing copy from webpage:', sender.tab.url);
    
    const randomized = randomizeUTMParameters(text);
    if (randomized === text) {
      sendResponse({ processed: false });
      return true;
    }
    
    // Mark as processed
    processedUrls.add(text);
    processedUrls.add(randomized);
    setTimeout(() => {
      processedUrls.delete(text);
      processedUrls.delete(randomized);
    }, 3000);
    
    // Update stats
    stats.countTotal++;
    stats.lastRandomized = Date.now();
    chrome.storage.local.set({
      countTotal: stats.countTotal,
      lastRandomized: stats.lastRandomized
    });
    
    sendResponse({ 
      processed: true, 
      originalUrl: text,
      randomizedUrl: randomized 
    });
    
  } else if (message.action === 'toggleExtension') {
    isEnabled = !isEnabled;
    chrome.storage.local.set({ enabled: isEnabled });
    sendResponse({ enabled: isEnabled });
    
    // Notify all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { 
            action: 'stateChanged', 
            enabled: isEnabled 
          }).catch(() => {});
        }
      });
    });
    
  } else if (message.action === 'getState') {
    sendResponse({ 
      enabled: isEnabled,
      stats: stats
    });
  } else if (message.action === 'manualCheck') {
    // Manual trigger from popup
    checkClipboardForAddressBarCopy();
    sendResponse({ triggered: true });
  }
  
  return true;
});

// Handle context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'randomize-utm' && tab?.id) {
    const text = info.linkUrl || info.selectionText;
    if (text && hasUTMParameters(text)) {
      const randomized = randomizeUTMParameters(text);
      
      // Write to clipboard via offscreen document
      await ensureOffscreenDocument();
      await chrome.runtime.sendMessage({
        type: 'write-clipboard',
        text: randomized
      });
      
      // Show in-page notification
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showInPageNotification,
          args: ['UTM parameters randomized!']
        });
      } catch (error) {
        console.log('Cannot show notification in this tab, using badge');
        await showBadgeNotification();
      }
      
      // Update stats
      stats.countTotal++;
      stats.lastRandomized = Date.now();
      chrome.storage.local.set({
        countTotal: stats.countTotal,
        lastRandomized: stats.lastRandomized
      });
    }
  }
});

// Handle keyboard shortcut (Ctrl+Shift+U)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'randomize-clipboard' && isEnabled && isChromeActive) {
    // Manual trigger - check clipboard now
    await checkClipboardForAddressBarCopy();
  }
});

console.log('UTM Randomizer background service initialized');