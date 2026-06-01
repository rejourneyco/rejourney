import { describe, expect, it } from 'vitest';

import { buildMobileAttentionHeatmap, type MobileHierarchySnapshot } from '../utils/mobileAttentionHeatmap.js';

const hierarchy = (
    timestamp: number,
    children: Array<Record<string, unknown>>,
    screenName = 'Home',
): MobileHierarchySnapshot => ({
    timestamp,
    screenName,
    screen: { width: 393, height: 852, scale: 3 },
    rootElement: {
        type: 'UIWindow',
        frame: { x: 0, y: 0, w: 393, h: 852 },
        children,
    },
});

const textNode = (x: number, y: number, w: number, h: number, textLength: number) => ({
    type: 'UILabel',
    frame: { x, y, w, h },
    textLength,
});

const buttonNode = (x: number, y: number, w: number, h: number, textLength = 12) => ({
    type: 'UIButton',
    frame: { x, y, w, h },
    textLength,
    interactive: true,
});

const imageNode = (x: number, y: number, w: number, h: number, type = 'UIImageView') => ({
    type,
    frame: { x, y, w, h },
    hasImage: true,
});

const containerNode = (
    x: number,
    y: number,
    w: number,
    h: number,
    type: string,
    children: Array<Record<string, unknown>> = [],
    extra: Record<string, unknown> = {},
) => ({
    type,
    frame: { x, y, w, h },
    children,
    ...extra,
});

describe('mobileAttentionHeatmap', () => {
    it('turns a pause on visible hierarchy content into attention hotspots without taps', () => {
        const result = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [],
                hierarchySnapshots: [
                    hierarchy(1_000, [
                        textNode(28, 84, 320, 42, 28),
                    ]),
                ],
                screenshotTimestamps: [1_700, 2_400],
                durationMs: 2_000,
            },
        ], {}, null, 'Home');

        expect(result.modelVersion).toBe('mobile-attention-v1');
        expect(result.sampledSessions).toBe(1);
        expect(result.hotspots.length).toBeGreaterThan(0);
        expect(result.hotspots[0]?.kind).toBe('attention');
        expect(result.hotspots[0]?.y).toBeLessThan(0.35);
        expect(result.hotspots.length).toBeGreaterThan(100);
        expect(Math.max(...result.hotspots.map((hotspot) => hotspot.y))).toBeGreaterThan(0.80);
        expect(result.dwellByDepth.some((value) => value > 0)).toBe(true);
        expect(result.signalsUsed).toContain('hierarchy');
        expect(result.signalsUsed).toContain('screenshots');
    });

    it('uses touch lookahead to lift the likely pre-tap target', () => {
        const result = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [
                    {
                        type: 'touch',
                        gestureType: 'tap',
                        timestamp: 1_337,
                        screenName: 'Home',
                        x: 196,
                        y: 720,
                        touches: [{ x: 196, y: 720, timestamp: 1_337 }],
                    },
                ],
                hierarchySnapshots: [
                    hierarchy(500, [
                        buttonNode(60, 100, 270, 56),
                        buttonNode(60, 692, 270, 56),
                    ]),
                ],
                screenshotTimestamps: [1_500],
            },
        ], {}, null, 'Home');

        expect(result.hotspots[0]?.y).toBeGreaterThan(0.70);
        expect(result.hotspots[0]?.kind).toMatch(/attention|touch/);
    });

    it('lifts search bars as semantic attention targets before taps happen', () => {
        const result = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [],
                hierarchySnapshots: [
                    hierarchy(1_000, [
                        textNode(28, 72, 320, 46, 9),
                        containerNode(20, 128, 353, 48, 'UISearchBar', [], { placeholder: 'Search countries' }),
                        textNode(28, 220, 320, 48, 90),
                    ], 'Countries'),
                ],
                screenshotTimestamps: [1_600, 2_200],
            },
        ], {}, null, 'Countries');

        expect(result.hotspots[0]?.y).toBeGreaterThan(0.12);
        expect(result.hotspots[0]?.y).toBeLessThan(0.28);
    });

    it('keeps bottom app bars and selected tabs visible in the attention field', () => {
        const result = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [],
                hierarchySnapshots: [
                    hierarchy(1_000, [
                        textNode(28, 96, 320, 48, 32),
                        textNode(28, 232, 320, 72, 80),
                        containerNode(24, 752, 345, 72, 'UITabBar', [
                            buttonNode(42, 8, 72, 52, 9),
                            buttonNode(136, 8, 72, 52, 3),
                            buttonNode(230, 8, 72, 52, 5),
                        ], { label: 'Bottom navigation selected tab' }),
                    ]),
                ],
                screenshotTimestamps: [1_700, 2_400],
            },
        ], {}, null, 'Home');

        expect(result.hotspots.slice(0, 40).some((hotspot) => hotspot.y > 0.84 && hotspot.intensity > 0.55)).toBe(true);
    });

    it('treats image and video regions as strong visual attention candidates', () => {
        const result = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [],
                hierarchySnapshots: [
                    hierarchy(1_000, [
                        containerNode(24, 88, 345, 80, 'UIView'),
                        imageNode(32, 220, 329, 210, 'AVPlayerView'),
                        textNode(28, 482, 320, 52, 26),
                    ]),
                ],
                screenshotTimestamps: [1_700, 2_400],
            },
        ], {}, null, 'Home');

        expect(result.hotspots[0]?.y).toBeGreaterThan(0.22);
        expect(result.hotspots[0]?.y).toBeLessThan(0.54);
    });

    it('suppresses dwell credited during fast scroll gestures', () => {
        const stable = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [],
                hierarchySnapshots: [
                    hierarchy(1_000, [textNode(28, 160, 320, 80, 80)]),
                ],
                screenshotTimestamps: [1_300, 1_600],
            },
        ], {}, null, 'Home');
        const fastScroll = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [
                    {
                        type: 'gesture',
                        gestureType: 'scroll',
                        timestamp: 1_000,
                        screenName: 'Home',
                    },
                ],
                hierarchySnapshots: [
                    hierarchy(1_000, [textNode(28, 160, 320, 80, 80)]),
                ],
                screenshotTimestamps: [1_300, 1_600],
            },
        ], {}, null, 'Home');

        const stableDwell = stable.dwellByDepth.reduce((sum, dwell) => sum + dwell, 0);
        const fastScrollDwell = fastScroll.dwellByDepth.reduce((sum, dwell) => sum + dwell, 0);
        expect(fastScrollDwell).toBeLessThan(stableDwell);
    });

    it('does not credit attention while the app is backgrounded', () => {
        const result = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [
                    { type: 'app_state', state: 'background', timestamp: 500, screenName: 'Home' },
                ],
                hierarchySnapshots: [
                    hierarchy(500, [textNode(28, 120, 320, 80, 70)]),
                ],
                screenshotTimestamps: [2_000],
            },
        ], {}, null, 'Home');

        expect(result.hotspots).toEqual([]);
        expect(result.dwellByDepth.every((value) => value === 0)).toBe(true);
    });

    it('falls back to normalized touch priors when replay signals are unavailable', () => {
        const result = buildMobileAttentionHeatmap([], {
            viewportWidth: 393,
            viewportHeight: 852,
        }, {
            touchBuckets: { '0.50,0.82': 10 },
            rageTapBuckets: { '0.52,0.82': 5 },
            totalTouches: 10,
            totalRageTaps: 5,
        }, 'Home');

        expect(result.hotspots.length).toBeGreaterThan(0);
        expect(result.hotspots[0]?.y).toBeGreaterThan(0.75);
        expect(result.hotspots.some((hotspot) => hotspot.kind === 'rage')).toBe(true);
        expect(result.confidence).toBe('low');
    });

    it('derives average session duration from replay sampling timestamps when stored duration is unavailable', () => {
        const result = buildMobileAttentionHeatmap([
            {
                platform: 'ios',
                events: [],
                hierarchySnapshots: [
                    hierarchy(1_000, [textNode(28, 160, 320, 80, 80)]),
                ],
                screenshotTimestamps: [1_400, 2_900],
            },
        ], {}, null, 'Home');

        expect(result.avgSessionDurationMs).toBe(1_900);
        expect(result.dwellByDepth.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);
    });
});
