/**
 * Replacement values for tracking parameters.
 *
 * - Decoy style produces values an analyst cannot tell from real ones: sources and mediums from
 *   the vocabulary real campaigns use, campaign names and search terms composed the way marketers
 *   write them, and identifiers (click IDs, tokens) rewritten character by character so they keep
 *   the original's exact length, alphabet, prefix, and encoding.
 * - Silly style produces obvious nonsense (`utm_source=carrier-pigeon`).
 * - Hybrid style picks decoy or silly independently for each value, so one link mixes both.
 *
 * Values are drawn from a seeded generator (see prng.ts), so a link always gets the same
 * replacements and rewriting is idempotent.
 */
import type { Category } from './params';
import { pick, randomInt, seededRandom, type Random } from './prng';

/** How replacement values look: believable decoys, obvious nonsense, or a per-value mix of both. */
export type Style = 'decoy' | 'silly' | 'hybrid';

const DECOY_SOURCES = [
  'google',
  'bing',
  'duckduckgo',
  'yahoo',
  'ecosia',
  'brave',
  'yandex',
  'facebook',
  'fb',
  'instagram',
  'ig',
  'linkedin',
  'twitter',
  'x',
  'threads',
  'bluesky',
  'mastodon',
  'reddit',
  'tiktok',
  'youtube',
  'pinterest',
  'snapchat',
  'quora',
  'medium',
  'substack',
  'hackernews',
  'producthunt',
  'github',
  'stackoverflow',
  'discord',
  'slack',
  'telegram',
  'whatsapp',
  'messenger',
  'newsletter',
  'email',
  'mailchimp',
  'hubspot',
  'klaviyo',
  'braze',
  'sendgrid',
  'marketo',
  'iterable',
  'customerio',
  'gmail',
  'outlook',
  'apple_news',
  'google_news',
  'flipboard',
  'feedly',
  'taboola',
  'outbrain',
  'criteo',
  'adroll',
  'partner',
  'affiliate',
  'podcast',
  'spotify',
  'qr_code',
  'direct_mail',
  'sms',
  'push',
  'in_app',
  'website',
  'blog',
  'homepage',
  'docs',
  'ios_app',
  'android_app',
  'chatgpt.com',
  'perplexity',
  'copilot',
  'capterra',
  'g2',
  'trustpilot',
  'yelp',
  'tripadvisor',
  'indeed',
  'share',
  'copy_link',
];

const DECOY_MEDIUMS = [
  'cpc',
  'ppc',
  'cpm',
  'paid_search',
  'paid_social',
  'paidsocial',
  'organic_social',
  'social',
  'organic',
  'email',
  'newsletter',
  'referral',
  'affiliate',
  'display',
  'banner',
  'retargeting',
  'remarketing',
  'native',
  'video',
  'audio',
  'podcast',
  'sms',
  'push',
  'influencer',
  'partner',
  'qr',
  'print',
  'offline',
  'event',
  'webinar',
  'community',
  'content',
  'pr',
  'sponsorship',
  'in_app',
  'notification',
  'share',
  'syndication',
];

const CAMPAIGN_THEMES = [
  'brand',
  'prospecting',
  'retargeting',
  'remarketing',
  'winback',
  'reactivation',
  'launch',
  'promo',
  'evergreen',
  'awareness',
  'consideration',
  'conversion',
  'lookalike',
  'abandoned_cart',
  'loyalty',
  'referral_program',
  'webinar',
  'free_trial',
  'demo_request',
  'newsletter',
  'product_update',
  'onboarding',
  'upsell',
  'cross_sell',
  'clearance',
  'flash_sale',
  'spring_sale',
  'summer_sale',
  'fall_sale',
  'winter_sale',
  'holiday',
  'black_friday',
  'cyber_monday',
  'bfcm',
  'back_to_school',
  'new_year',
  'valentines',
  'mothers_day',
  'prime_day',
  'end_of_quarter',
  'anniversary',
  'giveaway',
  'ebook',
  'report',
  'case_study',
];

const CAMPAIGN_QUALIFIERS = [
  'us',
  'uk',
  'eu',
  'ca',
  'au',
  'de',
  'fr',
  'emea',
  'apac',
  'latam',
  'na',
  'global',
  'en',
  'smb',
  'enterprise',
  'mobile',
  'desktop',
  'ios',
  'android',
  'v2',
  'v3',
  'test_a',
  'test_b',
  'broad',
  'exact',
  'lal_1pct',
  'lal_3pct',
  '18_34',
  '25_44',
  'retarget_30d',
  'retarget_7d',
  'warm',
  'cold',
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const TERM_NOUNS = [
  'crm+software',
  'project+management',
  'running+shoes',
  'vpn',
  'web+hosting',
  'laptop',
  'noise+cancelling+headphones',
  'meal+kit',
  'credit+card',
  'car+insurance',
  'standing+desk',
  'email+marketing',
  'password+manager',
  'online+course',
  'coffee+maker',
  'travel+insurance',
  'accounting+software',
  'cloud+storage',
  'language+app',
  'mattress',
  'hiking+boots',
  'electric+toothbrush',
  'website+builder',
  'note+taking+app',
  'air+purifier',
  'robot+vacuum',
  'protein+powder',
  'office+chair',
  'dog+food',
  'skincare',
];

const TERM_MODIFIERS = [
  'best',
  'top',
  'cheap',
  'affordable',
  'free',
  'buy',
  'online',
  'how+to+choose',
  'what+is',
  'compare',
];

const TERM_SUFFIXES = [
  'reviews',
  'pricing',
  'near+me',
  '2025',
  '2026',
  'for+beginners',
  'for+small+business',
  'online',
  'app',
  'alternatives',
  'discount+code',
  'coupon',
  'deals',
  'vs',
];

const CONTENT_WORDS = [
  'hero_banner',
  'cta_button',
  'text_link',
  'sidebar_banner',
  'footer_link',
  'header_nav',
  'story_ad',
  'logo',
  'product_card',
  'testimonial',
  'top_link',
  'bottom_cta',
  'inline_link',
  'image_link',
  'pricing_table',
  'feature_grid',
  'social_proof',
  'countdown',
];

const CONTENT_FORMATS = [
  'static_1080x1080',
  'static_1200x628',
  'static_1080x1920',
  'banner_300x250',
  'banner_728x90',
  'banner_160x600',
  'video_6s',
  'video_15s',
  'video_30s',
];

const DECOY_GENERIC = [
  'prospecting',
  'remarketing',
  'acquisition',
  'retention',
  'awareness',
  'display',
  'search',
  'social',
  'native',
  'video',
  'email',
  'partner',
  'organic',
  'paid',
  'control',
  'treatment',
  'default',
  'internal',
  'test',
  'v2',
  'share',
  'copy_link',
  'web',
  'app',
  'desktop',
  'mobile',
];

const FUNNY: Record<Exclude<Category, 'id'>, readonly string[]> = {
  source: [
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
    'haunted-toaster',
    'a-very-confused-cat',
    'grandmas-fax-machine',
    'the-group-chat',
    'ouija-board',
    'message-from-the-future',
  ],
  medium: [
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
    'tin-can-telephone',
    'passive-aggressive-sticky-note',
    'yodeling',
    'carrier-snail',
  ],
  campaign: [
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
    'operation-nice-try',
    'q5-synergy-offsite',
  ],
  term: [
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
    'lorem-ipsum-dolor',
    'nothing-to-see-here',
  ],
  content: [
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
    'blinking-gif',
    'hero-image-of-a-handshake',
  ],
  generic: [
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
    'none-of-your-business',
    'ask-again-later',
  ],
};

// Phrases for nonsense identifiers (click IDs become word salad plus a short suffix).
const FUNNY_TOKEN_PHRASES = [
  ...Object.values(FUNNY).flat(),
  'ad-tech-exorcism',
  'cookie-confetti',
  'tracking-troll',
  'surveillance-slapstick',
  'signal-smuggler',
  'botnet-ballet',
];

const DIGITS = '0123456789';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Values that look like words a person or marketing tool wrote, as opposed to encoded identifiers. */
const WORDY = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_. -]*$/u;
const HAS_LETTER = /\p{L}/u;
/** Long hexadecimal strings are identifiers even though they are made of letters and digits. */
const HEX_ID = /^(?=[0-9a-fA-F]*[0-9])(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{8,}$/;
const PERCENT_ESCAPE = /^%[0-9A-Fa-f]{2}/;

/** One position of an identifier's shape: a literal to keep, or a character class to redraw. */
type ShapeToken = { literal: string } | { alphabet: readonly string[]; code: string };

/**
 * Whether a raw value reads like words (`spring_sale`, `newsletter`, `x`) rather than an encoded
 * identifier (`1`, `a3f9c0b1d2e4`, `IwAR3%3D`). Every decoy word value is wordy, and scrambling never
 * turns an identifier into a wordy value, so rewriting stays idempotent.
 */
export function isWordy(raw: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return false;
  }
  return WORDY.test(decoded) && HAS_LETTER.test(decoded) && !HEX_ID.test(decoded);
}

/** `lower`/`upper` when the letters and digits of `raw` form a hexadecimal string of that case. */
function hexCase(raw: string): 'lower' | 'upper' | null {
  const alnum = raw
    .replace(/%([0-9A-Fa-f]{2})/g, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/[^0-9A-Za-z]/g, '');
  if (!/[0-9]/.test(alnum)) {
    return null;
  }
  if (/^[0-9a-f]+$/.test(alnum) && /[a-f]/.test(alnum)) {
    return 'lower';
  }
  return /^[0-9A-F]+$/.test(alnum) && /[A-F]/.test(alnum) ? 'upper' : null;
}

/**
 * Splits a raw (still URL-encoded) value into literal characters and character classes. Long values
 * keep their first four characters, which often identify the issuer (`IwAR`, `Cj0K`, `AfmB`), and
 * numbers keep their first digit, so they never gain or lose a leading zero. Hexadecimal values keep
 * to hex digits.
 */
function shapeOf(raw: string): ShapeToken[] {
  const hex = hexCase(raw);
  const numeric = /^[0-9]+$/.test(raw);
  const prefixLength = raw.length >= 12 ? 4 : numeric && raw.length > 1 ? 1 : 0;

  const tokens: ShapeToken[] = [];
  for (let i = 0; i < raw.length;) {
    const escape = PERCENT_ESCAPE.exec(raw.slice(i));
    const char = escape ? String.fromCharCode(Number.parseInt(escape[0].slice(1), 16)) : raw.charAt(i);
    if (escape && (!/[A-Za-z0-9]/.test(char) || i < prefixLength)) {
      tokens.push({ literal: escape[0] });
      i += escape[0].length;
      continue;
    }
    let token: ShapeToken;
    if (i < prefixLength) {
      token = { literal: char };
    } else if (DIGITS.includes(char)) {
      token = { alphabet: DIGITS.split(''), code: 'd' };
    } else if (LOWER.includes(char)) {
      token = hex === 'lower' ? { alphabet: 'abcdef'.split(''), code: 'x' } : { alphabet: LOWER.split(''), code: 'l' };
    } else if (UPPER.includes(char)) {
      token = hex === 'upper' ? { alphabet: 'ABCDEF'.split(''), code: 'X' } : { alphabet: UPPER.split(''), code: 'u' };
    } else {
      token = { literal: char };
    }
    if (escape && 'alphabet' in token) {
      // Keep the escape's digit/letter spelling stable so its output has the same seed shape.
      const spelling = escape[0].replace(/[0-9]/g, '#').replace(/[a-f]/g, 'l').replace(/[A-F]/g, 'u');
      const alphabet = token.alphabet
        .map((candidate) => {
          const encoded = candidate.charCodeAt(0).toString(16);
          return '%' + (/[a-f]/.test(escape[0]) ? encoded : encoded.toUpperCase());
        })
        .filter(
          (candidate) => candidate.replace(/[0-9]/g, '#').replace(/[a-f]/g, 'l').replace(/[A-F]/g, 'u') === spelling,
        );
      token = { alphabet, code: token.code + spelling };
    }
    tokens.push(token);
    i += escape ? escape[0].length : 1;
  }
  return tokens;
}

/** A compact description of a value's shape; equal for a value and its scrambled version. */
function shapeSignature(tokens: ShapeToken[]): string {
  return tokens.map((token) => ('literal' in token ? `=${token.literal}` : token.code)).join('');
}

/**
 * Redraws every letter and digit of `raw` from the same class, keeping the prefix, separators,
 * percent-encoding, and length, so the result has exactly the original's format. A value that was
 * not hexadecimal never comes out looking hexadecimal, which keeps its shape (and so the rewrite)
 * stable when it is scrambled again.
 */
export function scrambleLike(raw: string, random: Random): string {
  const tokens = shapeOf(raw);
  const chars = tokens.map((token) => ('literal' in token ? token.literal : pick(random, token.alphabet)));
  if (hexCase(raw) === null && hexCase(chars.join('')) !== null) {
    const index = tokens.findIndex(
      (token) =>
        'alphabet' in token && token.alphabet.some((candidate) => /[g-z]/i.test(decodeURIComponent(candidate))),
    );
    const token = tokens[index];
    if (token && 'code' in token) {
      chars[index] = pick(
        random,
        token.alphabet.filter((candidate) => /[g-z]/i.test(decodeURIComponent(candidate))),
      );
    }
  }
  return chars.join('');
}

/** A campaign name in one of the shapes marketers use: theme, market, date, variant. */
function decoyCampaign(random: Random): string {
  const theme = pick(random, CAMPAIGN_THEMES);
  const qualifier = pick(random, CAMPAIGN_QUALIFIERS);
  const year = String(2024 + randomInt(random, 4));
  const month = pick(random, MONTHS);
  const date = `${String(1 + randomInt(random, 12)).padStart(2, '0')}${String(1 + randomInt(random, 28)).padStart(2, '0')}`;
  const parts = pick(random, [
    [theme, year],
    [theme, qualifier],
    [theme, qualifier, year],
    [month, theme],
    [theme, month, year],
    [year, 'q' + String(1 + randomInt(random, 4)), theme],
    [theme, date],
    [theme],
  ]);
  return parts.join(random() < 0.8 ? '_' : '-');
}

/** A search term shaped like a real paid-search keyword (`best+crm+software`). */
function decoyTerm(random: Random): string {
  const noun = pick(random, TERM_NOUNS);
  switch (randomInt(random, 3)) {
    case 0:
      return `${pick(random, TERM_MODIFIERS)}+${noun}`;
    case 1:
      return `${noun}+${pick(random, TERM_SUFFIXES)}`;
    default:
      return noun;
  }
}

/** An ad or link placement name (`hero_banner`, `video_15s`, `variant_b`). */
function decoyContent(random: Random): string {
  switch (randomInt(random, 4)) {
    case 0:
      return pick(random, CONTENT_FORMATS);
    case 1:
      return `variant_${pick(random, ['a', 'b', 'c'])}`;
    case 2:
      return `${pick(random, ['ad', 'headline', 'image', 'carousel_card', 'reel'])}_${String(1 + randomInt(random, 12))}`;
    default:
      return pick(random, CONTENT_WORDS);
  }
}

/** A believable word value for a marketing parameter category. */
function decoyWord(category: Exclude<Category, 'id'>, random: Random): string {
  switch (category) {
    case 'source':
      return pick(random, DECOY_SOURCES);
    case 'medium':
      return pick(random, DECOY_MEDIUMS);
    case 'campaign':
      return decoyCampaign(random);
    case 'term':
      return decoyTerm(random);
    case 'content':
      return decoyContent(random);
    case 'generic':
      return pick(random, DECOY_GENERIC);
  }
}

/** Word-salad nonsense for an identifier: two or three phrases and a short alphanumeric suffix. */
function sillyToken(random: Random): string {
  const words: string[] = [];
  const count = 2 + randomInt(random, 2);
  while (words.length < count) {
    const phrase = pick(random, FUNNY_TOKEN_PHRASES);
    if (!words.includes(phrase)) {
      words.push(phrase);
    }
  }
  let suffix = '';
  for (let i = 0, length = 4 + randomInt(random, 3); i < length; i += 1) {
    suffix += pick(random, (LOWER + DIGITS).split(''));
  }
  return [...words, suffix].join('-');
}

/**
 * The replacement for one tracking value. `seed` must be stable for this parameter of this link
 * (see rewrite.ts); the value itself only contributes its shape, so feeding a replacement back in
 * returns the same replacement.
 *
 * Because the value is ignored beyond its shape, the replacement sometimes equals it: 1 in 10 for a
 * one-digit value such as `gad_source=1`, about 1 in the vocabulary size for a word. The link is
 * then already in its decoy form and `rewriteUrl` reports nothing to rewrite. This is deliberate.
 * Every replacement is a fixed point (that is what makes rewriting idempotent), so an original that
 * happens to equal it is one too; and picking another value whenever they match would make the
 * decoy depend on the real value, which for small ranges gives it away. A "must differ" rule fails
 * the idempotency tests in rewrite.test.ts and values.test.ts.
 *
 * @param style Believable decoys, obvious nonsense, or a per-value mix of both.
 * @param category What the parameter carries; picks the vocabulary for word values.
 * @param raw The current value, still URL-encoded.
 * @param seed Stable per link and parameter, including the secret per-install key.
 * @returns A URL-safe replacement in the same encoding style as `raw`.
 */
export function replacementValue(style: Style, category: Category, raw: string, seed: string): string {
  if (style === 'hybrid') {
    // The pick depends only on the seed, never on the value, so a rewritten link keeps its mix.
    const pickSilly = seededRandom(`${seed}|hybrid`)() < 0.5;
    return replacementValue(pickSilly ? 'silly' : 'decoy', category, raw, seed);
  }
  if (style === 'silly') {
    const random = seededRandom(`${seed}|silly`);
    return category === 'id' ? sillyToken(random) : pick(random, FUNNY[category]);
  }
  if (category !== 'id' && isWordy(raw)) {
    const word = decoyWord(category, seededRandom(`${seed}|word`));
    return raw.includes('%') ? encodeURIComponent(word.replace(/\+/g, ' ')) : word;
  }
  const shape = shapeOf(raw);
  return scrambleLike(raw, seededRandom(`${seed}|${shapeSignature(shape)}`));
}
