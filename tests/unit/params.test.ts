import { describe, expect, it } from 'vitest';
import { classifyParam } from '../../src/lib/params';

describe('classifyParam', () => {
  it('categorizes UTM parameters by suffix', () => {
    expect(classifyParam('utm_source')).toBe('source');
    expect(classifyParam('utm_medium')).toBe('medium');
    expect(classifyParam('utm_campaign')).toBe('campaign');
    expect(classifyParam('utm_term')).toBe('term');
    expect(classifyParam('utm_content')).toBe('content');
    expect(classifyParam('utm_id')).toBe('campaign');
    expect(classifyParam('utm_source_platform')).toBe('generic');
  });

  it('matches case-insensitively', () => {
    expect(classifyParam('UTM_Source')).toBe('source');
    expect(classifyParam('FBCLID')).toBe('id');
    expect(classifyParam('ScCid')).toBe('id');
    expect(classifyParam('hsCtaTracking')).toBe('id');
  });

  it.each([
    'gclid',
    'gbraid',
    'wbraid',
    'dclid',
    'fbclid',
    'msclkid',
    'ttclid',
    'twclid',
    'li_fat_id',
    'igsh',
    'igshid',
    'srsltid',
    '_gl',
    '__hssc',
    '__hstc',
    '__hsfp',
    '_hsenc',
    'mkt_tok',
    'mc_eid',
    'epik',
    'rdt_cid',
    'yclid',
    '_branch_match_id',
  ])('treats %s as tracking everywhere', (key) => {
    expect(classifyParam(key)).not.toBeNull();
  });

  it('matches vendor families by prefix', () => {
    expect(classifyParam('hsa_cam')).toBe('campaign');
    expect(classifyParam('hsa_acc')).toBe('id');
    expect(classifyParam('mtm_kwd')).toBe('term');
    expect(classifyParam('pk_source')).toBe('source');
    expect(classifyParam('elqTrackId')).toBe('id');
    expect(classifyParam('cm_mmc')).toBe('campaign');
  });

  it.each([
    'ref',
    'source',
    'src',
    'campaign',
    'term',
    'content',
    'channel',
    'keywords',
    'search',
    'search_query',
    'cid',
    'si',
    't',
    's',
    'user_id',
    'session_id',
    'instance_id',
    'tracking_number',
    'promo',
    'network',
    'device',
    'unlocked_article_code',
    'ocid',
    'q',
    'id',
  ])('leaves ambiguous parameter %s alone without a site rule', (key) => {
    expect(classifyParam(key, 'example.com', '/')).toBeNull();
  });

  it('applies site rules to the site and its subdomains only', () => {
    expect(classifyParam('si', 'youtu.be', '/abc')).toBe('id');
    expect(classifyParam('si', 'music.youtube.com', '/watch')).toBe('id');
    expect(classifyParam('si', 'open.spotify.com', '/track/1')).toBe('id');
    expect(classifyParam('si', 'notyoutube.com', '/')).toBeNull();
    expect(classifyParam('share_id', 'www.reddit.com', '/r/x/comments/1')).toBe('id');
    expect(classifyParam('smid', 'www.nytimes.com', '/2025/01/01/a.html')).toBe('source');
    expect(classifyParam('smid', 'www.amazon.com', '/dp/B000')).toBeNull();
  });

  it('matches wildcard TLDs', () => {
    expect(classifyParam('pd_rd_w', 'www.amazon.co.uk', '/dp/B000')).toBe('id');
    expect(classifyParam('ref_', 'www.amazon.de', '/dp/B000')).toBe('source');
    expect(classifyParam('qid', 'amazon.com.au', '/dp/B000')).toBe('id');
    expect(classifyParam('qid', 'amazon.example.com', '/dp/B000')).toBeNull();
  });

  it('honors path restrictions', () => {
    expect(classifyParam('t', 'x.com', '/user/status/123')).toBe('id');
    expect(classifyParam('t', 'x.com', '/search')).toBeNull();
    expect(classifyParam('ved', 'www.google.com', '/search')).toBe('id');
    expect(classifyParam('ved', 'www.google.com', '/maps/place/x')).toBeNull();
    expect(classifyParam('cid', 'maps.google.com', '/')).toBeNull();
  });

  it('is not fooled by Object.prototype keys', () => {
    for (const key of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
      'utm_constructor',
      'hsa_constructor',
    ]) {
      const category = classifyParam(key, 'www.youtube.com', '/');
      expect(category === null || typeof category === 'string').toBe(true);
    }
    expect(classifyParam('utm_constructor')).toBe('generic');
    expect(classifyParam('constructor', 'www.youtube.com', '/')).toBeNull();
  });
});
