
const FUNNY_SOURCES = [
  'definitely-not-facebook',
  'mystery-meat',
  'your-moms-browser',
  'the-void',
  'carrier-pigeon',
  'time-traveler',
  'alien-mothership',
  'magic-8-ball',
  'fortune-cookie',
  'bathroom-wall',
  'conspiracy-theory',
  'rubber-duck',
];

const FUNNY_MEDIUMS = [
  'smoke-signals',
  'interpretive-dance',
  'telepathy',
  'shouting-really-loud',
  'morse-code',
  'semaphore-flags',
  'trained-squirrels',
  'quantum-entanglement',
  'pigeon-post',
  'message-in-bottle',
  'cave-paintings',
  'skywriting',
];

const FUNNY_CAMPAIGNS = [
  'operation-click-bait',
  'project-procrastination',
  'mission-impossible-to-track',
  'campaign-against-campaigns',
  'the-great-data-heist',
  'operation-banana-split',
  'project-digital-confusion',
  'the-utm-rebellion',
  'campaign-chaos-theory',
  'operation-random-nonsense',
  'project-anti-tracking',
  'the-great-param-shuffle',
];

const FUNNY_TERMS = [
  'unicorn-tears',
  'digital-breadcrumbs',
  'pixel-dust',
  'data-ghost',
  'tracking-goblin',
  'analytics-anxiety',
  'metric-madness',
  'conversion-confusion',
  'funnel-fear',
  'attribution-anarchy',
  'engagement-enigma',
  'retention-riddle',
];

const FUNNY_CONTENT = [
  'banner-of-shame',
  'click-me-please',
  'desperate-cta',
  'shiny-button',
  'definitely-not-an-ad',
  'trust-me-bro',
  'random-popup',
  'attention-grabber',
  'scroll-stopper',
  'engagement-trap',
  'conversion-bait',
  'metric-manipulator',
];

const FUNNY_GENERIC = [
  'nope-not-today',
  'privacy-police',
  'analytics-anarchy',
  'tracking-resistance',
  'param-party-crasher',
  'cookie-crumbler',
  'metrics-are-fiction',
  'campaign-chaos',
  'referral-rebellion',
  'gclid-gone-wild',
  'idk-not-telling',
  'mystery-tour',
];

const FUNNY_WORD_BANK = Array.from(
  new Set([
    ...FUNNY_GENERIC,
    ...FUNNY_SOURCES,
    ...FUNNY_MEDIUMS,
    ...FUNNY_CAMPAIGNS,
    ...FUNNY_TERMS,
    ...FUNNY_CONTENT,
    'ad-tech-exorcism',
    'cookie-confetti',
    'tracking-troll',
    'surveillance-slapstick',
    'signal-smuggler',
    'botnet-ballet',
  ]),
);

type TrackingCategory = 'source' | 'medium' | 'campaign' | 'term' | 'content' | 'generic' | 'hash';

const CATEGORY_LOOKUP = new Map<string, Exclude<TrackingCategory, 'hash'>>();

function registerCategory(category: Exclude<TrackingCategory, 'hash'>, keys: string[]) {
  keys.forEach(key => CATEGORY_LOOKUP.set(key.toLowerCase(), category));
}

registerCategory('source', ['utm_source', 'source', 'src', 'ga_source', 'hsa_src', 'ref', 'referrer', 'ref_source', 'affiliate_source']);
registerCategory('medium', ['utm_medium', 'medium', 'ga_medium', 'hsa_mt', 'channel', 'channelid', 'traffic_medium', 'promo_medium']);
registerCategory('campaign', [
  'utm_campaign',
  'campaign',
  'campaignid',
  'campaign_id',
  'cmp',
  'cmpid',
  'ga_campaign',
  'hsa_cam',
  'utm_id',
  'utm_name',
  'campaign_name',
  'adcampaign',
]);
registerCategory('term', ['utm_term', 'term', 'ga_term', 'keyword', 'keywords', 'hsa_kw', 'searchterm', 'search_term', 'search_query']);
registerCategory('content', ['utm_content', 'content', 'ga_content', 'creative', 'creativename', 'hsa_ad', 'hsa_tgt', 'adset', 'adset_id', 'adgroup', 'adgroup_id']);
registerCategory('generic', [
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  'ga_place',
  'ga_location',
  'adid',
  'adgroupid',
  'adunit',
  'device',
  'placement',
  'matchtype',
  'network',
  'feeditemid',
  'creativeid',
  'creative_id',
  'adgroupname',
  'emc',
  'nl',
  'referringsource',
  'referring_source',
  'sharelink',
  'share_link',
  'share_url',
  'sharechannel',
  'newsletter',
  'audience',
]);

const EXACT_HASH_KEYS = new Set(
  [
    'fbclid',
    'gclid',
    'gbraid',
    'wbraid',
    'dclid',
    'msclkid',
    'yclid',
    'twclid',
    'ttclid',
    'li_fat_id',
    'igshid',
    'mc_eid',
    'mc_cid',
    'mkt_tok',
    '_hsenc',
    '_hsmi',
    'vero_id',
    'vero_conv',
    'spm',
    'scid',
    's_cid',
    'icid',
    'irclickid',
    'irgwc',
    'oly_anon_id',
    'oly_enc_id',
    'trk_contact',
    'trk_module',
    'trk_msg',
    'trk_sid',
    'rb_clickid',
    'ncid',
    'adobe_mc_ref',
    'adobe_mc_sdid',
    'instance_id',
    'segment_id',
    'regi_id',
    'user_id',
    'smid',
    'unlocked_article_code',
    'ad_id',
    'ref_id',
    'visitor_id',
    'subscriber_id',
  ].map(key => key.toLowerCase()),
);

const HASH_PREFIXES = ['oly_', 'vero_', 'trk_', 'sentry_', 'hssc', 'hssr', 'hsfp'];

const KEYWORD_CATEGORY_PATTERNS: Array<{ category: Exclude<TrackingCategory, 'hash'>; regex: RegExp }> = [
  { category: 'source', regex: /(^|[_-])(source|src|ref|referrer)([_-]|$)/ },
  { category: 'medium', regex: /(^|[_-])(medium|channel|cpm|cpc)([_-]|$)/ },
  { category: 'campaign', regex: /(^|[_-])(campaign|cmp|promo|marketing|mk)([_-]|$)/ },
  { category: 'term', regex: /(^|[_-])(term|keyword|kw|search)([_-]|$)/ },
  { category: 'content', regex: /(^|[_-])(content|creative|adset|adgroup|adcreative)([_-]|$)/ },
];

const GENERIC_TRACKING_HINTS: RegExp[] = [
  /(^|[_-])(track|tracking|trk)([_-]|$)/,
  /clid$/i,
  /(^|[_-])cid([_-]|$)/,
  /(^|[_-])clickid([_-]|$)/,
  /(^|[_-])aff([_-]|$)/,
  /(^|[_-])(session|visitor)(_?id)?([_-]|$)/,
  /(^|[_-])adid([_-]|$)/,
  /(^|[_-])(newsletter|audience|segment)([_-]|$)/,
];

const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789';

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomAlphaNumeric(length: number): string {
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += ALPHANUMERIC.charAt(Math.floor(Math.random() * ALPHANUMERIC.length));
  }
  return token;
}

function generateTrackingToken(original: string): string {
  const desiredWordCount = Math.min(4, Math.max(2, Math.floor(Math.max(original.length, 12) / 16)));
  const words: string[] = [];

  while (words.length < desiredWordCount) {
    const candidate = getRandomElement(FUNNY_WORD_BANK);
    if (!words.includes(candidate)) {
      words.push(candidate);
    }
  }

  const suffixLength = Math.min(10, Math.max(4, Math.ceil(Math.max(original.length, 8) / 7)));
  const suffix = randomAlphaNumeric(suffixLength);

  return [...words, suffix].join('-');
}

function getFunnyValueForCategory(category: Exclude<TrackingCategory, 'hash'>): string {
  switch (category) {
    case 'source':
      return getRandomElement(FUNNY_SOURCES);
    case 'medium':
      return getRandomElement(FUNNY_MEDIUMS);
    case 'campaign':
      return getRandomElement(FUNNY_CAMPAIGNS);
    case 'term':
      return getRandomElement(FUNNY_TERMS);
    case 'content':
      return getRandomElement(FUNNY_CONTENT);
    case 'generic':
    default:
      return getRandomElement(FUNNY_GENERIC);
  }
}

function categorizeParam(key: string): TrackingCategory | null {
  const normalizedKey = key.toLowerCase();

  if (CATEGORY_LOOKUP.has(normalizedKey)) {
    return CATEGORY_LOOKUP.get(normalizedKey) ?? null;
  }

  if (normalizedKey.startsWith('utm_')) {
    return 'generic';
  }

  if (EXACT_HASH_KEYS.has(normalizedKey)) {
    return 'hash';
  }

  if (HASH_PREFIXES.some(prefix => normalizedKey.startsWith(prefix))) {
    return 'hash';
  }

  for (const { category, regex } of KEYWORD_CATEGORY_PATTERNS) {
    if (regex.test(normalizedKey)) {
      return category;
    }
  }

  if (GENERIC_TRACKING_HINTS.some(regex => regex.test(normalizedKey))) {
    return 'generic';
  }

  return null;
}

export function hasTrackingParameters(url: string): boolean {
  try {
    const urlObj = new URL(url);
    for (const key of urlObj.searchParams.keys()) {
      if (categorizeParam(key)) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Failed to parse URL while checking tracking params:', error);
    return false;
  }
}

export function randomizeTrackingParameters(url: string): string {
  try {
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);

    let mutated = false;

    params.forEach((value, key) => {
      const category = categorizeParam(key);
      if (!category) {
        return;
      }

      mutated = true;

      if (category === 'hash') {
        params.set(key, generateTrackingToken(value));
      } else {
        params.set(key, getFunnyValueForCategory(category));
      }
    });

    if (!mutated) {
      return url;
    }

    urlObj.search = params.toString();
    return urlObj.toString();
  } catch (error) {
    console.error('Failed to randomize tracking parameters:', error);
    return url;
  }
}
