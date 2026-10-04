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

The end-to-end tests load `dist/` into Playwright's Chromium and exercise single-URL clipboard changes, unchanged page addresses, settings, and non-URL and non-text controls. Before the first run, install the browser with `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium binary. Run `HEADED=1 npm run test:e2e` to show the browser.

Focus tests require `HEADED=1` to exercise a visible browser's native window focus. State this limitation before a headless run and run the focus cases in a visible browser before claiming full coverage.

See the [validation requirements](../CONTRIBUTING.md#checks) when choosing local checks.

Settings tests run the options page in an extension tab. Background-watcher tests write through an extension tab, including cleaning without a webpage reader; focus tests minimize and restore the browser window. These tests do not exercise native address-bar copying, browser menu selection, the embedded options view, or copying from another application.

## Manual testing

The playground provides copy controls, tracked and functional links, and a box to inspect pasted text. Open it in the browser where `dist/` is loaded.

Use Chrome's actual controls for the workflows outside the automated suite:

- Copy the tracked address with Ctrl+L / Cmd+L followed by Ctrl+C / Cmd+C. Check the clipboard both while the address bar remains focused and after returning to the page; separately try switching directly to another app to exercise the final tick. The page address must stay unchanged. See the [current focus limits](behavior.md#background-watching).
- Select **Copy link address** from a real context menu. Check `chrome.windows.getLastFocused().focused` while the menu or address-bar dropdown is open; Chrome's window must remain focused even if its focus event reports `WINDOW_ID_NONE`.
- Open `chrome://extensions` -> **UTM Randomizer** -> **Details** -> **Extension options**. Check on/off and each replacement mode.
- With Chrome unfocused and the watcher stopped, copy a tracked link in another app, then focus Chrome and paste. That existing clipboard entry must remain unchanged. Separately write a new URL to the clipboard while Chrome stays focused: it should be processed regardless of the writing application.

## Packaging and CI

`npm run package` creates `release/utm-randomizer-<version>.zip`, with `manifest.json` at the ZIP's root. Attach that file to a GitHub release as the extension download.

CI runs only lint, formatting, and type checks. Run tests and packaging locally when relevant. See [CONTRIBUTING.md](../CONTRIBUTING.md) for adding parameters and replacement values and for submitting changes.

## Source map

- `src/manifest.json`: extension manifest; the build fills in `version` from `package.json`.
- `src/background.ts`: service worker: focus checks, settings updates, and clipboard watcher lifecycle.
- `src/offscreen.ts`: background clipboard watcher and clipboard writer.
- `src/options.*`: on/off and mode settings, opened through Chrome's extension management page.
- `src/lib/params.ts`: campaign namespaces, exact tracking names, and replacement categories.
- `src/lib/rewrite.ts`: in-place rewriting of a whole URL.
- `src/lib/values.ts`, `prng.ts`: Decoy, Silly, and Hybrid replacement values, seeded per copy.
- `src/lib/messages.ts`: runtime message contracts and sender checks.
- `src/lib/settings.ts`: settings defaults and storage subscriptions.
- `tests/unit/`: rules, rewriting, values, settings, and clipboard coordination, using Vitest.
- `tests/e2e/`: Playwright tests with the extension loaded.
- `tests/fixtures/playground.html`: manual and end-to-end test page.
- `scripts/`: build, packaging, playground server, and icon renderer.
