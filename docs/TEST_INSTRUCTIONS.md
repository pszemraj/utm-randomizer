# Testing Address Bar Copy Issue

## Setup
1. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select this directory

2. Open the background script console:
   - On the extensions page, click "Service Worker" link under the extension
   - This opens DevTools for the background script

## Test 1: Address Bar Copy (CRITICAL TEST)

1. Open any tab with this URL:
   ```
   https://www.reddit.com/r/Anthropic/?utm_source=test&utm_medium=address_bar&utm_campaign=test
   ```

2. Click in the address bar and press Ctrl+A, then Ctrl+C to copy

3. Switch to another tab (this should trigger clipboard check)

4. Paste somewhere to verify if UTM parameters were randomized

5. Check background console for logs:
   - Should see: "Tab activated, checking clipboard..."
   - Should see: "Checking URL: [your URL]"
   - Should see: "Valid URL: true Has UTM: true"

## Test 2: Using Test Page

1. Open `test-address-bar.html` in Chrome

2. Follow the on-screen instructions:
   - Click "Copy to Clipboard" (simulates address bar copy)
   - Click "Trigger Tab Focus" 
   - Click "Check Clipboard"

3. Monitor both:
   - The test page log (black console on page)
   - The background script console (DevTools)

## Test 3: Manual Trigger

1. Copy a URL with UTM parameters from address bar

2. Press Ctrl+Shift+U (or Cmd+Shift+U on Mac)

3. Check if URL was randomized

## Expected Behavior

When copying from address bar:
- Background script should log: "Tab activated, checking clipboard..."
- Background script should log: "Checking URL: [url]"
- Background script should log: "Valid URL: true Has UTM: true"
- Background script should log: "Randomized: [new url]"
- Clipboard should be updated with randomized URL
- Notification should appear

## Current Issues to Debug

1. **Tab activation not firing**: Check if `chrome.tabs.onActivated` is being called
2. **Clipboard permission denied**: Check if clipboard read is failing
3. **URL not detected as having UTM**: Check if `utm_name` and other non-standard params are detected
4. **ProcessedUrls blocking**: Check if URL is being blocked by dedup logic

## Debugging Commands

In background console, run:
```javascript
// Check if extension is enabled
chrome.storage.local.get(['enabled'], (data) => console.log('Enabled:', data));

// Manually check clipboard
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: () => navigator.clipboard.readText().then(console.log)
  });
});

// Clear processed URLs
processedUrls.clear();
```