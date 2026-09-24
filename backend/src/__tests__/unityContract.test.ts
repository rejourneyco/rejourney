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
