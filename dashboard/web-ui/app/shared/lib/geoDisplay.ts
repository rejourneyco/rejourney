export interface GeoLocationLike {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

export interface GeoDisplay {
  countryCode: string | null;
  cityLabel: string | null;
  countryLabel: string | null;
  fullLabel: string;
  hasLocation: boolean;
}

const UNKNOWN_LOCATION_LABEL = 'Unknown location';
const REGION_DISPLAY_NAMES = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;
let searchableCountryNames: Array<{ code: string; name: string }> | null = null;

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCountry(
  country: string | null,
  countryCode: string | null
): { country: string | null; countryCode: string | null } {
  const countryAsCode = country && /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : null;
  const normalizedCode = (countryCode?.toUpperCase() ?? countryAsCode) === 'UK'
    ? 'GB'
    : countryCode?.toUpperCase() ?? countryAsCode;
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

  const displayCountry = countryAsCode && normalizedCode
    ? countryCodeToDisplayName(normalizedCode)
    : country || (normalizedCode ? countryCodeToDisplayName(normalizedCode) : null);

  return {
    country: displayCountry,
    countryCode: normalizedCode,
  };
}

export function countryCodeToDisplayName(countryCode: string | null | undefined): string | null {
  const normalizedCode = cleanText(countryCode)?.toUpperCase();
  if (!normalizedCode) return null;
  if (normalizedCode === 'PS/IL' || normalizedCode === 'IL') return 'Palestine / Israel';

  const isoCode = normalizedCode === 'UK' ? 'GB' : normalizedCode;
  if (!/^[A-Z]{2}$/.test(isoCode)) return normalizedCode;

  const displayName = REGION_DISPLAY_NAMES?.of(isoCode);
  return displayName && displayName !== isoCode ? displayName : normalizedCode;
}

export function formatCountryDisplayName(
  country: string | null | undefined,
  countryCode?: string | null,
): string | null {
  const normalized = normalizeCountry(cleanText(country), cleanText(countryCode));
  return normalized.country;
}

export function findCountryCodesMatchingName(query: string): string[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery || !REGION_DISPLAY_NAMES) return [];

  if (!searchableCountryNames) {
    searchableCountryNames = [];
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        const name = REGION_DISPLAY_NAMES.of(code);
        if (name && name !== code && name !== 'Unknown Region') {
          searchableCountryNames.push({ code, name: name.toLocaleLowerCase() });
        }
      }
    }
  }

  return searchableCountryNames
    .filter(({ code, name }) => code.toLocaleLowerCase().includes(normalizedQuery) || name.includes(normalizedQuery))
    .map(({ code }) => code)
    .slice(0, 20);
}

function getIsoCountryCodes(countryCode: string | null | undefined): string[] {
  if (!countryCode) return [];
  return countryCode
    .toUpperCase()
    .split('/')
    .map((code) => code.trim())
    .filter((code) => /^[A-Z]{2}$/.test(code));
}

export function countryCodeToTwemojiFlagAssetNames(countryCode: string | null | undefined): string[] {
  return getIsoCountryCodes(countryCode).map((code) =>
    Array.from(code)
      .map((char) => (0x1f1e6 + char.charCodeAt(0) - 65).toString(16))
      .join('-')
  );
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
    countryCode: hasLocation ? normalized.countryCode : null,
    cityLabel: city,
    countryLabel,
    fullLabel,
    hasLocation,
  };
}
