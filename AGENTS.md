# AGENTS.md - UTM Randomizer

UTM Randomizer is a Chrome extension that changes or removes known tracking
parameters from copied links. Preserve functional URL bytes and clipboard formats.
Decoy, Silly, Hybrid, and Remove are the four modes.

## Extension-wide behavior

1. **Copy only while Chrome is open and focused.** Only a fresh copy made with
   Chrome focused authorizes rewriting. Check browser-window focus before every
   clipboard write, including page handlers, background watching, popup, menu,
   shortcut, and Undo actions. Starting or regaining focus establishes an untouched
   baseline; paste, navigation, and unrelated gestures do not authorize processing
   existing clipboard contents.
2. **Change only the clipboard payload.** URL processing must never change page
   links, the page URL, browser history, or the address bar, or trigger navigation.
3. **Replacements are stochastic; removal is deterministic.** Decoy, Silly, and
   Hybrid draw fresh randomness per accepted copy, shared by matching links in its
   text and HTML. Replace the current value with a different value where its format
   permits. Remove deletes the supported tracking parameters. Never use a fixed
   mapping across copies or infer completed processing from replacement vocabulary.

## Working rules

- Keep changes focused on the requested behavior. Prefer deleting obsolete code
  over adding abstractions or compatibility layers.
- **Commit verified implementation work before finishing.** Use atomic
  Conventional Commits at logical points; do not leave completed fixes
  uncommitted. Work on a branch.
- Update every consumer when a setting, message payload, or rewrite contract
  changes. Update existing documentation in place.
- Defaults live in `src/lib/settings.ts` and are described in the
  [usage instructions](README.md#usage). Do not change them casually.
- Keep the README focused on release installation and first use, with
  prerequisites, verification, and a compact source-build example. Put detailed
  behavior and architecture in `docs/` and link to them.
- Never commit generated bundles, packages, browser profiles, test reports,
  logs, or probe outputs. Private evidence in `local-scratch/` stays local.
  Stage intended source files explicitly.
- Do not expand CI without separate approval of the scope and cost. Preserve
  the existing workflow; permission to run tests locally is not permission to
  add CI jobs, browser runs, packaging checks, or matrices.

## Commands and setup

Use the Node version in `.nvmrc` and the npm scripts in `package.json`. Follow the
[installation steps](README.md#install) and [development commands](docs/development.md),
including extension reloads and browser-test setup. See the [source map](docs/development.md#source-map)
for file responsibilities.

Keep the manifest, build target, and [minimum Chrome version](README.md#install)
consistent. Do not add older-browser support unless requested. Both browser-test
configurations must pass when browser checks apply.

## Architecture and behavior invariants

1. **Keep URL rewriting pure.** The parameter rules, rewrite functions, and
   replacement generators do not read the DOM, clipboard, or `chrome.*`.
   Preserve the [URL byte and input-bound contracts](docs/behavior.md#what-gets-rewritten).
2. **Classify tracking conservatively.** Favor a small, evidence-backed rule set.
   Missing some tracking is preferable to breaking a functional link; leave
   uncertain or ambiguous parameters untouched. Keep one generic rewrite engine
   and an exact global allowlist; do not restore site-specific or prefix rules.
   Prefer removing or narrowing an overbroad rule to accumulating site-specific
   exceptions, and do not expand site coverage opportunistically during fixes.
   Follow the [parameter rules and required control tests](CONTRIBUTING.md#adding-a-tracking-parameter).
3. **Track the current clipboard entry.** Preserve the [replacement behavior](docs/behavior.md#replacement-values).
   The current successful before-and-after write record suppresses repeated
   processing. Release it after observing different text, HTML, or formats; do not
   accumulate clipboard history or use expiry to rewrite unchanged contents.
4. **DOM events are a trust boundary.** Content scripts run in the isolated
   world, but page code shares the DOM and can dispatch synthetic events.
   Copy/cut authorization, gesture intent, clipboard-change handling, and Undo
   must reject untrusted events. A rejected synthetic Undo click must not
   consume the listener for a later real click.
5. **Coordinate clipboard writes.** Preserve the [shared writer and cancellation
   guarantees](docs/behavior.md#clipboard-coordination). Use a shared epoch to reject
   older reads from other frames and cancel pending reads and candidates on
   browser-window focus loss. Completed processing state is separate from read
   cancellation.
6. **Preserve complete clipboard formats.** Follow the [format limits](docs/behavior.md#clipboard-formats)
   and [background inspection requirements](docs/behavior.md#background-watching).
   Preserve [Undo eligibility](docs/behavior.md#usage); do not restore rich copies as plain text.
7. **Preserve native copy/cut behavior.** Follow the [page-copy contract](docs/behavior.md#page-copies).
   Stopped event propagation still needs deferred reconciliation from capture.
   Let native copy/cut finish before coordinated rewriting; preserve native cut
   deletion. Leave a copy untouched if its path cannot verify browser-window focus
   and preserve the complete clipboard formats.
8. **Messages need payload and sender checks.** Keep message contracts in
   `src/lib/messages.ts`. Validate known payloads at runtime and enforce
   content/popup/worker/offscreen direction before changing settings,
   counters, or clipboard contents. Register worker listeners synchronously;
   worker globals are temporary, not durable state.
9. **Bound synchronous copy work.** Compact the stable link seed once before
   deriving per-parameter seeds. Keep URL and HTML entry points bounded;
   many tracking parameters must not cause repeated full-link hashing.
10. **Respect cleaning controls.** Preserve the [automatic and explicit action
    behavior](docs/behavior.md#usage) and [browser-copy focus limits](docs/behavior.md#background-watching).

## Validation

Follow the [validation requirements](CONTRIBUTING.md#checks) and
[code style](CONTRIBUTING.md#code-style), including doc comments and real browser
coverage for native clipboard, trust, focus, and worker-lifecycle changes.
