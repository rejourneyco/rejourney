import { describe, expect, it } from 'vitest';
import {
  buildHumanSummary,
  conditionsToArchiveQuery,
  getConditionShortLabel,
  type LocationCondition,
} from './queryBuilderTypes';

function location(overrides: Partial<LocationCondition>): LocationCondition {
  return {
    id: 'location-1',
    type: 'location',
    mode: 'country',
    ...overrides,
  };
}

describe('session replay location query rules', () => {
  it('maps a country-only rule to the archive API', () => {
    expect(conditionsToArchiveQuery([location({ country: 'US' })])).toEqual({
      geoCountry: 'US',
    });
  });

  it('maps a city-only rule without accidentally restricting the country', () => {
    expect(conditionsToArchiveQuery([location({ mode: 'city', city: 'Austin', country: 'US' })])).toEqual({
      geoCity: 'Austin',
    });
  });

  it('maps a precise country-and-city rule and summarizes it clearly', () => {
    const condition = location({ mode: 'both', country: 'US', city: 'Austin' });

    expect(conditionsToArchiveQuery([condition])).toEqual({
      geoCountry: 'US',
      geoCity: 'Austin',
    });
    expect(buildHumanSummary([condition])).toBe('Sessions where in Austin, US');
    expect(getConditionShortLabel(condition)).toBe('Austin, US');
  });
});
