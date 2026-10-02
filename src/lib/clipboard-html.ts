import { rewriteText, rewriteUrl, type RewriteOptions } from './rewrite';

/** Rewrites HTML clipboard links and visible URL text while retaining markup. */
export function rewriteHtml(html: string, options: RewriteOptions): string | null {
  if (html.length > 100_000) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const result = rewriteUrl(anchor.getAttribute('href') ?? '', options);
    if (result) {
      anchor.setAttribute('href', result.url);
      changed = true;
    }
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const result = rewriteText(text.data, { ...options, embedded: true });
    if (result) {
      text.data = result.text;
      changed = true;
    }
  }
  return changed ? doc.head.innerHTML + doc.body.innerHTML : null;
}
