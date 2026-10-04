# Contributing to UTM Randomizer

## Setup

Use the [installation steps](README.md#install) to load the extension and the [development commands](README.md#development) to rebuild it.

## Checks

Run focused regression tests for changed behavior and the applicable [lint, formatting, type, and build checks](README.md#development). For documentation-only changes, check formatting, relative links, and examples against the current code. `npm run format` fixes formatting.

A simulated DOM cannot establish native clipboard permissions, event trust, format preservation, focus behavior, or worker termination behavior. Changes to those paths require a real loaded-extension browser run in both configurations. Exercise real mouse/keyboard input and clipboard data; inject delays or failures when testing races. Cover newer copies, cross-frame Undo, lost acknowledgements, unsupported formats, stopped propagation, and synthetic-event attacks where relevant.

## Code style

TypeScript runs in strict mode, ESLint uses `typescript-eslint`'s strict type-checked rules, and Prettier owns formatting; `npm run check` enforces all three.

Every function, class, method, interface, type alias, and exported constant needs a `/** ... */` doc comment that says what it is for, not how it is implemented. This includes internal and test helpers. The [JSDoc lint configuration](eslint.config.mjs) enforces comments on declarations and exports; function expressions and constructors need manual review. Types come from TypeScript, so `@param` and `@returns` tags are optional; add them when a parameter or return value needs explanation (units, `null` meaning "no change", and so on). Tags that are present must match the signature, and one blank line separates the description from the first tag:

```ts
/**
 * Rewrites tracking parameters
 * in a single link.
 *
 * @returns The rewritten link,
 *   or null when no rewrite applies.
 */
export function rewriteUrl(
  link: string,
  options: RewriteOptions,
): UrlRewrite | null {
```

In `scripts/*.mjs`, which are plain JavaScript, write types inside the tags (`@param {number} [port]`).

## Adding a tracking parameter

The exact allowlist lives in `src/lib/params.ts`. Keep coverage small and deliberate: missing tracking is preferable to breaking functional links. Add a name only for explicitly requested coverage, with vendor documentation establishing its tracking purpose and a source comment beside the entry. Leave uncertain or ambiguous names untouched; do not add site rules or prefix matches.

Each entry declares a category (`source`, `medium`, `campaign`, `term`, `content`, `generic`, or `id`), which selects the [replacement values](README.md#replacement-values). Use `id` for click IDs; it always takes the identifier path.

Every new entry needs a regression in [`tests/unit/rewrite.test.ts`](tests/unit/rewrite.test.ts) showing the link being cleaned while unrelated query bytes stay intact. Extend the existing preservation controls for names outside the allowlist. A rewriting test establishes the chosen behavior; vendor evidence establishes whether the name belongs in the allowlist.

## Adding replacement values

Replacement values live in [`src/lib/values.ts`](src/lib/values.ts). Preserve the [stable per-link behavior](README.md#replacement-values) when editing the lists or generators.

- **Decoy lists** (`DECOY_SOURCES`, `DECOY_MEDIUMS`, and the parts used to compose campaigns, terms, and placements) should read like values real marketing tools produce (`google`, `newsletter`, `paid_social`). Every value must pass `isWordy` after percent-decoding and converting `+` to a space: start with a Unicode letter or number, contain a letter, use only letters, combining marks, numbers, spaces, `_`, `.`, and `-`, and not look like a hexadecimal ID. Otherwise the next copy would treat it as an identifier and change it again.
- **Silly lists** (`FUNNY`, `FUNNY_TOKEN_PHRASES`) should be lowercase and hyphenated, humorous but not offensive, obviously fake, and free of real company or brand names.

`npm run check` runs property tests (`tests/unit/values.test.ts` and the idempotency cases in `tests/unit/rewrite.test.ts`) that fail if a value would be rewritten again or is not URL-safe.

## Submitting changes

1. Create a branch named with a Conventional Commits type, for example `feat/clipboard-undo` or `fix/relative-links`.
2. Write commit messages in the same style: `feat: add clipboard Undo`, `fix(rewrite): preserve relative link bytes`.
3. Complete the [checks](#checks).
4. If behavior changes, update `README.md` and add an entry to `CHANGELOG.md`.
5. Open a pull request describing what changed and how you tested it.

## Reporting issues

Include your Chrome version, the extension version (shown in the popup), steps to reproduce, the link before and after (remove anything personal), and what you expected instead. For a link that broke after being rewritten, the site's domain and the parameter name are usually enough.
