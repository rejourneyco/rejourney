/**
 * Purging sessions with very large numbers of recording_artifacts rows.
 *
 * Unlike sessionArtifactPurge.test.ts this file keeps the real drizzle-orm and
 * the real schema and replaces only the pg client, so the assertions see the
 * SQL text and parameters the purge would send, and how many rows each
 * statement hands back to the worker. The fake client models the table as
 * counters; it does not execute SQL, so these tests pin the statement shapes
 * and the control flow, not PostgreSQL's behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type InvalidRow = { id: string; kind: string; s3ObjectKey: string; endpointId: string | null };

type CapturedStatement = { text: string; params: unknown[]; returnedRows: number };

const harness = vi.hoisted(() => ({
    statements: [] as Array<{ text: string; params: unknown[]; returnedRows: number }>,
    events: [] as string[],
    table: {
        session: null as null | {
            sessionId: string;
            projectId: string;
            teamId: string;
            retentionTier: number;
            retentionDays: number;
        },
        /** Rows stored under the canonical prefix; only ever counted. */
        canonicalRows: 0,
        canonicalBytes: 0,
        invalidRows: [] as Array<{ id: string; kind: string; s3ObjectKey: string; endpointId: string | null }>,
        endpointIds: [] as Array<string | null>,
        metricsReset: false,
        flagsSet: false,
    },
    /** 1-based index of the batched DELETE that should fail, or 0 for none. */
    failBatchDeleteAt: 0,
    batchDeleteCalls: 0,
    /** When true the DELETE answers without a count row. */
    omitDeleteCount: false,
    resolveRetentionDeletionEndpoints: vi.fn(),
    deletePrefixFromStorageEndpoints: vi.fn(),
    deleteObjectsFromStorageEndpoints: vi.fn(),
    beginRetentionDeletionLog: vi.fn(),
    finalizeRetentionDeletionLog: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function answer(rawText: string, params: unknown[]): { rows: unknown[]; rowCount: number } {
    const text = normalize(rawText);
    const { table } = harness;

    if (text === 'begin' || text === 'commit' || text === 'rollback') {
        return { rows: [], rowCount: 0 };
    }

    if (text.startsWith('select') && text.includes('from "sessions" inner join "projects"')) {
        const session = table.session;
        return session
            ? {
                rows: [[
                    session.sessionId,
                    session.projectId,
                    session.teamId,
                    session.retentionTier,
                    session.retentionDays,
                    table.flagsSet,
                    table.flagsSet,
                ]],
                rowCount: 1,
            }
            : { rows: [], rowCount: 0 };
    }

    if (text.startsWith('select count(*)') && text.includes('from "recording_artifacts"')) {
        const total = table.canonicalRows + table.invalidRows.length;
        // node-postgres returns bigint as a string and varchar[] as an array.
        return {
            rows: [[
                String(total),
                String(table.canonicalBytes),
                total > 0 ? [...table.endpointIds] : null,
                String(table.invalidRows.length),
            ]],
            rowCount: 1,
        };
    }

    if (text.startsWith('select') && text.includes('starts_with(')) {
        const limit = Number(params[params.length - 1]);
        const rows = table.invalidRows
            .slice(0, limit)
            .map((row) => [row.id, row.kind, row.s3ObjectKey, row.endpointId]);
        return { rows, rowCount: rows.length };
    }

    if (text.includes('DELETE FROM "recording_artifacts"')) {
        if (harness.omitDeleteCount) {
            return { rows: [], rowCount: 0 };
        }

        if (/LIMIT \$\d+/.test(text)) {
            harness.batchDeleteCalls += 1;
            if (harness.batchDeleteCalls === harness.failBatchDeleteAt) {
                throw new Error('Connection terminated unexpectedly');
            }
            const limit = Number(params[params.length - 1]);
            const fromCanonical = Math.min(table.canonicalRows, limit);
            table.canonicalRows -= fromCanonical;
            const fromInvalid = Math.min(table.invalidRows.length, limit - fromCanonical);
            table.invalidRows.splice(0, fromInvalid);
            const deleted = fromCanonical + fromInvalid;
            harness.events.push(`rows:batch:${deleted}`);
            return { rows: [{ deleted }], rowCount: 1 };
        }

        const ids = new Set(params.slice(1));
        const before = table.invalidRows.length;
        table.invalidRows = table.invalidRows.filter((row) => !ids.has(row.id));
        const deleted = before - table.invalidRows.length;
        harness.events.push(`rows:by-id:${deleted}`);
        return { rows: [{ deleted }], rowCount: 1 };
    }

    if (text.startsWith('update "session_metrics"')) {
        table.metricsReset = true;
        return { rows: [], rowCount: 1 };
    }

    if (text.startsWith('update "sessions"')) {
        table.flagsSet = true;
        harness.events.push('flags');
        return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected SQL in test: ${text}`);
}

vi.mock('../db/client.js', async () => {
    const schema = await vi.importActual<Record<string, unknown>>('../db/schema.js');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const client = {
        query: async (config: { text: string }, params: unknown[] = []) => {
            const result = answer(config.text, params);
            harness.statements.push({
                text: normalize(config.text),
                params,
                returnedRows: result.rows.length,
            });
            return result;
        },
    };
    return { ...schema, db: drizzle({ client: client as any }) };
});

vi.mock('../db/redis.js', () => ({
    getRedis: () => ({ del: vi.fn(async () => 0) }),
    invalidateSessionEndpointCache: vi.fn(async () => undefined),
    invalidateSessionExistsCache: vi.fn(async () => undefined),
}));

vi.mock('../db/s3.js', () => ({
    resolveRetentionDeletionEndpoints: harness.resolveRetentionDeletionEndpoints,
    deletePrefixFromStorageEndpoints: harness.deletePrefixFromStorageEndpoints,
    deleteObjectsFromStorageEndpoints: harness.deleteObjectsFromStorageEndpoints,
    classifyS3DeletionError: vi.fn(() => 'unexpected'),
}));

vi.mock('../services/retentionAudit.js', () => ({
    beginRetentionDeletionLog: harness.beginRetentionDeletionLog,
    finalizeRetentionDeletionLog: harness.finalizeRetentionDeletionLog,
}));

vi.mock('../logger.js', () => ({ logger: harness.logger }));

vi.mock('../config.js', () => ({
    config: { RETENTION_FAIL_ON_MISSING_STORAGE: false },
}));

import {
    ARTIFACT_ROW_DELETE_BATCH_SIZE,
    INVALID_ARTIFACT_PAGE_SIZE,
    purgeSessionArtifacts,
} from '../services/sessionArtifactPurge.js';

const SESSION_ID = 'session_big';
const PROJECT_ID = '00000000-0000-4000-8000-0000000000c1';
const TEAM_ID = '00000000-0000-4000-8000-0000000000b1';
const CANONICAL_PREFIX = `tenant/${TEAM_ID}/project/${PROJECT_ID}/sessions/${SESSION_ID}/`;
const DERIVED_PREFIX = `sessions/${SESSION_ID}/`;

function artifactStatements(): CapturedStatement[] {
    return harness.statements.filter((statement) => statement.text.includes('"recording_artifacts"'));
}

function batchDeletes(): CapturedStatement[] {
    return harness.statements.filter((statement) => /DELETE FROM "recording_artifacts".*LIMIT \$\d+/.test(statement.text));
}

function makeInvalidRows(count: number): InvalidRow[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
        kind: 'events',
        s3ObjectKey: `tenant/${TEAM_ID}/project/${PROJECT_ID}/misplaced/${SESSION_ID}/events_${index}.json.gz`,
        endpointId: 'endpoint_1',
    }));
}

/** Objects under the canonical prefix that the storage mock will report as deleted. */
let canonicalObjectsInStorage = 0;

describe('sessionArtifactPurge with very large sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        harness.statements.length = 0;
        harness.events.length = 0;
        harness.failBatchDeleteAt = 0;
        harness.batchDeleteCalls = 0;
        harness.omitDeleteCount = false;
        harness.table.session = {
            sessionId: SESSION_ID,
            projectId: PROJECT_ID,
            teamId: TEAM_ID,
            retentionTier: 1,
            retentionDays: 7,
        };
        harness.table.canonicalRows = 0;
        harness.table.canonicalBytes = 0;
        harness.table.invalidRows = [];
        harness.table.endpointIds = ['endpoint_1'];
        harness.table.metricsReset = false;
        harness.table.flagsSet = false;
        canonicalObjectsInStorage = 0;

        harness.beginRetentionDeletionLog.mockResolvedValue('log_1');
        harness.finalizeRetentionDeletionLog.mockResolvedValue(undefined);
        harness.resolveRetentionDeletionEndpoints.mockResolvedValue([{ id: 'endpoint_1' }]);
        harness.deletePrefixFromStorageEndpoints.mockImplementation(async (prefix: string) => {
            const deletedObjectCount = prefix === CANONICAL_PREFIX ? canonicalObjectsInStorage : 0;
            if (prefix === CANONICAL_PREFIX) canonicalObjectsInStorage = 0;
            harness.events.push(`storage:prefix:${prefix === CANONICAL_PREFIX ? 'canonical' : 'derived'}`);
            return { prefix, deletedObjectCount, deletedBytes: deletedObjectCount * 10, endpointResults: [] };
        });
        harness.deleteObjectsFromStorageEndpoints.mockImplementation(async (keys: string[]) => {
            harness.events.push(`storage:objects:${keys.length}`);
            return {
                deletedObjectCount: keys.length,
                deletedBytes: keys.length * 7,
                endpointResults: [{
                    endpointId: 'endpoint_1',
                    endpointUrl: 'https://storage-1.local',
                    projectId: PROJECT_ID,
                    shadow: false,
                    active: true,
                    bucket: 'bucket_1',
                    deletedObjectCount: keys.length,
                    deletedBytes: keys.length * 7,
                }],
            };
        });
    });

    it('purges a session with 2,000,000 artifacts without any statement returning a row per artifact', async () => {
        harness.table.canonicalRows = 2_000_000;
        // Above the int4 range on purpose: the production session held 4.4 GB.
        harness.table.canonicalBytes = 4_400_000_000;
        harness.table.endpointIds = ['endpoint_1', null];
        canonicalObjectsInStorage = 2_000_000;

        const result = await purgeSessionArtifacts(SESSION_ID, {
            runId: 'run_big',
            trigger: 'retention_expiry',
        });

        expect(result).toMatchObject({
            sessionId: SESSION_ID,
            plannedArtifactCount: 2_000_000,
            plannedArtifactBytes: 4_400_000_000,
            deletedArtifactCount: 2_000_000,
            deletedObjectCount: 2_000_000,
            storageMissing: false,
        });

        // No statement gave the worker more than one page of rows, and the
        // statements that touch recording_artifacts gave it one row at most.
        expect(Math.max(...harness.statements.map((statement) => statement.returnedRows))).toBeLessThanOrEqual(1);
        expect(artifactStatements().every((statement) => statement.returnedRows <= 1)).toBe(true);

        // 400 full batches, then one that finds nothing and ends the loop.
        const deletes = batchDeletes();
        expect(deletes).toHaveLength(2_000_000 / ARTIFACT_ROW_DELETE_BATCH_SIZE + 1);
        expect(deletes.every((statement) => (
            statement.params.length === 2
            && statement.params[0] === SESSION_ID
            && statement.params[1] === ARTIFACT_ROW_DELETE_BATCH_SIZE
        ))).toBe(true);
        expect(harness.events.filter((event) => event.startsWith('rows:batch:')).at(-1)).toBe('rows:batch:0');
        expect(harness.table.canonicalRows).toBe(0);

        // Reading the session's artifacts costs one full pass at this size, so
        // exactly one statement may do it: the aggregate. With no misplaced
        // keys the page query is never sent, and the only other statements on
        // recording_artifacts are the batched deletes.
        const shapes = new Set(artifactStatements().map((statement) => statement.text));
        expect(shapes.size).toBe(2);
        const totalsStatements = artifactStatements().filter((statement) => statement.text.startsWith('select count(*)'));
        expect(totalsStatements).toHaveLength(1);
        expect(artifactStatements().filter((statement) => statement.text.startsWith('select'))).toHaveLength(1);
        const totalsSql = totalsStatements[0].text;
        const [deleteSql] = [...shapes].filter((text) => text.includes('DELETE FROM'));

        expect(totalsSql).toBe(
            'select count(*), coalesce(sum(coalesce("size_bytes", "declared_size_bytes", 0)), 0),'
            + ' array_agg(distinct "endpoint_id"),'
            + ' count(*) filter (where not starts_with("s3_object_key", $1::text))'
            + ' from "recording_artifacts" where "recording_artifacts"."session_id" = $2',
        );
        // The prefix travels as a bound value, never as SQL text or a pattern.
        expect(totalsStatements[0].params).toEqual([CANONICAL_PREFIX, SESSION_ID]);
        expect(totalsSql).not.toContain(TEAM_ID);

        expect(deleteSql).toBe(
            'WITH deleted AS ( DELETE FROM "recording_artifacts" WHERE "recording_artifacts"."id" IN ('
            + ' SELECT "recording_artifacts"."id" FROM "recording_artifacts"'
            + ' WHERE "recording_artifacts"."session_id" = $1 LIMIT $2 ) RETURNING 1 )'
            + ' SELECT count(*)::int AS deleted FROM deleted',
        );

        // Storage, then rows, then flags.
        const kinds = harness.events.map((event) => event.split(':')[0]);
        const lastStorageEvent = kinds.lastIndexOf('storage');
        const firstRowEvent = kinds.indexOf('rows');
        const lastRowEvent = kinds.lastIndexOf('rows');
        expect(lastStorageEvent).toBeGreaterThanOrEqual(0);
        expect(lastStorageEvent).toBeLessThan(firstRowEvent);
        expect(lastRowEvent).toBeLessThan(harness.events.indexOf('flags'));
        expect(harness.table.flagsSet).toBe(true);
        expect(harness.table.metricsReset).toBe(true);

        expect(harness.resolveRetentionDeletionEndpoints).toHaveBeenCalledWith(PROJECT_ID, ['endpoint_1', null]);
        expect(harness.deletePrefixFromStorageEndpoints).toHaveBeenCalledWith(CANONICAL_PREFIX, expect.any(Array));
        expect(harness.deletePrefixFromStorageEndpoints).toHaveBeenCalledWith(DERIVED_PREFIX, expect.any(Array));
        expect(harness.beginRetentionDeletionLog).toHaveBeenCalledWith(expect.objectContaining({
            plannedArtifactRowCount: 2_000_000,
            plannedArtifactBytes: 4_400_000_000,
        }));
        expect(harness.finalizeRetentionDeletionLog).toHaveBeenCalledWith('log_1', expect.objectContaining({
            status: 'completed',
            deletedArtifactRowCount: 2_000_000,
            deletedObjectCount: 2_000_000,
            storageMissing: false,
            details: expect.objectContaining({
                invalidArtifacts: [],
                invalidArtifactsTruncated: false,
            }),
        }));
    });

    it('caps the invalid-artifact list, flags the truncation, and still deletes every misplaced object', async () => {
        const invalidRows = makeInvalidRows(2_500);
        harness.table.canonicalRows = 10;
        harness.table.canonicalBytes = 1_000;
        harness.table.invalidRows = [...invalidRows];
        canonicalObjectsInStorage = 10;

        const result = await purgeSessionArtifacts(SESSION_ID, {
            runId: 'run_invalid',
            trigger: 'retention_expiry',
        });

        // The worker never holds more than one page (plus the look-ahead row).
        expect(Math.max(...harness.statements.map((statement) => statement.returnedRows)))
            .toBe(INVALID_ARTIFACT_PAGE_SIZE + 1);

        // The aggregate counted misplaced keys, so the page query was sent:
        // once for each of the three pages, bounded and unordered.
        const pageStatements = harness.statements.filter((statement) => (
            statement.text.startsWith('select "id"') && statement.text.includes('starts_with(')
        ));
        expect(pageStatements).toHaveLength(3);
        for (const statement of pageStatements) {
            expect(statement.text).toBe(
                'select "id", "kind", "s3_object_key", "endpoint_id" from "recording_artifacts"'
                + ' where ("recording_artifacts"."session_id" = $1'
                + ' and NOT starts_with("recording_artifacts"."s3_object_key", $2::text)) limit $3',
            );
            expect(statement.params).toEqual([SESSION_ID, CANONICAL_PREFIX, INVALID_ARTIFACT_PAGE_SIZE + 1]);
        }
        expect(harness.statements.filter((statement) => statement.text.startsWith('select count(*)'))).toHaveLength(1);

        const finalizeParams = harness.finalizeRetentionDeletionLog.mock.calls[0][1];
        expect(finalizeParams.status).toBe('completed');
        expect(finalizeParams.details.invalidArtifacts).toHaveLength(INVALID_ARTIFACT_PAGE_SIZE);
        expect(finalizeParams.details.invalidArtifacts[0]).toEqual({
            artifactId: invalidRows[0].id,
            kind: 'events',
            s3ObjectKey: invalidRows[0].s3ObjectKey,
            endpointId: 'endpoint_1',
        });
        expect(finalizeParams.details.invalidArtifactsTruncated).toBe(true);

        // Truncating the audit list must not strand objects: every misplaced
        // key is still sent for deletion exactly once, a page at a time.
        const deletedKeys = harness.deleteObjectsFromStorageEndpoints.mock.calls.flatMap(([keys]) => keys as string[]);
        expect(harness.deleteObjectsFromStorageEndpoints.mock.calls.map(([keys]) => (keys as string[]).length))
            .toEqual([1_000, 1_000, 500]);
        expect(new Set(deletedKeys)).toEqual(new Set(invalidRows.map((row) => row.s3ObjectKey)));
        expect(deletedKeys).toHaveLength(2_500);
        expect(finalizeParams.details.invalidArtifactDeletedObjectCount).toBe(2_500);
        expect(finalizeParams.details.invalidArtifactDeletedBytes).toBe(2_500 * 7);
        // Per-endpoint results are folded, not appended once per page.
        expect(finalizeParams.details.endpointResults).toEqual([
            expect.objectContaining({ endpointId: 'endpoint_1', deletedObjectCount: 2_500, deletedBytes: 2_500 * 7 }),
        ]);

        // A page's rows go only after that page's objects, and the flags last.
        expect(harness.events.filter((event) => !event.startsWith('storage:prefix:'))).toEqual([
            'storage:objects:1000',
            'rows:by-id:1000',
            'storage:objects:1000',
            'rows:by-id:1000',
            'storage:objects:500',
            'rows:batch:510',
            'rows:batch:0',
            'flags',
        ]);

        // The by-id deletes are bounded by the page size and scoped to the session.
        const byIdDeletes = harness.statements.filter((statement) => (
            statement.text.includes('DELETE FROM "recording_artifacts"') && !/LIMIT \$\d+/.test(statement.text)
        ));
        expect(byIdDeletes).toHaveLength(2);
        for (const statement of byIdDeletes) {
            expect(statement.text).toMatch(
                /^WITH deleted AS \( DELETE FROM "recording_artifacts" WHERE "recording_artifacts"\."session_id" = \$1 AND "recording_artifacts"\."id" in \(\$2, .*\$1001\) RETURNING 1 \) SELECT count\(\*\)::int AS deleted FROM deleted$/,
            );
            expect(statement.params).toHaveLength(INVALID_ARTIFACT_PAGE_SIZE + 1);
            expect(statement.params[0]).toBe(SESSION_ID);
        }

        expect(result.deletedArtifactCount).toBe(2_510);
        expect(result.plannedArtifactCount).toBe(2_510);
        expect(finalizeParams.deletedArtifactRowCount).toBe(2_510);
        expect(harness.table.invalidRows).toHaveLength(0);
        expect(harness.logger.info).toHaveBeenCalledWith(
            expect.objectContaining({ invalidArtifactCount: 2_500, deletedArtifactCount: 2_510 }),
            expect.any(String),
        );
    });

    it('does not flag truncation when the invalid artifacts fit in one page', async () => {
        harness.table.invalidRows = makeInvalidRows(INVALID_ARTIFACT_PAGE_SIZE);

        await purgeSessionArtifacts(SESSION_ID, { runId: 'run_exact', trigger: 'retention_expiry' });

        const finalizeParams = harness.finalizeRetentionDeletionLog.mock.calls[0][1];
        expect(finalizeParams.details.invalidArtifacts).toHaveLength(INVALID_ARTIFACT_PAGE_SIZE);
        expect(finalizeParams.details.invalidArtifactsTruncated).toBe(false);
        expect(harness.deleteObjectsFromStorageEndpoints).toHaveBeenCalledTimes(1);
        expect(harness.events).not.toContain('rows:by-id:1000');
    });

    it('resumes after a failure part-way through the row batches', async () => {
        harness.table.canonicalRows = 12_000;
        harness.table.canonicalBytes = 120_000;
        canonicalObjectsInStorage = 12_000;
        harness.failBatchDeleteAt = 2;

        await expect(purgeSessionArtifacts(SESSION_ID, {
            runId: 'run_crash',
            trigger: 'retention_expiry',
        })).rejects.toMatchObject({
            // drizzle wraps driver errors and keeps the original as the cause.
            cause: expect.objectContaining({ message: 'Connection terminated unexpectedly' }),
        });

        // First batch committed; the session is still unflagged, so still eligible.
        expect(harness.table.canonicalRows).toBe(7_000);
        expect(harness.table.flagsSet).toBe(false);
        expect(harness.table.metricsReset).toBe(false);
        expect(harness.finalizeRetentionDeletionLog).toHaveBeenLastCalledWith('log_1', expect.objectContaining({
            status: 'failed',
            deletedArtifactRowCount: 5_000,
            errorText: expect.stringContaining('DELETE FROM "recording_artifacts"'),
        }));

        // Next run: storage is already empty and 7,000 rows are left.
        harness.failBatchDeleteAt = 0;
        harness.statements.length = 0;
        harness.events.length = 0;
        harness.beginRetentionDeletionLog.mockResolvedValue('log_2');

        const resumed = await purgeSessionArtifacts(SESSION_ID, {
            runId: 'run_resume',
            trigger: 'retention_expiry',
        });

        expect(resumed).toMatchObject({
            plannedArtifactCount: 7_000,
            deletedArtifactCount: 7_000,
            deletedObjectCount: 0,
            storageMissing: true,
        });
        expect(harness.events.filter((event) => event.startsWith('rows:') || event === 'flags')).toEqual([
            'rows:batch:5000',
            'rows:batch:2000',
            'rows:batch:0',
            'flags',
        ]);
        expect(harness.table.canonicalRows).toBe(0);
        expect(harness.table.flagsSet).toBe(true);
        expect(harness.table.metricsReset).toBe(true);
        expect(harness.finalizeRetentionDeletionLog).toHaveBeenLastCalledWith('log_2', expect.objectContaining({
            status: 'completed',
            deletedArtifactRowCount: 7_000,
            storageMissing: true,
        }));
    });

    it('resumes through the missing-storage recovery path when failing closed is enabled', async () => {
        // State left by a run that died after storage and some row batches.
        harness.table.canonicalRows = 3_200;
        harness.table.canonicalBytes = 32_000;
        canonicalObjectsInStorage = 0;

        await expect(purgeSessionArtifacts(SESSION_ID, {
            runId: 'run_resume_closed',
            trigger: 'retention_expiry',
            failOnMissingStorage: true,
        })).rejects.toThrow(`Canonical storage missing for session ${SESSION_ID}`);
        expect(harness.table.canonicalRows).toBe(3_200);
        expect(harness.table.flagsSet).toBe(false);
        expect(batchDeletes()).toHaveLength(0);

        // What the worker does next for that error message.
        const recovered = await purgeSessionArtifacts(SESSION_ID, {
            runId: 'run_resume_closed',
            trigger: 'retention_expiry_repair_missing_storage',
            allowMissingStorage: true,
            failOnMissingStorage: true,
        });

        expect(recovered).toMatchObject({ deletedArtifactCount: 3_200, storageMissing: true });
        expect(harness.table.canonicalRows).toBe(0);
        expect(harness.table.flagsSet).toBe(true);
    });

    it('completes for a session whose rows are already gone but whose flags were never set', async () => {
        const result = await purgeSessionArtifacts(SESSION_ID, {
            runId: 'run_flags_only',
            trigger: 'retention_expiry',
        });

        expect(result).toMatchObject({
            plannedArtifactCount: 0,
            deletedArtifactCount: 0,
            storageMissing: false,
        });
        expect(batchDeletes()).toHaveLength(1);
        expect(harness.table.flagsSet).toBe(true);
        expect(harness.resolveRetentionDeletionEndpoints).toHaveBeenCalledWith(PROJECT_ID, []);
    });

    it('fails instead of setting the flags when a delete does not report its row count', async () => {
        harness.table.canonicalRows = 20_000;
        canonicalObjectsInStorage = 20_000;
        harness.omitDeleteCount = true;

        await expect(purgeSessionArtifacts(SESSION_ID, {
            runId: 'run_no_count',
            trigger: 'retention_expiry',
        })).rejects.toThrow('Unexpected deleted row count');

        expect(harness.table.flagsSet).toBe(false);
        expect(harness.finalizeRetentionDeletionLog).toHaveBeenLastCalledWith('log_1', expect.objectContaining({
            status: 'failed',
        }));
    });
});
