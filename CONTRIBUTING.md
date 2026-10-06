# Contributing to UTM Randomizer

## Setup

Use the [source build](README.md#build-from-source) to load the extension and the [development commands](docs/development.md#commands) to rebuild it.

## Checks

Run focused regression tests for changed behavior and the applicable [lint, formatting, type, and build checks](docs/development.md). For documentation-only changes, check formatting, relative links, and examples against the current code. `npm run format` fixes formatting.

Unit mocks cannot establish native clipboard access, format handling, browser focus, or worker termination behavior. Changes to those paths require a real loaded-extension browser run. Exercise real clipboard data and browser focus; inject delays or failures when testing races. Cover newer copies, unsupported formats, and stale writes where relevant. Keep native browser-control workflows that automation cannot reach in the [manual checks](docs/development.md#manual-testing). On the user's macOS desktop, perform those checks deliberately through computer use in the already-running Chrome; never launch a headed Playwright suite that can flash or steal focus.

## Code style

TypeScript runs in strict mode, ESLint uses `typescript-eslint`'s strict type-checked rules, and Prettier owns formatting; `npm run check` enforces all three.

Every function, class, method, interface, type alias, and exported constant needs a `/** ... */` doc comment that says what it is for, not how it is implemented. This includes internal and test helpers. The [JSDoc lint configuration](eslint.config.mjs) enforces comments on declarations and exports; function expressions and constructors need manual review. Types come from TypeScript, so `@param` and `@returns` tags are optional; add them when a parameter or return value needs explanation (units, `null` meaning "no change", and so on). Tags that are present must match the signature, and one blank line separates the description from the first tag:

```ts
/**
 * Rewrites tracking
 * parameters in a link.
 *
 * @returns A rewritten link,
 *   or null for no change.
 */
export function rewriteUrl(
  link: string,
  options: RewriteOptions,
): UrlRewrite | null {
```

In `scripts/*.mjs`, which are plain JavaScript, write types inside the tags (`@param {number} [port]`).

## Adding a tracking parameter

Recognition lives in `src/lib/params.ts`: [campaign namespaces and exact names](docs/behavior.md#what-gets-rewritten) use one classifier. Keep coverage deliberate: missing tracking is preferable to breaking functional links. Add names or namespaces only for explicitly requested coverage, with vendor documentation establishing their campaign purpose and a source comment beside the rule. Leave uncertain or ambiguous names untouched; do not add site rules.

Known names declare a category (`source`, `medium`, `campaign`, `term`, `content`, `generic`, or `id`), which selects the [replacement values](docs/behavior.md#replacement-values). Use `id` for identifiers. Unknown names inside a supported namespace draw from pooled vocabulary; do not invent category inference.

Every new rule needs a regression in [`tests/unit/rewrite.test.ts`](tests/unit/rewrite.test.ts) showing cleaning while unrelated query bytes stay intact. For namespaces, cover unseen suffixes and names outside the boundary. A rewriting test establishes the chosen behavior; vendor evidence establishes the campaign use.

## Adding replacement values

Replacement values live in [`src/lib/values.ts`](src/lib/values.ts). Preserve the [per-copy replacement behavior](docs/behavior.md#replacement-values) when editing the lists or generators.

- **Decoy lists** (`DECOY_SOURCES`, `DECOY_MEDIUMS`, and the parts used to compose campaigns, terms, and placements) should read like values real marketing tools produce (`google`, `newsletter`, `paid_social`). Every value must pass `isWordy` after percent-decoding and converting `+` to a space: start with a Unicode letter or number, contain a letter, use only letters, combining marks, numbers, spaces, `_`, `.`, and `-`, and not look like a hexadecimal ID.
- **Silly lists** (`FUNNY`, `FUNNY_TOKEN_PHRASES`) should be lowercase and hyphenated, humorous but not offensive, obviously fake, and free of real company or brand names.

`npm run check` runs property tests in `tests/unit/values.test.ts` and `tests/unit/rewrite.test.ts` for format preservation, different replacements, and consistent results within a copy and fresh seeds for new copies. Completed clipboard processing is recognized from the [current write record](docs/behavior.md#clipboard-coordination), never from the value's vocabulary.

## Submitting changes

1. Create a branch named with a Conventional Commits type, for example `feat/replacement-values` or `fix/relative-links`.
2. Write commit messages in the same style: `feat: add replacement values`, `fix(rewrite): preserve relative link bytes`.
3. Complete the [checks](#checks).
4. If behavior changes, update the relevant usage and behavior documentation.
5. Open a pull request describing what changed and how you tested it.

## Reporting issues

Include your Chrome version, the extension version (shown in `chrome://extensions`), steps to reproduce, the link before and after (remove anything personal), and what you expected instead. For a link that broke after being rewritten, the site's domain and the parameter name are usually enough.
