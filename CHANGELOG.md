# Changelog

All notable changes to the UTM Randomizer extension will be documented in this file.

## [2.0.0] - 2025-09-09

### Major Changes
- **Architecture**: Complete rewrite using Chrome Offscreen API for secure clipboard access
- **Security**: Extension only operates when Chrome is active and user initiates action
- **Notifications**: Replaced system notifications with in-page visual indicators
- **Performance**: Improved to 3M+ URLs/second processing capability

### Added
- **Offscreen Document**: Dedicated secure context for clipboard operations
- **Badge Notifications**: Fallback indicator when in-page notifications unavailable
- **Chrome Focus Tracking**: Ensures clipboard only accessed when Chrome is active
- **Manual Trigger**: Improved popup with direct clipboard check

### Fixed
- **Critical Security Issue**: No longer monitors clipboard when Chrome is not active
- **Notification Display**: Works on all pages including chrome:// URLs
- **Address Bar Detection**: More reliable detection using multiple triggers
- **UTM Coverage**: Now detects ANY utm_* parameter including custom ones

### Improved
- **Code Organization**: Moved test tools to docs/tools subdirectory
- **Memory Management**: Reduced cache time to 3 seconds
- **Error Handling**: Better fallbacks for restricted pages
- **Documentation**: Professional documentation with clear explanations

## [1.1.0] - 2024-09-09

### Critical Fixes
- **Fixed**: Address bar copy failure - extension now works when copying URLs from browser address bar
- **Fixed**: Race conditions with proper debouncing (100ms checks, 500ms deduplication)
- **Fixed**: Memory leaks with automatic cleanup every 60 seconds
- **Fixed**: Notification stacking issues with proper cleanup

### Added
- **Extended Tracking Support**: Added support for 15+ tracking parameters beyond UTM
  - Facebook: fbclid, fb_source, fb_action_ids, fb_action_types
  - Google: gclid, wbraid, gbraid, _ga
  - Email: Mailchimp (mc_cid, mc_eid), MailerLite (ml_subscriber)
  - Others: yclid, twclid, msclkid, ef_id
- **Popup UI**: Interactive dashboard with toggle, statistics, and manual trigger
- **Context Menu**: Right-click option for manual UTM randomization
- **Keyboard Shortcut**: Ctrl+Shift+U (Cmd+Shift+U on Mac) for quick access
- **Statistics Tracking**: Daily and total URL counts with persistent storage
- **Tab Focus Monitoring**: Detects clipboard changes when switching tabs
- **Test Suite**: Comprehensive testing with 10+ test cases and performance benchmarks

### Improved
- **Background Script**: Proper clipboard monitoring via script injection
- **Content Script**: Debounced event handling with better clipboard access
- **Message Passing**: Secure communication between content and background scripts
- **Notification System**: Gradient styling with smooth animations
- **Webpack Configuration**: Production optimizations and clean builds
- **Type Safety**: Fixed all TypeScript errors and improved type definitions
- **Performance**: 2.5M+ URLs/second processing capability

### Technical
- Added 50+ new funny randomization values
- Implemented weighted randomization to avoid repetition
- Added 5-second cache for duplicate URL handling
- Improved URL sanitization with better validation
- Enhanced error handling for malformed URLs

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