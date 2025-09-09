// popup.ts
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle');
  const countToday = document.getElementById('count-today');
  const countTotal = document.getElementById('count-total');
  const manualCheck = document.getElementById('manual-check');
  const shortcutKey = document.getElementById('shortcut');
  
  // Set correct shortcut for Mac
  if (navigator.platform.includes('Mac')) {
    if (shortcutKey) {
      shortcutKey.textContent = 'Cmd+Shift+U';
    }
  }
  
  // Load stats from storage
  chrome.storage.local.get(['enabled', 'countToday', 'countTotal'], (data) => {
    if (toggle) {
      toggle.classList.toggle('active', data.enabled !== false);
    }
    if (countToday) {
      countToday.textContent = String(data.countToday || 0);
    }
    if (countTotal) {
      countTotal.textContent = String(data.countTotal || 0);
    }
  });
  
  // Toggle handler
  toggle?.addEventListener('click', () => {
    const isActive = toggle.classList.contains('active');
    toggle.classList.toggle('active');
    
    chrome.runtime.sendMessage({ action: 'toggleExtension' });
    chrome.storage.local.set({ enabled: !isActive });
  });
  
  // Manual check button
  manualCheck?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          navigator.clipboard.readText().then(text => {
            chrome.runtime.sendMessage({ action: 'checkAndRandomize', text });
          });
        }
      });
    }
    
    window.close();
  });
});