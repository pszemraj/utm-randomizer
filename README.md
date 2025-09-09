# UTM Randomizer Chrome Extension

A privacy-focused Chrome extension that automatically replaces UTM tracking parameters with randomized values when copying URLs, preventing marketing attribution and protecting user privacy.

## Overview

UTM Randomizer intercepts clipboard operations to detect and randomize tracking parameters in URLs. It works seamlessly across all websites, including when copying from the browser address bar, providing comprehensive protection against marketing tracking.

## Key Features

### Core Functionality
- **Automatic Detection**: Identifies UTM parameters and other tracking codes in copied URLs
- **Smart Randomization**: Replaces tracking parameters with humorous but functional alternatives
- **Universal Coverage**: Works on all websites and browser address bar copies
- **Multiple Trigger Methods**:
  - Automatic on copy (Ctrl/Cmd+C)
  - Tab focus monitoring for address bar copies
  - Right-click context menu
  - Keyboard shortcut (Ctrl/Cmd+Shift+U)
  - Manual trigger via popup

### Supported Tracking Parameters
- **UTM Parameters**: utm_source, utm_medium, utm_campaign, utm_term, utm_content
- **Facebook**: fbclid, fb_source, fb_action_ids, fb_action_types
- **Google**: gclid, wbraid, gbraid, _ga
- **Email Marketing**: mc_cid, mc_eid (Mailchimp), ml_subscriber (MailerLite)
- **Other Platforms**: yclid (Yandex), twclid (Twitter), msclkid (Microsoft), ef_id (Adobe)

### User Interface
- **Popup Dashboard**: Toggle switch, statistics, and manual clipboard check
- **Statistics Tracking**: Daily and total URLs randomized
- **Visual Notifications**: Non-intrusive success indicators
- **Context Menu**: Right-click option for manual randomization

## Installation

### From Source
1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/utm-randomizer.git
   cd utm-randomizer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the project directory

## Usage

### Automatic Mode
Simply copy any URL containing tracking parameters. The extension automatically:
1. Detects tracking parameters
2. Replaces them with randomized values
3. Updates your clipboard
4. Shows a brief confirmation

### Manual Controls
- **Popup**: Click the extension icon to access controls and statistics
- **Context Menu**: Right-click on selected text/links → "Randomize UTM Parameters"
- **Keyboard Shortcut**: Press Ctrl+Shift+U (Cmd+Shift+U on Mac)

### Example Transformation

**Before:**
```
https://example.com?utm_source=facebook&utm_medium=social&utm_campaign=spring_sale&fbclid=abc123
```

**After:**
```
https://example.com?utm_source=carrier-pigeon&utm_medium=interpretive-dance&utm_campaign=operation-click-bait&fbclid=nice-try-zuckerberg
```

## Development

### Prerequisites
- Node.js 16+ 
- npm or yarn
- Chrome browser

### Scripts
```bash
npm run dev          # Development build with watch mode
npm run build        # Production build
npm run test         # Run test suite
npm run lint         # Run ESLint
npm run type-check   # TypeScript type checking
```

### Project Structure
```
utm-randomizer/
├── src/
│   ├── background.ts   # Service worker for clipboard monitoring
│   ├── content.ts      # Content script for page interaction
│   ├── popup.ts        # Popup UI logic
│   └── utm-randomizer.ts # Core randomization logic
├── tests/
│   └── terminal-test-suite.ts # Comprehensive test suite
├── dist/               # Built extension files
├── manifest.json       # Extension manifest
└── popup.html          # Popup UI
```

### Testing
Run the comprehensive test suite:
```bash
npm test
```

Tests include:
- URL randomization logic
- Parameter detection
- Edge cases handling
- Performance benchmarks (2.5M+ URLs/second)

## Technical Details

### Architecture
- **Service Worker**: Background script using Chrome Offscreen API for secure clipboard access
- **Content Script**: Monitors copy events within webpages
- **Offscreen Document**: Dedicated context for clipboard operations
- **Security First**: Only operates when Chrome is active and user initiates action

### Performance
- **Debouncing**: Intelligent clipboard monitoring with user activity detection
- **Caching**: 3-second deduplication for repeated URLs
- **Processing Speed**: 3M+ URLs/second
- **Resource Efficient**: Minimal CPU and memory footprint

### Security & Privacy
- **No Data Collection**: All processing happens locally
- **No External Requests**: Completely offline operation
- **Minimal Permissions**: Only essential Chrome APIs used
- **Open Source**: Full transparency of code behavior

## Permissions

The extension requires these permissions:
- `offscreen`: Create secure context for clipboard operations
- `clipboardRead/Write`: Access clipboard for URL processing
- `contextMenus`: Add right-click menu option
- `notifications`: Display success indicators
- `scripting`: Inject notification display
- `storage`: Save statistics and preferences
- `tabs`: Monitor user activity in Chrome

## Browser Compatibility

- Chrome 109+ (required for Offscreen API)
- Edge 109+
- Chromium-based browsers with Manifest V3 support

## Troubleshooting

### Extension Not Working
1. Ensure all permissions are granted
2. Check if extension is enabled in chrome://extensions/
3. Reload the extension after updates

### Clipboard Access Denied
- Grant clipboard permissions when prompted
- Check site-specific permissions in Chrome settings

### Address Bar URLs Not Randomizing
- Ensure tab focus monitoring is working
- Try using the manual trigger (Ctrl+Shift+U)

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Run tests and linting
4. Submit a pull request

## License

MIT License - See LICENSE file for details

## Acknowledgments

Built to combat invasive marketing tracking and protect user privacy. Special thanks to the open-source community for inspiration and tools.

---

**Version**: 2.0.0  
**Last Updated**: September 2025