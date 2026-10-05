import { classifyParam } from './params';
import { compactSeed } from './prng';
import { replacementValue } from './values';

/**
 * `decoy` swaps tracking values for believable fakes, `silly` for obvious nonsense, `hybrid` for a
 * per-value mix of the two, and `strip` removes tracking parameters entirely.
 */
export type Mode = 'decoy' | 'silly' | 'hybrid' | 'strip';

/** How to rewrite, and how to interpret relative links. */
export interface RewriteOptions {
  mode: Mode;
  /**
   * Fresh seed supplied by the copy handler and shared across that copy's formats. Writers track
   * completed output separately; plausible tracking values are always eligible inputs.
   */
  key?: string;
  /** Resolves relative links (`/path?utm_source=x`) for parsing and stable replacement seeds. */
  baseUrl?: string;
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
const ABSOLUTE_URL =
  /https?:\/\/[^\s\u200B-\u200D\uFEFF<>"'`\u2018\u2019\u201c\u201d\u3001\uff0c\u3002\uff01\uff1b\uff1a]+/giu;
const TRAILING_PROSE_PUNCTUATION = new Set([
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  '\u3001',
  '\uff0c',
  '\u3002',
  '\uff01',
  '\uff1f',
  '\uff1b',
  '\uff1a',
]);
const BARE_HOST = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#:]|$)/i;

/** Counts visible non-URL prose without making whitespace padding affect classification. */
function countNonWhitespace(text: string): number {
  let count = 0;
  for (const char of text) {
    if (!WHITESPACE.test(char)) count += 1;
  }
  return count;
}

/** Trims punctuation that closes surrounding prose, while retaining balanced URL delimiters. */
function embeddedUrlEnd(text: string, start: number, rawEnd: number): number {
  let end = rawEnd;
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const counts: Record<string, number> = { '(': 0, ')': 0, '[': 0, ']': 0, '{': 0, '}': 0 };
  for (const char of text.slice(start, rawEnd)) {
    if (char in counts) counts[char] = (counts[char] ?? 0) + 1;
  }
  while (end > start) {
    const last = text.charAt(end - 1);
    if (TRAILING_PROSE_PUNCTUATION.has(last)) {
      end -= 1;
      continue;
    }
    const opener = pairs[last];
    if (!opener) break;
    if ((counts[last] ?? 0) <= (counts[opener] ?? 0)) break;
    counts[last] = (counts[last] ?? 0) - 1;
    end -= 1;
  }
  return end;
}

/** Finds bounded absolute web links inside a potential compact share-text payload. */
function absoluteUrlSpans(text: string): { start: number; end: number }[] | null {
  const spans: { start: number; end: number }[] = [];
  ABSOLUTE_URL.lastIndex = 0;
  for (const match of text.matchAll(ABSOLUTE_URL)) {
    const start = match.index;
    const end = embeddedUrlEnd(text, start, start + match[0].length);
    if (end === start) continue;
    spans.push({ start, end });
    if (spans.length > MAX_SHARE_URLS) return null;
  }
  return spans;
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
function parseLink(link: string, baseUrl?: string): URL | null {
  if (!link || WHITESPACE.test(link) || /^[<("'`[{]/.test(link)) {
    return null;
  }
  const attempts: (() => URL)[] = [];
  if (/^https?:\/\//i.test(link)) {
    attempts.push(() => new URL(link));
  } else if (link.startsWith('//')) {
    attempts.push(() => new URL(`https:${link}`));
  } else if (BARE_HOST.test(link)) {
    attempts.push(() => new URL(`https://${link}`));
  } else if (baseUrl && !/^(?:[^/?#]*:|!?\[)/.test(link)) {
    // Named relative paths have no scheme.
    attempts.push(() => new URL(link, baseUrl));
  }

  for (const attempt of attempts) {
    try {
      const url = attempt();
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url;
      }
    } catch {
      // Not a URL.
    }
  }
  return null;
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
 * scheme-less or relative forms) stays byte-for-byte identical.
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

  const url = parseLink(link, options.baseUrl);
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
  const rewritten = rewriteUrl(trimmed, options);
  if (rewritten) return { text: rewritten.url, urls: 1, params: rewritten.params };
  if (parseLink(trimmed, options.baseUrl)) return null;

  const spans = absoluteUrlSpans(text);
  if (!spans || spans.length === 0) return null;
  let urlCharacters = 0;
  let proseCharacters = 0;
  let cursor = 0;
  for (const span of spans) {
    proseCharacters += countNonWhitespace(text.slice(cursor, span.start));
    urlCharacters += span.end - span.start;
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
    const result = rewriteUrl(link, options);
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

/** Whether a link carries parameters this extension would rewrite. */
export function hasTrackingParams(link: string, baseUrl?: string): boolean {
  return rewriteUrl(link, { mode: 'strip', baseUrl }) !== null;
}
