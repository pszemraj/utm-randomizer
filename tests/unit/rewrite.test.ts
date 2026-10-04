import { describe, expect, it } from 'vitest';
import { hasTrackingParams, rewriteText, rewriteUrl } from '../../src/lib/rewrite';

const decoy = { mode: 'decoy', key: 'test-key' } as const;
const silly = { mode: 'silly', key: 'test-key' } as const;
const strip = { mode: 'strip' } as const;

const SIGNED_LINKS = [
  'https://cdn.example/report.pdf?utm_source=email&Expires=2000000000&Signature=abc%2Bdef&Key-Pair-Id=K123',
  'https://cdn.example/report.pdf?utm_source=email&Policy=abc&Signature=xyz&Key-Pair-Id=K123',
  'https://storage.example/file?utm_source=email&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc',
  'https://storage.example/file?utm_source=email&X-Goog-Credential=account&X-Goog-Signature=abc',
  'https://storage.example/file?utm_source=email&GoogleAccessId=account&Expires=2000000000&Signature=abc',
  'https://storage.example/file?utm_source=email&AWSAccessKeyId=account&Expires=2000000000&Signature=abc',
  'https://storage.example/file?utm_source=email&sv=2025-01-05&sp=r&sr=b&sig=abc%2Bdef',
  'https://storage.example/file?utm_source=email&sv=2025-01-05&si=policy&sr=b&sig=abc%2Bdef',
];

/** Query parameters of an absolute URL. */
function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('rewriteUrl (decoy)', () => {
  it('replaces every standard UTM value with a believable word value', () => {
    const original =
      'https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_term=shoes&utm_content=hero&utm_id=launch2025&utm_source_platform=network&utm_creative_format=video&utm_marketing_tactic=prospecting';
    const result = rewriteUrl(original, decoy);
    expect(result?.params).toBe(9);
    const query = params(result?.url ?? '');
    expect([...query.keys()]).toEqual([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'utm_id',
      'utm_source_platform',
      'utm_creative_format',
      'utm_marketing_tactic',
    ]);
    for (const value of query.values()) {
      expect(value).toMatch(/^[A-Za-z0-9][A-Za-z0-9_. -]*$/);
    }
    for (const [name, value] of params(original)) {
      expect(query.get(name), name).not.toBe(value);
    }
  });

  it('keeps the exact format of click IDs', () => {
    const gclid = 'Cj0KCQjw9-KzBhDVARIsAFLvbqRZQ8x9Xk1_xYz2vT4mW7n8pL0aBcDeFgHiJkLmNoPq_BwE';
    const msclkid = '3f2a9c0b1d4e5f60718293a4b5c6d7e8';
    const result = rewriteUrl(`https://example.com/?gclid=${gclid}&msclkid=${msclkid}&dclid=123456789`, decoy);
    const query = params(result?.url ?? '');
    const fakeGclid = query.get('gclid') ?? '';
    expect(fakeGclid).not.toBe(gclid);
    expect(fakeGclid).toHaveLength(gclid.length);
    expect(fakeGclid.slice(0, 4)).toBe('Cj0K');
    expect(fakeGclid.replace(/[A-Za-z0-9]/g, '')).toBe(gclid.replace(/[A-Za-z0-9]/g, ''));
    expect(query.get('msclkid')).toMatch(/^[0-9a-f]{32}$/);
    expect(query.get('dclid')).toMatch(/^[1-9][0-9]{8}$/);
  });

  it('keeps percent-encoding in replaced values', () => {
    const result = rewriteUrl('https://www.youtube.com/watch?v=x&gclid=ygUEdGVzdA%3D%3D', decoy);
    expect(result?.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=x&gclid=[A-Za-z]{10}%3D%3D$/);
    expect(result?.url).not.toContain('gclid=ygUEdGVzdA');
  });

  it('replaces an encoded non-Latin source without touching other query values', () => {
    const result = rewriteUrl('https://example.com/?utm_source=%E6%96%B0%E9%97%BB&keep=%2F', decoy);
    expect(result?.params).toBe(1);
    expect(result?.url).toMatch(/^https:\/\/example\.com\/\?utm_source=[^&]+&keep=%2F$/);
    expect(result?.url).not.toContain('%E6%96%B0%E9%97%BB');
    expect(rewriteUrl(result?.url ?? '', decoy)?.url).not.toBe(result?.url);
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
    expect(rewriteUrl('https://example.com/?utm_source&utm_medium=&utm_extra=&mtm_extra&hsa_extra=', decoy)).toBeNull();
  });

  it('is deterministic per key and link, and different across keys', () => {
    const link = 'https://example.com/?utm_source=fb&utm_campaign=launch&fbclid=IwAR3xYz123AbC456dEf789';
    expect(rewriteUrl(link, decoy)).toEqual(rewriteUrl(link, decoy));
    const others = new Set(['a', 'b', 'c', 'd', 'e'].map((key) => rewriteUrl(link, { mode: 'decoy', key })?.url));
    expect(others.size).toBeGreaterThan(1);
  });

  it('replaces an existing plausible source on the reported address-bar link', () => {
    const link =
      'https://www.reuters.com/legal/litigation/openai-safety-employee-quits-says-time-trial-error-is-over-2026-10-03/?utm_source=linkedin';
    for (let key = 0; key < 300; key += 1) {
      const result = rewriteUrl(link, { mode: 'decoy', key: String(key) });
      expect(result?.params).toBe(1);
      expect(params(result?.url ?? '').get('utm_source')).not.toBe('linkedin');
      const again = rewriteUrl(result?.url ?? '', { mode: 'decoy', key: String(key) });
      expect(again?.params).toBe(1);
      expect(again?.url).not.toBe(result?.url);
    }
  });

  it('matches encoded keys but keeps their original spelling', () => {
    const result = rewriteUrl('https://example.com/?utm%5Fsource=newsletter&UTM_MEDIUM=email', decoy);
    expect(result?.url).toMatch(/^https:\/\/example\.com\/\?utm%5Fsource=[^&]+&UTM_MEDIUM=[^&]+$/);
  });

  it('handles scheme-less, protocol-relative, and relative links without reshaping them', () => {
    expect(rewriteUrl('www.example.com/p?utm_source=xx', decoy)?.url).toMatch(/^www\.example\.com\/p\?utm_source=/);
    expect(rewriteUrl('example.com?utm_source=xx', decoy)?.url).toMatch(/^example\.com\?utm_source=/);
    expect(rewriteUrl('//example.com/p?utm_source=xx', decoy)?.url).toMatch(/^\/\/example\.com\/p\?utm_source=/);
    expect(rewriteUrl('/watch?v=1&gclid=abcdefgh', { ...decoy, baseUrl: 'https://www.youtube.com/feed' })?.url).toMatch(
      /^\/watch\?v=1&gclid=[a-z]{8}$/,
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

  it('resolves named relative paths only with an originating page', () => {
    const baseUrl = 'https://www.youtube.com/feed';
    for (const path of ['watch', 'folder/watch', 'folder/watch:detail']) {
      const link = `${path}?v=abc&si=secret&gclid=abc123&keep=a%2Fb#part`;
      expect(rewriteUrl(link, { ...strip, baseUrl })?.url).toBe(`${path}?v=abc&si=secret&keep=a%2Fb#part`);
      expect(rewriteUrl(link, strip)).toBeNull();
      expect(rewriteUrl(link, { ...strip, baseUrl: 'https://example.com/' })?.url).toBe(
        `${path}?v=abc&si=secret&keep=a%2Fb#part`,
      );
    }
    expect(rewriteUrl('article?utm_source=email&next=https://example.com', { ...strip, baseUrl })?.url).toBe(
      'article?next=https://example.com',
    );
    for (const link of [
      'mailto:a@example.com?utm_source=x',
      'javascript:alert(1)?utm_source=x',
      'ftp://example.com/?utm_source=x',
    ]) {
      expect(rewriteUrl(link, { ...strip, baseUrl })).toBeNull();
    }
    expect(rewriteText('read more?utm_source=email', { ...strip, baseUrl })).toBeNull();
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

describe('replacing current values', () => {
  it('preserves an unescaped percent sign across replacements', () => {
    const options = { mode: 'decoy', key: '2' } as const;
    const once = rewriteUrl('https://example.com/?utm_campaign=50%off', options);
    expect(once).not.toBeNull();
    expect(once?.url).toMatch(/^https:\/\/example\.com\/\?utm_campaign=[0-9]{2}%of[a-z]$/);
    expect(rewriteUrl(once?.url ?? '', options)?.url).toMatch(
      /^https:\/\/example\.com\/\?utm_campaign=[0-9]{2}%of[a-z]$/,
    );
    expect(rewriteUrl('https://example.com/?coupon=50%off', options)).toBeNull();
  });

  it.each(['decoy', 'hybrid'] as const)('replaces a mixed-case hexadecimal campaign again (%s)', (mode) => {
    for (const raw of ['aB1c1F1b', '%61%42%31%63%31%46%31%62']) {
      const options = { mode, key: 'review0' };
      const once = rewriteUrl(`https://example.com/?utm_campaign=${raw}`, options);
      expect(once).not.toBeNull();
      expect(rewriteUrl(once?.url ?? '', options)?.url).not.toBe(once?.url);
    }
  });

  const links = [
    'https://example.com/?utm_source=fb&utm_medium=social&utm_campaign=2025_launch&fbclid=abc123&gclid=xyz',
    'https://shop.example/p?gclid=Cj0KCQjw9-KzBhDVARIsAFLvbqRZQ8x9Xk1_BwE&utm_term=running+shoes&utm_content=a%20b',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=AbCdEf123456&gclid=ygUEdGVzdA%3D%3D',
    'https://x.com/jack/status/20?s=20&t=AbCdEfGhIjKlMn&twclid=AbCdEf123',
    'https://www.amazon.com/dp/B0ABC/ref=sr_1_1?crid=2X9Z&qid=1700000000&sprefix=usb%2Caps%2C181&sr=8-1&utm_campaign=launch',
    'https://example.com/?_ga=2.123456789.1234567890-1234567890.1700000000&_gl=1*abc12*_ga*MTIzNA..&mc_eid=a1b2c3d4e5&li_fat_id=a1b2c3d4e5',
  ];

  it.each(['decoy', 'silly', 'hybrid', 'strip'] as const)(
    'treats generated tracking values as ordinary input (%s)',
    (mode) => {
      for (const link of links) {
        for (let key = 0; key < 300; key += 1) {
          const once = rewriteUrl(link, { mode, key: String(key) });
          expect(once, link).not.toBeNull();
          const twice = rewriteUrl(once?.url ?? '', { mode, key: String(key) });
          if (mode === 'strip') expect(twice).toBeNull();
          else {
            expect(twice).not.toBeNull();
            expect(twice?.url).not.toBe(once?.url);
          }
        }
      }
    },
  );
});

describe('campaign namespaces', () => {
  it.each(['decoy', 'silly', 'hybrid', 'strip'] as const)(
    'rewrites campaign fields and preserves unrelated bytes (%s)',
    (mode) => {
      const keys = [
        'mtm_campaign',
        'mtm_source',
        'mtm_medium',
        'mtm_keyword',
        'mtm_kwd',
        'mtm_content',
        'mtm_placement',
        'mtm_cid',
        'mtm_group',
        'pk_campaign',
        'pk_cpn',
        'pk_keyword',
        'pk_kwd',
        'piwik_campaign',
        'piwik_kwd',
        'matomo_campaign',
        'matomo_kwd',
        'pk_source',
        'pk_medium',
        'pk_content',
        'pk_cid',
        'hsa_cam',
        'hsa_grp',
        'hsa_ad',
        'hsa_acc',
        'hsa_tgt',
        'hsa_kw',
        'hsa_src',
        'hsa_net',
        'hsa_mt',
        'hsa_ver',
        'utm_penis',
        'utm_penis',
        'UTM%5FUNSEEN',
        'mtm_extra',
        'hsa_extra',
      ];
      const prefix = 'https://example.com/a%20b/?q=a%2fb&pk_abe=checkout&pk_abv=blue&';
      const suffix = '&keep=a+b&flag&empty=#part?utm_source=untouched';
      const link = prefix + keys.map((key) => `${key}=${key === 'utm_penis' ? 'chode' : '12345'}`).join('&') + suffix;
      const result = rewriteUrl(link, { mode, key: 'campaign-test' });
      expect(hasTrackingParams(link)).toBe(true);
      expect(result?.params).toBe(keys.length);
      if (mode === 'strip') {
        expect(result?.url).toBe(prefix.slice(0, -1) + suffix);
        expect(hasTrackingParams(result?.url ?? '')).toBe(false);
      } else {
        expect(result?.url.startsWith(prefix)).toBe(true);
        expect(result?.url.endsWith(suffix)).toBe(true);
        const segments = result?.url.slice(prefix.length, -suffix.length).split('&') ?? [];
        expect(segments.map((segment) => segment.split('=')[0])).toEqual(keys);
        for (const segment of segments) expect(segment.split('=')[1]).not.toMatch(/^(?:12345|chode)$/);
      }
    },
  );
});

describe('rewriteUrl (strip)', () => {
  it('removes tracking parameters and keeps the rest verbatim', () => {
    expect(rewriteUrl('https://example.com/p?id=5&utm_source=x&fbclid=y&b=a,b#top', strip)).toEqual({
      url: 'https://example.com/p?id=5&b=a,b#top',
      params: 2,
    });
  });

  it('drops the question mark only when no query segments remain', () => {
    expect(rewriteUrl('https://example.com/p?utm_source=x&utm_medium#top', strip)?.url).toBe(
      'https://example.com/p#top',
    );
    expect(rewriteUrl('https://youtu.be/dQw4w9WgXcQ?gclid=AbCdEf123', strip)?.url).toBe('https://youtu.be/dQw4w9WgXcQ');
    for (const [query, kept] of [
      ['utm_source=x&', ''],
      ['&utm_source=x', ''],
      ['utm_source=x&&', '&'],
      ['&utm_source=x&', '&'],
    ]) {
      expect(rewriteUrl(`https://example.com/p?${query}#top`, strip)?.url).toBe(`https://example.com/p?${kept}#top`);
    }
  });
});

describe('signed URLs', () => {
  it.each(['decoy', 'silly', 'hybrid', 'strip'] as const)('preserves signed resources in %s mode', (mode) => {
    for (const link of SIGNED_LINKS) {
      expect(rewriteUrl(link, { mode, key: 'signed-key' }), link).toBeNull();
      expect(rewriteText(link, { mode, key: 'signed-key' }), link).toBeNull();
      expect(rewriteText(`Read ${link}`, { mode, key: 'signed-key' }), link).toBeNull();
    }
  });

  it('preserves signed exclusions while allowing ordinary signature-named query parameters', () => {
    for (const link of SIGNED_LINKS) {
      expect(hasTrackingParams(link)).toBe(false);
    }
    expect(
      rewriteUrl('/report?utm_source=email&Signature=abc&Key-Pair-Id=K&Expires=1', {
        ...strip,
        baseUrl: 'https://cdn.example/',
      }),
    ).toBeNull();
    expect(rewriteUrl('https://example.com/?utm_source=email&Signature=abc', strip)?.url).toBe(
      'https://example.com/?Signature=abc',
    );
  });
});

describe('core URL work limits', () => {
  it('bounds direct URL calls', () => {
    const link = `https://example.com/?utm_source=${'x'.repeat(100_000)}`;
    expect(rewriteUrl(link, decoy)).toBeNull();
    expect(rewriteUrl(link, strip)).toBeNull();
  });

  it('processes many tracking parameters within a practical synchronous budget', () => {
    for (const count of [1000, 5000, 10_000]) {
      const link = 'https://example.com/?' + Array.from({ length: count }, () => 'utm_id=x').join('&');
      const started = performance.now();
      const result = rewriteUrl(link, decoy);
      const elapsed = performance.now() - started;
      expect(result?.params).toBe(count);
      expect(elapsed, `${String(count)} parameters took ${String(elapsed)}ms`).toBeLessThan(500);
    }
  });
});

describe('omitted global and former site parameters', () => {
  it.each([
    'https://example.com/?ga_extra=1&itm_extra=2&elqAnything=3&cm_mmcExtra=4&pk_abe=checkout&pk_abv=blue&ref=a&ref=b&empty=&flag#part',
    'https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123456',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&pp=ygUEdGVzdA%3D%3D',
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=8a1b2c',
    'https://x.com/jack/status/20?s=20&t=AbCdEf',
    'https://twitter.com/jack/status/20?s=20&t=AbCdEf',
    'https://www.bing.com/search?q=cats&sp=1&pq=ca&form=QBRE&cvid=abc',
    'https://www.tiktok.com/@scout2015/video/6718335390845095173?lang=en&_t=Ab12&_r=1',
    'https://cgi.ebay.com/ws/eBayISAPI.dll?ViewItem&item=123456789012&_trksid=p123&mkevt=1&mkcid=1',
    'https://www.aliexpress.com/item/1005001234567890.html?algo_pvid=Ab12&aff_trace_key=Cd34#product-description',
    'https://apps.apple.com/us/app/apple-store/id439104108?pt=8668&ct=test123&mt=8&app=messages',
    'https://genome.ch.bbc.co.uk/search/0/20?order=asc&q=%22rock+around+the+clock%22&ns_mchannel=social&ns_source=twitter',
    'https://www.bbc.com/news?ocid=social&ns_campaign=share#main-content',
    'https://www.etsy.com/search?q=ceramic+mug&ref=search_bar&click_key=Ab12&click_sum=Cd34',
    'https://www.imdb.com/search/title/?genres=drama&my_ratings=restrict&ref_=adv&pf_rd_p=Ab12',
    'https://www.walmart.com/search?q=laptop&athbdg=L1100&u1=Ab12',
    'https://player.twitch.tv/?video=v40464143&parent=streamernews.example.com&time=1h2m3s&tt_medium=embed&tt_content=vod',
    'https://www.msn.com/?ocid=share&cvid=Ab12#main',
    'https://www.microsoft.com/en-us/download/details.aspx?id=54616&ocid=affiliate&epi=Ab12',
    'https://www.xbox.com/en-US/games/halo-infinite?ocid=share&nclid=Ab12#overview',
    'https://www.theguardian.com/world?page=2&CMP=share_btn_link',
    'https://www.washingtonpost.com/search/?query=climate&itid=search',
    'https://www.snapchat.com/add/scout2015?share_id=Ab12',
    'https://www.quora.com/search?q=rust&share=1',
    'https://play.google.com/store/apps/details?id=com.google.android.apps.maps&pcampaignid=share&referrer=utm_source%3Demail',
    'https://www.instagram.com/p/C0abc/?igsh=MWt4bXZ2',
    'https://www.reddit.com/r/rust/comments/abc/title/?share_id=Xy12',
    'https://www.linkedin.com/posts/someone_activity-123?rcm=ACoAAB&trk=public_post',
    'https://www.amazon.com/dp/B0ABC/ref=sr_1_1?crid=2X&keywords=usb+cable&qid=1700&sprefix=usb&sr=8-1',
    'https://www.nytimes.com/2025/01/01/us/story.html?unlocked_article_code=1.abc.XYZ&smid=url-share',
    'https://www.google.com/search?q=cats&sca_esv=abc&ei=xyz&ved=0ah&udm=14',
    'https://shop.example/p?srsltid=AfmBOoq&gad_source=1&gad_campaignid=123&id=9',
    'https://example.com/?__hssc=1.1.1&__hstc=abc&__hsfp=9&keep=1',
  ])('preserves %s while cleaning retained parameters', (url) => {
    expect(hasTrackingParams(url)).toBe(false);
    const mixed = url.replace(/(#.*)?$/, '&utm_source=retired_rule_control&fbclid=AbCdEf123$1');
    for (const mode of ['decoy', 'silly', 'hybrid', 'strip'] as const) {
      const options = { mode, key: 'review-key' };
      expect(rewriteUrl(url, options)).toBeNull();
      const rewritten = rewriteUrl(mixed, options);
      expect(rewritten).not.toBeNull();
      expect(rewritten?.params).toBe(2);
      expect(rewritten?.url).not.toContain('utm_source=retired_rule_control');
      expect(rewritten?.url).not.toContain('fbclid=AbCdEf123');
      if (mode === 'strip') expect(rewritten?.url).toBe(url);
      else expect(rewritten?.url.replace(/&utm_source=[^&#]*&fbclid=[^&#]*/, '')).toBe(url);
    }
  });
});

describe('functional links stay intact', () => {
  it.each(['decoy', 'silly', 'hybrid', 'strip'] as const)(
    'preserves TikTok player timestamp controls in %s mode',
    (mode) => {
      // TikTok documents timestamp=0|1 as the playback-time visibility control.
      const options = { mode, key: 'review-key' };
      for (const timestamp of ['0', '1']) {
        const player = `https://www.tiktok.com/player/v1/6718335390845095173?timestamp=${timestamp}&controls=1`;
        expect(rewriteUrl(player, options)).toBeNull();
        expect(hasTrackingParams(player)).toBe(false);
        const rewritten = rewriteUrl(`${player}&ttclid=Ab12`, options)?.url;
        expect(rewritten).toBeDefined();
        expect(rewritten).toContain(`timestamp=${timestamp}&controls=1`);
        expect(rewritten).not.toContain('ttclid=Ab12');
      }
    },
  );

  it.each(['decoy', 'silly', 'hybrid', 'strip'] as const)('preserves Bing Maps collections in %s mode', (mode) => {
    // Microsoft documents sp as the address, pin, or geometry to add to the map.
    const options = { mode, key: 'review-key' };
    for (const path of ['/maps', '/maps/default.aspx']) {
      for (const collection of [
        'point.47.67_-122.12_Office',
        'adr.1%20Microsoft%20Way%2C%20Redmond%2C%20WA%2098052',
        'polyline.47.68_-122.12_48.68_-123.12_LINE',
      ]) {
        const map = `https://www.bing.com${path}?cp=47.67~-122.12&lvl=12&sp=${collection}`;
        expect(rewriteUrl(map, options)).toBeNull();
        expect(hasTrackingParams(map)).toBe(false);
        const rewritten = rewriteUrl(`${map}&utm_source=map_share`, options)?.url;
        expect(rewritten).toBeDefined();
        expect(rewritten).toContain(`cp=47.67~-122.12&lvl=12&sp=${collection}`);
        expect(rewritten).not.toContain('utm_source=map_share');
      }
    }
  });

  it.each(['decoy', 'silly', 'hybrid', 'strip'] as const)('preserves Amazon store selectors in %s mode', (mode) => {
    const options = { mode, key: 'review-key' };
    for (const path of ['/s', '/gp/search']) {
      const store = `https://www.amazon.com${path}?i=appliances&srs=21217039011`;
      expect(rewriteUrl(store, options)).toBeNull();
      expect(hasTrackingParams(store)).toBe(false);
      const rewritten = rewriteUrl(`${store}&utm_source=email`, options)?.url;
      expect(rewritten).toBeDefined();
      expect(rewritten).toContain('i=appliances&srs=21217039011');
      expect(rewritten).not.toContain('utm_source=email');
    }
  });

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
    'https://twitter.com/search?q=rust&f=live',
    'https://medium.com/p/abc?sk=friendlinkkey',
    'https://www.netflix.com/browse?jbv=80057281',
    'https://substack.com/app-link/post?publication_id=1&post_id=2',
  ])('%s', (url) => {
    for (const mode of ['decoy', 'silly', 'hybrid', 'strip'] as const) {
      expect(rewriteUrl(url, { mode, key: 'test-key' })).toBeNull();
    }
    expect(hasTrackingParams(url)).toBe(false);
  });
});

describe('rewriteText', () => {
  it.each([' ', '\t', '\r\n', '\u00a0', '\ufeff', '\u200b', '\u200c', '\u200d'])(
    'rewrites a lone link and removes surrounding whitespace (%j)',
    (whitespace) => {
      const result = rewriteText(whitespace + 'https://example.com/?utm_source=x' + whitespace, strip);
      expect(result).toEqual({ text: 'https://example.com/', urls: 1, params: 1 });
      expect(rewriteText('https://example.com/' + whitespace + '?utm_source=x', strip)).toBeNull();
    },
  );

  it('preserves standalone URL semantics and matches direct URL rewrites', () => {
    for (const link of [
      'https://example.com/?id=42&utm_source=newsletter;',
      'https://example.com/?utm_source=newsletter&keep=one;',
      'https://example.com/?id=42&utm_source=newsletter)',
      'https://example.com/?id=42&utm_source=新聞，速報',
      'https://en.wikipedia.org/wiki/Foo_(bar)?utm_source=x',
      'www.example.com/p?utm_source=x',
      '//example.com/p?utm_source=x',
      '/article?utm_source=x',
      'article?utm_source=x',
    ]) {
      for (const mode of ['decoy', 'silly', 'hybrid', 'strip'] as const) {
        const options = { mode, key: 'test-key', baseUrl: 'https://example.com/page' };
        expect(rewriteText(link, options)?.text).toBe(rewriteUrl(link, options)?.url);
        const once = rewriteUrl(link, options)?.url ?? link;
        if (mode === 'strip') expect(rewriteText(once, options)).toBeNull();
        else expect(rewriteText(once, options)?.text).not.toBe(once);
      }
    }
  });

  it.each([
    '<https://example.com/?utm_source=x>',
    '"https://example.com/?utm_source=x"',
    "'https://example.com/?utm_source=x'",
    '\x60https://example.com/?utm_source=x\x60',
    '(https://example.com/?utm_source=x)',
    '[link](https://example.com/?utm_source=x)',
    '[docs/api](https://example.com/?utm_source=x)',
    '![docs/api](https://example.com/?utm_source=x)',
    'Read this: https://example.com/?utm_source=x',
    'https://example.com/?utm_source=x thanks',
    'https://example.com/?utm_source=x\nhttps://example.com/?utm_source=y',
    'https://example.com/?utm_source=x https://example.com/?utm_source=y',
    'https://example.com/?utm_source=x\tand more',
    '请访问 https://example.com/?utm_source=x，然后继续',
    '詳しくはhttps://example.com/?utm_source=x。次に進む',
    'Read “https://example.com/?utm_source=x”next.',
    '# Report\n\nRead https://example.com/?utm_source=x\n' + 'A paragraph of document text. '.repeat(100),
  ])('leaves non-URL clipboard text untouched (%s)', (text) => {
    for (const mode of ['decoy', 'silly', 'hybrid', 'strip'] as const) {
      const options = { mode, key: 'test-key', baseUrl: 'https://example.com/page' };
      expect(rewriteText(text, options)).toBeNull();
      expect(rewriteUrl(text, options)).toBeNull();
    }
  });

  it('ignores text without tracked links, empty text, and huge text', () => {
    expect(rewriteText('just some words', strip)).toBeNull();
    expect(rewriteText('   ', strip)).toBeNull();
    expect(rewriteText('https://example.com/?id=42', strip)).toBeNull();
    expect(rewriteText(`${' '.repeat(200_000)}https://example.com/?utm_source=x`, strip)).toBeNull();
  });

  it('stays fast on pathological and whitespace-heavy input', () => {
    const started = performance.now();
    rewriteText(`https://example.com/?utm_source=x${')'.repeat(90_000)}`, strip);
    rewriteText(`see https://example.com/?utm_source=x${')'.repeat(90_000)}`, strip);
    rewriteText(`${' '.repeat(90_000)}x`, strip);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
