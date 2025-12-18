# UTM Randomizer

A Chrome extension that automatically replaces tracking parameters (UTM, fbclid, gclid, etc.) with random values when you copy links, disrupting analytics attribution while keeping links functional.

## Features

- Detects UTM parameters and analytics IDs (`fbclid`, `gclid`, `msclkid`, `mkt_tok`, HubSpot, Marketo, Mailchimp, Adobe, Omeda, and more)
- Replaces tracking values with humorous nonsense (IDs become word salad, sources become jokes)
- Works with both `Ctrl+C` copy events and "Copy Link" buttons
- Popup UI with enable/disable toggle and randomization stats
- Shows brief notification when parameters are randomized
- Privacy-focused: no data collection, all processing is local

## Installation

### From Source

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the extension
4. Open Chrome and navigate to `chrome://extensions/`
5. Enable "Developer mode" (toggle in top right)
6. Click "Load unpacked" and select this directory
7. The extension icon will appear in your toolbar

## Usage

Once installed, the extension runs automatically. Copy any URL containing tracking parameters and they will be replaced with random values.

**Before:**
```
https://example.com/page?utm_source=facebook&utm_medium=cpc&fbclid=IwAR3xyz123
```

**After:**
```
https://example.com/page?utm_source=carrier-pigeon&utm_medium=smoke-signals&fbclid=cookie-crumbler-mystery-tour-abc123
```

Click the extension icon to:
- Toggle the extension on/off
- View randomization statistics

### Supported Parameters

| Category | Examples |
|----------|----------|
| UTM | `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` |
| Click IDs | `fbclid`, `gclid`, `gbraid`, `wbraid`, `msclkid`, `yclid`, `ttclid`, `twclid` |
| Marketing Platforms | `mkt_tok`, `_hsenc`, `_hsmi`, `mc_eid`, `mc_cid`, `oly_anon_id` |
| Generic | `campaign`, `source`, `adgroup`, `creative`, `placement`, `ref` |

## Development

```bash
npm run dev          # Development build with watch mode
npm run build        # Production build
npm run lint         # Run ESLint
npm run type-check   # TypeScript type checking
npm run test         # Run unit tests
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `clipboardRead` | Read copied URLs to detect tracking parameters |
| `clipboardWrite` | Write randomized URLs back to clipboard |
| `storage` | Persist enable/disable state and statistics |

## License

MIT
