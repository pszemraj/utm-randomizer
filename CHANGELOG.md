# Changelog

## Unreleased

### Changed

- Compact share text can contain captions and up to eight absolute web links; supported tracking parameters are rewritten while wrappers stay intact. Long prose-dominated documents remain untouched.

### Fixed

- Successful rewrites again show a brief Chrome-only confirmation while the browser is focused, without system notifications or page injection.
- Browser-focus polling checks all normal, popup, and DevTools windows so native Chrome menus remain eligible while genuine app blur suspends clipboard reads.
- Installation instructions distinguish a built release asset from GitHub's unbuilt source archives.

## [2.0.3] - 2026-10-04

### Changed

- Only copied text containing one whole URL is rewritten; documents, prose, multiple URLs, Markdown wrappers, and HTML link destinations stay untouched. Rewritten URLs are plain text, including copies with HTML, URI-list, or hidden web-added accompaniment; detectable images, files, and custom non-text formats are skipped.
- Clipboard reads and writes happen inside the extension without requiring a webpage reader. Browser-copy watching can clean copies while browser controls, the address bar, or an HTTP page retain focus. Starting or regaining Chrome focus still leaves existing contents untouched.
- One background watcher handles new clipboard entries from any source while Chrome is focused, without content scripts, page event handlers, or a separate watching toggle. It checks every 200 ms and takes a final tick on focus loss.

## [2.0.2] - 2026-10-04

### Fixed

- All clipboard writes, including page copies, explicit Copy, and Undo, pass through the browser-focus check. Pending operations cannot resume after losing and regaining focus.
- Native copy/cut data stays unchanged during dispatch. The coordinator rewrites supported text and HTML afterward; copies with custom formats or without a Clipboard API reader stay untouched.

## [2.0.1] - 2026-10-04

### Fixed

- Page addresses remain unchanged on load, navigation, and settings changes; tracking is cleaned only in copied links.
- Each copy draws fresh replacement values while matching text and HTML agree. Completed clipboard state prevents repeated processing; no per-install replacement key is stored.
- Clipboard observation runs only while Chrome is focused. Returning to Chrome establishes an untouched baseline; paste and ordinary typing do not authorize cleaning.

## [2.0.0] - 2026-09-29

### Breaking

- The unpacked extension now lives in `dist/`: load that folder in `chrome://extensions` instead of the repository root.
- Requires Chrome 123 or newer (was 102).
- Decoy is the default replacement style. The old nonsense values are still available as Silly mode.
- Only the exact [UTM and ad click-ID allowlist](docs/behavior.md#what-gets-rewritten) is rewritten. Site-specific, email, affiliate, and unknown prefix fields remain untouched, favoring functional links over tracking coverage.

### Added

- Decoy, Hybrid, and Remove [replacement modes](docs/behavior.md#replacement-values).
- [Automatic cleaning, Undo, and explicit copy actions](README.md#usage), with [page-copy detection](docs/behavior.md#page-copies) and [background watching](docs/behavior.md#background-watching).
- A compact global [tracking allowlist](docs/behavior.md#what-gets-rewritten), backed by vendor references.
- Popup controls for cleaning layers, notifications, and mode, with statistics and automatic light/dark styling.
- [Development tools](docs/development.md) for builds, tests, manual checks, icons, and Web Store packaging.

### Changed

- [In-place URL rewriting](docs/behavior.md#what-gets-rewritten) replaces URL re-serialization, preserving unrelated query bytes, duplicate keys, and link forms.
- [Page clipboard reads](docs/behavior.md#page-copies) follow user intent instead of every button or link click on Chrome 144+.
- The "this session" counter now resets with the browser session.
- The notification is isolated from page styles in a shadow root, sits in the top layer above modal dialogs, is announced to screen readers, and respects reduced motion.
- Content scripts stop working as soon as the extension is disabled, reloaded, or removed, instead of running until the page reloads.
- New icon with transparent padding, following Chrome Web Store icon guidelines.
- Tooling: TypeScript 6, ESLint 10 with typed `typescript-eslint` rules, Prettier, esbuild instead of webpack, and Vitest instead of the ts-node script.
- Required [doc comments](CONTRIBUTING.md#code-style), enforced by ESLint.

### Fixed

- [Copy detection](docs/behavior.md#page-copies) handles shadow-root text fields, stopped propagation, late page handlers, interrupted baseline reads, and oversized previous clipboard values.
- [Clipboard formats](docs/behavior.md#clipboard-formats) survive rich-copy cleaning; changed HTML is detected even with unchanged text, and plain-text Undo no longer discards formatting.
- [Clipboard coordination](docs/behavior.md#clipboard-coordination) rejects stale reads after newer copies, settings changes, Undo, and coordinator recreation without worker requests for ordinary typing. Undo suppression survives cross-frame work and worker restarts; failed restores do not suppress later copies, and lost acknowledgements report failure.
- [Background watching](docs/behavior.md#background-watching) leaves unrelated clipboard contents unchanged and retries tracked links after unavailable readers, invalidated inspections, or custom-format removal. Page observations expire obsolete write records without rewriting unrelated contents; settings updates no longer depend on context-menu updates.
- Synthetic copy, gesture, and Undo events and malformed or forged runtime messages are rejected.
- [URL rewriting](docs/behavior.md#what-gets-rewritten) preserves Bing Maps collections, TikTok player display controls, Amazon store selectors, signed links, standalone punctuation, adjacent non-Latin prose, relative page-link forms, and empty query segments, and handles standalone Markdown links.
- [Replacement values](docs/behavior.md#replacement-values) differ from current word and mutable identifier values, including plausible originals and one-character IDs, while preserving encoded, mixed-case hexadecimal, non-Latin, malformed-percent, and `magic-8-ball` formats.
- [Clipboard coordination](docs/behavior.md#clipboard-coordination) records the current successful before-and-after payload to process each entry once, replacing it on observed clipboard changes without keeping a history.
- Synchronous rewriting is bounded and avoids repeated full-link hashing; explicit Copy accepts unchanged or generated links beyond the automatic input bound.
- [Notifications and statistics](docs/behavior.md#usage) resume expiry after keyboard focus leaves and count rich-copy links without duplicate text/HTML counts.
- [Browser tests](docs/development.md) explicitly select and verify clipboard events and polling instead of relying on Chromium feature flags.

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
