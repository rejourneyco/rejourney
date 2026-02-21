export interface GeoLocationLike {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

export interface GeoDisplay {
  flagEmoji: string;
  cityLabel: string | null;
  countryLabel: string | null;
  fullLabel: string;
  hasLocation: boolean;
}

const UNKNOWN_LOCATION_LABEL = 'Unknown location';

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCountry(
  country: string | null,
  countryCode: string | null
): { country: string | null; countryCode: string | null } {
  const normalizedCode = countryCode?.toUpperCase() ?? null;
  const hasIsraelMention =
    normalizedCode === 'IL' ||
    normalizedCode === 'PS/IL' ||
    (country ? /\bisrael\b/i.test(country) : false);

  if (hasIsraelMention) {
    return {
      country: 'Palestine / Israel',
      countryCode: 'PS/IL',
    };
  }

  return {
    country,
    countryCode: normalizedCode,
  };
}

function isoCountryCodeToFlagEmoji(countryCode: string): string {
  const normalized = countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '🌐';
  const base = 127397;
  return String.fromCodePoint(
    normalized.charCodeAt(0) + base,
    normalized.charCodeAt(1) + base
  );
}

export function countryCodeToFlagEmoji(countryCode: string | null | undefined): string {
  if (!countryCode) return '🌐';
  const normalized = countryCode.toUpperCase();

  if (normalized === 'PS/IL') {
    return '🇵🇸/🇮🇱';
  }

  if (normalized.includes('/')) {
    const flags = normalized
      .split('/')
      .map((code) => code.trim())
      .filter(Boolean)
      .map(isoCountryCodeToFlagEmoji);

    return flags.length > 0 ? flags.join('/') : '🌐';
  }

  return isoCountryCodeToFlagEmoji(normalized);
}

export function formatGeoDisplay(geoLocation: GeoLocationLike | null | undefined): GeoDisplay {
  const city = cleanText(geoLocation?.city);
  const region = cleanText(geoLocation?.region);
  const countryRaw = cleanText(geoLocation?.country);
  const countryCodeRaw = cleanText(geoLocation?.countryCode);
  const normalized = normalizeCountry(countryRaw, countryCodeRaw);
  const countryLabel = normalized.country;

  const fullLabel =
    [city, countryLabel].filter(Boolean).join(', ') ||
    region ||
    countryLabel ||
    UNKNOWN_LOCATION_LABEL;

  const hasLocation = fullLabel !== UNKNOWN_LOCATION_LABEL;

  return {
    flagEmoji: hasLocation ? countryCodeToFlagEmoji(normalized.countryCode) : '🌐',
    cityLabel: city,
    countryLabel,
    fullLabel,
    hasLocation,
  };
}
