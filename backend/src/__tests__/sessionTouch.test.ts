import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Session "touch" write path (markSessionIngestActivity).
 *
 * The fake database below builds every statement with the real drizzle query
 * builder, so the SQL text and parameters asserted here are what Postgres
 * receives. Row matching is decided by a test-local reading of that SQL text,
 * independent of the production mirror (shouldWriteSessionTouch); the two are
 * then checked against each other.
 */

type Row = {
    id: string;
    status: string;
    endedAt: Date | null;
    durationSeconds: number | null;
    backgroundTimeSeconds: number | null;
    lastIngestActivityAt: Date | null;
    updatedAt: Date | null;
};

const state = vi.hoisted(() => ({
    rows: new Map<string, any>(),
    statements: [] as Array<{ sql: string; params: unknown[]; written: boolean }>,
    transaction: null as any,
    execute: null as any,
}));

const TOUCH_WHERE = '("sessions"."id" = $n and (("sessions"."last_ingest_activity_at" is null) or "sessions"."last_ingest_activity_at" < $n))';
const REOPEN_WHERE = '("sessions"."id" = $n and ("sessions"."status" is distinct from \'processing\' or ("sessions"."ended_at" is not null) or ("sessions"."duration_seconds" is not null) or ("sessions"."last_ingest_activity_at" is null) or "sessions"."last_ingest_activity_at" < $n))';
const EXPLICIT_WHERE = '"sessions"."id" = $n';

/** Decide which row (if any) a rendered touch statement matches, from its SQL text alone. */
function matchRow(query: { sql: string; params: unknown[] }): Row | null {
    const whereText = query.sql.slice(query.sql.indexOf(' where ') + ' where '.length).replace(/\$\d+/g, '$n');
    const params = query.params;

    if (whereText === EXPLICIT_WHERE) {
        return state.rows.get(String(params[params.length - 1])) ?? null;
    }

    const row: Row | undefined = state.rows.get(String(params[params.length - 2]));
    if (!row) return null;
    const staleBefore = new Date(String(params[params.length - 1]));
    const stale = row.lastIngestActivityAt === null || row.lastIngestActivityAt.getTime() < staleBefore.getTime();

    if (whereText === TOUCH_WHERE) {
        return stale ? row : null;
    }
    if (whereText === REOPEN_WHERE) {
        const notReopened = row.status !== 'processing' || row.endedAt !== null || row.durationSeconds !== null;
        return notReopened || stale ? row : null;
    }
    throw new Error(`Unexpected touch statement: ${query.sql}`);
}

vi.mock('../db/client.js', async () => {
    const schema = await import('../db/schema.js');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const builder = drizzle.mock();
    state.transaction = vi.fn();
    state.execute = vi.fn();
    const db = {
        transaction: state.transaction,
        execute: state.execute,
        update: (table: any) => ({
            set: (payload: Record<string, unknown>) => ({
                where: async (condition: any) => {
                    const query = builder.update(table).set(payload as any).where(condition).toSQL();
                    const row = matchRow(query);
                    if (row) Object.assign(row, payload);
                    state.statements.push({ sql: query.sql, params: query.params, written: Boolean(row) });
                },
            }),
        }),
    };
    return { ...schema, db, dbRead: db, pool: {} };
});

vi.mock('../logger.js', () => {
    const log: any = { child: () => log, debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    return { logger: log };
});

import {
    SESSION_FINALIZE_IDLE_MS,
    SESSION_TOUCH_MIN_INTERVAL_MS,
    markSessionIngestActivity,
    shouldWriteSessionTouch,
} from '../services/sessionReconciliation.js';
import { deriveSessionEvidenceState } from '../services/sessionEvidence.js';
import { deriveSessionPresentationState, SESSION_LIVE_INGEST_WINDOW_MS } from '../services/sessionPresentationState.js';

const T0 = new Date('2026-11-27T12:00:00.000Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

function seed(overrides: Partial<Row> = {}): Row {
    const row: Row = {
        id: 'session_1',
        status: 'processing',
        endedAt: null,
        durationSeconds: null,
        backgroundTimeSeconds: 0,
        lastIngestActivityAt: T0,
        updatedAt: T0,
        ...overrides,
    };
    state.rows.set(row.id, row);
    return row;
}

const writes = () => state.statements.filter((statement) => statement.written).length;

describe('session touch (markSessionIngestActivity)', () => {
    beforeEach(() => {
        state.rows.clear();
        state.statements.length = 0;
        state.transaction.mockClear();
        state.execute.mockClear();
    });

    it('uses a named 15 second interval and widens server-side finalization by it', () => {
        expect(SESSION_TOUCH_MIN_INTERVAL_MS).toBe(15_000);
        expect(SESSION_LIVE_INGEST_WINDOW_MS).toBe(60_000);
        expect(SESSION_FINALIZE_IDLE_MS).toBe(SESSION_LIVE_INGEST_WINDOW_MS + SESSION_TOUCH_MIN_INTERVAL_MS);
    });

    it('sends a plain activity touch as one conditional autocommit UPDATE', async () => {
        seed();
        await markSessionIngestActivity('session_1', { at: at(30_000), updatedAt: at(30_001) });

        expect(state.statements).toHaveLength(1);
        expect(state.transaction).not.toHaveBeenCalled();
        expect(state.execute).not.toHaveBeenCalled();
        expect(state.statements[0].sql).toBe(
            'update "sessions" set "last_ingest_activity_at" = $1, "updated_at" = $2 '
            + 'where ("sessions"."id" = $3 and (("sessions"."last_ingest_activity_at" is null) '
            + 'or "sessions"."last_ingest_activity_at" < $4))',
        );
        expect(state.statements[0].params).toEqual([
            '2026-11-27T12:00:30.000Z',
            '2026-11-27T12:00:30.001Z',
            'session_1',
            '2026-11-27T12:00:15.000Z',
        ]);
    });

    it('sends a reopen touch with the same SET list as before plus the reopen-or-stale filter', async () => {
        seed();
        await markSessionIngestActivity('session_1', { at: at(30_000), updatedAt: at(30_001), reopen: true });

        expect(state.statements).toHaveLength(1);
        expect(state.transaction).not.toHaveBeenCalled();
        expect(state.statements[0].sql).toBe(
            'update "sessions" set "ended_at" = $1, "last_ingest_activity_at" = $2, "duration_seconds" = $3, '
            + '"status" = $4, "updated_at" = $5 '
            + 'where ("sessions"."id" = $6 and ("sessions"."status" is distinct from \'processing\' '
            + 'or ("sessions"."ended_at" is not null) or ("sessions"."duration_seconds" is not null) '
            + 'or ("sessions"."last_ingest_activity_at" is null) or "sessions"."last_ingest_activity_at" < $7))',
        );
        expect(state.statements[0].params).toEqual([
            null,
            '2026-11-27T12:00:30.000Z',
            null,
            'processing',
            '2026-11-27T12:00:30.001Z',
            'session_1',
            '2026-11-27T12:00:15.000Z',
        ]);
    });

    it('always writes explicit close timing from /session/end, even on a fresh row', async () => {
        const row = seed({ lastIngestActivityAt: at(29_000) });
        await markSessionIngestActivity('session_1', {
            at: at(20_000),
            updatedAt: at(30_000),
            endedAt: at(20_000),
            durationSeconds: 19.6,
            backgroundTimeSeconds: 0.4,
        });

        expect(state.statements).toHaveLength(1);
        expect(state.transaction).not.toHaveBeenCalled();
        expect(state.statements[0].sql).toBe(
            'update "sessions" set "ended_at" = $1, "last_ingest_activity_at" = $2, "duration_seconds" = $3, '
            + '"background_time_seconds" = $4, "updated_at" = $5 where "sessions"."id" = $6',
        );
        expect(state.statements[0].params).toEqual([
            '2026-11-27T12:00:20.000Z',
            '2026-11-27T12:00:20.000Z',
            20,
            0,
            '2026-11-27T12:00:30.000Z',
            'session_1',
        ]);
        expect(row.endedAt).toEqual(at(20_000));
        expect(row.durationSeconds).toBe(20);
    });

    it('skips a touch inside the interval and writes the first one after it', async () => {
        const row = seed();

        await markSessionIngestActivity('session_1', { at: at(14_999) });
        await markSessionIngestActivity('session_1', { at: at(15_000) });
        expect(writes()).toBe(0);
        expect(row.lastIngestActivityAt).toEqual(T0);

        await markSessionIngestActivity('session_1', { at: at(15_001) });
        expect(writes()).toBe(1);
        expect(row.lastIngestActivityAt).toEqual(at(15_001));
        expect(row.status).toBe('processing');
        expect(row.endedAt).toBeNull();
    });

    it('is idempotent under repeated and out-of-order calls and never moves the clock backwards', async () => {
        const row = seed();

        await markSessionIngestActivity('session_1', { at: at(20_000) });
        await markSessionIngestActivity('session_1', { at: at(20_000) });
        await markSessionIngestActivity('session_1', { at: at(20_000), reopen: true });
        await markSessionIngestActivity('session_1', { at: at(5_000) });
        await markSessionIngestActivity('session_1', { at: at(5_000), reopen: true });

        expect(state.statements).toHaveLength(5);
        expect(writes()).toBe(1);
        expect(row.lastIngestActivityAt).toEqual(at(20_000));
    });

    it('treats a missing session like a skipped write: zero rows, no error', async () => {
        await expect(markSessionIngestActivity('session_missing', { at: at(60_000) })).resolves.toBeUndefined();
        await expect(markSessionIngestActivity('session_missing', { at: at(60_000), reopen: true })).resolves.toBeUndefined();

        expect(state.statements).toHaveLength(2);
        expect(writes()).toBe(0);
    });

    it('reopens a finalized row on the next reopen touch regardless of how fresh its clock is', async () => {
        const row = seed({
            status: 'ready',
            endedAt: at(-5_000),
            durationSeconds: 42,
            lastIngestActivityAt: at(-1),
        });

        await markSessionIngestActivity('session_1', { at: T0, updatedAt: at(1), reopen: true });

        expect(writes()).toBe(1);
        expect(row).toMatchObject({
            status: 'processing',
            endedAt: null,
            durationSeconds: null,
            lastIngestActivityAt: T0,
            updatedAt: at(1),
        });
    });

    it.each([
        ['status is not processing', { status: 'pending' }],
        ['ended_at is set', { endedAt: new Date('2026-11-27T11:59:00.000Z') }],
        ['duration_seconds is set', { durationSeconds: 7 }],
    ])('reopen writes on a fresh row when %s', async (_label, overrides) => {
        const row = seed({ lastIngestActivityAt: at(-1), ...(overrides as Partial<Row>) });

        await markSessionIngestActivity('session_1', { at: T0, reopen: true });

        expect(writes()).toBe(1);
        expect(row).toMatchObject({ status: 'processing', endedAt: null, durationSeconds: null });
    });

    it('never clears close timing from a plain touch on a closed session', async () => {
        const endedAt = at(-60_000);
        const row = seed({ status: 'ready', endedAt, durationSeconds: 42, lastIngestActivityAt: at(-60_000) });

        await markSessionIngestActivity('session_1', { at: T0 });
        await markSessionIngestActivity('session_1', { at: at(1_000) });

        expect(writes()).toBe(1);
        expect(row).toMatchObject({ status: 'ready', endedAt, durationSeconds: 42, lastIngestActivityAt: T0 });
    });

    it('writes about once per interval for 50 chunks uploaded over 60 seconds', async () => {
        // Session row was just created (activity clock = T0). Each chunk touches the
        // session four times: presign (reopen), relay buffer, flush, complete.
        const row = seed();
        const chunkSpacingMs = 1_200;
        let lastTouchAt = T0;

        for (let chunk = 0; chunk < 50; chunk += 1) {
            const base = chunk * chunkSpacingMs;
            await markSessionIngestActivity('session_1', { at: at(base), reopen: true });
            await markSessionIngestActivity('session_1', { at: at(base + 150) });
            await markSessionIngestActivity('session_1', { at: at(base + 400) });
            await markSessionIngestActivity('session_1', { at: at(base + 600) });
            lastTouchAt = at(base + 600);

            // Requirement (b): the stored clock never lags the newest touch by more than the interval.
            expect(lastTouchAt.getTime() - row.lastIngestActivityAt!.getTime())
                .toBeLessThanOrEqual(SESSION_TOUCH_MIN_INTERVAL_MS);
        }

        // Before: 200 touches = 200 row writes inside 200 BEGIN/SET LOCAL/COMMIT wrappers (800 round trips).
        expect(state.statements).toHaveLength(200);
        expect(state.transaction).not.toHaveBeenCalled();
        // After: 200 single-statement round trips, of which only the first touch
        // after each 15 s boundary writes (t = 15.6 s, 31.2 s, 46.8 s).
        expect(writes()).toBe(3);
        expect(row).toMatchObject({ status: 'processing', endedAt: null, durationSeconds: null });
    });

    it('keeps the production mirror in step with the SQL filter', async () => {
        const clocks = [null, at(-60_000), at(-15_001), at(-15_000), at(-14_999), at(-1), T0, at(5_000)];
        const shapes: Array<Partial<Row>> = [
            {},
            { status: 'ready' },
            { status: 'pending' },
            { endedAt: at(-30_000) },
            { durationSeconds: 3 },
            { status: 'ready', endedAt: at(-30_000), durationSeconds: 3 },
        ];
        const optionSets = [
            { at: T0 },
            { at: T0, reopen: true },
            { at: T0, endedAt: T0 },
            { at: T0, endedAt: null },
            { at: T0, durationSeconds: 5 },
            { at: T0, backgroundTimeSeconds: 0 },
        ];

        let compared = 0;
        for (const lastIngestActivityAt of clocks) {
            for (const shape of shapes) {
                for (const options of optionSets) {
                    state.statements.length = 0;
                    const row = seed({ ...shape, lastIngestActivityAt });
                    const expected = shouldWriteSessionTouch({ ...row }, options);

                    await markSessionIngestActivity('session_1', options);

                    expect(
                        state.statements[0].written,
                        JSON.stringify({ lastIngestActivityAt, shape, options }),
                    ).toBe(expected);
                    compared += 1;
                }
            }
        }
        expect(compared).toBe(clocks.length * shapes.length * optionSets.length);
    });
});

describe('finalization absorbs the throttled activity clock', () => {
    const now = new Date('2026-11-27T12:10:00.000Z');
    const base = {
        status: 'processing',
        platform: 'ios',
        replayAvailable: true,
        recordingDeleted: false,
        isReplayExpired: false,
        startedAt: new Date('2026-11-27T12:00:00.000Z'),
        hasPendingWork: false,
        hasPendingReplayWork: false,
        now,
    };

    it('does not finalize server-side until the stored clock proves a full live window of real silence', () => {
        // Stored clock is 61 s old, but the newest real touch may be up to 15 s newer (46 s ago).
        const lastIngestActivityAt = new Date(now.getTime() - SESSION_LIVE_INGEST_WINDOW_MS - 1_000);

        const dashboard = deriveSessionPresentationState({ ...base, lastIngestActivityAt });
        expect(dashboard.isLiveIngest).toBe(false);
        expect(dashboard.shouldFinalize).toBe(true);

        const reconcile = deriveSessionPresentationState({
            ...base,
            lastIngestActivityAt,
            finalizationIdleMs: SESSION_FINALIZE_IDLE_MS,
        });
        expect(reconcile.isLiveIngest).toBe(false);
        expect(reconcile.shouldFinalize).toBe(false);
        expect(reconcile.effectiveStatus).toBe('processing');
    });

    it('finalizes server-side once the stored clock is older than live window + touch interval', () => {
        const reconcile = deriveSessionPresentationState({
            ...base,
            lastIngestActivityAt: new Date(now.getTime() - SESSION_FINALIZE_IDLE_MS),
            finalizationIdleMs: SESSION_FINALIZE_IDLE_MS,
        });
        expect(reconcile.shouldFinalize).toBe(true);
        expect(reconcile.effectiveStatus).toBe('ready');
    });

    it('still finalizes immediately on an explicit close and ignores idle windows below the live window', () => {
        const fresh = new Date(now.getTime() - 1_000);
        expect(deriveSessionPresentationState({
            ...base,
            lastIngestActivityAt: fresh,
            endedAt: fresh,
            finalizationIdleMs: SESSION_FINALIZE_IDLE_MS,
        }).shouldFinalize).toBe(true);

        expect(deriveSessionPresentationState({
            ...base,
            lastIngestActivityAt: new Date(now.getTime() - 30_000),
            finalizationIdleMs: 1_000,
        }).shouldFinalize).toBe(false);
    });

    it('holds Smart Capture evidence open for the same widened window', () => {
        const aggregate = {
            readyScreenshotCount: 1,
            readyScreenshotBytes: 10,
            readyWebReplayCount: 0,
            readyWebReplayBytes: 0,
            readyHierarchyCount: 0,
            openArtifactCount: 0,
            activeJobCount: 0,
            openReplayArtifactCount: 0,
            activeReplayJobCount: 0,
            latestReplayArtifactEndMs: null,
            latestEventArtifactEndMs: null,
            latestReadyAt: null,
            pendingEventEvidenceCount: 0,
            readyEventArtifactMissingDerivedCount: 0,
            hasPendingProcessingWork: false,
            hasPendingWork: false,
            hasPendingReplayWork: false,
        };
        const session = (ageMs: number) => ({
            startedAt: new Date('2026-11-27T12:00:00.000Z'),
            platform: 'ios',
            lastIngestActivityAt: new Date(now.getTime() - ageMs),
        });

        expect(deriveSessionEvidenceState({
            aggregate,
            finalizationIdleMs: SESSION_FINALIZE_IDLE_MS,
            now,
            session: session(SESSION_LIVE_INGEST_WINDOW_MS + 1_000),
        }).smartCaptureEvidenceSettled).toBe(false);
        expect(deriveSessionEvidenceState({
            aggregate,
            finalizationIdleMs: SESSION_FINALIZE_IDLE_MS,
            now,
            session: session(SESSION_FINALIZE_IDLE_MS),
        }).smartCaptureEvidenceSettled).toBe(true);
    });
});
