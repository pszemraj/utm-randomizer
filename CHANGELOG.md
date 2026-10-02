# Changelog

## [2.0.0] - 2026-09-29

### Breaking

- The unpacked extension now lives in `dist/`: load that folder in `chrome://extensions` instead of the repository root.
- Requires Chrome 123 or newer (was 102).
- Decoy is the default replacement style. The old nonsense values are still available as Silly mode.
- Only [known tracking parameters](README.md#what-gets-rewritten) are rewritten; ambiguous names retain their functional uses on other sites.

### Added

- Decoy, Hybrid, and Remove modes with stable, per-install [replacement values](README.md#replacement-values).
- Automatic [clipboard and address-bar cleaning](README.md#usage), Undo, and copying inside iframes.
- [Copy detection](README.md#how-it-works) for copy-event handlers, share buttons, and right-click copies, with legacy polling support.
- Explicit context-menu, shortcut, and popup [copy actions](README.md#usage).
- Global and site-specific [tracking rules](README.md#what-gets-rewritten).
- Popup controls for cleaning layers, notifications, mode, theme, and statistics.
- [Development tools](README.md#development) for builds, tests, manual checks, icons, and Web Store packaging, with CI artifacts.

### Changed

- Links are edited in place: only tracking values change, while parameter order, duplicate keys, encoding, valueless flags, fragments, and scheme-less or relative forms are preserved. Previously every link was re-serialized, which re-encoded untouched parameters (`a,b` → `a%2Cb`, `%20` → `+`), dropped duplicate keys, and turned `www.example.com/...` into `https://www.example.com/...`.
- Content scripts no longer read the clipboard after every click on any link or button (on Chrome 144+), and read nothing unless you interacted with the page within the last 10 seconds. Watching the clipboard outside pages is the separate, switchable background watcher.
- The "this session" counter now resets with the browser session.
- The notification is isolated from page styles in a shadow root, sits in the top layer above modal dialogs, is announced to screen readers, and respects reduced motion.
- Content scripts stop working as soon as the extension is disabled, reloaded, or removed, instead of running until the page reloads.
- New icon with transparent padding, following Chrome Web Store icon guidelines.
- Tooling: TypeScript 6, ESLint 10 with typed `typescript-eslint` rules, Prettier, esbuild instead of webpack, and Vitest instead of the ts-node script.
- Required [doc comments](CONTRIBUTING.md#code-style), enforced by ESLint.

### Fixed

- Amazon store-search selectors (`srs`) remain unchanged while tracking parameters are cleaned.
- Browser tests explicitly select and verify the clipboard-event and polling paths instead of relying on Chromium feature flags.
- Recognized signed CloudFront, AWS, Google Cloud, and Azure links remain byte-for-byte unchanged in every mode.
- Standalone URL punctuation stays in its original query value or fragment, and text and URL entry points agree on replacements.
- URL rewriting bounds input size and hashes each link's stable seed once, avoiding quadratic work for many tracking parameters.
- Deferred clipboard checks clean text and HTML links even when a page stops copy or cut propagation.
- Polling reconciles copies after dispatch even when a dynamically registered page handler overwrites a synchronous edit.
- Native rich selections retain their HTML formatting and functional anchor destinations during cleaning.
- Rich copies clean URLs embedded in prose in both plain-text and HTML representations.
- Plain-text Undo is offered only for copies containing no other clipboard formats.
- Explicit Copy accepts generated output and unchanged links beyond the rewrite input bound.
- Post-copy writes share an offscreen coordinator and retain originating-frame context for relative text and HTML links; newer copies, Undo, and settings changes invalidate older asynchronous reads.
- New trusted intent advances the shared clipboard generation so older page contexts cannot rewrite newer identical copies using stale link rules.
- Clipboard generation tokens stay distinct across coordinator recreation, preventing pause/resume from accepting an older in-flight request.
- Settings changes cancel automatic reconciliation awaiting coordinator or key lookup in the worker, preventing delayed writes after Pause.
- Automatic writes inspect the complete native format inventory and preserve images, files, and custom payloads. Whole-clipboard cleaning waits for a focused page when that inspection is unavailable.
- Undo suppression survives cross-frame work and service-worker restart, then expires when different contents or formats are observed. Lost acknowledgements report restoration failure.
- Synthetic copy, gesture, and Undo events cannot authorize clipboard writes; malformed runtime messages and forged control senders are rejected.
- Clipboard checks compare HTML as well as plain text: new HTML targets are cleaned even with unchanged text, while legacy polling leaves pre-existing rich links alone after unrelated clicks and context menus and continues when a new copy invalidates its baseline read.
- Settings changes stop or reconfigure the clipboard watcher independently of cosmetic context-menu updates.
- Decoy replacements stay stable for percent-encoded and mixed-case hexadecimal identifiers, non-Latin tracking words, and values containing malformed percent sequences.
- Standalone Markdown links in plain clipboard text are cleaned even when the text contains no whitespace.
- Tokens containing `magic-8-ball` were randomized again on the next copy; stable replacements remove the need to detect previously randomized values.
- HubSpot's `__hssc`, `__hstc`, and `__hsfp` were never matched.

## [1.2.0] - 2025-12-17

### Added

- Popup UI with enable/disable toggle and randomization statistics
- `isAlreadyRandomized()` function to prevent double-randomization when switching tabs
- `storage` permission for persisting settings and stats
- Idempotency tests for re-randomization detection

### Fixed

- Re-randomization bug: URLs no longer get re-randomized when switching between tabs
- Race condition in clipboard sweep using AbortController
- Aggressive copy-intent detection: narrowed keywords to copy-specific terms only

### Changed

- Notification moved to bottom-left with neutral dark styling and dismiss button
- Notification duration reduced from 2.6s to 1.8s
- Removed unnecessary `host_permissions` from manifest (not needed for MV3)

## [1.1.0] - 2025-12-16

### Added

- Prepare for Chrome Web Store submission

## [1.0.0] - 2025-10-11

### Added

- Robustness improvements and dependency upgrades

## [0.0.1] - 2025-06-03

### Added

- Initial release of UTM Randomizer Chrome extension
