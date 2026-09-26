import { describe, expect, it } from 'vitest';
import { createProjectSchema, updateProjectSchema } from '../validation/projects.js';
import { buildDeviceMetadataUpdates, summarizeEventsArtifact } from '../services/ingestEventArtifactProcessor.js';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { normalizeReplayEventPayload } from '../services/replayEventPayload.js';
import { extractMobileHierarchySnapshotsFromArtifact } from '../utils/mobileAttentionHeatmap.js';

describe('Unity mobile contract', () => {
    it('parses the Unity artifact fixture without exposing input labels or losing clocks', () => {
        const fixture = JSON.parse(readFileSync(new URL('../__fixtures__/unity/session.json', import.meta.url), 'utf8'));
        const snapshots = extractMobileHierarchySnapshotsFromArtifact(gzipSync(JSON.stringify(fixture.hierarchy)), 'unity/hierarchy.json.gz', 1770000999999);
        expect(snapshots[0].timestamp).toBe(1770000000200);
        expect(snapshots[0].screen).toMatchObject({ width: 1080, height: 1920 });
        expect(JSON.stringify(snapshots[0])).toContain('[masked]');
        const performance = fixture.events.find((e: {name?: string}) => e.name === 'unity_performance');
        expect(normalizeReplayEventPayload(performance).properties).toMatchObject({ frameTimeP95Ms: 16.7, fps: 60 });
        expect(buildDeviceMetadataUpdates(fixture.deviceInfo)).toMatchObject({ sdkFamily: 'unity', scriptingBackend: 'il2cpp', buildIdentifier: '0123456789abcdef0123456789abcdef' });
    });
    it.each([
        { bundleId: 'co.rejourney.arcadelab' },
        { packageName: 'co.rejourney.arcadelab' },
        { bundleId: 'co.rejourney.arcadelab', packageName: 'co.rejourney.arcadelab' },
    ])('accepts Unity identifiers %j', (identifiers) => {
        expect(createProjectSchema.safeParse({ name: 'Arcade Lab', platforms: ['unity'], ...identifiers }).success).toBe(true);
        expect(updateProjectSchema.safeParse({ platforms: ['unity', 'android'], ...identifiers }).success).toBe(true);
    });
    it('preserves Unity runtime context independently of OS', () => {
        const runtime = { sdkFamily: 'unity', unityVersion: '6000.6.2f1', scriptingBackend: 'il2cpp', graphicsApi: 'Vulkan', renderPipeline: 'URP', buildIdentifier: 'synthetic-build' };
        expect(buildDeviceMetadataUpdates({ ...runtime, platform: 'android' })).toMatchObject(runtime);
        expect(buildDeviceMetadataUpdates({ sdkFamily: 'x'.repeat(1024) }).sdkFamily).toHaveLength(128);
    });
    it('keeps capture timestamps even when artifacts arrive late', () => {
        const payload = { events: [
            { type: 'touch', timestamp: 1770000000100, x: 100, y: 200, coordinateSpace: 'px' },
            { type: 'error', timestamp: 1770000000200, source: 'unity', message: 'synthetic error' },
            { type: 'anr', timestamp: 1770000000300, source: 'unity_game_loop', durationMs: 5000 },
        ], deviceInfo: { platform: 'ios', sdkFamily: 'unity', time: 1770000060 } };
        const summary = summarizeEventsArtifact(Buffer.from(JSON.stringify(payload)), payload);
        expect(summary.startTime).toBe(1770000000100);
        expect(summary.endTime).toBe(1770000000300);
    });
});

describe('Unity gameplay frustration eligibility', () => {
    it('does not turn repeated combat taps into rage incidents', async () => {
        const { computeMobileFrustrationCounts } = await import('../utils/mobileFrustration.js');
        const events = [0, 100, 200, 300, 400].map(offset => ({ type: 'touch', gestureType: 'tap', x: 100, y: 100, timestamp: 1770000000000 + offset, rageEligible: false }));
        expect(computeMobileFrustrationCounts(events)).toEqual({ rageTapCount: 0, deadTapCount: 0 });
        expect(computeMobileFrustrationCounts(events.map(event => ({ ...event, rageEligible: true }))).rageTapCount).toBeGreaterThan(0);
    });
});

describe('Unity gameplay markers', () => {
    const fixture = JSON.parse(readFileSync(new URL('../__fixtures__/unity/session.json', import.meta.url), 'utf8'));

    it('pairs the fixture markers into one interval that holds the gameplay tap', async () => {
        const { deriveGameplayIntervals, gameplayIntervalAt, gameplayMarkersFromEvents, isGameplayTelemetryEvent } = await import('../utils/gameplayIntervals.js');
        const markers = gameplayMarkersFromEvents(fixture.events, (event) => Number(event.timestamp));
        const intervals = deriveGameplayIntervals(markers, { start: 1770000000000, end: 1770000000600 });
        expect(intervals).toEqual([{
            index: 0, gameplayId: '9f1c2b7e4d5a4c3b8a716e5f4d3c2b1a', name: 'arena', start: 1770000000150, end: 1770000000350,
            outcome: 'completed', continued: false, startInferred: false, endInferred: false,
        }]);
        const touch = fixture.events.find((event: { type: string }) => event.type === 'touch');
        expect(isGameplayTelemetryEvent(touch)).toBe(true);
        expect(gameplayIntervalAt(intervals, touch.timestamp)?.gameplayId).toBe(touch.gameplayId);
        const error = fixture.events.find((event: { type: string }) => event.type === 'error');
        expect(gameplayIntervalAt(intervals, error.timestamp)).toBeNull();
    });

    it('keeps marker properties readable for the replay', () => {
        const end = fixture.events.find((event: { type: string; phase?: string }) => event.type === 'gameplay' && event.phase === 'end');
        expect(normalizeReplayEventPayload(end).properties).toMatchObject({ score: 3 });
    });

    it('never counts taps recorded during play as frustration, even from SDKs that mark them rage-eligible', async () => {
        const { computeMobileFrustrationCounts } = await import('../utils/mobileFrustration.js');
        const taps = [0, 100, 200, 300, 400].map((offset) => ({
            type: 'touch', gestureType: 'tap', x: 100, y: 100, timestamp: 1770000000000 + offset, rageEligible: true, gameplayId: 'segment',
        }));
        expect(computeMobileFrustrationCounts(taps)).toEqual({ rageTapCount: 0, deadTapCount: 0 });
        expect(computeMobileFrustrationCounts([{ type: 'rage_tap', x: 1, y: 1, timestamp: 1770000000000, gameplayId: 'segment' }])).toEqual({ rageTapCount: 0, deadTapCount: 0 });
        expect(computeMobileFrustrationCounts(taps.map(({ gameplayId: _unused, ...tap }) => tap)).rageTapCount).toBeGreaterThan(0);
    });
});
