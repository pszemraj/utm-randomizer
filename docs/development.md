# Development

Use the [source build](../README.md#build-from-source) to install dependencies and load the extension.

## Commands

```bash
# Rebuild, then reload
npm run dev

# Lint, format, types, tests
npm run check

# Test loaded extension
npm run test:e2e

# Manual: 127.0.0.1:5173
npm run playground

# Web Store zip in release/
npm run package

# Render icons from icon.svg
npm run icons
```

## Browser tests

The end-to-end tests load `dist/` into Playwright's Chromium and exercise page copies, background watching, unchanged page addresses, format preservation, and Undo. Before the first run, install the browser with `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium binary. Run `HEADED=1 npm run test:e2e` to show the browser.

The suite runs with native `clipboardchange` events and with that capability removed from a temporary extension copy; a polling-specific case skips the event configuration. Both projects verify the capability in the content script's isolated world. This exercises the fallback in current Chromium, not an older Chrome installation. See the [validation requirements](../CONTRIBUTING.md#checks) when choosing local checks.

## Manual testing

The playground has one control for each copy path, a tracked address-bar link, a link to copy from another app, right-click test links, functional links that must paste unchanged, an iframe, and a box to inspect pasted text. Open it in the browser where `dist/` is loaded.

## Packaging and CI

`npm run package` creates `release/utm-randomizer-<version>.zip`, with `manifest.json` at the ZIP's root. Attach that file to a GitHub release as the extension download.

CI runs only lint, formatting, and type checks. Run tests and packaging locally when relevant. See [CONTRIBUTING.md](../CONTRIBUTING.md) for adding parameters and replacement values and for submitting changes.

## Source map

- `src/manifest.json`: extension manifest; the build fills in `version` from `package.json`.
- `src/content.ts`: content script entry: settings, copy watcher, notifications.
- `src/background.ts`: service worker: context menu, shortcut, statistics, key, clipboard watcher lifecycle.
- `src/offscreen.ts`: background clipboard watcher and clipboard writer.
- `src/popup.*`: toolbar popup.
- `src/lib/params.ts`: exact global tracking-parameter allowlist.
- `src/lib/rewrite.ts`: in-place link and text rewriting.
- `src/lib/values.ts`, `prng.ts`: Decoy, Silly, and Hybrid replacement values, seeded per install.
- `src/lib/copy-watcher.ts`: copy events, `clipboardchange`, and the polling fallback.
- `src/lib/clipboard-html.ts`: rich clipboard rewriting and link counting.
- `src/lib/toast.ts`: on-page notification in a shadow root on the top layer.
- `src/lib/messages.ts`: runtime message contracts and sender checks.
- `src/lib/settings.ts`: settings defaults, storage subscriptions, and per-install key requests.
- `tests/unit/`: rules, rewriting, values, and page watchers in a simulated DOM, using Vitest.
- `tests/e2e/`: Playwright tests with the extension loaded.
- `tests/fixtures/playground.html`: manual and end-to-end test page.
- `scripts/`: build, packaging, playground server, and icon renderer.
