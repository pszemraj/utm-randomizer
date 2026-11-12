# Privacy Policy

UTM Randomizer processes copied URLs inside your browser. It makes no network requests, uses no analytics or telemetry, and sets no cookies.

## What the extension reads

While cleaning is enabled, the [background watcher](docs/behavior.md#background-watching) reads plain clipboard text while Chrome is focused, plus one final check on focus loss. Unrelated text is discarded without reading accompanying HTML or images. HTML and other detectable formats are inspected only for [eligible link text](docs/behavior.md#what-gets-rewritten), pre-write checks, and verification. Background reads can cause system clipboard-access prompts.

Clipboard contents are never written to extension storage, logged, or transmitted outside your browser. The extension does not read tab addresses, inject scripts into web pages, or read page content.

Copied text and HTML may contain personal, health, financial, authentication, communication, location, or website information. The extension does not request or analyze these categories separately.

UTM Randomizer's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only for the link-cleaning feature and is never sold, shared with third parties, or used for advertising, creditworthiness, or lending.

## What the extension stores

Chrome's local extension storage holds only your on/off and replacement-mode settings. They are never synced or transmitted.

The [clipboard coordinator](docs/behavior.md#clipboard-coordination) retains only the current eligible link entry's text, HTML when inspected, and format names in memory. After a successful rewrite, it also retains the output snapshot to prevent repeated rewrites. Closing the offscreen document releases it. No clipboard history is accumulated.

## Permissions

| Permission       | Why it is needed                                       |
| ---------------- | ------------------------------------------------------ |
| `clipboardRead`  | Reading copied URL text and checking clipboard changes |
| `clipboardWrite` | Writing the cleaned URL back as plain text             |
| `offscreen`      | The extension's clipboard reader and writer            |
| `storage`        | Saving on/off and replacement-mode settings            |

## Open source

The [source code](src/) is public and available for inspection.

## Contact

For privacy questions or concerns, [open an issue](https://github.com/pszemraj/utm-randomizer/issues).

_Last updated: November 12, 2026_
