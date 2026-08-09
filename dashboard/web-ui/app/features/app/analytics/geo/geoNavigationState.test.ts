import { describe, expect, it } from 'vitest';
import {
    geoNavigationStatesEqual,
    getGeoNavigationStorageKey,
    normalizeGeoNavigationState,
    parseStoredGeoNavigationState,
    type GeoNavigationState,
} from './geoNavigationState';

describe('geographic navigation state', () => {
    it('restores the selected location, visitor, session, cluster, and viewport', () => {
        const state: GeoNavigationState = {
            metric: 'latency',
            country: 'France',
            city: 'Paris',
            markerLocation: { country: 'France', city: 'Paris' },
            clusterId: 'cluster:12:9:4',
            visitorId: 'visitor-123',
            activeSessionId: 'session-456',
            viewport: { latitude: 48.856613, longitude: 2.352222, zoom: 6.2549 },
        };

        expect(normalizeGeoNavigationState(state)).toEqual(state);
    });

    it('ignores incomplete locations and malformed viewports', () => {
        const state = normalizeGeoNavigationState({
            markerLocation: { country: 'France' },
            viewport: { latitude: 999, longitude: 2.35, zoom: 'not-a-number' },
        });

        expect(state.markerLocation).toBeNull();
        expect(state.viewport).toBeNull();
        expect(state.metric).toBe('sessions');
    });

    it('compares restored states by value', () => {
        const left = normalizeGeoNavigationState({
            markerLocation: { country: 'France', city: 'Paris' },
            visitorId: 'visitor-123',
            viewport: { latitude: 48.8, longitude: 2.3, zoom: 6 },
        });
        const right = normalizeGeoNavigationState(structuredClone(left));

        expect(geoNavigationStatesEqual(left, right)).toBe(true);
        expect(geoNavigationStatesEqual(left, { ...right, visitorId: 'visitor-456' })).toBe(false);
    });

    it('round-trips state saved while navigating between dashboard pages', () => {
        const state: GeoNavigationState = {
            metric: 'sessions',
            country: 'France',
            city: 'Paris',
            markerLocation: { country: 'France', city: 'Paris' },
            clusterId: null,
            visitorId: 'visitor-123',
            activeSessionId: 'session-456',
            viewport: { latitude: 48.8566, longitude: 2.3522, zoom: 8 },
        };

        expect(parseStoredGeoNavigationState(JSON.stringify(state))).toEqual(state);
        expect(parseStoredGeoNavigationState('{bad json')).toBeNull();
    });

    it('migrates legacy marker selections into the country and city drill-down', () => {
        const state = normalizeGeoNavigationState({
            markerLocation: { country: 'France', city: 'Paris' },
        });

        expect(state.country).toBe('France');
        expect(state.city).toBe('Paris');
        expect(state.metric).toBe('sessions');
    });

    it('isolates stored state by route scope and project', () => {
        expect(getGeoNavigationStorageKey('/dashboard', 'project-a')).not.toBe(
            getGeoNavigationStorageKey('/dashboard', 'project-b'),
        );
        expect(getGeoNavigationStorageKey('/demo', 'project-a')).not.toBe(
            getGeoNavigationStorageKey('/dashboard', 'project-a'),
        );
    });
});
