# Changelog

## Unreleased

The 2.x work has not been released; these notes describe the changes from 1.2.0.

### Breaking

- The unpacked extension lives in `dist/`: load that folder in `chrome://extensions` instead of the repository root.
- Requires Chrome 123 or newer (was 102).
- Hybrid is the default replacement mode. The original nonsense values are available as Silly mode.
- Rewritten clipboard entries are plain text. Accompanying HTML, URI lists, and hidden web-added data are discarded; detectable images, files, and custom non-text formats leave the entry unchanged.
- Parameter coverage is narrower than 1.2.0: generic names such as `ref`, `source`, and `campaign`; identifiers such as `yclid`, `mkt_tok`, `_hsenc`, and `mc_eid`; and broad `oly_`, `vero_`, `trk_`, and `hss*` prefixes are no longer rewritten unless they match the documented namespaces or exact names.

### Added

- Decoy, Hybrid, and Remove [replacement modes](docs/behavior.md#replacement-values).
- [Extension options](README.md#usage) for the on/off setting and replacement mode.
- A brief Chrome-only check on the extension icon after successful rewriting.
- [Development tools](docs/development.md) for builds, tests, manual checks, icons, and Web Store packaging.
- Release-only automation that builds and attaches the installable extension ZIP to versioned GitHub releases.

### Changed

- One [background clipboard watcher](docs/behavior.md#background-watching) handles new entries from any source while Chrome is focused, including browser-control copies. It checks focus every 200 ms, takes one final clipboard tick on focus loss, and establishes an untouched baseline on startup and focus regain.
- [Whole URLs and bounded compact share text](docs/behavior.md#what-gets-rewritten) are eligible. Captions and wrappers stay intact; long prose-dominated documents, path-relative URLs, and ambiguous embedded spans stay untouched.
- Campaign namespaces and documented exact tracking names use one [global classifier](docs/behavior.md#what-gets-rewritten), backed by vendor references. Unrelated query bytes, duplicate keys, fragments, and functional parameters stay intact; recognized signed links are skipped.
- Each accepted copy draws fresh replacements. Word values and mutable identifiers differ from their originals while preserving the documented formats; the current clipboard snapshot prevents repeated rewriting without accumulating history.
- New icon with transparent padding, following Chrome Web Store icon guidelines.
- TypeScript 6, ESLint 10 with typed `typescript-eslint` rules, Prettier, esbuild instead of webpack, and Vitest instead of the ts-node script.
- Required [doc comments](CONTRIBUTING.md#code-style), enforced by ESLint.

### Removed

- The toolbar popup and randomization statistics from 1.2.0.
- Page-injected notifications and content scripts; only clipboard contents change.

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
