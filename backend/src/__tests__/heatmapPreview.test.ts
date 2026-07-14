import { describe, expect, it } from 'vitest';

import {
    buildHeatmapScreenshotUrl,
    findHeatmapPreviewTimestampInEvents,
    hasCompatibleHeatmapVisualArtifact,
} from '../utils/heatmapPreview.js';

describe('heatmapPreview', () => {
    it('uses timestamped frame URLs for screen-specific screenshot previews', () => {
        expect(buildHeatmapScreenshotUrl('session_1', 1770000000123.7))
            .toBe('/api/session/frame/session_1/1770000000124.jpg');
    });

    it('falls back to the session thumbnail when no screen timestamp is available', () => {
        expect(buildHeatmapScreenshotUrl('session_1', null))
            .toBe('/api/session/thumbnail/session_1');
    });

    it('can require screen-specific timestamps for heatmap previews', () => {
        expect(buildHeatmapScreenshotUrl('session_1', null, { requireTimestamp: true }))
            .toBeNull();
    });

    it('returns null for empty session ids', () => {
        expect(buildHeatmapScreenshotUrl('', 1770000000123)).toBeNull();
    });

    it('accepts rrweb as the visual evidence source for browser heatmaps', () => {
        expect(hasCompatibleHeatmapVisualArtifact('web', ['events', 'rrweb'])).toBe(true);
        expect(hasCompatibleHeatmapVisualArtifact('web', ['events', 'screenshots'])).toBe(false);
    });

    it('continues to require screenshot archives for native heatmaps', () => {
        expect(hasCompatibleHeatmapVisualArtifact('ios', ['events', 'screenshots'])).toBe(true);
        expect(hasCompatibleHeatmapVisualArtifact('android', ['events'])).toBe(false);
    });

    it('uses interactions inherited from the current screen context for previews', () => {
        const base = 1_781_262_500_000;
        expect(findHeatmapPreviewTimestampInEvents({
            events: [
                { event: { timestamp: base + 1_000, type: 'navigation', screen: 'Home' } },
                { event: { timestamp: base + 4_000, type: 'touch', gestureType: 'tap', x: 120, y: 500 } },
            ],
            normalizedScreenName: 'Home',
            sessionStartMs: base,
            sessionEndMs: base + 10_000,
            interactionPrerollMs: 250,
            routeSettleMs: 2_000,
        })).toBe(base + 3_750);
    });

    it('does not settle a transition after the user has already left the screen', () => {
        const base = 1_781_262_500_000;
        expect(findHeatmapPreviewTimestampInEvents({
            events: [
                { event: { timestamp: base + 1_000, type: 'navigation', screen: 'Home' } },
                { event: { timestamp: base + 1_500, type: 'navigation', screen: 'Profile' } },
            ],
            normalizedScreenName: 'Home',
            sessionStartMs: base,
            sessionEndMs: base + 10_000,
            interactionPrerollMs: 250,
            routeSettleMs: 2_000,
        })).toBeNull();
    });

    it('uses a later stable transition when an earlier visit was too brief', () => {
        const base = 1_781_262_500_000;
        expect(findHeatmapPreviewTimestampInEvents({
            events: [
                { event: { timestamp: base + 1_000, type: 'navigation', screen: 'Home' } },
                { event: { timestamp: base + 1_500, type: 'navigation', screen: 'Profile' } },
                { event: { timestamp: base + 5_000, type: 'navigation', screen: 'Home' } },
            ],
            normalizedScreenName: 'Home',
            sessionStartMs: base,
            sessionEndMs: base + 10_000,
            interactionPrerollMs: 250,
            routeSettleMs: 2_000,
        })).toBe(base + 7_000);
    });

    it('falls back to a settled transition when there is no interaction', () => {
        const base = 1_781_262_500_000;
        expect(findHeatmapPreviewTimestampInEvents({
            events: [
                { event: { timestamp: base + 1_000, type: 'navigation', screen: 'Home' } },
            ],
            normalizedScreenName: 'Home',
            sessionStartMs: base,
            sessionEndMs: base + 10_000,
            interactionPrerollMs: 250,
            routeSettleMs: 2_000,
        })).toBe(base + 3_000);
    });
});
