
const FUNNY_SOURCES = [
  'definitely-not-facebook', 'mystery-meat', 'your-moms-browser', 'the-void', 
  'carrier-pigeon', 'time-traveler', 'alien-mothership', 'magic-8-ball',
  'fortune-cookie', 'bathroom-wall', 'conspiracy-theory', 'rubber-duck'
];

const FUNNY_MEDIUMS = [
  'smoke-signals', 'interpretive-dance', 'telepathy', 'shouting-really-loud',
  'morse-code', 'semaphore-flags', 'trained-squirrels', 'quantum-entanglement',
  'pigeon-post', 'message-in-bottle', 'cave-paintings', 'skywriting'
];

const FUNNY_CAMPAIGNS = [
  'operation-click-bait', 'project-procrastination', 'mission-impossible-to-track',
  'campaign-against-campaigns', 'the-great-data-heist', 'operation-banana-split',
  'project-digital-confusion', 'the-utm-rebellion', 'campaign-chaos-theory',
  'operation-random-nonsense', 'project-anti-tracking', 'the-great-param-shuffle'
];

const FUNNY_TERMS = [
  'unicorn-tears', 'digital-breadcrumbs', 'pixel-dust', 'data-ghost',
  'tracking-goblin', 'analytics-anxiety', 'metric-madness', 'conversion-confusion',
  'funnel-fear', 'attribution-anarchy', 'engagement-enigma', 'retention-riddle'
];

const FUNNY_CONTENT = [
  'banner-of-shame', 'click-me-please', 'desperate-cta', 'shiny-button',
  'definitely-not-an-ad', 'trust-me-bro', 'random-popup', 'attention-grabber',
  'scroll-stopper', 'engagement-trap', 'conversion-bait', 'metric-manipulator'
];

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

export function randomizeUTMParameters(url: string): string {
  try {
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);
    
    // Check if URL has UTM parameters
    let hasUTM = false;
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    
    utmKeys.forEach(key => {
      if (params.has(key)) {
        hasUTM = true;
        switch (key) {
          case 'utm_source':
            params.set(key, getRandomElement(FUNNY_SOURCES));
            break;
          case 'utm_medium':
            params.set(key, getRandomElement(FUNNY_MEDIUMS));
            break;
          case 'utm_campaign':
            params.set(key, getRandomElement(FUNNY_CAMPAIGNS));
            break;
          case 'utm_term':
            params.set(key, getRandomElement(FUNNY_TERMS));
            break;
          case 'utm_content':
            params.set(key, getRandomElement(FUNNY_CONTENT));
            break;
        }
      }
    });
    
    if (hasUTM) {
      urlObj.search = params.toString();
      return urlObj.toString();
    }
    
    return url;
  } catch (error) {
    console.error('Failed to parse URL:', error);
    return url;
  }
}