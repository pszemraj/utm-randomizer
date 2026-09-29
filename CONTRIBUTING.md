# Contributing to UTM Randomizer

## Setup

Node 22.13+ or 24 is required (`.nvmrc` pins 24).

```bash
git clone https://github.com/pszemraj/utm-randomizer.git
cd utm-randomizer
npm ci
npm run dev
```

`npm run dev` rebuilds `dist/` on every change. Load `dist/` once via `chrome://extensions` → Developer mode → **Load unpacked**, then click the reload icon on the extension's card after each rebuild. Pages that were open before a reload keep the old content script until they are refreshed.

## Checks

```bash
npm run check      # lint (including required doc comments), format check, typecheck, unit tests
npm run test:e2e   # build, then Playwright tests with the extension loaded in Chromium
```

Both must pass before a pull request is merged; CI runs them on every pull request. For end-to-end tests, run `npx playwright install chromium` once, or point `CHROMIUM_PATH` at an existing Chromium binary. `npm run format` fixes formatting.

For manual testing, run `npm run playground` and open `http://127.0.0.1:5173` in the browser where `dist/` is loaded. The page covers every way sites copy links and includes look-alike functional links that must paste unchanged.

## Code style

TypeScript runs in strict mode, ESLint uses `typescript-eslint`'s strict type-checked rules, and Prettier owns formatting; `npm run check` enforces all three.

Every function, class, method, interface, type alias, and exported constant needs a `/** ... */` doc comment that says what it is for, not how it is implemented. This covers internal helpers and test helpers too, and `eslint-plugin-jsdoc` fails the lint when one is missing. Types come from TypeScript, so `@param` and `@returns` tags are optional; add them when a parameter or return value needs explanation (units, `null` meaning "no change", and so on). Tags that are present must match the signature, and one blank line separates the description from the first tag:

```ts
/**
 * Rewrites the tracking parameters of a single link, editing the query string in place.
 *
 * @returns The rewritten link, or null when it is not a link or has nothing to rewrite.
 */
export function rewriteUrl(link: string, options: RewriteOptions): UrlRewrite | null {
```

In `scripts/*.mjs`, which are plain JavaScript, write types inside the tags (`@param {number} [port]`).

## Adding a tracking parameter

Parameters are defined in `src/lib/params.ts`. Pick the narrowest rule that covers the parameter:

- `GLOBAL_PARAMS` or `GLOBAL_PREFIXES` only for names that mean tracking on every site, such as a vendor's click ID. Cite the vendor with a trailing comment.
- A `SITE_RULES` entry for names that are functional somewhere else (`ref`, `source`, `si`, `t`, ...). Add a `path` pattern if the name is functional on other pages of the same site.

Each rule declares a category (`source`, `medium`, `campaign`, `term`, `content`, `generic`, or `id`), which picks the kind of nonsense used in Randomize mode; `id` produces word-salad tokens for opaque identifiers.

Every new rule needs a test in `tests/unit/rewrite.test.ts`: a case under "site-specific tracking" showing the link being cleaned, and, for any name that is ambiguous in general, a case under "functional links stay intact" showing an ordinary link that uses the same name and must not change.

## Adding replacement values

The funny values live in `src/lib/randomizer.ts`, one list per category. Keep them lowercase and hyphenated (letters, digits, hyphens), humorous but not offensive, obviously fake, and free of real company or brand names. New values are recognized as already randomized automatically.

## Submitting changes

1. Create a branch named with a Conventional Commits type, for example `feat/threads-share-params` or `fix/amazon-variant-links`.
2. Write commit messages in the same style: `feat: strip Threads share tracking`, `fix(params): keep Amazon variant selection`.
3. Run `npm run check` and `npm run test:e2e`.
4. If behavior changes, update `README.md` and add an entry to `CHANGELOG.md`.
5. Open a pull request describing what changed and how you tested it.

## Reporting issues

Include your Chrome version, the extension version (shown in the popup), steps to reproduce, the link before and after (remove anything personal), and what you expected instead. For a link that broke after being rewritten, the site's domain and the parameter name are usually enough.
