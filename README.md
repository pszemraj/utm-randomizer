# UTM Randomizer Chrome Extension

A Chrome extension that automatically replaces common tracking parameters (UTM, fbclid, gclid, etc.) with random/funny values when you copy links to your clipboard, helping thwart free advertising data collection.

## Features

- 🎯 Detects UTM parameters **and** popular analytics IDs like `fbclid`, `gclid`, `msclkid`, `mkt_tok`, HubSpot/Marketo tags, and more
- 🎲 Replaces marketing payloads with rebellious nonsense (IDs become chaos phrases, sources get jokes)
- 📋 Hooks into modern copy buttons (`navigator.clipboard.write*`) and traditional copy events alike
- 🔔 Shows brief notifications when parameters are randomized
- 🚀 Works on all websites where clipboard access is permitted
- 🔒 Privacy-focused - no data collection

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the extension
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode"
6. Click "Load unpacked" and select this directory (the `manifest.json` expects icons at `assets/icons/`)
7. The extension will now monitor your clipboard for tracking-heavy URLs

## How it works

When you copy a URL containing tracking parameters like:

```
https://example.com?utm_source=facebook&utm_medium=social&utm_campaign=spring_sale&fbclid=IwAR0rkF
```

It gets automatically replaced with something like:

```
https://example.com?utm_source=carrier-pigeon&utm_medium=interpretive-dance&utm_campaign=operation-click-bait&fbclid=CATNIP-REBELLION
```

### What gets randomized?

The extension keeps an evolving catalogue of common marketing parameters, including:

- `utm_*`, `ga_*`, `hsa_*`, `mkt_tok`
- `fbclid`, `gclid`, `gbraid`, `wbraid`, `msclkid`, `yclid`, `ttclid`, `twclid`
- HubSpot (`_hsenc`, `_hsmi`), Marketo (`mkt_tok`), Mailchimp (`mc_eid`, `mc_cid`), Adobe MC IDs, Omeda (`oly_anon_id`, `oly_enc_id`), and similar
- Generic tracking hints like `campaign`, `source`, `adgroup`, `creative`, `placement`, and friends

Identifiers turn into chaotic nonsense phrases so attribution data becomes useless while links keep working.

## Development

- `npm run dev` - Build in development mode with watch
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking
- `npm run test` - Run deterministic unit tests for the randomizer logic

## Permissions

- `clipboardRead` - To read copied URLs
- `clipboardWrite` - To write randomized URLs back
- `activeTab` - To run on all websites
