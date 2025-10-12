# Contributing to UTM Randomizer

Thank you for your interest in contributing to UTM Randomizer! This document provides guidelines for contributing to the project.

## Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd utm-randomizer
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome for testing**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select this directory

## Development Workflow

### Scripts
- `npm run dev` - Build in development mode with watch
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking
- `npm run test` - Run deterministic randomizer unit tests

### Adding New Funny Values

To add new funny replacement values, edit `src/utm-randomizer.ts`:

- `FUNNY_SOURCES` - For utm_source parameters
- `FUNNY_MEDIUMS` - For utm_medium parameters
- `FUNNY_CAMPAIGNS` - For utm_campaign parameters
- `FUNNY_TERMS` - For utm_term parameters
- `FUNNY_CONTENT` - For utm_content parameters

Guidelines for new values:
- Keep them humorous but not offensive
- Avoid real company/brand names
- Make them obviously fake to prevent confusion
- Keep them relatively short

### Testing

Test your changes by:
1. Building the extension with `npm run build`
2. Reloading the extension in Chrome
3. Using the test URLs [on the repo wiki](https://github.com/pszemraj/utm-randomizer/wiki/Test-URLs)
4. Copying URLs with UTM parameters and verifying they're randomized

## Code Style

- Use TypeScript for all new code
- Follow the existing ESLint configuration
- Write descriptive variable and function names
- Add comments for complex logic

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests: `npm run lint && npm run type-check && npm run test`
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Reporting Issues

When reporting issues, please include:
- Chrome version
- Extension version
- Steps to reproduce
- Example URLs (if applicable)
- Expected vs actual behavior
