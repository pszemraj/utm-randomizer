# Changelog

All notable changes to the UTM Randomizer extension will be documented in this file.

## [1.0.0] - 2025-06-03

### Added
- Initial release of UTM Randomizer Chrome extension
- Automatic detection of UTM parameters in copied URLs
- Random replacement of UTM values with funny alternatives
- Support for all standard UTM parameters (source, medium, campaign, term, content)
- Visual notifications when URLs are processed
- TypeScript implementation with proper type safety
- Comprehensive test URLs for validation

### Features
- **utm_source**: Replaced with funny sources like "carrier-pigeon", "mystery-meat", "your-moms-browser"
- **utm_medium**: Replaced with creative mediums like "smoke-signals", "interpretive-dance", "telepathy"
- **utm_campaign**: Replaced with humorous campaigns like "operation-click-bait", "project-procrastination"
- **utm_term**: Replaced with silly terms like "unicorn-tears", "pixel-dust", "tracking-goblin"
- **utm_content**: Replaced with amusing content like "banner-of-shame", "click-me-please", "desperate-cta"

### Technical
- Built with TypeScript and Webpack
- Chrome Manifest V3 compatibility
- ESLint configuration for code quality
- Proper clipboard API usage with permissions
- Content script injection on all websites