import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updates, heatmapRollups } = vi.hoisted(() => ({
    updates: [] as { table: unknown; values: Record<string, any> }[],
    heatmapRollups: [] as Record<string, any>[],
}));

vi.mock('drizzle-orm', () => {
    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values });
    const any = () => ({});
    return { sql, and: any, eq: any, isNotNull: any, isNull: any, lt: any, notInArray: any, or: any };
});

vi.mock('../db/client.js', () => {
    const table = (name: string) => new Proxy({ name }, { get: (target, key) => (key in target ? (target as any)[key] : `${name}.${String(key)}`) });
    const tables = { sessions: table('sessions'), sessionMetrics: table('session_metrics'), errors: table('errors'), recordingArtifacts: table('recording_artifacts') };
    return {
        ...tables,
        db: {
            update: (target: unknown) => ({
                set: (values: Record<string, any>) => {
                    updates.push({ table: target, values });
                    return { where: async () => undefined };
                },
            }),
            insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined, returning: async () => [] }) }),
            select: () => {
                const builder: any = {};
                builder.from = () => builder;
                builder.where = () => builder;
                builder.limit = async () => [];
                return builder;
            },
        },
    };
});
vi.mock('../db/s3.js', () => ({ downloadFromS3ForArtifact: vi.fn(async () => null) }));
vi.mock('../services/issueTracker.js', () => ({ trackANRAsIssue: vi.fn(async () => undefined), trackErrorAsIssue: vi.fn(async () => undefined) }));
vi.mock('../services/stabilityIngest.js', () => ({ persistAnrOccurrence: vi.fn(async () => ({ inserted: false })) }));
vi.mock('../services/visitorLedger.js', () => ({ assignSessionVisitorById: vi.fn(async () => undefined) }));
vi.mock('../services/clickhouseApiStatsSink.js', () => ({
    buildClickHouseApiEndpointEventRow: vi.fn(() => ({})),
    writeApiEndpointEventsToClickHouse: vi.fn(async () => undefined),
}));
vi.mock('../services/clickhouseProductRollupsSink.js', () => ({
    buildClickHouseScreenHeatmapDailyRollupRows: vi.fn((params: Record<string, any>) => {
        heatmapRollups.push(params);
        return [];
    }),
    writeScreenHeatmapDailyRollupsToClickHouse: vi.fn(async () => undefined),
}));

import { processEventsArtifact } from '../services/ingestEventArtifactProcessor.js';

const log = { child: () => log, debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } as any;
const gameplayId = '7d3a9c1e5b2f4a6d8c0e1f2a3b4c5d6e';
const base = 1_770_000_000_000;
const tap = (offset: number, extra: Record<string, unknown> = {}) => ({
    type: 'touch', gestureType: 'tap', x: 120, y: 240, rageEligible: true,
    touches: [{ x: 120, y: 240, timestamp: base + offset }], timestamp: base + offset, ...extra,
});

async function ingest(events: unknown[]) {
    updates.length = 0;
    heatmapRollups.length = 0;
    await processEventsArtifact(
        { sessionId: 'session-1', artifactId: 'artifact-1' },
        { id: 'session-1', platform: 'ios', deviceId: 'device-1', startedAt: new Date(base), sdkPausedAt: null },
        { touchCount: 0, rageTapCount: 0, deadTapCount: 0, screensVisited: [], eventsSizeBytes: 0 },
        'project-1',
        Buffer.from(JSON.stringify({ events, deviceInfo: { screenWidth: 1080, screenHeight: 1920 } })),
        log,
        { recomputeMobileFrustrationCounts: false },
    );
    const metrics = updates.find((entry) => String((entry.table as any).name) === 'session_metrics' && 'touchCount' in entry.values)?.values;
    const stored = updates.find((entry) => String((entry.table as any).name) === 'sessions' && 'events' in entry.values)?.values.events;
    return { metrics, stored };
}

describe('ingest of gameplay intervals', () => {
    beforeEach(() => vi.clearAllMocks());

    it('counts taps during play as activity but never as rage taps or heatmap touches', async () => {
        const { metrics } = await ingest([
            { type: 'navigation', screen: 'Arena', timestamp: base },
            { type: 'gameplay', phase: 'start', gameplayId, name: 'arena', continued: false, startedAt: base + 50, timestamp: base + 50 },
            ...[100, 200, 300, 400, 500].map((offset) => tap(offset, { gameplayId })),
            { type: 'gameplay', phase: 'end', gameplayId, name: 'arena', outcome: 'quit', durationMs: 550, timestamp: base + 600 },
            { type: 'navigation', screen: 'Menu', timestamp: base + 700 },
            ...[800, 900, 1000].map((offset) => tap(offset)),
        ]);
        expect(metrics).toMatchObject({ touchCount: 8, rageTapCount: 1, deadTapCount: 0 });
        const arena = heatmapRollups.find((rollup) => rollup.screenName === 'Arena');
        const menu = heatmapRollups.find((rollup) => rollup.screenName === 'Menu');
        expect(arena).toBeUndefined();
        expect(Object.values(menu?.touchBuckets ?? {}).reduce((sum: number, count) => sum + Number(count), 0)).toBe(3);
        expect(Object.values(menu?.rageTapBuckets ?? {}).reduce((sum: number, count) => sum + Number(count), 0)).toBe(1);
    });

    it('ignores frustration shapes reported for input during play', async () => {
        const { metrics } = await ingest([
            { type: 'navigation', screen: 'Arena', timestamp: base },
            { type: 'rage_tap', x: 10, y: 10, gameplayId, timestamp: base + 100 },
            { type: 'dead_tap', x: 10, y: 10, gameplayId, timestamp: base + 200 },
            { type: 'gesture', gestureType: 'dead_tap', frustrationKind: 'dead_tap', x: 10, y: 10, gameplayId, timestamp: base + 300 },
            { type: 'gesture', gestureType: 'rage_tap', frustrationKind: 'rage_tap', x: 10, y: 10, timestamp: base + 400 },
        ]);
        expect(metrics).toMatchObject({ rageTapCount: 1, deadTapCount: 0 });
    });

    it('stores gameplay markers with headroom past the custom-event cap', async () => {
        const start = { type: 'gameplay', phase: 'start', gameplayId, name: 'arena', timestamp: base + 50 };
        const custom = { type: 'custom', name: 'coin_collected', payload: '{}', timestamp: base + 60 };
        const { stored } = await ingest([start, custom]);
        expect(stored.sql).toContain('jsonb_array_length');
        expect(stored.values).toContain(2000);
        expect(stored.values).toContain(2500);
        expect(stored.values).toContain(JSON.stringify([custom]));
        expect(stored.values).toContain(JSON.stringify([start]));
        // Markers never count as custom analytics events.
        const { metrics } = await ingest([start]);
        expect(metrics).toMatchObject({ customEventCount: 0 });
    });
});
