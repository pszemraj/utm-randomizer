/**
 * Which query parameters count as tracking, and what kind of value each one carries.
 *
 * Only names that are unambiguously used for tracking are matched on every site. Names that are
 * also used functionally somewhere (`ref`, `source`, `src`, `campaign`, `keywords`, `cid`, `si`,
 * `t`, ...) are matched only on the sites where their meaning is known, so copying a YouTube
 * search, a Google Maps place, or a GitLab file link never breaks it.
 *
 * Sources: vendor documentation, the AdGuard URL Tracking filter, uBlock Origin's
 * privacy-removeparam list, ClearURLs rules, and Firefox query stripping.
 */

/** The kind of value a parameter carries; picks the kind of replacement value. */
export type Category = 'source' | 'medium' | 'campaign' | 'term' | 'content' | 'generic' | 'id';

// Shared suffix vocabulary of analytics parameter families (utm_source, pk_kwd, mtm_cid, ...).
const SUFFIX_CATEGORIES = new Map<string, Category>([
  ['source', 'source'],
  ['src', 'source'],
  ['referrer', 'source'],
  ['medium', 'medium'],
  ['campaign', 'campaign'],
  ['name', 'campaign'],
  ['id', 'campaign'],
  ['cid', 'campaign'],
  ['term', 'term'],
  ['keyword', 'term'],
  ['kwd', 'term'],
  ['content', 'content'],
]);

/** Category for the part of a family parameter after its prefix, e.g. `source` in `utm_source`. */
function bySuffix(suffix: string): Category {
  return SUFFIX_CATEGORIES.get(suffix) ?? 'generic';
}

/** Exact entries for a parameter family, e.g. `family('pk_', ['source'])` gives `pk_source`. */
function family(prefix: string, suffixes: string[]): [string, Category][] {
  return suffixes.map((suffix) => [`${prefix}${suffix}`, bySuffix(suffix)]);
}

// HubSpot ads (hsa_*) use their own abbreviations.
const HUBSPOT_ADS = new Map<string, Category>([
  ['src', 'source'],
  ['mt', 'medium'],
  ['cam', 'campaign'],
  ['kw', 'term'],
  ['ad', 'content'],
]);

/** Parameter families matched on every site by prefix. */
const GLOBAL_PREFIXES: [prefix: string, categorize: (suffix: string) => Category][] = [
  ['utm_', bySuffix], // Urchin / Google Analytics and practically everyone else
  ['ga_', bySuffix], // legacy Google Analytics
  ['mtm_', bySuffix], // Matomo
  ['otm_', bySuffix], // Opentracker
  ['itm_', bySuffix], // internal tracking (itm_source, ...)
  ['hsa_', (suffix) => HUBSPOT_ADS.get(suffix) ?? 'id'], // HubSpot ads
  ['bsft_', () => 'id'], // Blueshift
  ['elq', () => 'id'], // Oracle Eloqua (elq, elqTrackId, elqCampaignId, ...)
  ['cm_mmc', () => 'campaign'], // IBM Digital Analytics
];

/** Exact parameter names matched on every site (lowercase). */
const GLOBAL_PARAMS = new Map<string, Category>([
  // Google Ads, Analytics, Merchant Center
  ['gclid', 'id'],
  ['gclsrc', 'generic'],
  ['dclid', 'id'],
  ['gbraid', 'id'],
  ['wbraid', 'id'],
  ['gad_source', 'source'],
  ['gad_campaignid', 'campaign'],
  ['srsltid', 'id'],
  ['_ga', 'id'],
  ['_gl', 'id'],
  // Meta (Facebook, Instagram)
  ['fbclid', 'id'],
  ['fbadid', 'id'],
  ['mibextid', 'id'],
  ['igshid', 'id'],
  ['igsh', 'id'],
  ['fb_action_ids', 'id'],
  ['fb_action_types', 'generic'],
  ['fb_ref', 'source'],
  ['fb_source', 'source'],
  ['action_object_map', 'id'],
  ['action_type_map', 'generic'],
  ['action_ref_map', 'generic'],
  // Click IDs of other ad platforms
  ['msclkid', 'id'], // Microsoft Advertising
  ['twclid', 'id'], // X / Twitter
  ['__twitter_impression', 'generic'],
  ['ttclid', 'id'], // TikTok
  ['li_fat_id', 'id'], // LinkedIn
  ['epik', 'id'], // Pinterest
  ['sccid', 'id'], // Snapchat
  ['rdt_cid', 'id'], // Reddit
  ['yclid', 'id'], // Yandex
  ['ysclid', 'id'],
  ['_openstat', 'id'],
  ['tgclid', 'id'], // Telegram
  // Email and marketing automation
  ['mc_cid', 'campaign'], // Mailchimp
  ['mc_eid', 'id'],
  ['mc_tc', 'generic'],
  ['_hsenc', 'id'], // HubSpot
  ['_hsmi', 'id'],
  ['__hssc', 'id'],
  ['__hstc', 'id'],
  ['__hsfp', 'id'],
  ['hsctatracking', 'id'],
  ['mkt_tok', 'id'], // Marketo
  ['oly_anon_id', 'id'], // Omeda
  ['oly_enc_id', 'id'],
  ['vero_id', 'id'], // Vero
  ['vero_conv', 'id'],
  ['ml_subscriber', 'id'], // MailerLite
  ['ml_subscriber_hash', 'id'],
  ['ck_subscriber_id', 'id'], // Kit (ConvertKit)
  ['_kx', 'id'], // Klaviyo
  ['vgo_ee', 'id'], // ActiveCampaign
  ['sms_click', 'id'], // Attentive
  ['sms_source', 'source'],
  ['sms_uph', 'id'],
  ['trk_contact', 'id'], // Listrak
  ['trk_msg', 'id'],
  ['trk_module', 'generic'],
  ['trk_sid', 'id'],
  ['wickedid', 'id'], // Wicked Reports
  ['hmb_campaign', 'campaign'],
  ['hmb_medium', 'medium'],
  ['hmb_source', 'source'],
  ['os_ehash', 'id'],
  ['tracking_source', 'source'],
  ['echobox', 'generic'],
  // Adobe, Webtrends, AT Internet, and internal campaign codes
  ['s_cid', 'campaign'],
  ['s_kwcid', 'id'],
  ['ef_id', 'id'],
  ['adobe_mc_ref', 'id'],
  ['adobe_mc_sdid', 'id'],
  ['wt_mc', 'campaign'],
  ['wt_zmc', 'campaign'],
  ['xtor', 'campaign'],
  ['icid', 'campaign'],
  ['ncid', 'campaign'],
  ['cmpid', 'campaign'],
  ['emc', 'campaign'],
  ['spm', 'id'],
  ['referringsource', 'source'],
  ['referring_source', 'source'],
  ['guccounter', 'generic'], // Yahoo consent redirect
  ['guce_referrer', 'id'],
  ['guce_referrer_sig', 'id'],
  ...family('pk_', ['source', 'medium', 'campaign', 'kwd', 'keyword', 'content', 'cid']), // Matomo / Piwik
  ['pk_vid', 'id'],
  ...family('piwik_', ['campaign', 'kwd', 'keyword']),
  ...family('matomo_', ['source', 'medium', 'campaign', 'keyword', 'content', 'cid', 'group', 'placement']),
  ...family('int_', ['source', 'medium', 'campaign', 'term', 'content']),
  ...family('at_', [
    'medium',
    'campaign',
    'campaign_type',
    'creation',
    'emailtype',
    'link',
    'link_id',
    'link_origin',
    'link_type',
    'ptr_name',
    'recipient_id',
    'recipient_list',
    'send_date',
  ]),
  // Affiliate networks
  ['irclickid', 'id'], // Impact
  ['irgwc', 'id'],
  ['ir_campaignid', 'campaign'],
  ['ir_adid', 'id'],
  ['ir_partnerid', 'id'],
  ['cjevent', 'id'], // CJ
  ['cjdata', 'id'],
  ['awc', 'id'], // Awin
  ['ranmid', 'id'], // Rakuten Advertising
  ['raneaid', 'id'],
  ['ransiteid', 'id'],
  ['rb_clickid', 'id'],
  ['tduid', 'id'], // Tradedoubler
  ['sscid', 'id'], // ShareASale
  ['_branch_match_id', 'id'], // Branch
  ['_branch_referrer', 'id'],
]);

/** Parameters that are tracking only on particular sites. */
interface SiteRule {
  /** `example.com` matches the domain and its subdomains; `example.*` matches any TLD, e.g. example.co.uk. */
  hosts: string[];
  /** Only apply on matching paths. */
  path?: RegExp;
  /** Exact parameter names (lowercase) and their categories. */
  params: Record<string, Category>;
  /** Parameter name prefixes (lowercase) and their categories. */
  prefixes?: Record<string, Category>;
}

const SITE_RULES: SiteRule[] = [
  {
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'youtubekids.com'],
    params: {
      si: 'id',
      pp: 'id',
      feature: 'source',
      embeds_referring_euri: 'source',
      embeds_referring_origin: 'source',
      source_ve_path: 'id',
    },
  },
  { hosts: ['spotify.com'], params: { si: 'id', sp_cid: 'id', dlsi: 'id', pi: 'id', referral: 'source' } },
  {
    hosts: ['x.com', 'twitter.com'],
    params: { s: 'source', src: 'source', ref_src: 'source', refsrc: 'source', ref_url: 'source', cxt: 'id', cn: 'id' },
  },
  { hosts: ['x.com', 'twitter.com'], path: /\/status\//, params: { t: 'id' } },
  { hosts: ['instagram.com', 'threads.net', 'threads.com'], params: { ig_rid: 'id', xmt: 'id' } },
  {
    hosts: ['facebook.com', 'fb.com', 'fb.watch'],
    params: {
      ref: 'source',
      fref: 'source',
      rdid: 'id',
      extid: 'id',
      sfnsn: 'generic',
      hc_ref: 'source',
      hc_location: 'generic',
      __tn__: 'generic',
      comment_tracking: 'id',
      eav: 'id',
      paipv: 'generic',
      wtsid: 'id',
      rdc: 'generic',
      rdr: 'generic',
      _rdr: 'generic',
    },
    prefixes: { __cft__: 'id', __xts__: 'id' },
  },
  {
    hosts: ['reddit.com'],
    params: {
      share_id: 'id',
      ref: 'source',
      ref_source: 'source',
      ref_campaign: 'campaign',
      rdt: 'id',
      correlation_id: 'id',
      post_index: 'generic',
      post_fullname: 'id',
      $deep_link: 'generic',
      $3p: 'generic',
      $original_url: 'generic',
    },
  },
  {
    hosts: ['linkedin.com'],
    params: {
      trackingid: 'id',
      refid: 'id',
      lipi: 'id',
      rcm: 'id',
      lici: 'id',
      midtoken: 'id',
      midsig: 'id',
      otptoken: 'id',
      original_referer: 'source',
      originalreferer: 'source',
    },
    prefixes: { trk: 'source' },
  },
  {
    hosts: ['tiktok.com'],
    params: {
      _r: 'generic',
      _t: 'id',
      _d: 'id',
      u_code: 'id',
      share_app_id: 'id',
      share_app_name: 'source',
      share_iid: 'id',
      share_link_id: 'id',
      share_author_id: 'id',
      share_region: 'generic',
      social_share_type: 'generic',
      sender_device: 'generic',
      sender_web_id: 'id',
      is_from_webapp: 'generic',
      is_copy_url: 'generic',
      tt_from: 'source',
      web_id: 'id',
      sec_user_id: 'id',
      sec_uid: 'id',
      user_id: 'id',
      embed_source: 'source',
      referer_url: 'source',
      referer_video_id: 'id',
      refer: 'source',
      enter_method: 'generic',
      ug_btm: 'generic',
      trackparams: 'id',
      preview_pb: 'generic',
      timestamp: 'generic',
      source: 'source',
    },
  },
  {
    hosts: ['amazon.*'],
    params: {
      ref: 'source',
      ref_: 'source',
      refrid: 'id',
      qid: 'id',
      sr: 'generic',
      srs: 'generic',
      sprefix: 'term',
      crid: 'id',
      linkcode: 'generic',
      linkid: 'id',
      ascsubtag: 'id',
      asc_campaign: 'campaign',
      asc_refurl: 'source',
      asc_source: 'source',
      creativeasin: 'id',
      creative: 'content',
      camp: 'campaign',
      'content-id': 'id',
      dib: 'id',
      dib_tag: 'generic',
      _encoding: 'generic',
      social_share: 'source',
      spia: 'id',
      aaxitk: 'id',
      hsa_cr_id: 'id',
      dchild: 'generic',
      rnid: 'id',
    },
    prefixes: { pd_rd_: 'id', pf_rd_: 'id', cv_ct_: 'id', 'sb-ci-': 'id' },
  },
  {
    hosts: ['google.*'],
    path: /^\/(?:search|webhp|imgres)?\/?$/,
    params: {
      ved: 'id',
      ei: 'id',
      sei: 'id',
      sca_esv: 'id',
      sca_upv: 'id',
      sxsrf: 'id',
      oq: 'term',
      aqs: 'id',
      iflsig: 'id',
      uact: 'generic',
      sclient: 'source',
      sourceid: 'source',
      source: 'source',
      sa: 'generic',
      rlz: 'id',
      fbs: 'id',
      ictx: 'generic',
      cshid: 'id',
      uds: 'id',
      sstk: 'id',
      biw: 'generic',
      bih: 'generic',
      dpr: 'generic',
    },
    prefixes: { gs_: 'id' },
  },
  { hosts: ['play.google.com'], params: { pcampaignid: 'campaign', referrer: 'source' } },
  {
    hosts: ['bing.com'],
    params: {
      cvid: 'id',
      form: 'source',
      sk: 'generic',
      sp: 'generic',
      sc: 'generic',
      qs: 'generic',
      qp: 'generic',
      pq: 'term',
    },
  },
  { hosts: ['msn.com', 'microsoft.com', 'xbox.com'], params: { ocid: 'campaign', cvid: 'id', nclid: 'id', epi: 'id' } },
  {
    hosts: ['bbc.com', 'bbc.co.uk'],
    params: {
      ocid: 'campaign',
      ns_mchannel: 'medium',
      ns_source: 'source',
      ns_campaign: 'campaign',
      ns_linkname: 'content',
      ns_fee: 'generic',
      facebook_page: 'source',
      at_bbc_team: 'generic',
    },
  },
  {
    // Deliberately not unlocked_article_code: that is what makes a gift link work.
    hosts: ['nytimes.com'],
    params: {
      smid: 'source',
      nl: 'campaign',
      regi_id: 'id',
      segment_id: 'id',
      user_id: 'id',
      instance_id: 'id',
      campaign_id: 'campaign',
      impression_id: 'id',
      sgrp: 'generic',
      pgtype: 'generic',
      te: 'generic',
    },
  },
  { hosts: ['theguardian.com'], params: { cmp: 'campaign' } },
  { hosts: ['washingtonpost.com'], params: { itid: 'campaign' } },
  { hosts: ['medium.com'], params: { source: 'source' } },
  { hosts: ['substack.com'], params: { r: 'id', triedredirect: 'generic', isfreemail: 'generic' } },
  { hosts: ['etsy.com'], params: { click_key: 'id', click_sum: 'id', ref: 'source', organic_search_click: 'generic' } },
  {
    hosts: ['ebay.*'],
    params: {
      _trkparms: 'id',
      _trksid: 'id',
      _from: 'source',
      hash: 'id',
      mkevt: 'generic',
      mkcid: 'campaign',
      mkrid: 'id',
      campid: 'campaign',
      customid: 'id',
      toolid: 'id',
      amdata: 'id',
      itmmeta: 'id',
      itmprp: 'id',
      ssspo: 'generic',
      sssrc: 'source',
      ssuid: 'id',
    },
  },
  {
    hosts: ['aliexpress.*'],
    params: {
      scm: 'id',
      scm_id: 'id',
      'scm-url': 'id',
      algo_pvid: 'id',
      algo_expid: 'id',
      algo_exp_id: 'id',
      aff_platform: 'generic',
      aff_trace_key: 'id',
      aff_fcid: 'id',
      aff_fsk: 'id',
      aff_short_key: 'id',
      aff_request_id: 'id',
      pvid: 'id',
      utparam: 'id',
      'utparam-url': 'id',
      curpageloguid: 'id',
      pdp_npi: 'id',
      terminal_id: 'id',
      btsid: 'id',
      ws_ab_test: 'generic',
      'gps-id': 'id',
      sk: 'id',
      dp: 'id',
      mall_affr: 'generic',
    },
  },
  { hosts: ['imdb.com'], params: { ref_: 'source' }, prefixes: { pf_rd_: 'id' } },
  { hosts: ['walmart.com'], params: { u1: 'id' }, prefixes: { ath: 'id' } },
  { hosts: ['twitch.tv'], params: { tt_medium: 'medium', tt_content: 'content' } },
  {
    hosts: ['apple.com'],
    params: { itsct: 'campaign', itscg: 'campaign', ct: 'campaign', pt: 'id', afid: 'id', cid: 'campaign' },
    prefixes: { 'ign-itsc': 'campaign' },
  },
  { hosts: ['snapchat.com'], params: { share_id: 'id' } },
  { hosts: ['quora.com'], params: { share: 'generic' } },
  {
    hosts: ['github.com'],
    params: {
      email_token: 'id',
      email_source: 'source',
      reference_location: 'generic',
      notification_referrer_id: 'id',
    },
  },
  { hosts: ['netflix.com'], params: { trackid: 'id', tctx: 'id', source: 'source' } },
];

/** Compiles a {@link SiteRule} host pattern into a predicate over lowercase hostnames. */
function hostMatcher(pattern: string): (host: string) => boolean {
  if (pattern.endsWith('.*')) {
    // Any TLD, optionally behind a common second-level label: example.com, example.co.uk, example.com.au.
    const base = pattern.slice(0, -2).replace(/\./g, '\\.');
    const regex = new RegExp(`(?:^|\\.)${base}(?:\\.(?:com?|org|net|ne|or|ac|gov|edu))?\\.[a-z]{2,}$`);
    return (host) => regex.test(host);
  }
  return (host) => host === pattern || host.endsWith(`.${pattern}`);
}

const COMPILED_SITE_RULES = SITE_RULES.map((rule) => {
  const matchers = rule.hosts.map(hostMatcher);
  return {
    path: rule.path,
    params: new Map(Object.entries(rule.params)),
    prefixes: Object.entries(rule.prefixes ?? {}),
    matchesHost: (host: string) => matchers.some((matches) => matches(host)),
  };
});

/**
 * Returns a classifier for the parameters of one URL: `(key) => category`, or null for
 * parameters that are not tracking. Site rules are resolved once per URL.
 *
 * @param host Hostname of the URL, when known.
 * @param path Pathname of the URL, when known.
 */
export function paramClassifier(host = '', path = '/'): (key: string) => Category | null {
  const hostname = host.toLowerCase().replace(/\.$/, '');
  const siteRules = hostname
    ? COMPILED_SITE_RULES.filter((rule) => rule.matchesHost(hostname) && (!rule.path || rule.path.test(path)))
    : [];

  return (key) => {
    const name = key.toLowerCase();

    const global = GLOBAL_PARAMS.get(name);
    if (global) {
      return global;
    }

    for (const [prefix, categorize] of GLOBAL_PREFIXES) {
      if (name.startsWith(prefix)) {
        return categorize(name.slice(prefix.length));
      }
    }

    for (const rule of siteRules) {
      const category = rule.params.get(name);
      if (category) {
        return category;
      }
      for (const [prefix, prefixCategory] of rule.prefixes) {
        if (name.startsWith(prefix)) {
          return prefixCategory;
        }
      }
    }

    return null;
  };
}

/** Category of a single tracking parameter, or null when it is not tracking. See {@link paramClassifier}. */
export function classifyParam(key: string, host = '', path = '/'): Category | null {
  return paramClassifier(host, path)(key);
}
