# Privacy Policy

UTM Randomizer processes copied URLs inside your browser. It makes no network requests, uses no analytics or telemetry, and sets no cookies.

## What the extension reads

- **Clipboard text and available format information**, while cleaning is enabled and Chrome is focused, plus one final read on focus loss, using the [background watcher](docs/behavior.md#background-watching). Background reads can cause system clipboard-access prompts. Only text containing one whole URL is eligible for rewriting; [other contents stay unchanged](docs/behavior.md#clipboard-formats).
- **The current tab's address or selected link**, when you use an [explicit copy action](docs/behavior.md#usage). Page addresses and links are not changed. The extension does not inject scripts into web pages or read page content.

Clipboard contents and addresses are never written to extension storage, logged, or transmitted outside your browser.

## What the extension stores

Stored locally in Chrome's extension storage and never synced or transmitted:

- your settings (on/off, Decoy, Silly, Hybrid, or Remove, and whether toolbar feedback is on);
- a count of how many URLs were rewritten, in total and in the current browser session. Only the numbers are stored, not the URLs.

The [clipboard coordinator](docs/behavior.md#clipboard-coordination) keeps one current before-and-after record in memory to prevent repeated rewrites. Undo uses that record's original URL text. The record is replaced by observed clipboard changes or released when the offscreen document closes. No clipboard history is accumulated. Closing the popup does not clear the coordinator's current record.

## Permissions

| Permission       | Why it is needed                                                                   |
| ---------------- | ---------------------------------------------------------------------------------- |
| `clipboardRead`  | Reading copied URL text and checking clipboard changes                             |
| `clipboardWrite` | Writing the cleaned URL back as plain text                                         |
| `contextMenus`   | The "Copy link with ... tracking" menu entries                                     |
| `offscreen`      | The extension's clipboard reader and writer                                        |
| `activeTab`      | Reading the current tab's address when you use the shortcut, menu, or popup button |
| `storage`        | Saving settings and the rewrite counter                                            |

## Open source

The [source code](src/) is public and available for inspection.

## Contact

For privacy questions or concerns, [open an issue](https://github.com/pszemraj/utm-randomizer/issues).

_Last updated: October 4, 2026_
