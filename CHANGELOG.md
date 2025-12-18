# Changelog

All notable changes to this project will be documented in this file.

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
