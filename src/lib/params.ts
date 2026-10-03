/**
 * Exact tracking-parameter names supported on every site. Unknown names are left untouched;
 * classification does not infer tracking from a prefix, hostname, or path.
 */

/** The kind of value a parameter carries; picks the kind of replacement value. */
export type Category = 'source' | 'medium' | 'campaign' | 'term' | 'content' | 'generic' | 'id';

const TRACKING_PARAMS = new Map<string, Category>([
  // Google Analytics campaign fields: https://support.google.com/analytics/answer/10917952
  ['utm_source', 'source'],
  ['utm_medium', 'medium'],
  ['utm_campaign', 'campaign'],
  ['utm_term', 'term'],
  ['utm_content', 'content'],
  ['utm_id', 'campaign'],
  ['utm_source_platform', 'generic'],
  ['utm_creative_format', 'generic'],
  ['utm_marketing_tactic', 'generic'],
  // Google Ads click identifiers: https://developers.google.com/google-ads/api/docs/conversions/legacy_oci_guide
  ['gclid', 'id'],
  ['gbraid', 'id'],
  ['wbraid', 'id'],
  // Campaign Manager click attribution: https://support.google.com/analytics/answer/12325075
  ['dclid', 'id'],
  // Meta click attribution: https://github.com/facebook/capi-param-builder/blob/main/client_js/README.md
  ['fbclid', 'id'],
  // Microsoft click attribution: https://learn.microsoft.com/en-us/advertising/bulk-service/account#msclkid-auto-tagging-enabled
  ['msclkid', 'id'],
  // TikTok click attribution: https://ads.tiktok.com/help/article/tiktok-click-id
  ['ttclid', 'id'],
  // X click attribution: https://business.x.com/en/help/campaign-measurement-and-analytics/conversion-tracking-for-websites
  ['twclid', 'id'],
  // LinkedIn click attribution: https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies
  ['li_fat_id', 'id'],
]);

/** Category of an exact tracking-parameter name, or null when it is outside the supported set. */
export function classifyParam(key: string): Category | null {
  return TRACKING_PARAMS.get(key.toLowerCase()) ?? null;
}
