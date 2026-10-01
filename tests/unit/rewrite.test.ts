import { describe, expect, it } from 'vitest';
import { hasTrackingParams, rewriteText, rewriteUrl } from '../../src/lib/rewrite';

const decoy = { mode: 'decoy', key: 'test-key' } as const;
const silly = { mode: 'silly', key: 'test-key' } as const;
const strip = { mode: 'strip' } as const;

/** Query parameters of an absolute URL. */
function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('rewriteUrl (decoy)', () => {
  it('replaces every standard UTM value with a believable word value', () => {
    const original =
      'https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_term=shoes&utm_content=hero';
    const result = rewriteUrl(original, decoy);
    expect(result?.params).toBeGreaterThanOrEqual(4);
    const query = params(result?.url ?? '');
    expect([...query.keys()]).toEqual(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
    for (const value of query.values()) {
      expect(value).toMatch(/^[A-Za-z0-9][A-Za-z0-9_. -]*$/);
    }
  });

  it('keeps the exact format of click IDs', () => {
    const gclid = 'Cj0KCQjw9-KzBhDVARIsAFLvbqRZQ8x9Xk1_xYz2vT4mW7n8pL0aBcDeFgHiJkLmNoPq_BwE';
    const msclkid = '3f2a9c0b1d4e5f60718293a4b5c6d7e8';
    const result = rewriteUrl(`https://example.com/?gclid=${gclid}&msclkid=${msclkid}&_hsmi=123456789`, decoy);
    const query = params(result?.url ?? '');
    const fakeGclid = query.get('gclid') ?? '';
    expect(fakeGclid).not.toBe(gclid);
    expect(fakeGclid).toHaveLength(gclid.length);
    expect(fakeGclid.slice(0, 4)).toBe('Cj0K');
    expect(fakeGclid.replace(/[A-Za-z0-9]/g, '')).toBe(gclid.replace(/[A-Za-z0-9]/g, ''));
    expect(query.get('msclkid')).toMatch(/^[0-9a-f]{32}$/);
    expect(query.get('_hsmi')).toMatch(/^[1-9][0-9]{8}$/);
  });

  it('keeps percent-encoding in replaced values', () => {
    const result = rewriteUrl('https://www.youtube.com/watch?v=x&pp=ygUEdGVzdA%3D%3D', decoy);
    expect(result?.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=x&pp=ygUE[A-Za-z]{6}%3D%3D$/);
  });

  it('only touches tracking values and keeps every other byte', () => {
    const original =
      'https://example.com/a%20b/?q=a,b&redirect=/x/y&utm_source=weekly_digest_42&amp&empty=&sp=a+b&x=%E2%9C%93#frag?utm_medium=x';
    const result = rewriteUrl(original, decoy);
    expect(result).not.toBeNull();
    const [before, after] = original.split('utm_source=weekly_digest_42');
    expect(result?.url.startsWith(`${before ?? ''}utm_source=`)).toBe(true);
    expect(result?.url.endsWith(after ?? '')).toBe(true);
  });

  it('keeps duplicate keys and parameter order', () => {
    const result = rewriteUrl('https://example.com/?tag=a&utm_source=x1&tag=b&utm_source=y2', decoy);
    const keys = [...params(result?.url ?? '').keys()];
    expect(keys).toEqual(['tag', 'utm_source', 'tag', 'utm_source']);
    expect(params(result?.url ?? '').getAll('tag')).toEqual(['a', 'b']);
  });

  it('leaves valueless and empty tracking parameters alone', () => {
    expect(rewriteUrl('https://example.com/?utm_source&utm_medium=', decoy)).toBeNull();
  });

  it('is deterministic per key and link, and different across keys', () => {
    const link = 'https://example.com/?utm_source=fb&utm_campaign=launch&fbclid=IwAR3xYz123AbC456dEf789';
    expect(rewriteUrl(link, decoy)).toEqual(rewriteUrl(link, decoy));
    const others = new Set(['a', 'b', 'c', 'd', 'e'].map((key) => rewriteUrl(link, { mode: 'decoy', key })?.url));
    expect(others.size).toBeGreaterThan(1);
  });

  it('matches encoded keys but keeps their original spelling', () => {
    const result = rewriteUrl('https://example.com/?utm%5Fsource=newsletter&UTM_MEDIUM=email', decoy);
    expect(result?.url).toMatch(/^https:\/\/example\.com\/\?utm%5Fsource=[^&]+&UTM_MEDIUM=[^&]+$/);
  });

  it('handles scheme-less, protocol-relative, and relative links without reshaping them', () => {
    expect(rewriteUrl('www.example.com/p?utm_source=xx', decoy)?.url).toMatch(/^www\.example\.com\/p\?utm_source=/);
    expect(rewriteUrl('example.com?utm_source=xx', decoy)?.url).toMatch(/^example\.com\?utm_source=/);
    expect(rewriteUrl('//example.com/p?utm_source=xx', decoy)?.url).toMatch(/^\/\/example\.com\/p\?utm_source=/);
    expect(rewriteUrl('/watch?v=1&si=abcdefgh', { ...decoy, baseUrl: 'https://www.youtube.com/feed' })?.url).toMatch(
      /^\/watch\?v=1&si=[a-z]{8}$/,
    );
    expect(rewriteUrl('/p?utm_source=xx', decoy)).toBeNull();
  });

  it('ignores non-web links and text', () => {
    for (const input of [
      'mailto:a@example.com?subject=hi&utm_source=x',
      'javascript:alert(1)?utm_source=x',
      'ftp://example.com/?utm_source=x',
      'hello?utm_source=x',
      'https://example.com/#/route?utm_source=x',
      'https://example.com/no-query',
    ]) {
      expect(rewriteUrl(input, decoy), input).toBeNull();
    }
  });
});

describe('rewriteUrl (silly)', () => {
  it('uses obvious nonsense', () => {
    const result = rewriteUrl('https://example.com/?utm_source=newsletter&fbclid=IwAR3abc123', silly);
    const query = params(result?.url ?? '');
    expect(query.get('utm_source')).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
    expect(query.get('fbclid')).toMatch(/^[a-z0-9-]+-[a-z0-9]{4,6}$/);
  });
});

describe('rewriteUrl (hybrid)', () => {
  const link = 'https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale&utm_content=hero';

  it('picks a decoy or nonsense for each value independently, the same way every time', () => {
    const hybridKeys = Array.from({ length: 50 }, (_, key) => String(key));
    let mixed = 0;
    for (const key of hybridKeys) {
      const hybrid = params(rewriteUrl(link, { mode: 'hybrid', key })?.url ?? '');
      const decoyValues = params(rewriteUrl(link, { mode: 'decoy', key })?.url ?? '');
      const sillyValues = params(rewriteUrl(link, { mode: 'silly', key })?.url ?? '');
      const picks = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].map((name) => {
        const value = hybrid.get(name);
        expect([decoyValues.get(name), sillyValues.get(name)], name).toContain(value);
        return value === sillyValues.get(name);
      });
      if (picks.includes(true) && picks.includes(false)) {
        mixed += 1;
      }
      expect(rewriteUrl(link, { mode: 'hybrid', key })?.url).toBe(rewriteUrl(link, { mode: 'hybrid', key })?.url);
    }
    // Four fair picks mix both kinds 7 times in 8; allow plenty of slack.
    expect(mixed).toBeGreaterThan(30);
  });
});

describe('idempotency', () => {
  const links = [
    'https://example.com/?utm_source=fb&utm_medium=social&utm_campaign=2025_launch&fbclid=abc123&gclid=xyz',
    'https://shop.example/p?gclid=Cj0KCQjw9-KzBhDVARIsAFLvbqRZQ8x9Xk1_BwE&utm_term=running+shoes&utm_content=a%20b',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=AbCdEf123456&pp=ygUEdGVzdA%3D%3D',
    'https://x.com/jack/status/20?s=20&t=AbCdEfGhIjKlMn',
    'https://www.amazon.com/dp/B0ABC/ref=sr_1_1?crid=2X9Z&qid=1700000000&sprefix=usb%2Caps%2C181&sr=8-1',
    'https://example.com/?_ga=2.123456789.1234567890-1234567890.1700000000&_gl=1*abc12*_ga*MTIzNA..&mc_eid=a1b2c3d4e5',
  ];

  it.each(['decoy', 'silly', 'hybrid', 'strip'] as const)('rewriting a rewritten link changes nothing (%s)', (mode) => {
    for (const link of links) {
      for (let key = 0; key < 300; key += 1) {
        const once = rewriteUrl(link, { mode, key: String(key) });
        expect(once, link).not.toBeNull();
        expect(rewriteUrl(once?.url ?? '', { mode, key: String(key) }), once?.url).toBeNull();
      }
    }
  });
});

describe('rewriteUrl (strip)', () => {
  it('removes tracking parameters and keeps the rest verbatim', () => {
    expect(rewriteUrl('https://example.com/p?id=5&utm_source=x&fbclid=y&b=a,b#top', strip)).toEqual({
      url: 'https://example.com/p?id=5&b=a,b#top',
      params: 2,
    });
  });

  it('drops the question mark when nothing is left', () => {
    expect(rewriteUrl('https://example.com/p?utm_source=x&utm_medium#top', strip)?.url).toBe(
      'https://example.com/p#top',
    );
    expect(rewriteUrl('https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123', strip)?.url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });
});

describe('site-specific tracking', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123456', 'https://youtu.be/dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&pp=ygUEdGVzdA%3D%3D', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    [
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=8a1b2c',
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    ],
    ['https://x.com/jack/status/20?s=20&t=AbCdEf', 'https://x.com/jack/status/20'],
    ['https://www.instagram.com/p/C0abc/?igsh=MWt4bXZ2', 'https://www.instagram.com/p/C0abc/'],
    [
      'https://www.reddit.com/r/rust/comments/abc/title/?share_id=Xy12&utm_medium=android_app&utm_source=share',
      'https://www.reddit.com/r/rust/comments/abc/title/',
    ],
    [
      'https://www.linkedin.com/posts/someone_activity-123?utm_source=share&rcm=ACoAAB&trk=public_post',
      'https://www.linkedin.com/posts/someone_activity-123',
    ],
    [
      'https://www.amazon.com/dp/B0ABC/ref=sr_1_1?crid=2X&keywords=usb+cable&qid=1700&sprefix=usb&sr=8-1',
      'https://www.amazon.com/dp/B0ABC/ref=sr_1_1?keywords=usb+cable',
    ],
    [
      'https://www.nytimes.com/2025/01/01/us/story.html?unlocked_article_code=1.abc.XYZ&smid=url-share',
      'https://www.nytimes.com/2025/01/01/us/story.html?unlocked_article_code=1.abc.XYZ',
    ],
    [
      'https://www.google.com/search?q=cats&sca_esv=abc&ei=xyz&ved=0ah&udm=14',
      'https://www.google.com/search?q=cats&udm=14',
    ],
    ['https://shop.example/p?srsltid=AfmBOoq&gad_source=1&gad_campaignid=123&id=9', 'https://shop.example/p?id=9'],
    ['https://example.com/?__hssc=1.1.1&__hstc=abc&__hsfp=9&keep=1', 'https://example.com/?keep=1'],
  ])('cleans %s', (input, expected) => {
    expect(rewriteUrl(input, strip)?.url).toBe(expected);
  });
});

describe('functional links stay intact', () => {
  it.each([
    'https://www.youtube.com/results?search_query=lofi+beats',
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123',
    'https://www.linkedin.com/jobs/search/?keywords=python&location=Berlin',
    'https://maps.google.com/?cid=12345678901234567890',
    'https://www.google.com/maps/place/?q=place_id:ChIJ',
    'https://ads.google.com/aw/overview?ocid=123456&__c=987&campaignId=1&adGroupId=2',
    'https://gitlab.com/group/project/-/blob/main/README.md?ref_type=heads',
    'https://api.github.com/repos/o/r/contents/README.md?ref=main',
    'https://www.nytimes.com/2025/01/01/us/story.html?unlocked_article_code=1.abc.XYZ',
    'https://shop.example/orders?tracking_number=1Z999AA10123456784',
    'https://example.com/?search=foo',
    'https://registrar.example.edu/courses?term=fall2025',
    'https://example.com/download?channel=beta',
    'https://explorer.example/tx/0xabc?network=mainnet',
    'https://support.example/?device=iphone-15',
    'https://store.example/?promo=SAVE20',
    'https://cms.example/edit?content_id=42',
    'https://checkout.example/success?session_id=cs_test_123',
    'https://calendar.google.com/calendar/embed?src=en.usa%23holiday%40group.v.calendar.google.com',
    'https://example.com/api?user_id=42',
    'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.com',
    'https://www.amazon.com/dp/B0ABC?th=1&psc=1&smid=A1B2C3&tag=creator-20',
    'https://x.com/search?q=rust&f=live',
    'https://medium.com/p/abc?sk=friendlinkkey',
    'https://www.netflix.com/browse?jbv=80057281',
    'https://substack.com/app-link/post?publication_id=1&post_id=2',
  ])('%s', (url) => {
    expect(rewriteUrl(url, decoy)).toBeNull();
    expect(rewriteUrl(url, silly)).toBeNull();
    expect(rewriteUrl(url, strip)).toBeNull();
    expect(hasTrackingParams(url)).toBe(false);
  });
});

describe('rewriteText', () => {
  it('rewrites a lone link and keeps surrounding whitespace', () => {
    const result = rewriteText('  https://example.com/?utm_source=x\n', strip);
    expect(result).toEqual({ text: '  https://example.com/\n', urls: 1, params: 1 });
  });

  it('keeps wrappers and trailing punctuation around a lone link', () => {
    expect(rewriteText('<https://example.com/?utm_source=x>', strip)?.text).toBe('<https://example.com/>');
    expect(rewriteText('"https://example.com/?a=1&utm_source=x"', strip)?.text).toBe('"https://example.com/?a=1"');
    expect(rewriteText('https://example.com/?a=1&fbclid=x.', strip)?.text).toBe('https://example.com/?a=1.');
  });

  it('only rewrites links inside longer text when allowed', () => {
    const text = 'Read this: https://example.com/a?utm_source=x (and https://example.com/b?id=1&fbclid=y), thanks.';
    expect(rewriteText(text, strip)).toBeNull();
    expect(rewriteText(text, { ...strip, embedded: true })).toEqual({
      text: 'Read this: https://example.com/a (and https://example.com/b?id=1), thanks.',
      urls: 2,
      params: 2,
    });
  });

  it('rewrites a standalone Markdown link when embedded links are allowed', () => {
    const text = '[link](https://example.com/?utm_source=x)';
    expect(rewriteText(text, strip)).toBeNull();
    expect(rewriteText(text, { ...strip, embedded: true })).toEqual({
      text: '[link](https://example.com/)',
      urls: 1,
      params: 1,
    });
  });

  it('ignores text without tracked links, empty text, and huge text', () => {
    expect(rewriteText('just some words', { ...strip, embedded: true })).toBeNull();
    expect(rewriteText('   ', strip)).toBeNull();
    expect(rewriteText(`${' '.repeat(200_000)}https://example.com/?utm_source=x`, strip)).toBeNull();
  });

  it('unwraps parentheses and trims unbalanced closers', () => {
    expect(rewriteText('(https://example.com/?utm_source=x)', strip)?.text).toBe('(https://example.com/)');
    expect(rewriteText('see (https://example.com/?utm_source=x).', { ...strip, embedded: true })?.text).toBe(
      'see (https://example.com/).',
    );
    expect(rewriteText('https://en.wikipedia.org/wiki/Foo_(bar)?utm_source=x', strip)?.text).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    );
  });

  it('stays fast on pathological input', () => {
    const started = performance.now();
    rewriteText(`https://example.com/?utm_source=x${')'.repeat(90_000)}`, strip);
    rewriteText(`see https://example.com/?utm_source=x${')'.repeat(90_000)}`, { ...strip, embedded: true });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('stays fast on whitespace-heavy input', () => {
    const started = performance.now();
    rewriteText(`${' '.repeat(90_000)}x`, { ...strip, embedded: true });
    expect(performance.now() - started).toBeLessThan(500);
  });
});
