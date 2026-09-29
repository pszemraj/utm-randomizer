# Privacy Policy

UTM Randomizer does not collect, store, or transmit personal data. It makes no network requests, uses no analytics or telemetry, and sets no cookies. All processing happens inside your browser.

## What the extension reads

- **Links you copy on web pages.** When a page copies something (you press Ctrl+C / ⌘C, click a site's share button, or use Copy link address), the extension inspects the copied text to see whether it contains a link with tracking parameters. If it does, the extension writes back the same text with those parameters replaced or removed.
- **The clipboard, on web pages, right after such a copy.** A page's content script reads the clipboard only when the clipboard changes while you are using that page (within 10 seconds of clicking, typing, or right-clicking on it), or, on Chrome versions before 144, for a few seconds after you copy, click a button or link, or right-click a link.
- **The clipboard, in the background, while "Watch the whole clipboard" is on.** An offscreen extension page checks the clipboard's text about every 0.75 seconds so links copied from the address bar, other apps, or pages where extensions cannot run are cleaned too. It only looks for links with tracking parameters; images and files on the clipboard are never read or changed. Switching the setting off, or pausing the extension, stops these checks and closes the offscreen page.
- **The address of the page you are on**, while "Clean the address bar" is on, so tracking parameters can be replaced in the address bar after the page loads. The page is not reloaded and nothing is sent anywhere.
- **The current tab's address**, when you use the keyboard shortcut, the context menu, or the popup's "Copy this page's link" button, to put a cleaned copy of it on the clipboard.

Clipboard contents and addresses are used only for these checks. They are never stored, logged, or sent anywhere.

## What the extension stores

Stored locally in Chrome's extension storage and never synced or transmitted:

- your settings (on/off, Decoy, Silly, or Remove, and which cleaning layers and notifications are on);
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

The full source code is public, so every statement above can be verified: <https://github.com/pszemraj/utm-randomizer>.

## Contact

For privacy questions or concerns, open an issue on the GitHub repository.

_Last updated: September 29, 2026_
