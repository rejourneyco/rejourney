export type WebUtmAttribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  campaignId: string | null;
  term: string | null;
  content: string | null;
  sourcePlatform: string | null;
  channel: string | null;
  hasUtm: boolean;
  label: string;
  title: string;
};

const NOT_SET = 'Not set';

function readMetadataString(session: any, keys: string[]): string | null {
  const metadata = session?.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  for (const key of keys) {
    const value = metadata[key];
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

export function isWebSessionLike(session: any): boolean {
  return String(session?.platform || session?.deviceInfo?.platform || session?.deviceInfo?.os || '').toLowerCase() === 'web';
}

export function getWebReferral(session: any): string | null {
  return session?.webReferral ||
    readMetadataString(session, ['webReferral', 'webReferrerDomain', 'webAttributionSource']) ||
    null;
}

export function formatWebReferralLabel(referral: string | null): string {
  const raw = String(referral || '').trim();
  if (!raw) return 'Direct';

  const normalized = raw.toLowerCase();
  if (['direct', '(direct)', 'none', 'null', 'undefined'].includes(normalized)) {
    return 'Direct';
  }

  const maybeUrl = raw.includes('://')
    ? raw
    : raw.includes('.') && !raw.includes(' ')
      ? `https://${raw}`
      : null;

  if (maybeUrl) {
    try {
      const hostname = new URL(maybeUrl).hostname;
      if (hostname) return hostname;
    } catch {
      // Fall through to raw referral below.
    }
  }

  return raw;
}

function readUtm(session: any): Omit<WebUtmAttribution, 'hasUtm' | 'label' | 'title'> {
  return {
    source: readMetadataString(session, ['utm_source', 'webAttributionSource']),
    medium: readMetadataString(session, ['utm_medium', 'webAttributionMedium']),
    campaign: readMetadataString(session, ['utm_campaign', 'webAttributionCampaign']),
    campaignId: readMetadataString(session, ['utm_id', 'webAttributionCampaignId']),
    term: readMetadataString(session, ['utm_term', 'webAttributionTerm']),
    content: readMetadataString(session, ['utm_content', 'webAttributionContent']),
    sourcePlatform: readMetadataString(session, ['utm_source_platform', 'webAttributionSourcePlatform']),
    channel: readMetadataString(session, ['webAttributionChannel']),
  };
}

export function getWebUtmAttribution(session: any): WebUtmAttribution {
  const utm = readUtm(session);
  const hasUtm = Boolean(
    utm.source ||
    utm.medium ||
    utm.campaign ||
    utm.campaignId ||
    utm.term ||
    utm.content ||
    utm.sourcePlatform,
  );

  if (!hasUtm) {
    return {
      ...utm,
      hasUtm: false,
      label: 'No UTM',
      title: 'No UTM attribution captured',
    };
  }

  const primary = [
    utm.source,
    utm.medium,
  ].filter(Boolean).join(' / ') || utm.campaign || utm.campaignId || utm.term || utm.content || utm.sourcePlatform || 'UTM';
  const secondary = [
    utm.campaign ? `campaign ${utm.campaign}` : null,
    utm.campaignId ? `id ${utm.campaignId}` : null,
    !utm.campaign && utm.term ? `term ${utm.term}` : null,
    !utm.campaign && !utm.term && utm.content ? `content ${utm.content}` : null,
    utm.sourcePlatform ? `platform ${utm.sourcePlatform}` : null,
  ].filter(Boolean).join(' · ');

  const fields = [
    utm.source ? `source=${utm.source}` : null,
    utm.medium ? `medium=${utm.medium}` : null,
    utm.campaign ? `campaign=${utm.campaign}` : null,
    utm.campaignId ? `id=${utm.campaignId}` : null,
    utm.term ? `term=${utm.term}` : null,
    utm.content ? `content=${utm.content}` : null,
    utm.sourcePlatform ? `source_platform=${utm.sourcePlatform}` : null,
  ].filter(Boolean).join(' · ');

  return {
    ...utm,
    hasUtm: true,
    label: secondary ? `${primary} · ${secondary}` : primary,
    title: fields,
  };
}

export function buildCollectedWebMetadata(session: any): Record<string, unknown> {
  const metadata = session?.metadata && typeof session.metadata === 'object'
    ? { ...(session.metadata as Record<string, unknown>) }
    : {};

  if (!isWebSessionLike(session)) return metadata;

  const referral = getWebReferral(session);
  const utm = getWebUtmAttribution(session);
  const collected: Record<string, unknown> = {
    webReferral: referral || 'Direct',
    webReferrerDomain: readMetadataString(session, ['webReferrerDomain']) || (referral ? formatWebReferralLabel(referral) : NOT_SET),
    webAttributionChannel: utm.channel || (referral ? 'referral' : 'direct'),
    webAttributionSource: utm.source || NOT_SET,
    webAttributionMedium: utm.medium || NOT_SET,
    webAttributionCampaign: utm.campaign || NOT_SET,
    webAttributionCampaignId: utm.campaignId || NOT_SET,
    utm_source: utm.source || NOT_SET,
    utm_medium: utm.medium || NOT_SET,
    utm_campaign: utm.campaign || NOT_SET,
    utm_id: utm.campaignId || NOT_SET,
    utm_term: utm.term || NOT_SET,
    utm_content: utm.content || NOT_SET,
    utm_source_platform: utm.sourcePlatform || NOT_SET,
  };

  return {
    ...collected,
    ...metadata,
  };
}

export function getAbsoluteUrl(urlPath: string | null | undefined, webDomain: string | null | undefined): string | undefined {
  if (!urlPath) return undefined;
  const trimmed = urlPath.trim();
  if (!trimmed) return undefined;

  // If it's already an absolute URL (has :// or starts with //), return it
  if (trimmed.includes('://') || trimmed.startsWith('//')) {
    return trimmed;
  }

  // If we have a webDomain, prepend it
  if (webDomain) {
    const domain = webDomain.trim();
    // Ensure domain doesn't end with slash and path starts with slash
    const base = domain.includes('://') ? domain : `https://${domain}`;
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${cleanBase}${cleanPath}`;
  }

  return trimmed;
}

