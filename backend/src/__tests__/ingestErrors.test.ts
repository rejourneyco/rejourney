import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inserts, updates, issues, anrs } = vi.hoisted(() => ({
    inserts: [] as Record<string, any>[],
    updates: [] as Record<string, any>[],
    issues: [] as Record<string, any>[],
    anrs: [] as Record<string, any>[],
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
            update: () => ({ set: (values: Record<string, any>) => { updates.push(values); return { where: async () => undefined }; } }),
            insert: () => ({
                values: (values: Record<string, any>) => {
                    inserts.push(values);
                    return { onConflictDoNothing: () => ({ returning: async () => [{ id: `error-${inserts.length}` }] }) };
                },
            }),
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
vi.mock('../services/issueTracker.js', () => ({
    trackANRAsIssue: vi.fn(async () => undefined),
    trackErrorAsIssue: vi.fn(async (params: Record<string, any>) => { issues.push(params); }),
}));
vi.mock('../services/stabilityIngest.js', () => ({
    persistAnrOccurrence: vi.fn(async (params: Record<string, any>) => { anrs.push(params); return { inserted: true }; }),
}));
vi.mock('../services/visitorLedger.js', () => ({ assignSessionVisitorById: vi.fn(async () => undefined) }));
vi.mock('../services/clickhouseApiStatsSink.js', () => ({
    buildClickHouseApiEndpointEventRow: vi.fn(() => ({})),
    writeApiEndpointEventsToClickHouse: vi.fn(async () => undefined),
}));
vi.mock('../services/clickhouseProductRollupsSink.js', () => ({
    buildClickHouseScreenHeatmapDailyRollupRows: vi.fn(() => []),
    writeScreenHeatmapDailyRollupsToClickHouse: vi.fn(async () => undefined),
}));

import { processEventsArtifact } from '../services/ingestEventArtifactProcessor.js';

const log = { child: () => log, debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } as any;
const base = 1_770_000_000_000;
const error = (offset: number, fields: Record<string, unknown>) => ({
    type: 'error', message: `failure ${offset}`, stack: 'Game.Update ()', timestamp: base + offset, ...fields,
});

async function ingest(events: unknown[]) {
    inserts.length = 0;
    updates.length = 0;
    issues.length = 0;
    anrs.length = 0;
    await processEventsArtifact(
        { sessionId: 'session-1', artifactId: 'artifact-1' },
        { id: 'session-1', platform: 'ios', deviceId: 'device-1', startedAt: new Date(base), sdkPausedAt: null },
        { touchCount: 0, rageTapCount: 0, deadTapCount: 0, screensVisited: [], eventsSizeBytes: 0 },
        'project-1',
        Buffer.from(JSON.stringify({ events, deviceInfo: { screenWidth: 1080, screenHeight: 1920 } })),
        log,
        { recomputeMobileFrustrationCounts: false },
    );
    // Issue tracking is fire-and-forget.
    await new Promise((resolve) => setImmediate(resolve));
}

describe('ingest of error events', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps exceptions the app handled out of the unhandled bucket', async () => {
        await ingest([
            error(1, { name: 'System.InvalidOperationException', exceptionCategory: 'InvalidOperationException', handled: true, source: 'unity_capture' }),
            error(2, { name: 'ArgumentOutOfRangeException', exceptionCategory: 'ArgumentOutOfRangeException', handled: false, source: 'unity_log' }),
            error(3, { name: 'TypeError', exceptionCategory: 'TypeError', handled: false, source: 'react_native' }),
            error(4, { name: 'IllegalStateException' }),
        ]);
        expect(inserts.map((row) => [row.errorType, row.isHandled])).toEqual([
            ['js_error', true],
            ['unhandled_exception', false],
            ['js_error', false],
            ['unhandled_exception', undefined],
        ]);
        expect(issues.map((issue) => [issue.errorName, issue.isHandled])).toEqual([
            ['InvalidOperationException', true],
            ['ArgumentOutOfRangeException', false],
            ['TypeError', false],
            ['IllegalStateException', undefined],
        ]);
    });

    it('uses the screen sent with an error or ANR, else the last screen seen', async () => {
        await ingest([
            { type: 'navigation', screen: 'Menu', timestamp: base },
            error(10, { name: 'UnityLogError', screen: 'Shop' }),
            error(20, { name: 'UnityLogError' }),
            { type: 'anr', durationMs: 6000, threadState: 'unity_game_loop_stalled', screen: 'Arena', timestamp: base + 30 },
        ]);
        expect(inserts.map((row) => row.screenName)).toEqual(['Shop', 'Menu']);
        expect(anrs[0].deviceMetadata.screenName).toBe('Arena');
    });

    it('treats Unity screen views as screen changes', async () => {
        await ingest([
            { type: 'screen_view', screen: 'Shop', screenName: 'Shop', timestamp: base },
            error(10, { name: 'UnityLogError' }),
            { type: 'screen_view', screen: 'Arena', screenName: 'Arena', timestamp: base + 20 },
        ]);
        expect(inserts[0].screenName).toBe('Shop');
        expect(updates.find((values) => 'screensVisited' in values)?.screensVisited).toEqual(['Shop', 'Arena']);
    });
});
