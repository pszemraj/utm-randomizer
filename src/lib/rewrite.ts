import { paramClassifier } from './params';
import { funnyValue, isAlreadyRandomized } from './randomizer';

/** `randomize` swaps tracking values for nonsense; `strip` removes tracking parameters entirely. */
export type Mode = 'randomize' | 'strip';

/** How to rewrite, and how to interpret relative links. */
export interface RewriteOptions {
  mode: Mode;
  /** Resolves relative links (`/path?utm_source=x`) so site-specific rules can apply. */
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
  /** The full text with every rewritten link substituted in place. */
  text: string;
  /** Number of links that changed. */
  urls: number;
  /** Number of parameters replaced or removed across all links. */
  params: number;
}

const WHITESPACE = /[\s\u200B-\u200D\uFEFF]/;
/** Longer clipboard text is left alone; nobody shares a link inside a novel. */
const MAX_TEXT_LENGTH = 100_000;
const BARE_HOST = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#:]|$)/i;
const EMBEDDED_URL = /\bhttps?:\/\/[^\s<>"'`\u200B-\u200D\uFEFF]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]$/;
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const WRAPPERS: [open: string, close: string][] = [
  ['<', '>'],
  ['(', ')'],
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
];

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
  const attempts: (() => URL)[] = [];
  if (/^https?:\/\//i.test(link)) {
    attempts.push(() => new URL(link));
  } else if (link.startsWith('//')) {
    attempts.push(() => new URL(`https:${link}`));
  } else if (BARE_HOST.test(link)) {
    attempts.push(() => new URL(`https://${link}`));
  } else if (baseUrl && /^(?:\/|\.\.?\/|\?)/.test(link)) {
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

/**
 * Rewrites the tracking parameters of a single link, editing the query string in place so
 * everything else (encoding, parameter order, duplicate keys, valueless flags, fragment, and
 * scheme-less or relative forms) stays byte-for-byte identical.
 *
 * @returns The rewritten link, or null when it is not a link or has nothing to rewrite.
 */
export function rewriteUrl(link: string, options: RewriteOptions): UrlRewrite | null {
  const queryStart = link.indexOf('?');
  const fragmentStart = link.indexOf('#');
  if (queryStart === -1 || (fragmentStart !== -1 && fragmentStart < queryStart)) {
    return null;
  }

  const url = parseLink(link, options.baseUrl);
  if (!url) {
    return null;
  }

  const classify = paramClassifier(url.hostname, url.pathname);
  const queryEnd = fragmentStart === -1 ? link.length : fragmentStart;
  const segments = link.slice(queryStart + 1, queryEnd).split('&');
  const kept: string[] = [];
  let changed = 0;

  for (const segment of segments) {
    const separator = segment.indexOf('=');
    const rawKey = separator === -1 ? segment : segment.slice(0, separator);
    const category = rawKey ? classify(safeDecode(rawKey)) : null;
    if (!category) {
      kept.push(segment);
      continue;
    }

    if (options.mode === 'strip') {
      changed += 1;
      continue;
    }

    const rawValue = separator === -1 ? '' : segment.slice(separator + 1);
    const value = safeDecode(rawValue);
    if (!value || isAlreadyRandomized(value)) {
      kept.push(segment);
      continue;
    }
    kept.push(`${rawKey}=${funnyValue(category, value)}`);
    changed += 1;
  }

  if (changed === 0) {
    return null;
  }

  const query = kept.join('&');
  const head = query ? link.slice(0, queryStart + 1) + query : link.slice(0, queryStart);
  return { url: head + link.slice(queryEnd), params: changed };
}

/** Splits trailing sentence punctuation and unbalanced closing brackets off a matched link. */
function trimLinkEnd(link: string): [link: string, trailing: string] {
  // Closers minus openers per bracket type; a trailing closer is only trimmed while unbalanced.
  const excess = new Map<string, number>();
  for (const [closer, opener] of Object.entries(CLOSERS)) {
    excess.set(closer, link.split(closer).length - link.split(opener).length);
  }
  let end = link.length;
  while (end > 0) {
    const last = link.charAt(end - 1);
    const unbalanced = excess.get(last) ?? 0;
    if (TRAILING_PUNCTUATION.test(last)) {
      end -= 1;
    } else if (unbalanced > 0) {
      excess.set(last, unbalanced - 1);
      end -= 1;
    } else {
      break;
    }
  }
  return [link.slice(0, end), link.slice(end)];
}

/**
 * Rewrites clipboard text. A lone link (optionally wrapped in <>, parentheses, or quotes) may be
 * scheme-less or relative; with `embedded`, absolute http(s) links inside longer text are rewritten too.
 *
 * @returns The rewritten text, or null when nothing changed.
 */
export function rewriteText(text: string, options: RewriteOptions & { embedded?: boolean }): TextRewrite | null {
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
  const core = text.slice(start, end);
  if (!core) {
    return null;
  }

  if (!WHITESPACE.test(core)) {
    const [open, close] = WRAPPERS.find(
      ([opener, closer]) => core.length > 2 && core.startsWith(opener) && core.endsWith(closer),
    ) ?? ['', ''];
    const [link, trailing] = trimLinkEnd(core.slice(open.length, core.length - close.length));
    const rewritten = rewriteUrl(link, options);
    if (!rewritten) {
      return null;
    }
    return {
      text: text.slice(0, start) + open + rewritten.url + trailing + close + text.slice(end),
      urls: 1,
      params: rewritten.params,
    };
  }

  if (!options.embedded) {
    return null;
  }

  let urls = 0;
  let params = 0;
  const result = text.replace(EMBEDDED_URL, (match) => {
    const [link, trailing] = trimLinkEnd(match);
    const rewritten = rewriteUrl(link, options);
    if (!rewritten) {
      return match;
    }
    urls += 1;
    params += rewritten.params;
    return rewritten.url + trailing;
  });
  return urls > 0 ? { text: result, urls, params } : null;
}

/** Whether a link carries parameters this extension would rewrite. */
export function hasTrackingParams(link: string, baseUrl?: string): boolean {
  return rewriteUrl(link, { mode: 'strip', baseUrl }) !== null;
}
