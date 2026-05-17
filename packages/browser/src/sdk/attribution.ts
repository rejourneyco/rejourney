import { CLICK_ID_PARAMS, DEFAULT_ALLOWED_ATTRIBUTION_PARAMS } from './constants.js';
import { getDocument, getLocation } from './browser.js';
import { referrerDomain, scrubUrl } from './urlScrubber.js';
import type { AcquisitionChannel, RejourneyWebConfig, WebAttributionContext } from './types.js';

function getNavigationType(): WebAttributionContext['navigationType'] {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return 'unknown';
  }

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const type = navigation?.type;
  if (type === 'navigate' || type === 'reload' || type === 'back_forward' || type === 'prerender') {
    return type;
  }
  return 'unknown';
}

function classifyChannel(params: URLSearchParams, referrerHost: string | null, currentHost: string): AcquisitionChannel {
  const medium = params.get('utm_medium')?.toLowerCase() || '';
  const source = params.get('utm_source')?.toLowerCase() || '';

  if (medium) {
    if (/cpc|ppc|paidsearch|paid_search/.test(medium)) return 'paid_search';
    if (/paid.*social|social_paid/.test(medium)) return 'paid_social';
    if (/social/.test(medium)) return 'organic_social';
    if (/email|newsletter/.test(medium)) return 'email';
    if (/affiliate/.test(medium)) return 'affiliate';
    if (/display|banner|programmatic/.test(medium)) return 'display';
  }

  if (params.has('gclid') || params.has('gbraid') || params.has('wbraid') || params.has('msclkid')) return 'paid_search';
  if (params.has('fbclid') || params.has('ttclid') || params.has('twclid') || params.has('li_fat_id')) return 'paid_social';
  if (source && /facebook|instagram|tiktok|twitter|x|linkedin|reddit|pinterest/.test(source)) return 'organic_social';
  if (!referrerHost) return 'direct';
  if (referrerHost === currentHost) return 'internal';
  if (/google|bing|duckduckgo|yahoo|baidu|yandex/.test(referrerHost)) return 'organic_search';
  return 'referral';
}

export function captureAttribution(config: RejourneyWebConfig, routeName?: string): WebAttributionContext | null {
  if (config.captureAttribution === false) return null;

  const location = getLocation();
  const doc = getDocument();
  if (!location || !doc) return null;

  const allowedQueryParams = config.attribution?.allowedQueryParams || DEFAULT_ALLOWED_ATTRIBUTION_PARAMS;
  const allowlisted = new Set(allowedQueryParams.map((key) => key.toLowerCase()));
  const url = new URL(location.href);
  const entryQuery: Record<string, string> = {};

  for (const key of allowedQueryParams) {
    const value = url.searchParams.get(key);
    if (value) entryQuery[key] = value.slice(0, 256);
  }

  const clickIds: Record<string, string> = {};
  if (config.attribution?.preserveClickIds === true) {
    for (const key of CLICK_ID_PARAMS) {
      const value = url.searchParams.get(key);
      if (value) clickIds[key] = value.slice(0, 256);
    }
  }

  const referrerCapture = config.attribution?.captureReferrer ?? 'domain-only';
  const rawReferrer = doc.referrer || '';
  const domain = referrerDomain(rawReferrer);
  const referrer = referrerCapture === false
    ? null
    : referrerCapture === 'domain-only'
      ? domain
      : scrubUrl(rawReferrer);

  const entryPath = scrubUrl(location.href, { allowedQueryParams, pathOnly: true });
  const entryUrl = config.attribution?.captureEntryUrl === false
    ? ''
    : config.attribution?.captureEntryUrl === 'path-only'
      ? entryPath
      : scrubUrl(location.href, { allowedQueryParams: [...allowlisted] });

  const context: WebAttributionContext = {
    entryUrl,
    entryPath,
    entryQuery,
    referrer,
    referrerDomain: domain,
    source: url.searchParams.get('utm_source'),
    medium: url.searchParams.get('utm_medium'),
    campaign: url.searchParams.get('utm_campaign'),
    term: url.searchParams.get('utm_term'),
    content: url.searchParams.get('utm_content'),
    clickIds,
    landingRoute: routeName || location.pathname,
    navigationType: getNavigationType(),
    channel: classifyChannel(url.searchParams, domain, location.hostname),
  };

  return config.attribution?.beforeSendAttribution?.(context) ?? context;
}
