// utm-randomizer.ts - Enhanced version with better randomization and edge cases

const FUNNY_SOURCES = [
  'definitely-not-facebook', 'mystery-meat', 'your-moms-browser', 'the-void', 
  'carrier-pigeon', 'time-traveler', 'alien-mothership', 'magic-8-ball',
  'fortune-cookie', 'bathroom-wall', 'conspiracy-theory', 'rubber-duck',
  'crystal-ball', 'ouija-board', 'tea-leaves', 'tarot-cards',
  'chicken-bones', 'shadow-realm', 'parallel-universe', 'future-self',
  'interdimensional-portal', 'quantum-flux', 'neural-link', 'astral-projection'
];

const FUNNY_MEDIUMS = [
  'smoke-signals', 'interpretive-dance', 'telepathy', 'shouting-really-loud',
  'morse-code', 'semaphore-flags', 'trained-squirrels', 'quantum-entanglement',
  'pigeon-post', 'message-in-bottle', 'cave-paintings', 'skywriting',
  'hieroglyphics', 'crop-circles', 'graffiti', 'ransom-note',
  'fortune-cookie', 'dreams', 'vibes-only', 'bat-signal',
  'tribal-drums', 'yodeling', 'mime-performance', 'haiku'
];

const FUNNY_CAMPAIGNS = [
  'operation-click-bait', 'project-procrastination', 'mission-impossible-to-track',
  'campaign-against-campaigns', 'the-great-data-heist', 'operation-banana-split',
  'project-digital-confusion', 'the-utm-rebellion', 'campaign-chaos-theory',
  'operation-random-nonsense', 'project-anti-tracking', 'the-great-param-shuffle',
  'initiative-404-not-found', 'operation-gdpr-nightmare', 'project-cookie-monster',
  'campaign-inception', 'operation-rickroll', 'project-confused-analytics',
  'mission-data-obfuscation', 'operation-noise-generator', 'project-false-positive',
  'campaign-wildgoose-chase', 'operation-red-herring', 'project-decoy-duck'
];

const FUNNY_TERMS = [
  'unicorn-tears', 'digital-breadcrumbs', 'pixel-dust', 'data-ghost',
  'tracking-goblin', 'analytics-anxiety', 'metric-madness', 'conversion-confusion',
  'funnel-fear', 'attribution-anarchy', 'engagement-enigma', 'retention-riddle',
  'bounce-rate-blues', 'session-sorcery', 'pageview-poltergeist', 'click-cryptid',
  'impression-illusion', 'ctr-conspiracy', 'roi-roulette', 'kpi-kryptonite',
  'dashboard-delusion', 'report-rage', 'insight-insanity', 'data-delirium'
];

const FUNNY_CONTENT = [
  'banner-of-shame', 'click-me-please', 'desperate-cta', 'shiny-button',
  'definitely-not-an-ad', 'trust-me-bro', 'random-popup', 'attention-grabber',
  'scroll-stopper', 'engagement-trap', 'conversion-bait', 'metric-manipulator',
  'call-to-confusion', 'hero-image-zero', 'sidebar-sob-story', 'footer-foolery',
  'modal-madness', 'notification-nonsense', 'toast-trap', 'slider-silliness',
  'accordion-anarchy', 'carousel-chaos', 'dropdown-disaster', 'hamburger-havoc'
];

// Cache to prevent same randomization within short time
const recentRandomizations = new Map<string, string>();
const CACHE_DURATION = 5000; // 5 seconds

// Track last used values to avoid repetition
const lastUsed = {
  source: null as string | null,
  medium: null as string | null,
  campaign: null as string | null,
  term: null as string | null,
  content: null as string | null
};

// Weighted random selection for more variety
function getWeightedRandom<T>(array: T[], lastUsed?: T): T {
  let filtered = array;
  
  // Try to avoid repeating the last used item
  if (lastUsed && array.length > 1) {
    filtered = array.filter(item => item !== lastUsed);
  }
  
  return filtered[Math.floor(Math.random() * filtered.length)];
}

export function randomizeUTMParameters(url: string): string {
  try {
    // Check cache first
    const cached = recentRandomizations.get(url);
    if (cached) {
      const [cachedUrl, timestamp] = cached.split('|');
      if (Date.now() - parseInt(timestamp) < CACHE_DURATION) {
        return cachedUrl;
      }
    }
    
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);
    
    let hasUTM = false;
    const parametersChanged: string[] = [];
    
    // Process standard UTM parameters
    const utmMappings = {
      'utm_source': { array: FUNNY_SOURCES, lastKey: 'source' },
      'utm_medium': { array: FUNNY_MEDIUMS, lastKey: 'medium' },
      'utm_campaign': { array: FUNNY_CAMPAIGNS, lastKey: 'campaign' },
      'utm_term': { array: FUNNY_TERMS, lastKey: 'term' },
      'utm_content': { array: FUNNY_CONTENT, lastKey: 'content' }
    };
    
    for (const [key, mapping] of Object.entries(utmMappings)) {
      if (params.has(key)) {
        hasUTM = true;
        const newValue = getWeightedRandom(
          mapping.array, 
          lastUsed[mapping.lastKey as keyof typeof lastUsed] || undefined
        );
        params.set(key, newValue);
        lastUsed[mapping.lastKey as keyof typeof lastUsed] = newValue;
        parametersChanged.push(key);
      }
    }
    
    // Handle Facebook-specific tracking parameters
    const fbParams = ['fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source'];
    for (const param of fbParams) {
      if (params.has(param)) {
        hasUTM = true;
        params.set(param, 'nice-try-zuckerberg');
        parametersChanged.push(param);
      }
    }
    
    // Handle Google click ID
    if (params.has('gclid')) {
      hasUTM = true;
      params.set('gclid', 'google-cant-track-this');
      parametersChanged.push('gclid');
    }
    
    // Handle other common tracking parameters
    const trackingParams = [
      'mc_cid', 'mc_eid', // Mailchimp
      'ml_subscriber', 'ml_subscriber_hash', // MailerLite
      'yclid', // Yandex
      'twclid', // Twitter
      'msclkid', // Microsoft
      'ef_id', // Adobe
      '_ga', // Google Analytics
      'wbraid', 'gbraid' // Google Ads
    ];
    
    for (const param of trackingParams) {
      if (params.has(param)) {
        hasUTM = true;
        params.set(param, `${param}-says-no`);
        parametersChanged.push(param);
      }
    }
    
    if (hasUTM) {
      // Add a bonus parameter for fun
      if (Math.random() > 0.7) {
        params.set('utm_reality', 'simulation');
      }
      
      urlObj.search = params.toString();
      const randomizedUrl = urlObj.toString();
      
      // Cache the result
      recentRandomizations.set(url, `${randomizedUrl}|${Date.now()}`);
      
      // Clean old cache entries
      setTimeout(() => {
        recentRandomizations.delete(url);
      }, CACHE_DURATION);
      
      // Update stats
      updateStats(parametersChanged.length);
      
      return randomizedUrl;
    }
    
    return url;
  } catch (error) {
    console.error('Failed to parse URL:', error);
    return url;
  }
}

// Helper to validate and clean URLs
export function sanitizeUrl(url: string): string {
  try {
    // Remove zero-width characters and trim
    const cleaned = url.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    
    // Check if it might be a valid URL before adding protocol
    if (!cleaned.match(/^https?:\/\//)) {
      // Only add protocol if it looks like a domain
      if (cleaned.match(/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+/)) {
        const withProtocol = 'https://' + cleaned;
        // Validate it's actually a valid URL
        new URL(withProtocol);
        return withProtocol;
      }
    }
    
    // Validate original URL
    new URL(cleaned);
    return cleaned;
  } catch {
    // Return original if it can't be parsed as valid URL
    return url.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  }
}

// Update statistics
// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
function updateStats(_paramCount: number) {
  // Check if we're in a browser environment with chrome API
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['countToday', 'countTotal', 'lastResetDate'], (data) => {
      const today = new Date().toDateString();
      let countToday = data.countToday || 0;
      let countTotal = data.countTotal || 0;
      
      // Reset daily count if it's a new day
      if (data.lastResetDate !== today) {
        countToday = 0;
      }
      
      countToday++;
      countTotal++;
      
      chrome.storage.local.set({
        countToday,
        countTotal,
        lastResetDate: today
      });
    });
  }
}

// Export for testing
export const __testing = {
  FUNNY_SOURCES,
  FUNNY_MEDIUMS,
  FUNNY_CAMPAIGNS,
  FUNNY_TERMS,
  FUNNY_CONTENT,
  getWeightedRandom,
  lastUsed
};