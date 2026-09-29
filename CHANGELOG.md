# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-09-29

### Breaking

- The unpacked extension now lives in `dist/`: load that folder in `chrome://extensions` instead of the repository root.
- Requires Chrome 116 or newer (was 102).
- Only parameters known to be tracking are rewritten. Generic names such as `ref`, `source`, `src`, `campaign`, `term`, `keywords`, `channel`, `cid`, `user_id`, and `session_id` are no longer rewritten on arbitrary sites, because doing so broke functional links (YouTube and LinkedIn searches, Google Maps places, New York Times gift links, GitLab file links, package tracking numbers, promo codes). They are still handled on the specific sites where they are tracking.

### Added

- Remove mode, which deletes tracking parameters instead of randomizing them.
- Undo button on the notification, restoring the original link.
- Detection of right-click → Copy link address and of `navigator.clipboard.writeText` share buttons via the `clipboardchange` event (Chrome 144+), gated on recent interaction with the page; older Chrome versions fall back to short polling after clicks and right-clicks.
- Synchronous rewriting of copy events, including data pages put on the clipboard themselves (plain text and HTML), on http pages as well as https.
- Copying inside iframes, with the notification shown in the top-level page.
- Context menu entries to copy a link or the current page with tracking cleaned, an Alt+Shift+U shortcut, and a "Copy this page's link" popup button.
- Site-specific rules for YouTube and Spotify (`si`), X, Instagram, Facebook, Reddit, LinkedIn, TikTok, Amazon, Google Search, Bing, BBC, The New York Times, eBay, AliExpress, and more.
- Global rules for newer tracking parameters, including `gad_source`, `gad_campaignid`, `srsltid`, `_gl`, `igsh`, `mibextid`, `epik`, `ScCid`, `rdt_cid`, and Matomo, Klaviyo, Kit, ActiveCampaign, and affiliate-network click IDs.
- Popup settings for notifications and mode, a light and dark theme, and the configured shortcut.
- Playwright end-to-end tests that load the built extension, a manual test page (`npm run playground`), and a GitHub Actions workflow that runs all checks and attaches the Web Store zip.
- `npm run package` to build a Chrome Web Store zip.

### Changed

- Links are edited in place: only tracking values change, while parameter order, duplicate keys, encoding, valueless flags, fragments, and scheme-less or relative forms are preserved. Previously every link was re-serialized, which re-encoded untouched parameters (`a,b` → `a%2Cb`, `%20` → `+`), dropped duplicate keys, and turned `www.example.com/…` into `https://www.example.com/…`.
- The clipboard is no longer read after every click on any link or button (on Chrome 144+), and nothing is read unless you interacted with the page within the last 10 seconds.
- The "this session" counter now resets with the browser session.
- The notification is isolated from page styles in a shadow root, sits in the top layer above modal dialogs, is announced to screen readers, and respects reduced motion.
- Content scripts stop working as soon as the extension is disabled, reloaded, or removed, instead of running until the page reloads.
- New icon with transparent padding, following Chrome Web Store icon guidelines.
- Tooling: TypeScript 6, ESLint 10 with typed `typescript-eslint` rules, Prettier, esbuild instead of webpack, and Vitest instead of the ts-node script.

### Fixed

- About 2.5% of randomized links were randomized again on the next copy: tokens containing `magic-8-ball` escaped the already-randomized check. Detection is now exact.
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
