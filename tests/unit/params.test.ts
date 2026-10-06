import { describe, expect, it } from 'vitest';
import { classifyParam } from '../../src/lib/params';

describe('classifyParam', () => {
  it('categorizes known UTM fields', () => {
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

  it.each(['utm_penis', 'utm_unknown', 'utm_source_extra', 'mtm_extra', 'hsa_extra', 'utm_constructor'])(
    'uses pooled replacements for additional campaign field %s',
    (key) => {
      expect(classifyParam(key)).toBe('unknown');
      expect(classifyParam(key.toUpperCase())).toBe('unknown');
    },
  );

  it.each([
    ['mtm_campaign', 'campaign'],
    ['mtm_source', 'source'],
    ['mtm_medium', 'medium'],
    ['mtm_keyword', 'term'],
    ['mtm_kwd', 'term'],
    ['mtm_content', 'content'],
    ['mtm_placement', 'content'],
    ['mtm_cid', 'id'],
    ['mtm_group', 'generic'],
    ['pk_campaign', 'campaign'],
    ['pk_cpn', 'campaign'],
    ['pk_keyword', 'term'],
    ['pk_kwd', 'term'],
    ['piwik_campaign', 'campaign'],
    ['piwik_kwd', 'term'],
    ['matomo_campaign', 'campaign'],
    ['matomo_kwd', 'term'],
    ['pk_source', 'source'],
    ['pk_medium', 'medium'],
    ['pk_content', 'content'],
    ['pk_cid', 'id'],
    ['hsa_cam', 'id'],
    ['hsa_grp', 'id'],
    ['hsa_ad', 'id'],
    ['hsa_acc', 'id'],
    ['hsa_tgt', 'id'],
    ['hsa_kw', 'term'],
    ['hsa_src', 'source'],
    ['hsa_net', 'source'],
    ['hsa_mt', 'generic'],
    ['hsa_ver', 'generic'],
  ])('categorizes documented campaign field %s', (key, category) => {
    expect(classifyParam(key)).toBe(category);
    expect(classifyParam(key.toUpperCase())).toBe(category);
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
    'elqTrackId',
    'cm_mmc',
    'int_source',
    'at_link',
  ])('leaves omitted or ambiguous name %s untouched', (key) => {
    expect(classifyParam(key)).toBeNull();
    expect(classifyParam(key.toUpperCase())).toBeNull();
  });

  it.each([
    'utm_',
    'mtm_',
    'hsa_',
    'not_utm_source',
    'utmsource',
    'pk_extra',
    'pk_abe',
    'pk_abv',
    'ga_anything',
    'otm_anything',
    'itm_anything',
    'bsft_anything',
    'elqAnything',
    'cm_mmcAnything',
  ])('does not classify an ambiguous or incomplete name %s', (key) => {
    expect(classifyParam(key)).toBeNull();
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'does not classify Object.prototype-like name %s',
    (key) => {
      expect(classifyParam(key)).toBeNull();
    },
  );
});
