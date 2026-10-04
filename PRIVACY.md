# Privacy Policy

UTM Randomizer processes copied text and page addresses inside your browser. It makes no network requests, uses no analytics or telemetry, and sets no cookies.

## What the extension reads

- **Copied text and HTML on web pages**, from copy events and clipboard reads around relevant interactions. On older Chrome, a gesture can trigger a clipboard read before a copy occurs. See the [copy detection limits](docs/behavior.md#page-copies).
- **Clipboard text, HTML, and format information in the background**, while [whole-clipboard watching](docs/behavior.md#background-watching) is enabled. Background reads can cause system clipboard-access prompts.
- **The page address**, for resolving relative links copied from a page, and the current tab's address when you use an [explicit copy action](docs/behavior.md#usage). Page addresses are not changed.

Clipboard contents and addresses are never written to extension storage, logged, or transmitted outside your browser.

## What the extension stores

Stored locally in Chrome's extension storage and never synced or transmitted:

- your settings (on/off, Decoy, Silly, Hybrid, or Remove, and which cleaning layers and notifications are on);
- a count of how many links were rewritten, in total and in the current browser session. Only the numbers are stored, not the links;
- a random per-install key used to generate [replacement values](docs/behavior.md#replacement-values).

The [clipboard coordinator](docs/behavior.md#clipboard-coordination) keeps one current before-and-after record in memory for detecting replacement and preventing repeated rewrites. Notifications retain text for Undo, and page copies use temporary format snapshots. These records are replaced by observed clipboard changes or released when their page or offscreen document closes. No clipboard history is accumulated. Closing a notification alone does not clear the coordinator's current record.

## Permissions

| Permission                      | Why it is needed                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Content script on http(s) pages | Copy detection on supported pages                                                  |
| `clipboardRead`                 | Reading a link a page just copied, and the background watcher's clipboard checks   |
| `clipboardWrite`                | Writing the cleaned link back to the clipboard                                     |
| `contextMenus`                  | The "Copy link with ... tracking" menu entries                                     |
| `offscreen`                     | The background clipboard watcher, and clipboard writes from the service worker     |
| `activeTab`                     | Reading the current tab's address when you use the shortcut, menu, or popup button |
| `storage`                       | Saving settings, the rewrite counter, and the key for decoys                       |

## Open source

The [source code](src/) is public and available for inspection.

## Contact

For privacy questions or concerns, [open an issue](https://github.com/pszemraj/utm-randomizer/issues).

_Last updated: October 4, 2026_
