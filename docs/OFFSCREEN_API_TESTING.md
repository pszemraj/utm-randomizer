# Testing the Offscreen API Implementation

## Installation

1. Build the extension:
```bash
npm run build
```

2. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select this directory

## Test Scenarios

### Test 1: Address Bar Copy (Primary Use Case)

1. Navigate to any website
2. Add UTM parameters to the URL:
   ```
   https://example.com?utm_source=test&utm_medium=address_bar
   ```
3. Select the URL in address bar (Ctrl+L)
4. Copy it (Ctrl+C)
5. **Within 500ms, the URL will be automatically randomized**
6. Paste anywhere to verify the UTM parameters changed

### Test 2: Reddit URL with utm_name

1. Visit:
   ```
   https://reddit.com/r/test/?utm_source=app&utm_medium=android&utm_name=androidcss
   ```
2. Copy from address bar
3. Verify that utm_name is also randomized

### Test 3: Background Console Monitoring

1. Open extension service worker console:
   - In `chrome://extensions/`
   - Click "Service Worker" link under UTM Randomizer
2. Watch console logs while copying URLs
3. Should see:
   - "Detected URL with UTM parameters: [url]"
   - "Successfully randomized to: [new url]"

### Test 4: Offscreen Document Verification

1. In service worker console, run:
```javascript
chrome.runtime.getContexts({
  contextTypes: ['OFFSCREEN_DOCUMENT']
}).then(console.log);
```
2. Should show the offscreen document is active

### Test 5: Performance Check

1. Copy multiple URLs rapidly
2. Each should be randomized without lag
3. Check that duplicate URLs are skipped (3-second cooldown)

## Expected Behavior

- Clipboard polling runs every 500ms
- URLs with UTM parameters are automatically randomized
- Notification appears when randomization occurs
- Stats are updated in storage
- No user interaction required after copying

## Debugging

If not working:

1. Check Chrome version (needs 109+):
```javascript
navigator.userAgent
```

2. Check permissions in manifest:
   - Should include "offscreen"
   - Should include "clipboardRead" and "clipboardWrite"

3. Check offscreen document status:
```javascript
chrome.offscreen.hasDocument().then(console.log);
```

4. Force clipboard check:
```javascript
chrome.runtime.sendMessage({ type: 'read-clipboard' });
```