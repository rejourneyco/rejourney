import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Query = { text: string; values?: unknown[] };
type PutInput = { Bucket?: string; Key: string; Body: Buffer; ContentType?: string };

const state = vi.hoisted(() => ({
    queries: [] as Array<{ text: string; values?: unknown[] }>,
    lockAttempts: [] as Array<{ key: string; blocking: boolean }>,
    heldLocks: new Set<string>(),
    revenueRows: [] as unknown[],
    checkpoint: {} as Record<string, unknown>,
}));

const lockClient = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
        if (text.includes('pg_try_advisory_xact_lock')) {
            const key = String(values?.[0]);
            state.lockAttempts.push({ key, blocking: false });
            return { rows: [{ acquired: !state.heldLocks.has(key) }] };
        }
        if (text.includes('pg_advisory_xact_lock')) {
            state.lockAttempts.push({ key: String(values?.[0]), blocking: true });
        }
        return { rows: [] };
    }),
    release: vi.fn(),
};

vi.mock('../db/client.js', () => ({
    db: {},
    pool: {
        connect: vi.fn(async () => lockClient),
        query: vi.fn(async (text: string, values?: unknown[]) => {
            state.queries.push({ text, values });
            if (text.includes('research_extraction_jobs_session_lake_schema_unique')) return { rows: [{ active: true }], rowCount: 1 };
            if (text.includes('AS lagging')) return { rows: [{ lagging: false }], rowCount: 1 };
            if (text.includes('FROM research_lake_revenue_export_checkpoints')) return { rows: [state.checkpoint], rowCount: 1 };
            if (text.includes('FROM project_revenue_daily')) return { rows: state.revenueRows, rowCount: state.revenueRows.length };
            return { rows: [], rowCount: 0 };
        }),
    },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { runResearchLakeExtractionCycle, runResearchLakeV2ExtractionCycle } from '../services/researchLake.js';

const V1_LOCK = 'research-lake:v1:revenue-export';
const V2_LOCK = 'research-lake:v2:revenue-export';
const RAW_PROJECT_ID = '3f4f7d8a-7660-4a78-b944-442051c62eca';

const revenueRow = {
    id: '7bc5c775-c68d-43a7-9b82-f7cd81633823',
    project_id: RAW_PROJECT_ID,
    source_provider: 'revenuecat',
    date: '2026-06-11',
    currency: 'usd',
    gross_amount_cents: 14997,
    refund_amount_cents: 999,
    fee_amount_cents: 0,
    net_amount_cents: 13998,
    transaction_count: 7,
    refund_count: 1,
    subscriber_count: 4,
    trial_count: 2,
    subscription_start_count: 3,
    cancellation_count: 0,
    conversion_count: 0,
    updated_at: new Date('2026-06-11T12:00:00Z'),
};

const emptyCheckpoint = {
    full_backfill_started_at: null,
    full_backfill_completed_at: null,
    full_backfill_cursor_date: null,
    full_backfill_cursor_project_id: null,
    full_backfill_cursor_provider: null,
    full_backfill_cursor_currency: null,
    incremental_cursor_updated_at: null,
    incremental_cursor_id: null,
};

const puts: PutInput[] = [];
const originalConfig = { ...config };
const originalCompletionIndex = process.env.JOB_COMPLETION_INDEX;

/** The V2 cycle sleeps between idle claim rounds; drive those sleeps without waiting for them. */
async function runToCompletion<T>(run: () => Promise<T>): Promise<T> {
    let settled = false;
    const outcome = run().finally(() => { settled = true; });
    outcome.catch(() => undefined);
    while (!settled) {
        await vi.advanceTimersByTimeAsync(20_000);
        await new Promise((resolve) => setImmediate(resolve));
    }
    return outcome;
}

function revenueQueries(): Query[] {
    return state.queries.filter((query) => (
        query.text.includes('research_lake_revenue_export_checkpoints') || query.text.includes('project_revenue_daily')
    ));
}

function revenueLockAttempts(): Array<{ key: string; blocking: boolean }> {
    return state.lockAttempts.filter((attempt) => attempt.key.includes('revenue-export'));
}

describe('research lake revenue outcomes export ownership', () => {
    beforeEach(() => {
        // Only the timers the cycle sleeps on; the zip writer needs real setImmediate.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        state.queries.length = 0;
        state.lockAttempts.length = 0;
        state.heldLocks.clear();
        state.revenueRows = [revenueRow];
        state.checkpoint = { ...emptyCheckpoint };
        puts.length = 0;
        lockClient.query.mockClear();
        delete process.env.JOB_COMPLETION_INDEX;
        Object.assign(config, {
            RESEARCH_LAKE_ENABLED: true,
            RESEARCH_LAKE_V2_ENABLED: true,
            RESEARCH_LAKE_PREFIX: 'legacy-v1',
            RESEARCH_LAKE_V2_PREFIX: '/lake-v2/',
            RESEARCH_LAKE_ENDPOINT: 'https://lake.storage.test',
            RESEARCH_LAKE_BUCKET: 'research-lake-test',
            RESEARCH_LAKE_ACCESS_KEY_ID: 'access',
            RESEARCH_LAKE_SECRET_ACCESS_KEY: 'secret',
            RESEARCH_LAKE_REVENUE_OUTCOMES_ENABLED: true,
            RESEARCH_LAKE_REVENUE_OUTCOMES_BATCH_SIZE: 500,
            // No backfill share, so the V2 session lanes find nothing and the cycle drains quickly.
            RESEARCH_LAKE_V2_BACKFILL_PERCENT: 0,
        });
        vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: { input: PutInput }) => {
            puts.push(command.input);
            return {};
        }) as never);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        Object.assign(config, originalConfig);
        if (originalCompletionIndex === undefined) delete process.env.JOB_COMPLETION_INDEX;
        else process.env.JOB_COMPLETION_INDEX = originalCompletionIndex;
    });

    it('runs the export from the V2 cycle on the primary shard under the V2 section lock', async () => {
        const summary = await runToCompletion(runResearchLakeV2ExtractionCycle);

        // Skip-if-held: one non-blocking attempt on the V2 key, never the retired V1 key.
        expect(revenueLockAttempts()).toEqual([{ key: V2_LOCK, blocking: false }]);
        expect(summary.revenueOutcomes).toEqual({ attempted: 1, exported: 1, failed: 0, mode: 'backfill' });

        const basePath = puts[0]?.Key.replace(/\/manifest\.json$/, '') ?? '';
        expect(basePath).toMatch(
            /^lake-v2\/lake=revenue_outcomes\/project_key=[0-9a-f]{20}\/date=2026-06-11\/provider=revenuecat\/currency=usd$/,
        );
        expect(puts.map((put) => put.Key)).toEqual([
            `${basePath}/manifest.json`,
            `${basePath}/quality.json`,
            `${basePath}/daily_revenue.json`,
            `${basePath}.zip`,
        ]);
        expect(puts.every((put) => put.Bucket === 'research-lake-test')).toBe(true);
        expect(puts.some((put) => put.Key.startsWith('legacy-v1'))).toBe(false);

        for (const put of puts.slice(0, 3)) {
            const document = JSON.parse(put.Body.toString('utf8'));
            expect(document.schema_version).toBe(2);
            expect(JSON.stringify(document)).not.toContain(RAW_PROJECT_ID);
        }
        const manifest = JSON.parse(puts[0].Body.toString('utf8'));
        expect(manifest.lake).toBe('revenue_outcomes');
        expect(manifest.files.zip).toBe(`${basePath}.zip`);

        // The batch was smaller than the batch size, so this run also closes the backfill.
        const advance = state.queries.find((query) => query.text.includes('full_backfill_cursor_date = COALESCE'));
        expect(advance?.values?.slice(0, 6)).toEqual(['default', '2026-06-11', RAW_PROJECT_ID, 'revenuecat', 'usd', true]);
    });

    it('leaves the export to the primary shard when the V2 cycle runs on another shard', async () => {
        process.env.JOB_COMPLETION_INDEX = '2';

        const summary = await runToCompletion(runResearchLakeV2ExtractionCycle);

        expect(revenueLockAttempts()).toEqual([]);
        expect(revenueQueries()).toEqual([]);
        expect(puts).toEqual([]);
        expect(summary.revenueOutcomes).toEqual({ attempted: 0, exported: 0, failed: 0, mode: 'idle' });
    });

    it('skips the export when another worker holds the V2 section lock', async () => {
        state.heldLocks.add(V2_LOCK);

        const summary = await runToCompletion(runResearchLakeV2ExtractionCycle);

        expect(revenueLockAttempts()).toEqual([{ key: V2_LOCK, blocking: false }]);
        expect(revenueQueries()).toEqual([]);
        expect(puts).toEqual([]);
        expect(summary.revenueOutcomes).toEqual({ attempted: 0, exported: 0, failed: 0, mode: 'idle' });
    });

    it('keeps the export off when RESEARCH_LAKE_REVENUE_OUTCOMES_ENABLED is off', async () => {
        config.RESEARCH_LAKE_REVENUE_OUTCOMES_ENABLED = false;

        const summary = await runToCompletion(runResearchLakeV2ExtractionCycle);

        expect(revenueQueries()).toEqual([]);
        expect(puts).toEqual([]);
        expect(summary.revenueOutcomes).toEqual({ attempted: 0, exported: 0, failed: 0, mode: 'disabled' });
    });

    it('does not run the export while V2 extraction is disabled', async () => {
        config.RESEARCH_LAKE_V2_ENABLED = false;

        const summary = await runToCompletion(runResearchLakeV2ExtractionCycle);

        expect(revenueLockAttempts()).toEqual([]);
        expect(revenueQueries()).toEqual([]);
        expect(puts).toEqual([]);
        expect(summary.revenueOutcomes.exported).toBe(0);
    });

    it('no longer runs the export from the V1 cycle', async () => {
        const summary = await runToCompletion(runResearchLakeExtractionCycle);

        // The V1 cycle did run: it took its own maintenance section on the primary shard.
        expect(state.lockAttempts.map((attempt) => attempt.key)).toContain('research-lake:v1:maintenance');
        expect(state.lockAttempts.map((attempt) => attempt.key)).not.toContain(V1_LOCK);
        expect(revenueLockAttempts()).toEqual([]);
        expect(revenueQueries()).toEqual([]);
        expect(puts).toEqual([]);
        expect(summary).not.toHaveProperty('revenueOutcomes');
    });
});
