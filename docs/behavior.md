# Behavior and limits

## Usage

A new clipboard entry containing a URL or compact share text is processed while Chrome is focused, regardless of which application or page wrote it. The extension replaces supported tracking values using the selected mode, or deletes them in Remove mode. It changes only clipboard contents: page links, addresses, history, and navigation stay unchanged.

The only settings are on/off and replacement mode, available through [Chrome's extension options](../README.md#usage). Turning cleaning off stops clipboard checks. On focus loss, automatic cleaning takes one final clipboard reading and then stops. Returning to Chrome establishes a new untouched baseline. After a successful rewrite, a green check briefly appears on the extension icon with the title **Your link was randomized.** It is shown only while Chrome is focused. The extension has no system notifications, toolbar popup, keyboard shortcut, custom copy actions, Undo, or counters.

## Replacement values

**Decoy** uses vocabulary and identifier formats from real campaigns:

- sources and mediums from the vocabulary real campaigns use (`bing`, `linkedin`, `newsletter`, `paid_social`, `referral`, ...), including when the original words are percent-encoded or use non-Latin letters;
- campaign names, search terms, and ad placements composed the way marketers write them (`retargeting_2024`, `black_friday_uk_2025`, `best+standing+desk`, `video_15s`);
- click IDs rewritten character by character, keeping their exact length, alphabet, issuer prefix, separators, and percent-encoding (`IwAR3xYz...` stays a plausible `IwAR...` value, a 32-character hex `msclkid` stays 32 hex characters, and mixed-case hex keeps each letter's case).

Each new copy draws a fresh random seed; copying the same original again draws new values. Random draws can repeat a previous result. Word values and identifiers with replaceable characters get a different value, including when the original is already plausible. Empty values and literal identifier punctuation, including malformed percent sequences such as `%of`, retain their format. A value's presence in the replacement vocabulary does not identify it as previously processed.

**Silly** uses obvious nonsense (`utm_source=carrier-pigeon`, click IDs as word salad). **Hybrid** picks a decoy or nonsense separately for each value, so one link can carry a believable click ID next to a joke source. **Remove** deletes the tracking parameters.

Unrecognized fields in supported campaign namespaces draw a word from the combined existing Decoy or Silly vocabulary; Hybrid chooses between those pools. For example, `utm_penis=chode` gets another word regardless of its original value. There is no inference of a field's meaning or data type. Known fields retain their category-specific replacements.

## What gets rewritten

A copied whole URL is eligible, and surrounding whitespace is stripped when it is rewritten. Compact share text is also eligible: the extension rewrites each supported absolute `http://` or `https://` URL while preserving captions, punctuation, Markdown wrappers, and other surrounding text byte-for-byte.

Embedded URL spans containing raw non-ASCII characters stay untouched because adjacent prose cannot reliably be separated from a URL value. Other eligible spans in the same payload can still be rewritten. Percent-encoded characters remain eligible; standalone URLs retain their documented non-Latin replacement support.

The supported product scope is English-language share text and URLs expressed with ASCII or percent-encoded bytes. Raw-Unicode embedded URL parsing is not a compatibility target; ambiguous spans are skipped instead of accumulating language-specific boundary rules.

The compact-share boundary is deliberately explicit. Up to eight URLs are inspected. Text is eligible when it has at most 280 non-whitespace characters outside its URLs, or when URL characters are at least as numerous as the remaining non-whitespace characters. This covers ordinary share captions and link-heavy lists. Longer prose-dominated copies—such as a README, article, or document where links are a minority—stay entirely untouched. If a payload exceeds the URL-count boundary, it also stays untouched rather than being partially rewritten.

Only absolute web URLs are recognized inside a wrapper. Scheme-less links such as `www.example.com/page?utm_source=x` and protocol-relative links are supported only when the entire trimmed clipboard text is that link. Path-relative forms such as `/page?utm_source=x`, `./page?utm_source=x`, and bare paths without a dotted hostname stay unchanged. A copied hyperlink whose text contains no URL stays unchanged; use **Copy link address** to copy its destination.

Recognition is case-insensitive and applies on every website:

- **Campaign namespaces:** any name beginning with `utm_`, `mtm_` (Matomo), or `hsa_` (HubSpot), followed by a nonempty suffix. Documented fields such as `utm_source`, `mtm_keyword`, and `hsa_cam` have specific replacement categories; unseen fields use the pooled vocabulary.
- **Legacy campaign aliases:** documented `pk_`, `piwik_`, and `matomo_` names, including `pk_campaign` and `piwik_kwd`. These prefixes are not matched broadly; `pk_abe`, `pk_abv`, and unknown `pk_` fields stay untouched.
- **Ad click IDs:** `gclid`, `dclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `ttclid`, `twclid`, and `li_fat_id`.

Other parameters stay untouched, including YouTube and Spotify's `si`, X's `s` and `t`, Amazon's `ref` and `qid`, and email and affiliate markers such as `mc_eid` and `irclickid`. Supported campaign fields and click IDs are still rewritten on those sites. Unseen suffixes are recognized by this extension's policy; that does not mean vendors consume every possible field. There are no site-specific rules. Exact aliases, categories, and vendor references are in [`src/lib/params.ts`](../src/lib/params.ts).

Unselected query segments, their order and encoding, fragments, and link forms stay byte-for-byte intact. Scheme-less standalone links such as `www.example.com/page?utm_source=x` are supported. Text that looks like a dotted scheme-less host, including an ambiguous form such as `index.php?utm_source=x`, is treated as one; other path-relative URLs stay unchanged because clipboard text does not identify the page they came from. Trailing punctuation remains part of a standalone URL.

Recognized signed CloudFront, AWS, Google Cloud, and Azure links are left unchanged because changing query bytes can invalidate their signatures. Inputs longer than 100,000 characters are not rewritten. A larger previous clipboard value does not prevent cleaning a smaller new copy.

### Clipboard formats

A rewritten URL is written as plain text. If its copy also included HTML, a URI list, or hidden web-added data, those accompanying formats are discarded. Detectable images, files, and custom non-text formats leave the entire copy unchanged.

These rules apply only when the copied text is an eligible URL or compact share payload. Copying a long prose-dominated document, image, or ordinary text does not authorize rewriting its URLs or changing its formats.

## How it works

### Page copies

The extension does not inject scripts into web pages or intercept copy/cut events. Native page copying, site copy buttons, and browser copies all use the same background clipboard watcher. Copying or cutting keeps the page's normal behavior.

### Clipboard coordination

The offscreen document reads, checks, and writes each eligible clipboard entry synchronously in one tick. Settings start and stop its focus checks; the service worker supplies the queried Chrome-window focus state. Losing focus triggers a final clipboard tick, then suspends clipboard reads while focus checks continue. Clipboard operations are not atomic with arbitrary external apps.

The coordinator retains the current entry's full text, HTML when present, and format names in memory as a serialized snapshot, including entries that contain no URL. A successful rewrite also retains the output snapshot. It reads back its own output and leaves repeated observations of that output alone. The original URL is not a suppression rule: copying it again draws fresh replacements. Different observed contents replace the current record. Closing the coordinator releases the record; its first read after restarting establishes a baseline. There is no clipboard history or timer that reprocesses unchanged contents.

### Background watching

The background watcher queries Chrome's window focus every 0.2 seconds and checks the clipboard while focused. It handles new clipboard entries from any source. Starting it or returning to Chrome records existing clipboard contents as an untouched baseline; focusing Chrome, pasting, or loading a page does not authorize rewriting that baseline.

Subsequent changed clipboard entries containing eligible URL text are processed on the next check. Reads and writes happen inside the extension and do not require a focused web page: browser controls, an HTTP page, or the address bar can retain focus. Losing Chrome focus triggers a final tick and then stops clipboard reads; focus checks continue to detect its return. Native menus do not stop cleaning when Chrome's window remains focused. The address bar itself is never changed.

Polling observes contents, not native copy events. Recopying identical contents without an intervening clipboard change cannot be distinguished from leaving the clipboard unchanged, so it does not trigger another rewrite.

Polling and delivery of Chrome's focus state have a short delay. The final tick may therefore observe an entry written just after focus changed but before the extension received that change. It cannot determine which application wrote the entry.
