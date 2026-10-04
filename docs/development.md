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

Popup controls run in extension tabs; Copy button tests supply the tab URL. Background-watcher tests write through an extension tab, and focus tests minimize and restore the browser window. These tests do not exercise native address-bar copying, browser menu selection, shortcut invocation, toolbar popup opening, or copying from another application.

## Manual testing

The playground has one control for each copy path, a tracked address-bar link, a link for testing focus boundaries, right-click test links, functional links that must paste unchanged, an iframe, and a box to inspect pasted text. Open it in the browser where `dist/` is loaded.

Use Chrome's actual controls for the workflows outside the automated suite:

- Copy the tracked address with Ctrl+L / Cmd+L followed by Ctrl+C / Cmd+C. Check the clipboard both while the address bar remains focused and after returning to the page; separately try switching directly to another app. The page address must stay unchanged. See the [current focus limits](behavior.md#background-watching).
- Select **Copy link address** and the extension's copy actions from real context menus. Invoke **Alt+Shift+U**, and open the toolbar popup to test its Copy button and settings.
- Copy a tracked link in another app, then focus Chrome and paste. The link must remain unchanged.

## Packaging and CI

`npm run package` creates `release/utm-randomizer-<version>.zip`, with `manifest.json` at the ZIP's root. Attach that file to a GitHub release as the extension download.

CI runs only lint, formatting, and type checks. Run tests and packaging locally when relevant. See [CONTRIBUTING.md](../CONTRIBUTING.md) for adding parameters and replacement values and for submitting changes.

## Source map

- `src/manifest.json`: extension manifest; the build fills in `version` from `package.json`.
- `src/content.ts`: content script entry: settings, copy watcher, notifications.
- `src/background.ts`: service worker: context menu, shortcut, statistics, clipboard watcher lifecycle.
- `src/offscreen.ts`: background clipboard watcher and clipboard writer.
- `src/popup.*`: toolbar popup.
- `src/lib/params.ts`: exact global tracking-parameter allowlist.
- `src/lib/rewrite.ts`: in-place link and text rewriting.
- `src/lib/values.ts`, `prng.ts`: Decoy, Silly, and Hybrid replacement values, seeded per copy.
- `src/lib/copy-watcher.ts`: copy events, `clipboardchange`, and the polling fallback.
- `src/lib/clipboard-html.ts`: rich clipboard rewriting and link counting.
- `src/lib/toast.ts`: on-page notification in a shadow root on the top layer.
- `src/lib/messages.ts`: runtime message contracts and sender checks.
- `src/lib/settings.ts`: settings defaults and storage subscriptions.
- `tests/unit/`: rules, rewriting, values, and page watchers in a simulated DOM, using Vitest.
- `tests/e2e/`: Playwright tests with the extension loaded.
- `tests/fixtures/playground.html`: manual and end-to-end test page.
- `scripts/`: build, packaging, playground server, and icon renderer.
