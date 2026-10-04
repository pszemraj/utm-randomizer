/**
 * Campaign namespaces and documented tracking names supported on every site.
 * Unrecognized fields in campaign namespaces use pooled replacements; unrelated names stay untouched.
 */

/** The kind of value a parameter carries; picks the kind of replacement value. */
export type Category = 'source' | 'medium' | 'campaign' | 'term' | 'content' | 'generic' | 'id' | 'unknown';

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
  // Matomo campaign dimensions: https://matomo.org/faq/reports/what-is-campaign-tracking-and-why-it-is-important/
  ['mtm_campaign', 'campaign'],
  ['mtm_keyword', 'term'],
  ['mtm_kwd', 'term'],
  ['mtm_source', 'source'],
  ['mtm_medium', 'medium'],
  ['mtm_content', 'content'],
  ['mtm_placement', 'content'],
  ['mtm_cid', 'id'],
  ['mtm_group', 'generic'],
  // Legacy campaign aliases: https://help.piwik.pro/support/questions/how-can-i-customize-piwik-pro-campaign-parameters/
  ['pk_campaign', 'campaign'],
  ['pk_cpn', 'campaign'],
  ['pk_keyword', 'term'],
  ['pk_kwd', 'term'],
  ['piwik_campaign', 'campaign'],
  ['piwik_kwd', 'term'],
  ['pk_source', 'source'],
  ['pk_medium', 'medium'],
  ['pk_content', 'content'],
  ['pk_cid', 'id'],
  // Matomo campaign aliases: https://developer.matomo.org/guides/ab-tests/campaign
  ['matomo_campaign', 'campaign'],
  ['matomo_kwd', 'term'],
  // HubSpot ad attribution: https://knowledge.hubspot.com/ads/track-and-report-on-google-ads-in-hubspot
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

/** Campaign namespaces whose additional fields draw from the combined replacement vocabulary. */
const CAMPAIGN_PREFIXES = ['utm_', 'mtm_', 'hsa_'];

/** Category of a recognized campaign field or click ID, or null for an unrelated name. */
export function classifyParam(key: string): Category | null {
  const name = key.toLowerCase();
  return (
    TRACKING_PARAMS.get(name) ??
    (CAMPAIGN_PREFIXES.some((prefix) => name.startsWith(prefix) && name.length > prefix.length) ? 'unknown' : null)
  );
}
