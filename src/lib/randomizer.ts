import type { Category } from './params';

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
  'haunted-toaster',
  'a-very-confused-cat',
  'grandmas-fax-machine',
  'the-group-chat',
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
  'tin-can-telephone',
  'passive-aggressive-sticky-note',
  'yodeling',
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
  'operation-nice-try',
  'q5-synergy-offsite',
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
  'lorem-ipsum-dolor',
  'nothing-to-see-here',
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
  'blinking-gif',
  'hero-image-of-a-handshake',
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
  'none-of-your-business',
  'ask-again-later',
];

const CATEGORY_VALUES: Record<Exclude<Category, 'id'>, readonly string[]> = {
  source: FUNNY_SOURCES,
  medium: FUNNY_MEDIUMS,
  campaign: FUNNY_CAMPAIGNS,
  term: FUNNY_TERMS,
  content: FUNNY_CONTENT,
  generic: FUNNY_GENERIC,
};

const ALL_FUNNY_VALUES = new Set(Object.values(CATEGORY_VALUES).flat());

// Phrases that make up generated tokens (IDs become word salad plus a random suffix).
const TOKEN_PHRASES = [
  ...ALL_FUNNY_VALUES,
  'ad-tech-exorcism',
  'cookie-confetti',
  'tracking-troll',
  'surveillance-slapstick',
  'signal-smuggler',
  'botnet-ballet',
];
const TOKEN_PHRASE_SET = new Set(TOKEN_PHRASES);
const LONGEST_PHRASE_SEGMENTS = Math.max(...TOKEN_PHRASES.map((phrase) => phrase.split('-').length));

const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_PATTERN = /^[a-z0-9]{4,10}$/;

/** Uniform random integer in [0, max) from the platform CSPRNG, without modulo bias. */
function secureRandomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? 0;
    if (value < limit) {
      return value % max;
    }
  }
}

/** A uniformly random element of a non-empty list. */
function pick<T>(items: readonly T[]): T {
  const item = items[secureRandomInt(items.length)];
  if (item === undefined) {
    throw new RangeError('Cannot pick from an empty list');
  }
  return item;
}

/** A random string of lowercase letters and digits. */
function randomAlphanumeric(length: number): string {
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += ALPHANUMERIC.charAt(secureRandomInt(ALPHANUMERIC.length));
  }
  return token;
}

/** Word-salad replacement for an opaque identifier, roughly scaled to the original's length. */
export function generateToken(original: string): string {
  const wordCount = Math.min(4, Math.max(2, Math.floor(original.length / 16)));
  const words: string[] = [];
  while (words.length < wordCount) {
    const phrase = pick(TOKEN_PHRASES);
    if (!words.includes(phrase)) {
      words.push(phrase);
    }
  }
  const suffixLength = Math.min(10, Math.max(4, Math.ceil(original.length / 7)));
  return [...words, randomAlphanumeric(suffixLength)].join('-');
}

/** A replacement value for a tracking parameter of the given category. */
export function funnyValue(category: Category, original: string): string {
  return category === 'id' ? generateToken(original) : pick(CATEGORY_VALUES[category]);
}

/** Whether `segments` can be split entirely into known token phrases. */
function isPhraseSequence(segments: string[]): boolean {
  const reachable = new Array<boolean>(segments.length + 1).fill(false);
  reachable[0] = true;
  for (let end = 1; end <= segments.length; end += 1) {
    for (let start = Math.max(0, end - LONGEST_PHRASE_SEGMENTS); start < end && !reachable[end]; start += 1) {
      reachable[end] = reachable[start] === true && TOKEN_PHRASE_SET.has(segments.slice(start, end).join('-'));
    }
  }
  return reachable[segments.length] === true;
}

/**
 * Whether a value was produced by this extension, so copying an already-randomized link
 * (for example after switching tabs) leaves it alone.
 */
export function isAlreadyRandomized(value: string): boolean {
  if (ALL_FUNNY_VALUES.has(value)) {
    return true;
  }
  const segments = value.split('-');
  const suffix = segments.pop();
  return segments.length >= 2 && suffix !== undefined && SUFFIX_PATTERN.test(suffix) && isPhraseSequence(segments);
}
