import { describe, expect, it } from 'vitest';
import { classifyParam } from '../../src/lib/params';

describe('classifyParam', () => {
  it('categorizes the exact UTM allowlist', () => {
    expect(classifyParam('utm_source')).toBe('source');
    expect(classifyParam('utm_medium')).toBe('medium');
    expect(classifyParam('utm_campaign')).toBe('campaign');
    expect(classifyParam('utm_term')).toBe('term');
    expect(classifyParam('utm_content')).toBe('content');
    expect(classifyParam('utm_id')).toBe('campaign');
    for (const key of ['utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic']) {
      expect(classifyParam(key)).toBe('generic');
    }
  });

  it('matches allowlisted names case-insensitively', () => {
    expect(classifyParam('UTM_Source')).toBe('source');
    expect(classifyParam('FBCLID')).toBe('id');
    expect(classifyParam('MsClKiD')).toBe('id');
  });

  it.each(['gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', 'twclid', 'li_fat_id'])(
    'categorizes retained click ID %s',
    (key) => {
      expect(classifyParam(key)).toBe('id');
    },
  );

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
    'timestamp',
    'pp',
    'qid',
    'sp',
    'smid',
    'pt',
    'ct',
    'email_token',
    'midtoken',
    'otptoken',
    'igsh',
    'igshid',
    'srsltid',
    '_ga',
    '_gl',
    '__hssc',
    '__hstc',
    '__hsfp',
    '_hsenc',
    '_hsmi',
    'hsCtaTracking',
    'mkt_tok',
    'mc_eid',
    'epik',
    'rdt_cid',
    'yclid',
    '_branch_match_id',
    'guce_referrer_sig',
    'tracking_source',
    'action_type_map',
    'spm',
    'hsa_cam',
    'hsa_acc',
    'mtm_kwd',
    'pk_source',
    'elqTrackId',
    'cm_mmc',
    'int_source',
    'at_link',
  ])('leaves omitted or ambiguous name %s untouched', (key) => {
    expect(classifyParam(key)).toBeNull();
    expect(classifyParam(key.toUpperCase())).toBeNull();
  });

  it.each([
    'utm_unknown',
    'utm_source_extra',
    'utm_',
    'ga_anything',
    'mtm_anything',
    'otm_anything',
    'itm_anything',
    'hsa_anything',
    'bsft_anything',
    'elqAnything',
    'cm_mmcAnything',
  ])('does not expand a prefix into %s', (key) => {
    expect(classifyParam(key)).toBeNull();
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'utm_constructor', 'hsa_constructor'])(
    'does not classify Object.prototype-like name %s',
    (key) => {
      expect(classifyParam(key)).toBeNull();
    },
  );
});
