# Privacy Policy

UTM Randomizer processes copied URLs inside your browser. It makes no network requests, uses no analytics or telemetry, and sets no cookies.

## What the extension reads

- **Clipboard text, HTML when present, and available format information**, while cleaning is enabled and Chrome is focused, plus one final read on focus loss, using the [background watcher](docs/behavior.md#background-watching). Background reads can cause system clipboard-access prompts. Whole URLs and [bounded compact share text](docs/behavior.md#what-gets-rewritten) are eligible for rewriting; [other contents stay unchanged](docs/behavior.md#clipboard-formats).

Clipboard contents are never written to extension storage, logged, or transmitted outside your browser. The extension does not read tab addresses, inject scripts into web pages, or read page content.

## What the extension stores

Chrome's local extension storage holds only your on/off and replacement-mode settings. They are never synced or transmitted.

The [clipboard coordinator](docs/behavior.md#clipboard-coordination) retains the current entry's full text, HTML when present, and format names in memory as a serialized snapshot, even when that entry contains no URL. After a successful rewrite, it also retains the output snapshot to prevent repeated rewrites. Observed clipboard changes replace this record; closing the offscreen document releases it. No clipboard history is accumulated.

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

_Last updated: October 5, 2026_
