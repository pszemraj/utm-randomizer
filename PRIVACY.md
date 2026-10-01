# Privacy Policy

UTM Randomizer processes copied text and page addresses inside your browser. It makes no network requests, uses no analytics or telemetry, and sets no cookies.

## What the extension reads

- **Copied text and HTML on web pages**, from copy events and clipboard reads around relevant interactions. On older Chrome, a gesture can trigger a clipboard read before a copy occurs. The [copy detection paths](README.md#how-it-works) describe these limits.
- **Clipboard text and format information in the background**, while "Watch the whole clipboard" is on (see [default settings](README.md#usage)). The watcher skips rewriting clipboard content containing images or files. Switching the setting off, or pausing automatic cleaning, stops these checks and closes the offscreen page.
- **The page address**, while "Clean the address bar" is on, and the current tab's address when you use an [explicit copy action](README.md#usage).

Clipboard contents and addresses are never written to extension storage, logged, or transmitted outside your browser.

## What the extension stores

Stored locally in Chrome's extension storage and never synced or transmitted:

- your settings (on/off, Decoy, Silly, Hybrid, or Remove, and which cleaning layers and notifications are on);
- a count of how many links were rewritten, in total and in the current browser session. Only the numbers are stored, not the links;
- a random key created when the extension is installed. Decoy values are derived from it so the same link always gets the same decoys; it identifies nothing and never leaves your browser.

Notifications and clipboard watchers keep recent clipboard text and links in memory for Undo, detecting changes, and preventing repeated rewrites. Later rewrites and observed changes can replace these values; closing their page or offscreen document releases them. Closing a notification alone does not clear all watcher state.

## Permissions

| Permission                      | Why it is needed                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Content script on http(s) pages | Copy detection and address-bar cleaning on supported pages                         |
| `clipboardRead`                 | Reading a link a page just copied, and the background watcher's clipboard checks   |
| `clipboardWrite`                | Writing the cleaned link back to the clipboard                                     |
| `contextMenus`                  | The "Copy link with … tracking" menu entries                                       |
| `offscreen`                     | The background clipboard watcher, and clipboard writes from the service worker     |
| `activeTab`                     | Reading the current tab's address when you use the shortcut, menu, or popup button |
| `storage`                       | Saving settings, the rewrite counter, and the key for decoys                       |

## Open source

The [source code](src/) is public and available for inspection.

## Contact

For privacy questions or concerns, [open an issue](https://github.com/pszemraj/utm-randomizer/issues).

_Last updated: October 1, 2026_
