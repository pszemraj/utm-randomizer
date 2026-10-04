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
  /** The single URL without surrounding whitespace. */
  text: string;
  /** Number of links that changed. */
  urls: number;
  /** Number of parameters replaced or removed. */
  params: number;
}

const WHITESPACE = /[\s\u200B-\u200D\uFEFF]/;
/** Bounds synchronous processing of both clipboard text and directly rewritten URLs. */
const MAX_TEXT_LENGTH = 100_000;
const BARE_HOST = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#:]|$)/i;

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
 * Rewrites clipboard text only when the entire trimmed text is one URL.
 * Surrounding whitespace is removed; prose, documents, and wrapped links are left untouched.
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
  const rewritten = rewriteUrl(text.slice(start, end), options);
  return rewritten ? { text: rewritten.url, urls: 1, params: rewritten.params } : null;
}

/** Whether a link carries parameters this extension would rewrite. */
export function hasTrackingParams(link: string, baseUrl?: string): boolean {
  return rewriteUrl(link, { mode: 'strip', baseUrl }) !== null;
}
