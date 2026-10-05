# AGENTS.md - UTM Randomizer

UTM Randomizer is a Chrome extension that changes or removes known tracking
parameters from copied links. Preserve functional URL bytes and leave non-URL clipboard contents untouched.
Decoy, Silly, Hybrid, and Remove are the four modes.

## Extension-wide behavior

1. **Process new clipboard entries only while Chrome is focused.** Origin is
   irrelevant: any new entry observed during a focused interval is eligible.
   Check focus every 200 ms; on blur, take one final clipboard tick before
   suspending clipboard reads. Focus checks continue while cleaning is enabled.
   Every focus regain establishes an untouched baseline, with no short-gap
   exception. Never rewrite existing contents
   merely because Chrome starts, regains focus, navigates, or pastes.
2. **Change only the clipboard payload.** URL processing must never change page
   links, the page URL, browser history, or the address bar, or trigger navigation.
3. **Replacements are stochastic; removal is deterministic.** Decoy, Silly, and
   Hybrid draw fresh randomness per accepted URL entry. Replace the current value
   with a different value where its format
   permits. Remove deletes the supported tracking parameters. Never use a fixed
   mapping across copies or infer completed processing from replacement vocabulary.

## Working rules

- Keep changes focused on the requested behavior. Prefer deleting obsolete code
  over adding abstractions or compatibility layers.
- Target English-language share text and URLs expressed with ASCII or
  percent-encoded bytes. Do not add language-specific raw-Unicode URL parsing
  or boundary heuristics unless explicitly requested; conservatively skipping
  ambiguous embedded spans is acceptable.
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
consistent. Do not add older-browser support unless requested. Run applicable
browser tests and verify native Chrome controls in the user's actual profile;
page fields and synthetic events cannot stand in for those controls.

## Architecture and behavior invariants

1. **Keep URL rewriting pure.** The parameter rules, rewrite functions, and
   replacement generators do not read the DOM, clipboard, or `chrome.*`.
   Preserve the [URL byte and input-bound contracts](docs/behavior.md#what-gets-rewritten).
2. **Classify tracking conservatively.** Favor a small, evidence-backed rule set.
   Missing some tracking is preferable to breaking a functional link; leave
   uncertain or ambiguous parameters untouched. Keep one generic rewrite engine
   and the documented campaign namespaces and exact-name allowlist; do not add
   site-specific rules or broaden namespace coverage without an explicit request.
   Prefer removing or narrowing an overbroad rule to accumulating site-specific
   exceptions, and do not expand site coverage opportunistically during fixes.
   Follow the [parameter rules and required control tests](CONTRIBUTING.md#adding-a-tracking-parameter).
3. **Track the current clipboard entry.** Preserve the [replacement behavior](docs/behavior.md#replacement-values).
   The current successful before-and-after write record suppresses repeated
   processing. Release it after observing different text, HTML, or formats; do not
   accumulate clipboard history or use expiry to rewrite unchanged contents.
4. **Use one clipboard pipeline.** The offscreen document owns all clipboard
   reads and writes. Do not restore content scripts, webpage clipboard readers,
   host permissions, or page event authorization.
5. **Track observed contents, not provenance.** Skip only the read-back of our own
   output. Never suppress the original URL, add a revert guard, retain history,
   or re-randomize unchanged contents. Different observed contents discard the
   current before-and-after record.
6. **Rewrite whole URLs and bounded compact share text.** Normalize surrounding
   whitespace for a lone URL; preserve accepted share captions and wrappers
   byte-for-byte. Follow the [share-text boundaries](docs/behavior.md#what-gets-rewritten)
   and leave long prose-dominated documents and HTML-only link destinations
   untouched. Write accepted replacements as plain text. Skip detectable images,
   files, and custom non-text formats.
7. **Keep feedback inside Chrome.** Use browser feedback only while Chrome is
   focused. Never add system notifications or the notifications permission.
8. **Messages need payload and sender checks.** Keep message contracts in
   `src/lib/messages.ts`. Validate known payloads and enforce worker/offscreen
   direction before changing clipboard configuration, contents, or feedback. Register
   worker listeners synchronously; worker globals are temporary, not durable state.
9. **Bound synchronous URL work.** Compact the per-copy seed once before deriving
   per-parameter seeds. Preserve the URL input bound; many tracking parameters
   must not cause repeated full-link hashing.
10. **Respect cleaning controls.** Preserve the [on/off and mode behavior](docs/behavior.md#usage)
    and [browser-copy focus limits](docs/behavior.md#background-watching). Settings
    live in Extension options; do not restore a popup, custom copy actions, Undo,
    or counters.

## Validation

Follow the [validation requirements](CONTRIBUTING.md#checks) and
[code style](CONTRIBUTING.md#code-style), including doc comments and real browser
coverage for native clipboard, focus, and worker-lifecycle changes.
