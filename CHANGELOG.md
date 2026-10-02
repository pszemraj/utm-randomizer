# Changelog

## [2.0.0] - 2026-09-29

### Breaking

- The unpacked extension now lives in `dist/`: load that folder in `chrome://extensions` instead of the repository root.
- Requires Chrome 123 or newer (was 102).
- Decoy is the default replacement style. The old nonsense values are still available as Silly mode.
- Only [known tracking parameters](README.md#what-gets-rewritten) are rewritten; ambiguous names retain their functional uses on other sites.

### Added

- Decoy, Hybrid, and Remove [replacement modes](README.md#replacement-values).
- [Automatic cleaning, Undo, and explicit copy actions](README.md#usage), with [page-copy detection](README.md#page-copies) and [background watching](README.md#background-watching).
- Global and site-specific [tracking rules](README.md#what-gets-rewritten).
- Popup controls for cleaning layers, notifications, and mode, with statistics and automatic light/dark styling.
- [Development tools](README.md#development) for builds, tests, manual checks, icons, and Web Store packaging, with CI artifacts.

### Changed

- [In-place URL rewriting](README.md#what-gets-rewritten) replaces URL re-serialization, preserving unrelated query bytes, duplicate keys, and link forms.
- [Page clipboard reads](README.md#page-copies) follow user intent instead of every button or link click on Chrome 144+.
- The "this session" counter now resets with the browser session.
- The notification is isolated from page styles in a shadow root, sits in the top layer above modal dialogs, is announced to screen readers, and respects reduced motion.
- Content scripts stop working as soon as the extension is disabled, reloaded, or removed, instead of running until the page reloads.
- New icon with transparent padding, following Chrome Web Store icon guidelines.
- Tooling: TypeScript 6, ESLint 10 with typed `typescript-eslint` rules, Prettier, esbuild instead of webpack, and Vitest instead of the ts-node script.
- Required [doc comments](CONTRIBUTING.md#code-style), enforced by ESLint.

### Fixed

- [Copy detection](README.md#page-copies) handles shadow-root text fields, stopped propagation, late page handlers, and interrupted baseline reads.
- [Clipboard formats](README.md#clipboard-formats) survive rich-copy cleaning; changed HTML is detected even with unchanged text, and plain-text Undo no longer discards formatting.
- [Clipboard coordination](README.md#clipboard-coordination) rejects stale reads after newer copies, settings changes, Undo, and coordinator recreation. Undo suppression survives cross-frame work and worker restarts; lost acknowledgements report failure.
- [Background watching](README.md#background-watching) skips unrelated clipboard contents and retries tracked links after unavailable readers or custom-format removal. Page copies without rewritable links skip writer reconciliation; settings updates no longer depend on context-menu updates.
- Synthetic copy, gesture, and Undo events and malformed or forged runtime messages are rejected.
- [URL rewriting](README.md#what-gets-rewritten) preserves Bing Maps collections, TikTok player display controls, Amazon store selectors, signed links, standalone punctuation, and relative page-link forms, and handles standalone Markdown links.
- [Replacement values](README.md#replacement-values) stay stable for encoded, mixed-case hexadecimal, non-Latin, malformed-percent, and `magic-8-ball` inputs. HubSpot's `__hssc`, `__hstc`, and `__hsfp` are matched.
- Synchronous rewriting is bounded and avoids repeated full-link hashing; explicit Copy accepts unchanged or generated links beyond the automatic input bound.
- [Notifications and statistics](README.md#usage) resume expiry after keyboard focus leaves and count rich-copy links without duplicate text/HTML counts.
- [Browser tests](README.md#development) explicitly select and verify clipboard events and polling instead of relying on Chromium feature flags.

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
