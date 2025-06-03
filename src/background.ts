chrome.runtime.onInstalled.addListener(() => {
  console.log('UTM Randomizer extension installed');
});

// Listen for tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('UTM Randomizer: Tab updated, monitoring clipboard on', tab.url);
  }
});