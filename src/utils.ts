// utils.ts - Shared utility functions

export function isValidURL(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function hasUTMParameters(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    return utmKeys.some(key => params.has(key));
  } catch {
    return false;
  }
}

export function hasTrackingParameters(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    
    // Check for UTM parameters
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    if (utmKeys.some(key => params.has(key))) return true;
    
    // Check for other tracking parameters
    const trackingKeys = [
      'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ml_subscriber',
      'yclid', 'twclid', 'msclkid', 'ef_id', '_ga', 'wbraid', 'gbraid'
    ];
    return trackingKeys.some(key => params.has(key));
  } catch {
    return false;
  }
}