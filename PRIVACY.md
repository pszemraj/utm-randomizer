# Privacy Policy

UTM Randomizer does not collect, store, or transmit personal data. It makes no network requests, uses no analytics or telemetry, and sets no cookies. All processing happens inside your browser.

## What the extension reads

- **Copied text and HTML on web pages**, from copy events and clipboard reads after relevant interactions. The [copy detection paths](README.md#how-it-works) limit when a page reads the clipboard.
- **Clipboard text in the background**, while "Watch the whole clipboard" is on. It only looks for links with tracking parameters; images and files on the clipboard are never read or changed. Switching the setting off, or pausing the extension, stops these checks and closes the offscreen page.
- **The page address**, while "Clean the address bar" is on, and the current tab's address when you use an [explicit copy action](README.md#usage).

Clipboard contents and addresses are used only for these checks. They are never stored, logged, or sent anywhere.

## What the extension stores

Stored locally in Chrome's extension storage and never synced or transmitted:

- your settings (on/off, Decoy, Silly, Hybrid, or Remove, and which cleaning layers and notifications are on);
- a count of how many links were rewritten, in total and in the current browser session. Only the numbers are stored, not the links;
- a random key created when the extension is installed. Decoy values are derived from it so the same link always gets the same decoys; it identifies nothing and never leaves your browser.

The notification's Undo button keeps the original link in memory until the notification closes. After an Undo, the background watcher keeps the restored text in memory only so it can leave it alone until the clipboard changes again.

## Permissions

| Permission                          | Why it is needed                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| Content script on all http(s) pages | Detecting copies on any site and cleaning the address bar                          |
| `clipboardRead`                     | Reading a link a page just copied, and the background watcher's clipboard checks   |
| `clipboardWrite`                    | Writing the cleaned link back to the clipboard                                     |
| `contextMenus`                      | The "Copy link with … tracking" menu entries                                       |
| `offscreen`                         | The background clipboard watcher, and clipboard writes from the service worker     |
| `activeTab`                         | Reading the current tab's address when you use the shortcut, menu, or popup button |
| `storage`                           | Saving settings, the rewrite counter, and the key for decoys                       |

## Open source

The [source code](src/) is public and available for inspection.

## Contact

For privacy questions or concerns, open an issue on the GitHub repository.

_Last updated: September 29, 2026_
