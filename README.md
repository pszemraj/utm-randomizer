# UTM Randomizer Chrome Extension

A Chrome extension that automatically replaces UTM parameters with random/funny values when you copy links to your clipboard, helping thwart free advertising data collection.

## Features

- 🎲 Automatically detects UTM parameters in copied URLs
- 🤪 Replaces them with hilarious random values
- 🔔 Shows brief notifications when parameters are randomized
- 🚀 Works on all websites
- 🔒 Privacy-focused - no data collection

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the extension
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode"
6. Click "Load unpacked" and select this directory
7. The extension will now monitor your clipboard for UTM-tagged URLs

## How it works

When you copy a URL containing UTM parameters like:
```
https://example.com?utm_source=facebook&utm_medium=social&utm_campaign=spring_sale
```

It gets automatically replaced with something like:
```
https://example.com?utm_source=carrier-pigeon&utm_medium=interpretive-dance&utm_campaign=operation-click-bait
```

## Development

- `npm run dev` - Build in development mode with watch
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## Permissions

- `clipboardRead` - To read copied URLs
- `clipboardWrite` - To write randomized URLs back
- `activeTab` - To run on all websites