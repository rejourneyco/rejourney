/**
 * The per-call deadline, the in-process concurrency cap, the byte cap as the
 * tools meet it, error handling and the access-check cache.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { teamMembers } from '../db/schema.js';
import { createDbAccessChecker } from '../mcp/context.js';
import type { McpScopedData } from '../mcp/data/types.js';
import { ConcurrencyGate, DEFAULT_MAX_CONCURRENT_TOOLS, DEFAULT_TOOL_DEADLINE_MS, isStatementTimeout } from '../mcp/runtime.js';
import { InMemoryUsageProvider, ResponseTimeWindow, percentile } from '../mcp/usage.js';
import type { McpCallRecord } from '../mcp/usage.js';
import { startMcpToolHarness } from './helpers/mcpToolHarness.js';
import type { McpToolHarness } from './helpers/mcpToolHarness.js';
import { PGLITE_START_TIMEOUT_MS } from './helpers/pgliteHarness.js';

const DEADLINE_MS = 1500;
/** Far below the real 64 KB, so ordinary results hit the cap. */
const BYTES_PER_CREDIT = 2000;
let h: McpToolHarness;
/** While set, `listProjects` waits for it before answering. */
let hold: Promise<void> | null = null;
let failNext: Error | null = null;
/** How many `listProjects` calls have reached the data layer. */
let entered = 0;

beforeAll(async () => {
    h = await startMcpToolHarness({
        toolDeadlineMs: DEADLINE_MS,
        maxConcurrentTools: 2,
        // Refuse at once: the wait for a slot has its own tests below.
        toolSlotWaitMs: 0,
        busyRetrySeconds: 3,
        bytesPerCredit: BYTES_PER_CREDIT,
        wrapData: (data): McpScopedData => ({
            ...data,
            async listProjects(ctx) {
                entered += 1;
                if (failNext) {
                    const error = failNext;
                    failNext = null;
                    throw error;
                }
                if (hold) await hold;
                return data.listProjects(ctx);
            },
        }),
    });
    // Connect up front, so a test's calls reach the server straight away.
    await Promise.all([h.client(h.tokens.a), h.client(h.tokens.b)]);
}, PGLITE_START_TIMEOUT_MS);

afterAll(async () => {
    await h.close();
});

function gate(): { release: () => void } {
    let release!: () => void;
    hold = new Promise<void>((resolve) => {
        release = () => {
            hold = null;
            resolve();
        };
    });
    return { release };
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function untilEntered(count: number): Promise<void> {
    for (let waited = 0; entered < count && waited < 5000; waited += 10) await settle(10);
    expect(entered).toBeGreaterThanOrEqual(count);
}

describe('defaults', () => {
    it('are a 20 s deadline and a fixed number of concurrent tools', () => {
        expect(DEFAULT_TOOL_DEADLINE_MS).toBe(20_000);
        expect(DEFAULT_MAX_CONCURRENT_TOOLS).toBeGreaterThan(0);
        const limiter = new ConcurrencyGate(1);
        const release = limiter.tryAcquire();
        expect(release).not.toBeNull();
        expect(limiter.tryAcquire()).toBeNull();
        release!();
        release!();
        expect(limiter.inFlight).toBe(0);
    });
});

describe('a statement the database stopped', () => {
    it('is recognised on the error or on what it wraps, and nothing else is', () => {
        expect(isStatementTimeout(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }))).toBe(true);
        expect(isStatementTimeout(new Error('Failed query', { cause: Object.assign(new Error('x'), { code: '57014' }) }))).toBe(true);
        expect(isStatementTimeout(Object.assign(new Error('unique violation'), { code: '23505' }))).toBe(false);
        expect(isStatementTimeout(new Error('plain'))).toBe(false);
        expect(isStatementTimeout(null)).toBe(false);
    });

    it('is answered as deadline_exceeded with the advice to narrow, not as an internal error', async () => {
        failNext = new Error('Failed query: select 1', { cause: Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }) });
        const out = await h.call(h.tokens.a, 'list_projects');
        expect(out.error).toMatchObject({ code: 'deadline_exceeded', message: expect.stringContaining('Narrow the time range') });
        expect(out.raw).not.toContain('select 1');
    });
});

describe('waiting for a slot', () => {
    it('hands a freed slot to the call that has waited longest, and gives up after the wait', async () => {
        const limiter = new ConcurrencyGate(1, 2);
        const held = await limiter.acquire(50);
        expect(held).not.toBeNull();

        const order: string[] = [];
        const first = limiter.acquire(1_000).then((release) => { order.push('first'); return release; });
        const second = limiter.acquire(1_000).then((release) => { order.push('second'); return release; });
        expect(limiter.waiting).toBe(2);
        // The queue is full: no waiting, an immediate no.
        expect(await limiter.acquire(1_000)).toBeNull();

        held!();
        const releaseFirst = await first;
        expect(order).toEqual(['first']);
        expect(limiter.inFlight).toBe(1);
        releaseFirst!();
        const releaseSecond = await second;
        expect(order).toEqual(['first', 'second']);

        // Nothing frees up in time: null, and the waiter is gone from the queue.
        expect(await limiter.acquire(20)).toBeNull();
        expect(limiter.waiting).toBe(0);
        releaseSecond!();
        expect(limiter.inFlight).toBe(0);
        // No queue allowed at all behaves like tryAcquire.
        const strict = new ConcurrencyGate(1);
        const only = await strict.acquire(1_000);
        expect(await strict.acquire(1_000)).toBeNull();
        only!();
    });
});

describe('concurrency cap', () => {
    it('answers "busy, retry in N seconds" as a tool error result (HTTP 200), then recovers', async () => {
        const blocker = gate();
        const before = entered;
        const first = h.call(h.tokens.a, 'list_projects');
        const second = h.call(h.tokens.b, 'list_projects');
        await untilEntered(before + 2);

        const raw = await fetch(h.mcpUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${h.tokens.a}`, 'MCP-Protocol-Version': '2025-06-18' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_usage', arguments: {} } }),
        });
        expect(raw.status).toBe(200);
        const body = (await raw.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
        expect(body.result.isError).toBe(true);
        expect(JSON.parse(body.result.content[0].text).error).toEqual({
            code: 'busy', message: 'The server is busy. Retry in 3 seconds.', retryAfterSeconds: 3, requestId: expect.stringMatching(/^req_/),
        });
        // Free tools are refused too: the cap is on work in flight, not on credits.
        const third = await h.call(h.tokens.a, 'get_session', { sessionId: h.manifest.teamA.special.long.sessionId });
        expect(third.error).toMatchObject({ code: 'busy', retryAfterSeconds: 3 });
        expect(h.calls.filter((record) => record.outcome === 'busy').length).toBeGreaterThanOrEqual(2);

        blocker.release();
        expect((await first).isError).toBe(false);
        expect((await second).isError).toBe(false);
        expect((await h.call(h.tokens.a, 'get_usage')).isError).toBe(false);
    });
});

describe('deadline', () => {
    it('stops answering for a call after the deadline, with a generic error, and keeps its slot until the work ends', async () => {
        const blocker = gate();
        const started = Date.now();
        const slow = await h.call(h.tokens.a, 'list_projects');
        const elapsed = Date.now() - started;
        expect(slow.error).toEqual({ code: 'deadline_exceeded', message: expect.stringContaining('took too long'), requestId: expect.stringMatching(/^req_/) });
        expect(elapsed).toBeGreaterThanOrEqual(DEADLINE_MS - 20);
        expect(elapsed).toBeLessThan(DEADLINE_MS + 1500);
        expect(h.calls[h.calls.length - 1]).toMatchObject({ tool: 'list_projects', outcome: 'deadline_exceeded', credits: 0, bytes: 0 });
        expect(h.calls[h.calls.length - 1].durationMs).toBeGreaterThanOrEqual(DEADLINE_MS - 20);

        // The abandoned work still holds one of the two slots.
        const before = entered;
        const other = h.call(h.tokens.b, 'list_projects');
        await untilEntered(before + 1);
        expect((await h.call(h.tokens.a, 'get_usage')).error?.code).toBe('busy');
        blocker.release();
        await other;
        await settle(30);
        expect((await h.call(h.tokens.a, 'get_usage')).isError).toBe(false);
        expect((await h.call(h.tokens.a, 'list_projects')).isError).toBe(false);
    });
});

describe('byte cap through the tools', () => {
    const range = { from: '2026-10-21T00:00:00.000Z', to: '2026-11-20T12:00:00.000Z' };

    it('search_sessions shortens the page to fit and its cursor resumes exactly there', async () => {
        const project = h.manifest.teamA.projects[0];
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            const out = await h.call(h.tokens.a, 'search_sessions', { projectId: project.id, ...range, ...(cursor ? { cursor } : {}) });
            expect(out.isError, out.text).toBe(false);
            expect(Buffer.byteLength(out.text, 'utf8')).toBeLessThanOrEqual(BYTES_PER_CREDIT);
            expect(out.data.sessions.length).toBeGreaterThan(0);
            expect(out.data.sessions.length).toBeLessThan(25);
            if (out.data.nextCursor) expect(out.data.meta.truncated).toBe(true);
            seen.push(...out.data.sessions.map((session: { id: string }) => session.id));
            cursor = out.data.nextCursor ?? undefined;
            pages += 1;
        } while (cursor && pages < 200);
        expect(pages).toBeGreaterThan(Math.ceil(project.sessionIds.length / 25));
        expect(seen).toHaveLength(project.sessionIds.length);
        expect(new Set(seen).size).toBe(seen.length);
        // The record for metering carries the size actually sent.
        const record = h.calls[h.calls.length - 1];
        expect(record).toMatchObject({ tool: 'search_sessions', outcome: 'ok', credits: 1 });
        expect(record.bytes).toBeLessThanOrEqual(BYTES_PER_CREDIT);
    }, 60_000);

    it('get_session_digests returns what fits for the credits charged and a cursor for the rest', async () => {
        const ids = h.manifest.teamA.projects[0].sessionIds.slice(0, 12);
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            const out = await h.call(h.tokens.a, 'get_session_digests', { sessionIds: ids, ...(cursor ? { cursor } : {}) });
            expect(out.isError, out.text).toBe(false);
            // 12 sessions cost 3 credits, so the cap is three times as high.
            expect(out.data.meta.credits).toBe(3);
            expect(Buffer.byteLength(out.text, 'utf8')).toBeLessThanOrEqual(3 * BYTES_PER_CREDIT);
            seen.push(...out.data.digests.map((digest: { id: string }) => digest.id));
            cursor = out.data.nextCursor ?? undefined;
            pages += 1;
        } while (cursor && pages < 20);
        expect(pages).toBeGreaterThan(1);
        expect(seen).toEqual(ids);
    });

    it('get_session_timeline pages by what fits, without losing or repeating an event', async () => {
        const sessionId = h.manifest.teamA.special.long.sessionId;
        const first = await h.call(h.tokens.a, 'get_session_timeline', { sessionId, limit: 100 });
        expect(first.data.meta.truncated).toBe(true);
        expect(first.data.events.length).toBeLessThan(100);
        const second = await h.call(h.tokens.a, 'get_session_timeline', { sessionId, limit: 100, cursor: first.data.nextCursor });
        const names = [...first.data.events, ...second.data.events].map((event: { name: string }) => event.name);
        expect(new Set(names).size).toBe(names.length);
        expect(second.data.events[0].t).toBeGreaterThan(first.data.events[first.data.events.length - 1].t);
    });

    it('a result with no list to shorten is refused whole, never cut', async () => {
        const out = await h.call(h.tokens.a, 'get_session_context', { sessionId: h.manifest.teamA.special.rageThenCrash.sessionId });
        expect(out.error).toMatchObject({ code: 'result_too_large', requestId: expect.any(String) });
        expect(out.data).toEqual({});
        // Small results are untouched.
        expect((await h.call(h.tokens.a, 'get_session', { sessionId: h.manifest.teamA.special.rageThenCrash.sessionId })).data.meta.truncated).toBe(false);
    });
});

describe('errors', () => {
    it('an unexpected error becomes a generic result with a request id; the real error goes to the error hook only', async () => {
        h.serverErrors.length = 0;
        failNext = new Error('connect ECONNREFUSED s3://bucket-CANARY/key select * from sessions');
        const out = await h.call(h.tokens.a, 'list_projects');
        expect(out.error).toEqual({ code: 'internal', message: 'Something went wrong.', requestId: expect.stringMatching(/^req_[0-9a-f]{32}$/) });
        expect(out.raw).not.toMatch(/ECONNREFUSED|CANARY|select|bucket/);
        expect(h.serverErrors).toHaveLength(1);
        expect(h.serverErrors[0].error.message).toContain('ECONNREFUSED');
        expect(h.serverErrors[0].requestId).toBe(out.error!.requestId);
        expect((await h.call(h.tokens.a, 'list_projects')).isError).toBe(false);
    });
});

describe('access check', () => {
    it('is one query, reused for a few seconds, and then checked again', async () => {
        const { teamA } = h.manifest;
        let now = 1_000_000;
        const checker = createDbAccessChecker(h.pg.db, { ttlMs: 3000, now: () => now });
        const grant = h.grants.get(h.tokens.a)!;

        h.resetDbRoundTrips();
        expect(await checker.check(grant)).toMatchObject({ isMember: true, activeProjectIds: expect.arrayContaining(teamA.projects.map((project) => project.id)) });
        // The same query reads the team's MCP switches and billing fields.
        expect((await checker.check(grant)).team).toMatchObject({ teamId: teamA.id, mcpEnabled: true, maskIdentifiers: false });
        expect(h.dbRoundTrips()).toBe(1);
        await checker.check(grant);
        expect(h.dbRoundTrips()).toBe(1);

        // Removed, but inside the cache window: still the old answer. After it: gone.
        await h.pg.db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamA.id), eq(teamMembers.userId, grant.userId)));
        try {
            h.resetDbRoundTrips();
            now += 2999;
            expect((await checker.check(grant)).isMember).toBe(true);
            expect(h.dbRoundTrips()).toBe(0);
            now += 2;
            expect(await checker.check(grant)).toEqual({ isMember: false, activeProjectIds: [] });
            expect(h.dbRoundTrips()).toBe(1);
            // With the cache off (as the tool tests run), the very next call sees it.
            expect((await createDbAccessChecker(h.pg.db, { ttlMs: 0 }).check(grant)).isMember).toBe(false);
        } finally {
            await h.pg.db.insert(teamMembers).values({ teamId: teamA.id, userId: grant.userId, role: 'owner' });
        }
    });

    it('never widens a grant: unknown users, other teams and malformed ids get nothing', async () => {
        const checker = createDbAccessChecker(h.pg.db, { ttlMs: 0 });
        const grant = h.grants.get(h.tokens.a)!;
        const { teamB } = h.manifest;
        expect(await checker.check({ ...grant, grantId: 'x1', userId: teamB.users[0].id })).toEqual({ isMember: false, activeProjectIds: [] });
        expect(await checker.check({ ...grant, grantId: 'x2', projectIds: [teamB.projects[0].id] })).toMatchObject({ isMember: true, activeProjectIds: [] });
        expect(await checker.check({ ...grant, grantId: 'x3', userId: "x' or 1=1 --" })).toEqual({ isMember: false, activeProjectIds: [] });
        expect(await checker.check({ ...grant, grantId: 'x4', projectIds: ['not-a-uuid', grant.projectIds[0]] })).toMatchObject({ isMember: true, activeProjectIds: [grant.projectIds[0]] });
        expect(await checker.check({ ...grant, grantId: 'x5', projectIds: [] })).toMatchObject({ isMember: true, activeProjectIds: [] });
    });
});

describe('response-time window', () => {
    const record = (grantId: string, durationMs: number, outcome: McpCallRecord['outcome'] = 'ok'): McpCallRecord => ({
        tool: 't', requestId: 'r', grantId, teamId: 'team', userId: 'u', credits: 1, bytes: 10, outcome, durationMs,
    });

    it('percentile is nearest-rank', () => {
        expect(percentile([], 0.5)).toBe(0);
        expect(percentile([5], 0.95)).toBe(5);
        expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
        expect(percentile(Array.from({ length: 100 }, (_unused, index) => index + 1), 0.95)).toBe(95);
    });

    it('keeps the last N successful calls per connection, in a bounded ring', () => {
        const window = new ResponseTimeWindow(4, 2);
        for (const ms of [100, 200, 300, 400, 500, 600]) window.record(record('g1', ms));
        window.record(record('g1', 9999, 'busy'));
        expect(window.summarize('g1')).toEqual({ calls: 4, p50Ms: 400, p95Ms: 600 });
        expect(window.summarize('nobody')).toBeNull();
        // A third connection evicts the least recently active one.
        window.record(record('g2', 10));
        window.record(record('g1', 700));
        window.record(record('g3', 20));
        expect(window.trackedConnections).toBe(2);
        expect(window.summarize('g2')).toBeNull();
        expect(window.summarize('g1')?.calls).toBe(4);
    });

    it('the in-memory usage provider caps the records it keeps', () => {
        const usage = new InMemoryUsageProvider({ creditsUsed: 0, creditsLimit: null, periodStart: new Date(0), periodEnd: new Date(1) }, { maxCalls: 3 });
        for (let index = 0; index < 10; index += 1) usage.recordCall(record('g', index));
        expect(usage.calls.map((entry) => entry.durationMs)).toEqual([7, 8, 9]);
    });
});
