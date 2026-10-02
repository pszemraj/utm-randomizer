# AGENTS.md - UTM Randomizer

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
- Defaults live in `src/lib/settings.ts` and are described in the
  [usage instructions](README.md#usage). Do not change them casually.
- Keep prerequisites, installation commands, verification, and a first-use
  example directly in the README.
- Never commit generated bundles, packages, browser profiles, test reports,
  logs, or probe outputs. Private evidence in `local-scratch/` stays local.
  Stage intended source files explicitly.
- Do not expand CI without separate approval of the scope and cost. Preserve
  the existing workflow; permission to run tests locally is not permission to
  add CI jobs, browser runs, packaging checks, or matrices.

## Commands and setup

Use the Node version in `.nvmrc` and the npm scripts in `package.json`. Follow the
[installation steps](README.md#install) and [development commands](README.md#development),
including extension reloads and browser-test setup. See the [source map](README.md#source-map)
for file responsibilities.

Keep the manifest, build target, and [minimum Chrome version](README.md#install)
consistent. Do not add older-browser support unless requested. Both browser-test
configurations must pass when browser checks apply.

## Architecture and behavior invariants

1. **Keep URL rewriting pure.** The parameter rules, rewrite functions, and
   replacement generators do not read the DOM, clipboard, or `chrome.*`.
   Preserve the [URL byte and input-bound contracts](README.md#what-gets-rewritten).
2. **Classify tracking conservatively.** Follow the [parameter rules and required
   control tests](CONTRIBUTING.md#adding-a-tracking-parameter).
3. **Keep replacements stable.** Preserve the [replacement behavior](README.md#replacement-values).
   The service worker creates the per-install key; other contexts request it.
4. **DOM events are a trust boundary.** Content scripts run in the isolated
   world, but page code shares the DOM and can dispatch synthetic events.
   Copy/cut authorization, gesture intent, clipboard-change handling, and Undo
   must reject untrusted events. A rejected synthetic Undo click must not
   consume the listener for a later real click.
5. **Coordinate post-copy writes.** Preserve the [shared writer and cancellation
   guarantees](README.md#clipboard-coordination). Use a shared epoch to reject
   older reads from other frames.
6. **Preserve complete clipboard formats.** Follow the [format limits](README.md#clipboard-formats)
   and [background inspection requirements](README.md#background-watching).
   Preserve [Undo eligibility](README.md#usage); do not restore rich copies as plain text.
7. **Preserve native copy/cut behavior.** Follow the [page-copy contract](README.md#page-copies).
   Stopped event propagation still needs deferred reconciliation from capture.
   Keep clipboard-data edits synchronous; after dispatch, use the coordinated path.
8. **Messages need payload and sender checks.** Keep message contracts in
   `src/lib/messages.ts`. Validate known payloads at runtime and enforce
   content/popup/worker/offscreen direction before changing settings,
   counters, or clipboard contents. Register worker listeners synchronously;
   worker globals are temporary, not durable state.
9. **Bound synchronous copy work.** Compact the stable link seed once before
   deriving per-parameter seeds. Keep URL and HTML entry points bounded;
   many tracking parameters must not cause repeated full-link hashing.
10. **Respect cleaning controls.** Preserve the [automatic and explicit action
    behavior](README.md#usage) and [address-bar behavior](README.md#page-copies).

## Validation

Follow the [validation requirements](CONTRIBUTING.md#checks) and
[code style](CONTRIBUTING.md#code-style), including doc comments and real browser
coverage for native clipboard, trust, focus, and worker-lifecycle changes.
