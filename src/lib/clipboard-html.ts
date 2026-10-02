import { rewriteText, rewriteUrl, type RewriteOptions } from './rewrite';

/** Rewritten HTML and its link count, counting an anchor and its visible URL label only once. */
export interface HtmlRewrite {
  html: string;
  urls: number;
}

/** Rewrites HTML clipboard links and visible URL text while retaining markup. */
export function rewriteHtml(html: string, options: RewriteOptions): HtmlRewrite | null {
  if (html.length > 100_000) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rewrittenAnchors = new Set<Element>();
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const result = rewriteUrl(anchor.getAttribute('href') ?? '', options);
    if (result) {
      anchor.setAttribute('href', result.url);
      rewrittenAnchors.add(anchor);
    }
  }
  let urls = rewrittenAnchors.size;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const result = rewriteText(text.data, { ...options, embedded: true });
    if (result) {
      text.data = result.text;
      const anchor = text.parentElement?.closest('a[href]');
      if (!anchor || !rewrittenAnchors.has(anchor)) urls += result.urls;
    }
  }
  return urls ? { html: doc.head.innerHTML + doc.body.innerHTML, urls } : null;
}
