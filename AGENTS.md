# AGENTS.md — UTM Randomizer

UTM Randomizer is a Chrome extension that changes or removes known tracking
parameters from copied links and the address bar. Preserve functional URL bytes
and clipboard formats. Decoy, Silly, Hybrid, and Remove are the four modes.

## Working rules

- Keep changes focused on the requested behavior. Prefer deleting obsolete code
  over adding abstractions or compatibility layers.
- **Commit verified implementation work before finishing.** Use atomic
  Conventional Commits at logical points; do not leave completed fixes
  uncommitted. Work on a branch.
- Update every consumer when a setting, message payload, or rewrite contract
  changes. Update existing documentation in place.
- Defaults live in `src/lib/settings.ts`: Decoy mode, automatic cleaning,
  address-bar cleaning, whole-clipboard watching, and notifications are enabled.
  Do not change user-visible defaults casually.
- Keep prerequisites, installation commands, verification, and a first-use
  example directly in the README.
- Never commit generated bundles, packages, browser profiles, test reports,
  logs, or probe outputs. Private evidence in `local-scratch/` stays local.
  Stage intended source files explicitly.
- Do not expand CI without separate approval of the scope and cost. Preserve
  the existing workflow; permission to run tests locally is not permission to
  add CI jobs, browser runs, packaging checks, or matrices.

## Commands and setup

Use the Node version in `.nvmrc` and the npm scripts in `package.json`.

```bash
npm ci
npm run build        # esbuild bundles into dist/
npm run dev          # rebuild dist/ as source changes
npm run lint         # strict ESLint, including required doc comments
npm run typecheck    # TypeScript checking
npm test             # Vitest unit tests
npm run format:check # Prettier check
npm run check        # lint, formatting, types, and unit tests
npm run test:e2e     # build and test the loaded extension in Chromium
npm run playground  # local manual test page
npm run package     # build and zip dist/ into release/
```

Load `dist/` through `chrome://extensions` → Developer mode → Load unpacked.
After rebuilding, reload the extension card and refresh web pages so they receive
the new content script. **Chrome 123 is the minimum supported version**; keep the
manifest, build target, and README consistent. Do not add older-browser support
unless requested.

For browser tests, install Chromium with `npx playwright install chromium` or
set `CHROMIUM_PATH` to an existing Chromium binary. `HEADED=1 npm run test:e2e`
shows the browser. Both clipboard-event and polling configurations must pass;
disabling `clipboardchange` tests the fallback, not an older Chrome API version.

## Source map

- `src/content.ts`: settings/key subscriptions, per-frame copy watcher,
  top-frame address-bar cleaning, and notifications.
- `src/background.ts`: MV3 service worker; menus, shortcut, statistics,
  per-install key, offscreen lifecycle, and message routing.
- `src/offscreen.ts`: shared coordinator for post-copy clipboard writes,
  whole-clipboard polling, and Undo suppression.
- `src/popup.*`: vanilla DOM settings, counters, and explicit page-link copy.
- `src/lib/params.ts`: global and site-specific tracking rules.
- `src/lib/rewrite.ts`: URL and text rewriting; `values.ts` and `prng.ts`
  generate stable replacement values.
- `src/lib/copy-watcher.ts`: synchronous copy/cut handling, clipboard-change
  events, and cancellable gesture-triggered polling.
- `src/lib/clipboard-html.ts`, `address-bar.ts`, `toast.ts`, `messages.ts`,
  and `settings.ts`: shared HTML, address-bar, notification, messaging, and
  settings behavior.
- `tests/unit/`: Vitest and a simulated DOM. `tests/e2e/`: Playwright with
  the real extension. `tests/fixtures/playground.html` serves both manual
  and automated browser checks.

## Architecture and behavior invariants

1. **Keep URL rewriting pure.** The parameter rules, rewrite functions, and
   replacement generators do not read the DOM, clipboard, or `chrome.*`.
   Edit query segments in place: unrelated values, encoding, ordering,
   duplicate keys, fragments, and link forms must remain intact.
2. **Classify tracking conservatively.** Global rules apply only to names that
   unambiguously mean tracking. Ambiguous names such as `ref`, `si`, and
   `cid` need site/path rules and a functional-link control test. Categories
   are `source`, `medium`, `campaign`, `term`, `content`, `generic`,
   and `id`; click IDs and share tokens use `id`.
3. **Rewriting is deterministic and idempotent.** The service worker creates
   the per-install key; other contexts request it. Preserve identifier shape,
   prefixes, separators, and encoding while replacing identifying payload.
   A rewritten value must stay unchanged on subsequent passes. Preserve
   recognized signed links and the core input-length bounds.
4. **DOM events are a trust boundary.** Content scripts run in the isolated
   world, but page code shares the DOM and can dispatch synthetic events.
   Copy/cut authorization, gesture intent, clipboard-change handling, and Undo
   must reject untrusted events. A rejected synthetic Undo click must not
   consume the listener for a later real click.
5. **Post-copy writes have one coordinator.** Synchronous copy handlers may
   edit `ClipboardEvent.clipboardData` during dispatch. Asynchronous page
   reads, explicit Copy, and Undo go through the offscreen writer. New intent,
   settings changes, Undo, and shutdown invalidate pending reads; the shared
   epoch protects against older reads from other frames.
6. **Preserve complete clipboard formats.** Asynchronous automatic writes require a
   native format inventory containing only plain text and HTML. Images,
   files, and custom formats stay untouched. Offscreen synthetic paste cannot
   reveal web custom formats; whole-clipboard polling asks a focused page to
   inspect them and waits when none is available. Check the current snapshot
   before writing, require acknowledgement for Undo, and do not claim atomic
   read/write ordering against arbitrary external apps. Plain-text Undo is
   unavailable for HTML rewrites because it would discard formatting.
7. **Native copy/cut behavior must survive.** Do not cancel a native cut's
   deletion. Stopped event propagation still needs deferred reconciliation
   from capture. Keep clipboard-data edits synchronous; after dispatch, use
   the coordinated clipboard path. Cancel prior polling and pending reads
   when a newer action supersedes them.
8. **Messages need payload and sender checks.** Keep message contracts in
   `src/lib/messages.ts`. Validate known payloads at runtime and enforce
   content/popup/worker/offscreen direction before changing settings,
   counters, or clipboard contents. Register worker listeners synchronously;
   worker globals are temporary, not durable state.
9. **Bound synchronous copy work.** Compact the stable link seed once before
   deriving per-parameter seeds. Keep URL and HTML entry points bounded;
   many tracking parameters must not cause repeated full-link hashing.
10. **Automatic and explicit actions differ.** Pause disables automatic
    cleaning; menu, shortcut, and popup Copy still work. Disabling
    whole-clipboard watching stops polling while page copy handling and the
    shared writer remain available. Address-bar cleaning uses
    `history.replaceState` without navigation and has no Undo.

## Validation

Run focused regression tests for changed behavior and the applicable lint,
formatting, type, and build checks. Follow `CONTRIBUTING.md` for code style:
functions, classes, methods, interfaces, type aliases, and exported constants
require useful doc comments.

A simulated DOM cannot establish native clipboard permissions, event trust,
format preservation, focus behavior, or worker termination behavior. Changes
to those paths require a real loaded-extension browser run. Exercise real
mouse/keyboard input and clipboard data; inject delays or failures when testing
races. Cover newer copies, cross-frame Undo, lost acknowledgements, unsupported
formats, stopped propagation, and synthetic-event attacks where relevant.
