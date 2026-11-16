# Development

Use the [source build](../README.md#build-from-source) to install dependencies and load the extension.

## Commands

Use the [README development commands](../README.md#development) for watch builds and combined checks.

```bash
# Test the loaded extension headlessly; no browser window is shown
npm run test:e2e

# Manual: 127.0.0.1:5173
npm run playground

# Render icons from icon.svg
npm run icons
```

For release artifacts and changelog generation, see [Packaging and CI](#packaging-and-ci).

## Browser tests

The end-to-end command loads `dist/` into headless Playwright Chromium and exercises URL and compact-share clipboard changes, unchanged page addresses, settings, worker restart, and non-URL and non-text controls. It uses extension tabs for clipboard access and the options page. The fixture hard-codes headless mode; environment variables such as `HEADED=1` do not override it. Before the first run, install the browser with `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium binary.

Use the [manual checks](#manual-testing) for native minimize/regain, address-bar and context-menu copying, the embedded options view, and copying from another application. See [CONTRIBUTING.md](../CONTRIBUTING.md#checks) for choosing validation appropriate to a change.

## Manual testing

The playground provides copy controls, tracked and functional links, and a box to inspect pasted text. Open it in the browser where `dist/` is loaded.

Use Chrome's actual controls for the workflows outside the automated suite:

- Copy the tracked address with Ctrl+L / Cmd+L followed by Ctrl+C / Cmd+C. Check the clipboard both while the address bar remains focused and after returning to the page; separately try switching directly to another app to exercise the final tick. The page address must stay unchanged. See the [current focus limits](behavior.md#background-watching).
- Select **Copy link address** from a real context menu. Check that `chrome.windows.getAll({ windowTypes: ['normal', 'popup', 'devtools'] })` still reports a focused Chrome window while the menu or address-bar dropdown is open, even if its focus event reports `WINDOW_ID_NONE`.
- Open `chrome://extensions` -> **UTM Randomizer** -> **Details** -> **Extension options**. Check on/off and each replacement mode.
- With Chrome unfocused and the watcher stopped, copy a tracked link in another app, then focus Chrome and paste. That existing clipboard entry must remain unchanged. Separately write a new URL to the clipboard while Chrome stays focused: it should be processed regardless of the writing application.
- On Linux/X11, leave a large image on the clipboard for several minutes while Chrome stays focused, then repeat with an image accompanied by a tracked URL. Neither copy should change or cause sustained browser-memory growth. Ordinary polling and focus-regain baselines must use text-only paste; only newly eligible text should trigger a rich-format check. Include rapid text copies when checking that newer entries remain eligible.

### Agent browser validation notes

On a shared desktop, use the already-running Chrome for native checks, one bounded interaction at a time. Never launch a headed automated suite on the user's desktop. Use synthetic URLs, preserve all native clipboard formats privately, and restore the original clipboard and settings afterward. Pause the installed watcher while headless tests share the native clipboard. Keep profiles, screenshots, backups, and probe scripts out of commits.

- If Chromium aborts at launch with sandbox `EPERM`/`SIGABRT`, rerun the unchanged headless command outside the agent sandbox. A launch failure is not an application test failure; do not add project workarounds for it.
- Use the Node major in `.nvmrc`. If unavailable locally, a temporary registry runtime such as `npm exec --yes --package=node@24 -- npm run check` avoids changing global installations. Confirm the executed version and use the same runtime for browser tests and packaging.
- Browser-session clipboard APIs may be virtualized. For native clipboard checks, open a fresh tab through Chrome's native UI without claiming it through the browser-session provider. Verify a native copy and paste against the OS pasteboard; a page's "Copied" message alone is insufficient.
- A clipboard manager on the shared desktop records every test payload in its history. Run repeated clipboard writes and the image soak in a nested X display such as Xephyr, which has its own clipboard and focus.
- For the image soak, offer the image from a GTK application. A large image written by `xclip` while a clipboard manager is running can trigger the [clipboard-read hang](behavior.md#background-watching), after which the offscreen document stops answering; give debugger calls to it a timeout.
- Page focus can be emulated by browser tooling. Match the worker's explicit window types when sampling `chrome.windows.getAll`; its default excludes DevTools. Close inspectors before blur/minimize tests: a focused DevTools window legitimately keeps cleaning active.
- Computer-use observation of a minimized Chrome window can restore it. After minimizing, observe only the approved alternate app until the outside copy is verified. Read-only OS diagnostics and a bounded worker focus trace can distinguish genuine blur from reactivation by the test harness. Remove temporary probes afterward.
- App-targeted input or an accessibility `Raise` action is not proof that macOS switched foreground apps. Verify the actual foreground app and Chrome window focus. If a genuine switch cannot be achieved with approved controls, report that check as unverified, not as a product failure or an automation artifact.
- For user-assisted handoffs, ask the user only to switch apps; the agent still handles page controls, copying, pasting, and verification. Let the user set the pace. A reply may refocus the chat app, so use read-only native foreground observations rather than treating the reply as proof of browser focus.
- Use Safari for alternate-app checks. Ghostty is prohibited; do not use GUI terminals or editors as focus/clipboard test surfaces. Ask before accessing another app or granting desktop permissions. Repository commands belong in the execution tool, not a GUI terminal.

## Packaging and CI

`npm run changelog` regenerates `CHANGELOG.md` from Git tags and commit history. The `-p` option uses the version in `package.json` for the latest section even before its tag exists; generating that section does not publish a release. Generated changelog Markdown is excluded from Prettier.

On feature branches, preview with `npm run changelog -- --stdout` and keep pending-version sections out of the committed changelog. Squash merges leave one commit on `main`, so generated entries usually contain the pull request title. Generate the pending section from the updated `main` after the pull request is squash-merged and before tagging.

The default output includes at most three ordinary commits per release. Use `npm run changelog -- --commit-limit false` to include all of them.

Keep user-facing highlights and migration notes in the GitHub release notes; regenerating the changelog replaces manual additions.

`npm run package` creates `release/utm-randomizer-<version>.zip`, with `manifest.json` at the ZIP's root. Attach that file to a GitHub release as the extension download.

The release workflow runs only when a `v*` tag is pushed or when it is manually dispatched for an existing tag. The tag must equal `v` plus the version in `package.json`. It runs the repository checks, builds and inspects the package, then creates the GitHub release or attaches a missing ZIP on a manual rerun. An existing release asset is left unchanged.

After merging, let the tag-triggered workflow create the release with its ZIP attached. Publishing an [immutable release](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) beforehand blocks later asset uploads; disabling immutability afterward does not unlock that release. Its title and release notes remain editable.

Routine CI remains one static-check job for pull requests and `main`; release packaging does not run on ordinary branch updates. Run browser tests and packaging locally when relevant.

## Source map

- `src/manifest.json`: extension manifest; the build fills in `version` from `package.json`.
- `src/background.ts`: service worker: focus checks, settings updates, clipboard watcher lifecycle, and Chrome-only rewrite confirmation.
- `src/offscreen.ts`: background clipboard watcher and clipboard writer.
- `src/options.*`: on/off and mode settings, opened through Chrome's extension management page.
- `src/lib/params.ts`: campaign namespaces, exact tracking names, and replacement categories.
- `src/lib/rewrite.ts`: in-place URL rewriting and compact-share classification.
- `src/lib/values.ts`, `prng.ts`: Decoy, Silly, and Hybrid replacement values, seeded per copy.
- `src/lib/messages.ts`: runtime message contracts and sender checks.
- `src/lib/settings.ts`: defaults, shared mode validation, and local settings subscriptions.
- `tests/unit/`: rules, rewriting, values, settings, and clipboard coordination, using Vitest.
- `tests/e2e/`: Playwright tests with the extension loaded.
- `tests/fixtures/playground.html`: manual and end-to-end test page.
- `scripts/`: build, packaging, playground server, and icon renderer.
