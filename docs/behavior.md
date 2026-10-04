# Behavior and limits

## Usage

A new clipboard entry containing a single URL is processed while Chrome is focused, regardless of which application or page wrote it. The extension replaces supported tracking values using the selected mode, or deletes them in Remove mode. It changes only clipboard contents: page links, addresses, history, and navigation stay unchanged.

Automatic rewrites show a Chrome toolbar indicator when feedback is enabled. The extension does not send system notifications. Use **Undo last rewrite** in the popup to restore the original URL text until different clipboard contents are observed. Undo does not restore accompanying HTML or other formats.

Explicit actions copy a cleaned link on demand: right-click a link -> **Copy link with decoy tracking**; right-click a page -> **Copy page link with decoy tracking**; and **Alt+Shift+U** or the popup's **Copy this page's link** button for the current page. These actions use the selected mode and still work while automatic cleaning is paused. The shortcut can be changed at `chrome://extensions/shortcuts`.

Explicit Copy and Undo require Chrome to be focused. On focus loss, automatic cleaning takes one final clipboard reading and then stops. Returning to Chrome establishes a new untouched baseline.

Pausing cleaning stops automatic clipboard checks; explicit copy actions remain available. Counters track rewritten URLs in total and in the current browser session.

## Replacement values

**Decoy** uses vocabulary and identifier formats from real campaigns:

- sources and mediums from the vocabulary real campaigns use (`bing`, `linkedin`, `newsletter`, `paid_social`, `referral`, ...), including when the original words are percent-encoded or use non-Latin letters;
- campaign names, search terms, and ad placements composed the way marketers write them (`retargeting_2024`, `black_friday_uk_2025`, `best+standing+desk`, `video_15s`);
- click IDs rewritten character by character, keeping their exact length, alphabet, issuer prefix, separators, and percent-encoding (`IwAR3xYz...` stays a plausible `IwAR...` value, a 32-character hex `msclkid` stays 32 hex characters, and mixed-case hex keeps each letter's case).

Each new copy draws a fresh random seed; copying the same original again draws new values. Random draws can repeat a previous result. Word values and identifiers with replaceable characters get a different value, including when the original is already plausible. Empty values and literal identifier punctuation, including malformed percent sequences such as `%of`, retain their format. A value's presence in the replacement vocabulary does not identify it as previously processed.

**Silly** uses obvious nonsense (`utm_source=carrier-pigeon`, click IDs as word salad). **Hybrid** picks a decoy or nonsense separately for each value, so one link can carry a believable click ID next to a joke source. **Remove** deletes the tracking parameters.

## What gets rewritten

The copied text must be one whole URL; surrounding whitespace is stripped when rewriting. Documents, sentences containing URLs, multiple URLs, Markdown links, and HTML link destinations are not processed. A copied hyperlink whose text is only a label stays unchanged; use **Copy link address** to copy its URL.

Only these exact names are rewritten, case-insensitively, on every website:

- **UTM campaign fields:** `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `utm_source_platform`, `utm_creative_format`, and `utm_marketing_tactic`.
- **Ad click IDs:** `gclid`, `dclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `ttclid`, `twclid`, and `li_fat_id`.

All other parameters stay untouched. Coverage is deliberately limited: YouTube and Spotify's `si`, X's `s` and `t`, Amazon's `ref` and `qid`, email and affiliate markers such as `mc_eid` and `irclickid`, and unknown fields such as `utm_custom` remain in shared links. Supported UTM fields and click IDs are still rewritten on those sites. There are no site-specific rules or prefix matches. The parameter categories and vendor references are in [`src/lib/params.ts`](../src/lib/params.ts).

Unselected query segments, their order and encoding, fragments, and link forms stay byte-for-byte intact. Scheme-less links such as `www.example.com/page?utm_source=x` are supported. Relative URLs stay unchanged because clipboard text does not identify the page they came from. Trailing punctuation remains part of a standalone URL.

Recognized signed CloudFront, AWS, Google Cloud, and Azure links are left unchanged because changing query bytes can invalidate their signatures. Inputs longer than 100,000 characters are not rewritten. A larger previous clipboard value does not prevent cleaning a smaller new copy. Explicit Copy still copies longer links unchanged and accepts replacements that grow beyond that input bound.

### Clipboard formats

A rewritten URL is written as plain text. If its copy also included HTML, a URI list, or hidden web-added data, those accompanying formats are discarded. Undo restores only the original URL text. Detectable images, files, and custom non-text formats leave the entire copy unchanged.

These rules apply only when the copied text itself is an eligible URL. Copying a document, image, or ordinary text does not authorize rewriting URLs inside it or changing its formats.

## How it works

### Page copies

The extension does not inject scripts into web pages or intercept copy/cut events. Native page copying, site copy buttons, and browser copies all use the same background clipboard watcher. Copying or cutting keeps the page's normal behavior.

### Clipboard coordination

The offscreen document reads, checks, and writes each eligible clipboard entry synchronously in one tick. Pausing stops polling while keeping the current write record available for Undo. Explicit copies create the document when needed. The service worker starts and stops polling from Chrome-window focus changes. Losing focus triggers a final tick before polling stops. Clipboard operations are not atomic with arbitrary external apps.

The coordinator retains the current successful write and its original URL in memory. It reads back its own output and leaves repeated observations of that output alone. The original URL is not a suppression rule: copying it again draws fresh replacements. Different observed contents replace the current record, even when they contain no URL. Undo writes and records the original text so that the restored entry stays untouched. Closing the coordinator releases the record; its first read after restarting establishes a baseline. There is no clipboard history or timer that reprocesses unchanged contents.

### Background watching

The background watcher checks every 0.2 seconds while Chrome is focused. It handles new clipboard entries from any source. Starting it or returning to Chrome records existing clipboard contents as an untouched baseline; focusing Chrome, pasting, or loading a page does not authorize rewriting that baseline.

Subsequent changed clipboard entries containing one eligible URL are processed on the next check. Reads and writes happen inside the extension and do not require a focused web page: browser controls, an HTTP page, or the address bar can retain focus. Switching to another application triggers a final tick and then stops the watcher. The address bar itself is never changed.

Polling observes contents, not native copy events. Recopying identical contents without an intervening clipboard change cannot be distinguished from leaving the clipboard unchanged, so it does not trigger another rewrite.

Polling and delivery of Chrome's focus events have a short delay. The final tick may therefore observe an entry written just after focus changed but before the extension received that change. It cannot determine which application wrote the entry.
