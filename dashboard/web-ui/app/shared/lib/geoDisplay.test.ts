import { describe, expect, it } from 'vitest';
import {
  countryCodeToDisplayName,
  findCountryCodesMatchingName,
  formatCountryDisplayName,
  formatGeoDisplay,
} from './geoDisplay';

describe('country display names', () => {
  it('expands ISO country codes without changing the stored filter value', () => {
    expect(countryCodeToDisplayName('FR')).toBe('France');
    expect(formatCountryDisplayName('US')).toBe('United States');
    expect(findCountryCodesMatchingName('France')).toContain('FR');
    expect(formatGeoDisplay({ country: 'DE', countryCode: 'DE', city: 'Berlin' })).toMatchObject({
      countryCode: 'DE',
      countryLabel: 'Germany',
      fullLabel: 'Berlin, Germany',
    });
  });

  it('keeps existing country names and the combined Palestine / Israel label', () => {
    expect(formatCountryDisplayName('Canada', 'CA')).toBe('Canada');
    expect(formatCountryDisplayName('Israel', 'IL')).toBe('Palestine / Israel');
  });
});
