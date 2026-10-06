import { classifyParam } from './params';
import { compactSeed } from './prng';
import { replacementValue } from './values';

/**
 * `decoy` swaps tracking values for believable fakes, `silly` for obvious nonsense, `hybrid` for a
 * per-value mix of the two, and `strip` removes tracking parameters entirely.
 */
export type Mode = 'decoy' | 'silly' | 'hybrid' | 'strip';

/** How to rewrite tracking values for one clipboard entry. */
export interface RewriteOptions {
  mode: Mode;
  /**
   * Fresh seed supplied by the copy handler and shared across that copy's formats. Writers track
   * completed output separately; plausible tracking values are always eligible inputs.
   */
  key?: string;
}

/** A rewritten link. */
export interface UrlRewrite {
  /** The link with tracking values replaced or removed. */
  url: string;
  /** Number of parameters replaced or removed. */
  params: number;
}

/** Rewritten clipboard text. */
export interface TextRewrite {
  /** Rewritten clipboard text, preserving any accepted share-text wrapper. */
  text: string;
  /** Number of links that changed. */
  urls: number;
  /** Number of parameters replaced or removed. */
  params: number;
}

const WHITESPACE = /[\s\u200B-\u200D\uFEFF]/;
/** Bounds synchronous processing of both clipboard text and directly rewritten URLs. */
const MAX_TEXT_LENGTH = 100_000;
/** Bounds how many links one clipboard observation can make us inspect. */
const MAX_SHARE_URLS = 8;
/** Treats ordinary social captions and link labels as compact share text. */
const MAX_COMPACT_PROSE = 280;
const ABSOLUTE_URL = /https?:\/\/[^\s\u200B-\u200D\uFEFF<>"'`\u2018\u2019\u201c\u201d]+/giu;
const TRAILING_PROSE_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':']);
const BARE_HOST = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#:]|$)/i;

/** Counts visible non-URL prose without making whitespace padding affect classification. */
function countNonWhitespace(text: string): number {
  let count = 0;
  for (const char of text) {
    if (!WHITESPACE.test(char)) count += 1;
  }
  return count;
}

/** Whether an absolute web URL starts at a known character boundary. */
function startsAbsoluteUrl(text: string, start: number): boolean {
  const prefix = text.slice(start, start + 8).toLowerCase();
  return prefix.startsWith('http://') || prefix.startsWith('https://');
}

/** Bounds an embedded URL at its wrapper or next-link separator while retaining functional bytes. */
function embeddedUrlEnd(text: string, start: number, rawEnd: number): number {
  let end = rawEnd;
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const openers: Record<string, number> = { '(': 0, '[': 0, '{': 0 };
  const unmatchedClosers = new Set<number>();
  const outsideWrapper = text.charAt(start - 1);
  let outsideWrapperLength = 0;
  if (outsideWrapper === '*' || outsideWrapper === '_' || outsideWrapper === '~') {
    let index = start - 1;
    while (text.charAt(index) === outsideWrapper) {
      outsideWrapperLength += 1;
      index -= 1;
    }
    if (/[A-Za-z0-9]/.test(text.charAt(index))) outsideWrapperLength = 0;
  }
  let nestedAbsoluteUrl = false;
  for (let index = start; index < rawEnd; index += 1) {
    const char = text.charAt(index);
    if (index > start && (char === 'h' || char === 'H') && startsAbsoluteUrl(text, index)) {
      nestedAbsoluteUrl = true;
    }
    if (char === ',' || char === ';') {
      if (!nestedAbsoluteUrl && startsAbsoluteUrl(text, index + 1)) {
        end = index;
        break;
      }
    }
    if (char in openers) {
      openers[char] = (openers[char] ?? 0) + 1;
      continue;
    }
    const opener = pairs[char];
    if (!opener) continue;
    if ((openers[opener] ?? 0) > 0) {
      openers[opener] = (openers[opener] ?? 0) - 1;
      continue;
    }
    if (outsideWrapper === opener) {
      end = index;
      break;
    }
    unmatchedClosers.add(index);
  }
  while (end > start) {
    const last = text.charAt(end - 1);
    if (TRAILING_PROSE_PUNCTUATION.has(last) || unmatchedClosers.has(end - 1)) {
      end -= 1;
      continue;
    }
    break;
  }
  if (outsideWrapperLength > 0) {
    let trailingWrapperLength = 0;
    let index = end - 1;
    while (text.charAt(index) === outsideWrapper) {
      trailingWrapperLength += 1;
      index -= 1;
    }
    if (trailingWrapperLength === outsideWrapperLength) {
      end -= trailingWrapperLength;
    }
  }
  const trailingProse = /\.{3}and$/i.exec(text.slice(start, end));
  if (trailingProse?.index !== undefined) {
    end = start + trailingProse.index;
  }
  return end;
}

/** Finds bounded absolute web links inside a potential compact share-text payload. */
function absoluteUrlSpans(text: string): { start: number; end: number }[] | null {
  const spans: { start: number; end: number }[] = [];
  ABSOLUTE_URL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ABSOLUTE_URL.exec(text))) {
    const start = match.index;
    const rawEnd = start + match[0].length;
    const end = embeddedUrlEnd(text, start, rawEnd);
    if (end < rawEnd) ABSOLUTE_URL.lastIndex = Math.max(end, start + 1);
    if (end === start) continue;
    spans.push({ start, end });
    if (spans.length > MAX_SHARE_URLS) return null;
  }
  return spans;
}

/** Whether an embedded candidate may contain prose past an uncertain URL boundary. */
function isAmbiguousEmbeddedUrl(text: string, start: number, end: number): boolean {
  const link = text.slice(start, end);
  if (/[^\p{ASCII}]/u.test(link)) return true;

  const queryStart = link.indexOf('?');
  const fragmentStart = link.indexOf('#');
  if (queryStart === -1 || (fragmentStart !== -1 && fragmentStart < queryStart)) return false;
  const queryEnd = fragmentStart === -1 ? link.length : fragmentStart;
  return link
    .slice(queryStart + 1, queryEnd)
    .split('&')
    .some((segment) => {
      const separator = segment.indexOf('=');
      if (separator === -1) return false;
      const rawKey = segment.slice(0, separator);
      const rawValue = segment.slice(separator + 1);
      return classifyParam(safeDecode(rawKey)) !== null && /[,;][A-Za-z]/.test(rawValue);
    });
}

/** Decodes a form-encoded query component, returning the input unchanged when it is malformed. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Parses a link the way a person would read it, to learn its host and path. */
function parseLink(link: string): URL | null {
  if (!link || WHITESPACE.test(link) || /^[<("'`[{]/.test(link)) {
    return null;
  }
  let absolute: string;
  if (/^https?:\/\//i.test(link)) {
    absolute = link;
  } else if (link.startsWith('//')) {
    absolute = `https:${link}`;
  } else if (BARE_HOST.test(link)) {
    absolute = `https://${link}`;
  } else {
    return null;
  }

  try {
    const url = new URL(absolute);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Recognizable signatures that authenticate a URL's query bytes. */
function isSignedUrl(url: URL): boolean {
  const names = new Set([...url.searchParams.keys()].map((name) => name.toLowerCase()));
  return (
    (names.has('signature') && names.has('key-pair-id') && (names.has('expires') || names.has('policy'))) ||
    (names.has('x-amz-signature') && (names.has('x-amz-algorithm') || names.has('x-amz-credential'))) ||
    (names.has('x-goog-signature') && (names.has('x-goog-algorithm') || names.has('x-goog-credential'))) ||
    ((names.has('googleaccessid') || names.has('awsaccesskeyid')) && names.has('signature') && names.has('expires')) ||
    (names.has('sig') &&
      names.has('sv') &&
      (names.has('sp') || names.has('si')) &&
      (names.has('sr') || names.has('ss')))
  );
}

/**
 * Rewrites the tracking parameters of a single link, editing the query string in place so
 * everything else (encoding, parameter order, duplicate keys, valueless flags, fragment, and
 * scheme-less forms) stays byte-for-byte identical.
 *
 * @returns The rewritten link, or null when it is not a link or has nothing to rewrite.
 */
export function rewriteUrl(link: string, options: RewriteOptions): UrlRewrite | null {
  if (link.length > MAX_TEXT_LENGTH) {
    return null;
  }
  const queryStart = link.indexOf('?');
  const fragmentStart = link.indexOf('#');
  if (queryStart === -1 || (fragmentStart !== -1 && fragmentStart < queryStart)) {
    return null;
  }

  const url = parseLink(link);
  if (!url || isSignedUrl(url)) {
    return null;
  }

  const queryEnd = fragmentStart === -1 ? link.length : fragmentStart;
  const segments = link
    .slice(queryStart + 1, queryEnd)
    .split('&')
    .map((segment) => {
      const separator = segment.indexOf('=');
      const rawKey = separator === -1 ? segment : segment.slice(0, separator);
      return {
        segment,
        rawKey,
        rawValue: separator === -1 ? '' : segment.slice(separator + 1),
        category: rawKey ? classifyParam(safeDecode(rawKey)) : null,
      };
    });

  // Compact the link context once; each value then seeds its own draw without hashing the full link again.
  const untouched = segments.filter(({ category }) => !category).map(({ segment }) => segment);
  const trackingKeys = segments.filter(({ category }) => category).map(({ rawKey }) => rawKey);
  const seedBase = [options.key ?? '', url.host, url.pathname, untouched.join('&'), trackingKeys.join('&')].join('|');
  const linkSeed = compactSeed(seedBase);

  const kept: string[] = [];
  let changed = 0;
  let index = 0;
  for (const { segment, rawKey, rawValue, category } of segments) {
    if (!category) {
      kept.push(segment);
      continue;
    }
    index += 1;
    if (options.mode === 'strip') {
      changed += 1;
      continue;
    }
    if (!rawValue) {
      kept.push(segment);
      continue;
    }
    const replacement = replacementValue(options.mode, category, rawValue, `${linkSeed}|${String(index)}`);
    kept.push(`${rawKey}=${replacement}`);
    if (replacement !== rawValue) {
      changed += 1;
    }
  }

  if (changed === 0) {
    return null;
  }

  const query = kept.join('&');
  const head = kept.length > 0 ? link.slice(0, queryStart + 1) + query : link.slice(0, queryStart);
  return { url: head + link.slice(queryEnd), params: changed };
}

/**
 * Rewrites a whole URL or the absolute URLs in compact or link-dense share text. Surrounding
 * whitespace is removed from a lone URL; accepted wrappers stay byte-for-byte identical. Long,
 * prose-dominated documents and payloads with too many links are left untouched.
 *
 * @returns The rewritten text, or null when nothing changed.
 */
export function rewriteText(text: string, options: RewriteOptions): TextRewrite | null {
  if (text.length > MAX_TEXT_LENGTH) {
    return null;
  }
  let start = 0;
  let end = text.length;
  while (start < end && WHITESPACE.test(text.charAt(start))) {
    start += 1;
  }
  while (end > start && WHITESPACE.test(text.charAt(end - 1))) {
    end -= 1;
  }
  const trimmed = text.slice(start, end);
  const trimmedSpans = absoluteUrlSpans(trimmed);
  const firstFragment = trimmed.indexOf('#');
  const hasAdjacentUrls =
    trimmedSpans !== null &&
    trimmedSpans.length > 1 &&
    (firstFragment === -1 || (trimmedSpans[0]?.end ?? trimmed.length) < firstFragment);
  if (trimmedSpans && !hasAdjacentUrls) {
    const rewritten = rewriteUrl(trimmed, options);
    if (rewritten) return { text: rewritten.url, urls: 1, params: rewritten.params };
    if (parseLink(trimmed)) return null;
  }

  const spans = absoluteUrlSpans(text);
  if (!spans || spans.length === 0) return null;
  let urlCharacters = 0;
  let proseCharacters = 0;
  let cursor = 0;
  for (const span of spans) {
    proseCharacters += countNonWhitespace(text.slice(cursor, span.start));
    if (isAmbiguousEmbeddedUrl(text, span.start, span.end)) {
      proseCharacters += countNonWhitespace(text.slice(span.start, span.end));
    } else {
      urlCharacters += span.end - span.start;
    }
    cursor = span.end;
  }
  proseCharacters += countNonWhitespace(text.slice(cursor));
  if (proseCharacters > MAX_COMPACT_PROSE && urlCharacters < proseCharacters) return null;

  let output = '';
  let urls = 0;
  let params = 0;
  cursor = 0;
  for (const span of spans) {
    output += text.slice(cursor, span.start);
    const link = text.slice(span.start, span.end);
    // Raw Unicode may be adjoining caption text; its boundary cannot be inferred safely.
    const result = isAmbiguousEmbeddedUrl(text, span.start, span.end) ? null : rewriteUrl(link, options);
    output += result?.url ?? link;
    if (result) {
      urls += 1;
      params += result.params;
    }
    cursor = span.end;
  }
  output += text.slice(cursor);
  return urls > 0 ? { text: output, urls, params } : null;
}
