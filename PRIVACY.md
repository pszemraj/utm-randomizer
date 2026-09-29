# Privacy Policy

UTM Randomizer does not collect, store, or transmit personal data. It makes no network requests, uses no analytics or telemetry, and sets no cookies. All processing happens inside your browser.

## What the extension reads

- **Links you copy on web pages.** When a page copies something (you press Ctrl+C / ⌘C, click a site's share button, or use Copy link address), the extension inspects the copied text to see whether it contains a link with tracking parameters. If it does, the extension writes back the same text with those parameters randomized or removed.
- **The clipboard, only right after such a copy.** The extension reads the clipboard only when the clipboard changes while you are using a page (within 10 seconds of clicking, typing, or right-clicking on it), or, on Chrome versions before 144, for a few seconds after you copy, click a button or link, or right-click a link. Clipboard contents are used only for that check; they are never stored or sent anywhere.
- **The current tab's address**, only when you use the keyboard shortcut, the context menu, or the popup's "Copy this page's link" button, to put a cleaned copy of it on the clipboard.

## What the extension stores

Stored locally in Chrome's extension storage and never synced or transmitted:

- your settings (on/off, Randomize or Remove, notifications on/off);
- a count of how many links were rewritten, in total and in the current browser session. Only the numbers are stored, not the links.

The notification's Undo button keeps the original link in page memory until the notification closes.

## Permissions

| Permission                          | Why it is needed                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| Content script on all http(s) pages | Detecting copies on any site                                                       |
| `clipboardRead`                     | Reading a link a page just copied so it can be checked                             |
| `clipboardWrite`                    | Writing the cleaned link back to the clipboard                                     |
| `contextMenus`                      | The "Copy link with tracking …" menu entries                                       |
| `offscreen`                         | Writing to the clipboard from the service worker for menu and shortcut copies      |
| `activeTab`                         | Reading the current tab's address when you use the shortcut, menu, or popup button |
| `storage`                           | Saving settings and the rewrite counter                                            |

## Open source

The full source code is public, so every statement above can be verified: <https://github.com/pszemraj/utm-randomizer>.

## Contact

For privacy questions or concerns, open an issue on the GitHub repository.

_Last updated: September 29, 2026_
