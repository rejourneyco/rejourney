import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * processEventsArtifact: the per-artifact session row write is skipped when the
 * payload's device info matches the row the rollup just loaded.
 */

const { updates, assignSessionVisitorById } = vi.hoisted(() => ({
    updates: [] as { table: string; values: Record<string, any>; where: unknown }[],
    assignSessionVisitorById: vi.fn(async () => undefined),
}));

vi.mock('drizzle-orm', () => {
    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values });
    const op = (name: string) => (...args: unknown[]) => ({ op: name, args });
    return {
        sql,
        and: op('and'),
        eq: op('eq'),
        isNotNull: op('isNotNull'),
        isNull: op('isNull'),
        lt: op('lt'),
        notInArray: op('notInArray'),
        or: op('or'),
    };
});

vi.mock('../db/client.js', () => {
    const table = (name: string) => new Proxy({ name }, { get: (target, key) => (key in target ? (target as any)[key] : `${name}.${String(key)}`) });
    const tables = { sessions: table('sessions'), sessionMetrics: table('session_metrics'), errors: table('errors'), recordingArtifacts: table('recording_artifacts') };
    return {
        ...tables,
        db: {
            update: (target: any) => ({
                set: (values: Record<string, any>) => ({
                    where: async (where: unknown) => {
                        updates.push({ table: String(target.name), values, where });
                    },
                }),
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
vi.mock('../services/issueTracker.js', () => ({ resolveIssueUserId: vi.fn(async () => undefined), trackANRAsIssue: vi.fn(async () => undefined), trackErrorAsIssue: vi.fn(async () => undefined) }));
vi.mock('../services/stabilityIngest.js', () => ({ persistAnrOccurrence: vi.fn(async () => ({ inserted: false })) }));
vi.mock('../services/visitorLedger.js', () => ({ assignSessionVisitorById }));
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

const deviceInfo = { model: 'iPhone15,2', platform: 'ios', systemVersion: '17.4', appVersion: '1.2.3', sdkVersion: '1.5.1' };
const matchingSession = () => ({
    id: 'session-1',
    platform: 'ios',
    deviceModel: 'iPhone15,2',
    osVersion: '17.4',
    appVersion: '1.2.3',
    sdkVersion: '1.5.1',
    deviceId: 'device-1',
    startedAt: new Date(base),
    sdkPausedAt: null,
    metadata: { osVersion: '17.4', sdkVersion: '1.5.1', appVersion: '1.2.3' },
});

async function ingest(session: Record<string, any>, info: Record<string, unknown> = deviceInfo) {
    await processEventsArtifact(
        { sessionId: 'session-1', artifactId: 'artifact-1' },
        session,
        { touchCount: 0, rageTapCount: 0, deadTapCount: 0, screensVisited: [], eventsSizeBytes: 0 },
        'project-1',
        Buffer.from(JSON.stringify({ events: [], deviceInfo: info })),
        log,
        { recomputeMobileFrustrationCounts: false },
    );
}

const deviceWrites = () => updates.filter((entry) => entry.table === 'sessions' && 'updatedAt' in entry.values
    && Object.keys(entry.values).some((key) => ['appVersion', 'deviceModel', 'platform', 'deviceId', 'osVersion', 'sdkVersion', 'metadata'].includes(key)));

describe('processEventsArtifact device-info session write', () => {
    beforeEach(() => {
        updates.length = 0;
        vi.clearAllMocks();
    });

    it('sends no device-info statement when every reported value is already stored', async () => {
        await ingest(matchingSession());
        await ingest(matchingSession());

        expect(deviceWrites()).toEqual([]);
        // The old unconditional `SET updated_at = now()` write is gone too.
        expect(updates.filter((entry) => entry.table === 'sessions' && Object.keys(entry.values).join() === 'updatedAt')).toEqual([]);
        expect(assignSessionVisitorById).not.toHaveBeenCalled();
    });

    it('writes just the changed column with a per-column guard', async () => {
        await ingest({ ...matchingSession(), osVersion: '17.3' });

        const writes = deviceWrites();
        expect(writes).toHaveLength(1);
        expect(Object.keys(writes[0].values).sort()).toEqual(['osVersion', 'updatedAt']);
        expect(writes[0].values.osVersion).toBe('17.4');
        expect(writes[0].where).toEqual({
            op: 'and',
            args: [
                { op: 'eq', args: ['sessions.id', 'session-1'] },
                { op: 'or', args: [{ sql: '? is distinct from ?', values: ['sessions.osVersion', '17.4'] }] },
            ],
        });
    });

    it('still stamps the visitor ledger when device identity first arrives', async () => {
        const session = { ...matchingSession(), deviceId: null as string | null };

        await ingest(session, { ...deviceInfo, deviceId: 'device-9' });

        const writes = deviceWrites();
        expect(writes).toHaveLength(1);
        expect(writes[0].values.deviceId).toBe('device-9');
        expect(session.deviceId).toBe('device-9');
        expect(assignSessionVisitorById).toHaveBeenCalledWith('session-1', 'project-1');
    });
});
