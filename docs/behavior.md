# Behavior and limits

## Usage

Automatic plain-text rewrites show an **Undo** notification on supported web pages when notifications are enabled. Hovering or keyboard focus keeps the notification open; its countdown resumes after both leave. Undo restores the original clipboard text until different contents are observed; a later fresh copy is cleaned again. A failed restore is reported and does not suppress later copies. Copies with HTML or custom formats have no Undo button.

Explicit actions copy a cleaned link on demand: right-click a link -> **Copy link with decoy tracking**; right-click a page -> **Copy page link with decoy tracking**; and **Alt+Shift+U** or the popup's **Copy this page's link** button for the current page. These actions use the selected mode and still work while automatic cleaning is paused. The shortcut can be changed at `chrome://extensions/shortcuts`.

Every clipboard write, including explicit Copy and Undo, requires Chrome to remain focused. Losing focus cancels pending writes; returning to Chrome does not resume them.

Turning off **Watch browser copies** stops background checks; page copy handling stays active. The counters track rewritten clipboard links in total and in the current browser session. Rich copies include rewritten anchor destinations, counting each link once across its text and HTML representations.

## Replacement values

**Decoy** uses vocabulary and identifier formats from real campaigns:

- sources and mediums from the vocabulary real campaigns use (`bing`, `linkedin`, `newsletter`, `paid_social`, `referral`, ...), including when the original words are percent-encoded or use non-Latin letters;
- campaign names, search terms, and ad placements composed the way marketers write them (`retargeting_2024`, `black_friday_uk_2025`, `best+standing+desk`, `video_15s`);
- click IDs rewritten character by character, keeping their exact length, alphabet, issuer prefix, separators, and percent-encoding (`IwAR3xYz...` stays a plausible `IwAR...` value, a 32-character hex `msclkid` stays 32 hex characters, and mixed-case hex keeps each letter's case).

Each new copy draws a fresh random seed. Matching links share replacements across text and HTML within that copy; copying the same original again draws new values. Random draws can repeat a previous result. Word values and identifiers with replaceable characters get a different value, including when the original is already plausible. Empty values and literal identifier punctuation, including malformed percent sequences such as `%of`, retain their format. A value's presence in the replacement vocabulary does not identify it as previously processed.

**Silly** uses obvious nonsense (`utm_source=carrier-pigeon`, click IDs as word salad). **Hybrid** picks a decoy or nonsense separately for each value, so one link can carry a believable click ID next to a joke source; the mix is shared across the formats of one copy. **Remove** deletes the tracking parameters.

## What gets rewritten

Only these exact names are rewritten, case-insensitively, on every website:

- **UTM campaign fields:** `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `utm_source_platform`, `utm_creative_format`, and `utm_marketing_tactic`.
- **Ad click IDs:** `gclid`, `dclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `ttclid`, `twclid`, and `li_fat_id`.

All other parameters stay untouched. Coverage is deliberately limited: YouTube and Spotify's `si`, X's `s` and `t`, Amazon's `ref` and `qid`, email and affiliate markers such as `mc_eid` and `irclickid`, and unknown fields such as `utm_custom` remain in shared links. Supported UTM fields and click IDs are still rewritten on those sites. There are no site-specific rules or prefix matches. The parameter categories and vendor references are in [`src/lib/params.ts`](../src/lib/params.ts).

Unselected query segments, their order and encoding, fragments, and link forms stay byte-for-byte intact. Scheme-less links such as `www.example.com/page?utm_source=x` are supported. Relative links copied by a page, including named paths such as `article?utm_source=email` and asynchronous text and HTML copies, use the originating frame's URL for parsing and stable replacements and retain their relative form.

Recognized signed CloudFront, AWS, Google Cloud, and Azure links are left unchanged because changing query bytes can invalidate their signatures. Inputs longer than 100,000 characters are not rewritten. A larger previous clipboard value does not prevent cleaning a smaller new copy. Explicit Copy still copies longer links unchanged and accepts replacements that grow beyond that input bound.

Standalone URLs retain trailing punctuation as part of the URL; sentence-punctuation heuristics apply only to links extracted from prose. Embedded candidates containing raw non-ASCII punctuation are left unchanged because their URL boundary is ambiguous. Percent-encoded punctuation remains supported.

### Clipboard formats

Links inside longer plain text can be cleaned, including standalone Markdown links such as `[article](https://example.com/?utm_source=x)`. Rich copies clean anchor destinations and visible URLs in both plain text and HTML while retaining formatting and functional destinations. New HTML targets are checked even when the plain text is unchanged. Automatic writes require a complete inventory containing only plain text and HTML; images, files, and custom formats leave the entire copy unchanged.

## How it works

### Page copies

Content scripts run in every frame, including iframes. Native copy and cut finish before the extension reads and rewrites supported clipboard formats; cuts keep their normal deletion behavior. Open shadow-root text fields are supported when the Clipboard API is available. Page copy handlers retain their original event data. The worker checks browser-window focus before forwarding the clipboard write.

Successful page observations refresh the current clipboard record even when the contents have no rewritable link. Unchanged baseline observations leave the clipboard untouched.

Trusted copy and cut events start short polling after dispatch, including when the page stops propagation or a later handler overwrites the data. Copy controls and link context menus compare the complete payload with a pre-gesture baseline; polling continues if a new copy interrupts that read. On [Chrome 144 and later](https://developer.chrome.com/release-notes/144#the-clipboardchange-event), `clipboardchange` also supplies observations to the focused browser-copy watcher. Typing, pasting, and focus changes do not authorize a copy. Synthetic events and programmatic Undo clicks are ignored. If the Clipboard API is unavailable, as on insecure HTTP pages, automatic copies remain unchanged.

Page addresses remain unchanged on load, navigation, and settings changes. Rewriting a copied page address affects only the clipboard.

### Clipboard coordination

The offscreen document coordinates all clipboard writes. It remains available while automatic cleaning is enabled, even with browser-copy watching off. Pause closes it; explicit copies create it temporarily when needed. Copy/cut events and copy controls invalidate older reads across pages and frames, including when the new copy has identical text. Ordinary typing cancels pending reads in that page without contacting the service worker. Settings changes, Undo, and shutdown also cancel pending page reads and worker reconciliation; pause/resume cannot make an older request valid again. The writer checks current text and formats before committing, and Undo succeeds only after acknowledgement. Clipboard read and write operations are not atomic with arbitrary external apps.

The coordinator retains one current before-and-after record in memory. Repeated observations of its successful output leave the clipboard alone. Observing different text, HTML, or formats discards the old record, even when the new contents have no link. A click, focus change, failed read, or worker restart does not expire completed processing state. Losing Chrome-window focus cancels pending reads and candidates. Successful Undo keeps the restored entry untouched until replacement. Closing the coordinator releases the record; its first read after restarting establishes a baseline. There is no clipboard history or timer that reprocesses unchanged contents.

### Background watching

The background watcher runs only while Chrome is focused, checking every 0.75 seconds. Starting it or returning to Chrome records existing clipboard contents as an untouched baseline. Links copied in another app stay unchanged when you focus Chrome, paste, or load a page. Only subsequent changed payloads with rewritable text or HTML links are staged for inspection; unrelated contents stay in the offscreen document. After a 250 ms grace period, a focused page uses the Clipboard API to inspect the [format inventory](#clipboard-formats): offscreen synthetic paste alone cannot see web custom formats. Without that inspection, no automatic write occurs. Address-bar copies can wait until focus returns to a supported web page; switching straight to another app cancels pending cleaning. Inspection retries after unavailable readers or invalidated reads and waits for supported formats, even if a later copy removes a custom format without changing the text.
