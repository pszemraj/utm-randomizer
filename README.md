# UTM Randomizer

A Chrome extension that replaces tracking parameters in copied URLs with believable decoys, nonsense, or nothing. Page addresses stay unchanged. [Everything stays in your browser](PRIVACY.md).

![A copied link keeps its destination and id=42: Decoy uses plausible tracking values, Silly uses nonsense, Hybrid mixes both, and Remove deletes tracking.](assets/modes.svg)

Only known UTM fields and ad click IDs are rewritten. Ambiguous and site-specific fields stay untouched. See [supported parameters and limits](docs/behavior.md#what-gets-rewritten) and [mode details](docs/behavior.md#replacement-values).

## Install

Requires Chrome 123 or newer.

1. Open the [latest release](https://github.com/pszemraj/utm-randomizer/releases/latest) and download the `utm-randomizer-<version>.zip` extension under **Assets**.
2. Unzip it into a permanent folder, such as `Documents/ChromeExtensions/utm-randomizer/`. Keep that folder in place; Chrome loads the extension's files from it.
3. Open `chrome://extensions` and turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.

If the release only offers **Source code** archives, use the [source build](#build-from-source) below.

## Usage

- Copy one URL while Chrome is focused: Ctrl+C / Cmd+C, a site's copy button, or **Copy link address**. Documents and other text stay unchanged.
- Open the toolbar popup to choose **Decoy**, **Silly**, **Hybrid**, or **Remove**, pause cleaning, or change toolbar feedback.
- Cleaning, Decoy mode, and toolbar feedback are enabled by default. Rewritten URLs are plain text; use **Undo last rewrite** in the popup to restore the current entry.
- To copy the current page explicitly, use **Alt+Shift+U** or **Copy this page's link** in the popup.

Try it: right-click [this test link](https://example.com/article?id=42&utm_source=newsletter&utm_medium=email), select **Copy link address**, and paste into a text field. The tracking values should change while `id=42` stays intact.

## Build from source

Use Node 22.13 or later in the 22.x series, or Node 24 or later ([`.nvmrc`](.nvmrc) pins 24):

```bash
git clone https://github.com/pszemraj/utm-randomizer.git
cd utm-randomizer
npm ci
npm run build
```

Follow the Chrome steps above, selecting `dist/` instead of an extracted release folder. Verify it with the test link under [Usage](#usage). After rebuilding, reload the extension in `chrome://extensions`.

## Development

Run `npm run dev` to rebuild on edits and `npm run check` for lint, formatting, types, and unit tests. See [development commands and browser tests](docs/development.md), [behavior and clipboard details](docs/behavior.md), and [contributing](CONTRIBUTING.md).

## License

MIT
