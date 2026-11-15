# Behavior and limits

## Usage

Use [Extension options](../README.md#usage) to choose a [replacement mode](#replacement-values) or pause cleaning. The extension changes only clipboard contents: page links, addresses, history, and navigation stay unchanged.

There are no custom copy actions, Undo, or counters.

## Replacement values

**Decoy** uses vocabulary and identifier formats from real campaigns:

- sources and mediums from the vocabulary real campaigns use (`bing`, `linkedin`, `newsletter`, `paid_social`, `referral`, ...), including when the original words are percent-encoded or use non-Latin letters;
- campaign names, search terms, and ad placements composed the way marketers write them (`retargeting_2024`, `black_friday_uk_2025`, `best+standing+desk`, `video_15s`);
- click IDs rewritten character by character, keeping their exact length, alphabet, issuer prefix, separators, and percent-encoding (`IwAR3xYz...` stays a plausible `IwAR...` value, a 32-character hex `msclkid` stays 32 hex characters, and mixed-case hex keeps each letter's case).

Replacement modes draw a fresh random seed for each new entry; copying the same original again draws new values. Random draws can repeat a previous result. Word values and identifiers with replaceable characters get a different value, including when the original is already plausible. Empty values stay unchanged in replacement modes. Decoy preserves literal identifier punctuation, including malformed percent sequences such as `%of`.

**Silly** uses obvious nonsense (`utm_source=carrier-pigeon`, click IDs as word salad). **Hybrid** picks a decoy or nonsense separately for each value, so one link can carry a believable click ID next to a joke source. **Remove** deletes the tracking parameters.

For unrecognized fields in [supported campaign namespaces](#what-gets-rewritten), Decoy and Silly replace nonempty values with words from their pooled vocabularies; Hybrid chooses between the two pools. For example, `utm_custom=launch` gets another word. There is no inference of a field's meaning or data type. Known fields retain their category-specific replacements.

## What gets rewritten

A copied whole URL is eligible, and surrounding whitespace is stripped when it is rewritten. Compact share text is also eligible: the extension rewrites each supported absolute `http://` or `https://` URL while preserving captions, punctuation, Markdown wrappers, and other surrounding text byte-for-byte.

Embedded links target English-language share text with ASCII or percent-encoded URL bytes. Spans containing raw non-ASCII characters, a raw apostrophe anywhere in the query, or ambiguous raw prose punctuation or opening wrapper delimiters in a tracked query segment stay untouched because adjacent prose cannot reliably be separated from the URL. Periods joining ASCII alphanumeric characters to lowercase letters or digits remain eligible so ordinary dotted sources, hosts, and versions work. Other eligible spans in the same payload can still be rewritten. Standalone URLs support non-Latin word values.

Up to eight URLs are inspected in a share payload. Text is eligible when it has at most 280 non-whitespace characters outside unambiguous URL spans, or when those URL characters are at least as numerous as the remaining non-whitespace characters. Ambiguous spans count as prose. This covers ordinary share captions and link-heavy lists. Longer prose-dominated copies, such as an article where links are a minority, stay untouched. A payload exceeding the URL-count boundary stays untouched rather than being partially rewritten.

- Embedded links must be absolute web URLs. Scheme-less links such as `www.example.com/page?utm_source=x` and protocol-relative links are supported only when the entire trimmed clipboard text is that link. Trailing punctuation remains part of a standalone URL.
- A dotted scheme-less host, including an ambiguous form such as `index.php?utm_source=x`, is treated as a hostname. Path-relative forms such as `/page?utm_source=x`, `./page?utm_source=x`, and bare paths without a dotted hostname stay unchanged because clipboard text does not identify the source page.
- A copied hyperlink whose text contains no URL stays unchanged; use **Copy link address** to copy its destination.

Recognition is case-insensitive and applies on every website:

- **Campaign namespaces:** any name beginning with `utm_`, `mtm_` (Matomo), or `hsa_` (HubSpot), followed by a nonempty suffix. Documented fields such as `utm_source`, `mtm_keyword`, and `hsa_cam` have specific replacement categories; unseen fields use the pooled vocabulary.
- **Legacy campaign aliases:** documented `pk_`, `piwik_`, and `matomo_` names, including `pk_campaign` and `piwik_kwd`. These prefixes are not matched broadly; `pk_abe`, `pk_abv`, and unknown `pk_` fields stay untouched.
- **Ad click IDs:** `gclid`, `dclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `ttclid`, `twclid`, and `li_fat_id`.

Other parameters stay untouched, including YouTube and Spotify's `si`, X's `s` and `t`, Amazon's `ref` and `qid`, and email and affiliate markers such as `mc_eid` and `irclickid`. Supported campaign fields and click IDs are still rewritten on those sites. Unseen suffixes are recognized by this extension's policy; that does not mean vendors consume every possible field. There are no site-specific rules. Exact aliases, categories, and vendor references are in [`src/lib/params.ts`](../src/lib/params.ts).

Unselected query segments, their order and encoding, fragments, and link forms stay byte-for-byte intact.

Recognized signed CloudFront, AWS, Google Cloud, and Azure links are left unchanged because changing query bytes can invalidate their signatures. Inputs longer than 100,000 characters are not rewritten. A larger previous clipboard value does not prevent cleaning a smaller new copy.

### Clipboard formats

A rewritten URL is written as plain text. If its copy also included HTML, a URI list, or hidden web-added data, those accompanying formats are discarded. Detectable images, files, and custom non-text formats leave the entire copy unchanged.

## How it works

### Clipboard coordination

The offscreen document uses text-only reads for ordinary polling and startup or focus-regain baselines, avoiding repeated loading of clipboard images and HTML. A new eligible entry receives a rich-format inspection, another format check immediately before writing, and a read-back after the write. Each tick is synchronous, but clipboard operations are not atomic with arbitrary external apps.

The [current-entry record](../PRIVACY.md#what-the-extension-stores) leaves repeated observations of verified output alone; replacement vocabulary does not identify completed processing. The success indicator appears only after exact read-back. Different observed text replaces or clears the record. Changing mode applies to new entries, including when the current entry has empty tracking values that replacement modes leave unchanged. There is no timer that reprocesses unchanged contents.

An unavailable text-only read waits for a later poll. Once eligible text is observed, failed rich inspections, pre-write safety reads, and write checks share one retry for that entry, then settle it. A different entry observed during a safety read remains eligible for the next tick.

### Background watching

While cleaning is enabled, the offscreen watcher asks the service worker for Chrome's window focus every 0.2 seconds and checks the clipboard while focused. It handles new clipboard entries from any source, including native page copies, site copy buttons, and browser controls. Page copying and cutting keep their normal behavior. Starting the watcher or returning to Chrome records existing clipboard contents as an untouched baseline; focusing Chrome, pasting, or loading a page does not authorize rewriting that baseline. Turning cleaning off stops the watcher.

Subsequent changed clipboard entries containing eligible URL text are processed on the next check. Reads and writes happen inside the extension and do not require a focused web page: browser controls, an HTTP page, or the address bar can retain focus. Losing Chrome focus triggers a final tick and then stops clipboard reads; focus checks continue to detect its return. Native menus do not stop cleaning when Chrome's window remains focused.

Polling observes plain text, not native copy events. Recopying identical text without an intervening text change cannot be distinguished from leaving the clipboard unchanged, so it does not trigger another rewrite. HTML-only or format-only changes with identical text do not trigger cleaning.

Polling and delivery of Chrome's focus state have a short delay. The final tick may therefore observe an entry written just after focus changed but before the extension received that change. It cannot determine which application wrote the entry.
