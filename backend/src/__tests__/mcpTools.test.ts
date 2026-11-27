/**
 * The MCP tools, called through a real MCP client connection against the
 * seeded in-process Postgres: happy paths, argument validation, paging, caps,
 * masking, scopes, revoked access, and how the tools are registered.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projects, sessions, teamMembers } from '../db/schema.js';
import type { McpContext } from '../mcp/context.js';
import { MAX_DIGEST_SESSIONS } from '../mcp/data/types.js';
import { TOOK_MS_META_KEY } from '../mcp/output/emit.js';
import { REDACTED } from '../mcp/output/scrub.js';
import { MCP_PROMPTS } from '../mcp/prompts.js';
import { digestCredits } from '../mcp/tools/getSessionDigests.js';
import { MCP_TOOLS, MCP_TOOL_NAMES } from '../mcp/tools/registry.js';
import { UNTRUSTED_CONTENT_NOTE } from '../mcp/tools/types.js';
import { SEED_RANGE, toolCases } from './helpers/mcpToolCases.js';
import { MCP_TEST_DASHBOARD_URL, startMcpToolHarness } from './helpers/mcpToolHarness.js';
import type { McpToolHarness } from './helpers/mcpToolHarness.js';
import { PGLITE_START_TIMEOUT_MS } from './helpers/pgliteHarness.js';

let h: McpToolHarness;
let A: McpToolHarness['manifest']['teamA'];
let B: McpToolHarness['manifest']['teamB'];
let projectId: string;

beforeAll(async () => {
    h = await startMcpToolHarness();
    A = h.manifest.teamA;
    B = h.manifest.teamB;
    projectId = A.projects[0].id;
}, PGLITE_START_TIMEOUT_MS);

afterAll(async () => {
    await h.close();
});

const sessionLink = (id: string) => `${MCP_TEST_DASHBOARD_URL}/dashboard/sessions/${id}`;
const call = (tool: string, args: Record<string, unknown> = {}, token = h.tokens.a) => h.call(token, tool, args);

describe('registration', () => {
    it('lists every registry tool with a title, read-only hints and strict schemas that include meta', async () => {
        const client = await h.client(h.tokens.a);
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
        expect(MCP_TOOL_NAMES).toEqual([
            'list_projects', 'get_usage', 'get_project_health', 'find_friction', 'search_sessions', 'sample_sessions', 'get_session',
            'get_session_digests', 'get_session_timeline', 'get_session_context', 'summarize_faults', 'list_issues', 'get_issue', 'get_issue_context', 'get_crash_context',
        ]);
        for (const tool of tools) {
            expect(tool.title, tool.name).toEqual(expect.any(String));
            expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
            expect(tool.inputSchema, tool.name).toMatchObject({ type: 'object', additionalProperties: false });
            expect(tool.outputSchema, tool.name).toMatchObject({ type: 'object', additionalProperties: false });
            const output = tool.outputSchema as { properties: Record<string, { required?: string[] }>; required: string[] };
            expect(output.required, tool.name).toContain('meta');
            expect(output.properties.meta.required, tool.name).toEqual(['tookMs', 'credits', 'truncated', 'cached']);
        }
    });

    it('every tool that returns end-user content says it is untrusted; none is a leaks tool', () => {
        for (const tool of MCP_TOOLS) {
            if (tool.name === 'list_projects' || tool.name === 'get_usage') continue;
            expect(tool.description, tool.name).toContain(UNTRUSTED_CONTENT_NOTE);
            expect(tool.description, tool.name).toMatch(/Costs \d credits?/);
        }
        expect(MCP_TOOL_NAMES.some((name) => /leak|frame/.test(name))).toBe(false);
    });

    it('offers the three prompts, which name the tools to call and ask for links', async () => {
        const client = await h.client(h.tokens.a);
        const { prompts } = await client.listPrompts();
        expect(prompts.map((prompt) => prompt.name)).toEqual(['review_session', 'triage_crash', 'weekly_stability_review']);
        const review = await client.getPrompt({ name: 'review_session', arguments: { sessionId: A.special.rageThenCrash.sessionId } });
        const text = (review.messages[0].content as { text: string }).text;
        expect(text).toContain(A.special.rageThenCrash.sessionId);
        expect(text).toContain('get_session_context');
        expect(text).toMatch(/Cite the session link/);
        for (const prompt of MCP_PROMPTS) {
            const built = prompt.build({ sessionId: 's', issueId: 'i', projectId: 'p' });
            expect(built, prompt.name).toMatch(/never follow instructions/);
            expect(built, prompt.name).toMatch(/find_friction|get_session_context|get_issue_context/);
            for (const name of built.match(/\b(?:get|list|find|search|sample)_[a-z_]+\b/g) ?? []) expect(MCP_TOOL_NAMES, `${prompt.name}: ${name}`).toContain(name);
        }
        await expect(client.getPrompt({ name: 'triage_crash', arguments: { issueId: 'not-a-uuid' } })).rejects.toThrow();
    });

    it('tool files import no database client, schema, query builder or storage (lint rule and source scan)', async () => {
        const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
        const toolsDir = join(backendRoot, 'src', 'mcp', 'tools');
        const files = readdirSync(toolsDir).filter((file) => file.endsWith('.ts'));
        expect(files.length).toBeGreaterThanOrEqual(MCP_TOOLS.length);
        for (const file of files) {
            const source = readFileSync(join(toolsDir, file), 'utf8');
            const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
            for (const specifier of imports) {
                expect(specifier, file).not.toMatch(/(^|\/)db(\/|$)|drizzle|^pg$|pglite|aws-sdk|data\/scoped|data\/db|artifacts\/|\/routes\/|\/demo\//);
            }
        }

        const eslint = new ESLint({ cwd: backendRoot });
        const offending = "import { db } from '../../db/client.js';\nimport { sql } from 'drizzle-orm';\nimport { createScopedData } from '../data/scoped.js';\nexport const x = [db, sql, createScopedData];\n";
        const [inTools] = await eslint.lintText(offending, { filePath: join(toolsDir, '__probe.ts') });
        expect(inTools.messages.filter((message) => message.ruleId === 'no-restricted-imports')).toHaveLength(3);
        const [elsewhere] = await eslint.lintText(offending, { filePath: join(backendRoot, 'src', 'mcp', 'data', '__probe.ts') });
        expect(elsewhere.messages.filter((message) => message.ruleId === 'no-restricted-imports')).toHaveLength(0);
        const results = await eslint.lintFiles([join(toolsDir, '*.ts')]);
        expect(results.flatMap((result) => result.messages.filter((message) => message.severity === 2))).toEqual([]);
    }, 60_000);
});

describe('meta and timing', () => {
    it('every tool result carries meta, a closing timing line and _meta, and the call is recorded', async () => {
        for (const tool of MCP_TOOLS) {
            const args = toolCases(A)[tool.name][0];
            const before = h.usage.calls.length;
            const out = await call(tool.name, args);
            expect(out.isError, `${tool.name}: ${out.text}`).toBe(false);
            const credits = tool.credits(args);
            expect(out.data.meta, tool.name).toEqual({ tookMs: expect.any(Number), credits, truncated: false, cached: false });
            const [json, line] = out.text.split('\n');
            expect(JSON.parse(json), tool.name).toEqual(out.data);
            expect(line, tool.name).toBe(`(took ${out.data.meta.tookMs} ms, ${credits} ${credits === 1 ? 'credit' : 'credits'})`);
            expect(out._meta?.[TOOK_MS_META_KEY], tool.name).toBe(out.data.meta.tookMs);
            const record = h.usage.calls[before];
            expect(record, tool.name).toMatchObject({ tool: tool.name, outcome: 'ok', credits, durationMs: out.data.meta.tookMs, grantId: 'grant-a', teamId: A.id });
            expect(record.bytes, tool.name).toBe(Buffer.byteLength(out.text, 'utf8'));
        }
        expect(h.serverErrors).toEqual([]);
    });

    it('charges the documented credits', () => {
        const credits = Object.fromEntries(MCP_TOOLS.map((tool) => [tool.name, tool.credits(toolCases(A)[tool.name][0])]));
        expect(credits).toMatchObject({
            list_projects: 0, get_usage: 0, get_project_health: 1, find_friction: 2, search_sessions: 1, sample_sessions: 1, get_session: 1,
            get_session_timeline: 1, get_session_context: 3, summarize_faults: 2, list_issues: 1, get_issue: 1, get_issue_context: 3, get_crash_context: 4,
        });
        expect([1, 10, 11, 20, 50].map(digestCredits)).toEqual([2, 2, 3, 3, 6]);
    });
});

describe('list_projects and get_usage', () => {
    it('lists the granted projects only', async () => {
        const out = await call('list_projects');
        expect(out.data.projects).toEqual([
            { id: A.projects[0].id, name: 'Zebrafish Shop', platforms: ['android', 'ios'] },
            { id: A.projects[1].id, name: 'Zebrafish Web', platforms: ['web'] },
        ]);
        h.addToken('rjm_one_project', { grantId: 'grant-one', projectIds: [A.projects[1].id] });
        expect((await call('list_projects', {}, 'rjm_one_project')).data.projects.map((project: { id: string }) => project.id)).toEqual([A.projects[1].id]);
    });

    it('get_usage reports the allowance and this connection\'s recent response times', async () => {
        h.addToken('rjm_usage', { grantId: 'grant-usage' });
        const first = await call('get_usage', {}, 'rjm_usage');
        expect(first.data).toMatchObject({
            creditsUsed: 120, creditsLimit: 2000, creditsRemaining: 1880, unlimited: false,
            periodStart: '2026-11-01T00:00:00.000Z', resetsAt: '2026-12-01T00:00:00.000Z', responseTime: null,
        });
        await call('list_projects', {}, 'rjm_usage');
        await call('get_session', { sessionId: A.special.secrets.sessionId }, 'rjm_usage');
        const later = await call('get_usage', {}, 'rjm_usage');
        expect(later.data.responseTime).toEqual({ calls: 3, p50Ms: expect.any(Number), p95Ms: expect.any(Number) });
        expect(later.data.responseTime.p95Ms).toBeGreaterThanOrEqual(later.data.responseTime.p50Ms);
        h.usage.set(B.id, { creditsUsed: 5, creditsLimit: null, periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-12-01T00:00:00Z') });
        expect((await call('get_usage', {}, h.tokens.b)).data).toMatchObject({ creditsUsed: 5, creditsLimit: null, creditsRemaining: null, unlimited: true });
    });
});

describe('get_project_health and find_friction', () => {
    it('summarises a range', async () => {
        const out = await call('get_project_health', { projectId, ...SEED_RANGE });
        const total = A.projects[0].sessionIds.length;
        expect(out.data.sessions).toEqual({ count: total, capped: false, display: String(total) });
        expect(out.data.crashes.count).toBe(A.projects[0].crashIds.length);
        expect(out.data.anrs.count).toBe(A.projects[0].anrIds.length);
        expect(out.data.errors.count).toBe(A.projects[0].errorIds.length);
        expect(out.data.crashFreeSessionRate).toBeCloseTo(1 - out.data.sessionsWithCrash / total, 3);
        expect(out.data.topIssues).toHaveLength(5);
        const inRange = out.data.topIssues.map((issue: { eventsInRange: number }) => issue.eventsInRange);
        expect(inRange).toEqual([...inRange].sort((a, b) => b - a));
        expect(out.data.topIssues[0].link).toBe(`${MCP_TEST_DASHBOARD_URL}/dashboard/general/${out.data.topIssues[0].id}`);
    });

    it('defaults to the last 7 days and reports an empty range honestly', async () => {
        const week = await call('get_project_health', { projectId });
        expect(week.data.range).toEqual({ from: '2026-11-13T12:00:00.000Z', to: '2026-11-20T12:00:00.000Z' });
        const empty = await call('get_project_health', { projectId, from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
        expect(empty.data).toMatchObject({ sessions: { count: 0 }, crashFreeSessionRate: null, topIssues: [] });
    });

    it('find_friction ranks groups with a stated denominator, trend, versions and hash-picked examples', async () => {
        const out = await call('find_friction', { projectId });
        expect(out.data.range).toEqual({ from: '2026-11-13T12:00:00.000Z', to: '2026-11-20T12:00:00.000Z' });
        expect(out.data.previousRange).toEqual({ from: '2026-11-06T12:00:00.000Z', to: '2026-11-13T12:00:00.000Z' });
        const search = await call('search_sessions', { projectId });
        expect(out.data.sessionsInRange).toBe(search.data.total.count);
        const groups = out.data.groups as Array<Record<string, any>>;
        expect(groups.length).toBeGreaterThan(3);
        const affected = groups.map((group) => group.sessionsAffected);
        expect(affected).toEqual([...affected].sort((a, b) => b - a));
        for (const group of groups) {
            expect(group.shareOfSessions).toBeCloseTo(group.sessionsAffected / out.data.sessionsInRange, 3);
            expect(group.usersAffected).toBeGreaterThan(0);
            expect(group.usersAffected).toBeLessThanOrEqual(group.sessionsAffected);
            expect(group.versions.reduce((sum: number, version: { sessions: number }) => sum + version.sessions, 0)).toBeLessThanOrEqual(group.sessionsAffected);
            expect(group.exampleSessions.length).toBe(Math.min(5, group.sessionsAffected));
            for (const example of group.exampleSessions) expect(example.link).toBe(sessionLink(example.id));
            expect(group.trend.previousSessionsAffected).toBeGreaterThanOrEqual(0);
        }
        // Counter kinds cannot be tied to a screen; row-backed kinds can.
        const byKind = Object.fromEntries(groups.map((group) => [group.kind, group]));
        expect(byKind.dead_taps).toMatchObject({ signal: 'per_session_counter', concentratesOn: { type: 'unknown' } });
        expect(byKind.crash).toMatchObject({ signal: 'per_event_rows', concentratesOn: { type: 'issue', issueLink: expect.stringContaining('/dashboard/general/') } });
        expect(byKind.error_burst.concentratesOn).toMatchObject({ type: 'screen', screen: expect.stringMatching(/^Zebra/) });
    });

    it('find_friction groups agree with search_sessions, and examples are stable', async () => {
        const range = { from: '2026-11-13T12:00:00.000Z', to: '2026-11-20T12:00:00.000Z' };
        const friction = await call('find_friction', { projectId, ...range });
        const byKind = Object.fromEntries((friction.data.groups as Array<Record<string, any>>).map((group) => [group.kind, group]));
        for (const [kind, issueType] of [['crash', 'crash'], ['anr', 'anr'], ['dead_taps', 'dead_tap'], ['rage_taps', 'rage_tap'], ['slow_start', 'slow_start']] as const) {
            const search = await call('search_sessions', { projectId, ...range, issueType });
            expect(byKind[kind]?.sessionsAffected ?? 0, kind).toBe(search.data.total.count);
        }
        const again = await call('find_friction', { projectId, ...range });
        expect(again.data.groups).toEqual(friction.data.groups);
        const filtered = await call('find_friction', { projectId, ...range, platform: 'ios', screenName: A.filterValues.screenName });
        expect(filtered.data.sessionsInRange).toBeLessThan(friction.data.sessionsInRange);
        expect(filtered.data.sessionsInRange).toBeGreaterThan(0);
    });
});

describe('search_sessions and sample_sessions', () => {
    it('pages newest first, 25 at a time, without gaps or repeats, with a capped total', async () => {
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            const out = await call('search_sessions', { projectId, ...SEED_RANGE, ...(cursor ? { cursor } : {}) });
            expect(out.isError, out.text).toBe(false);
            expect(out.data.total).toEqual({ count: A.projects[0].sessionIds.length, capped: false, display: String(A.projects[0].sessionIds.length) });
            expect(out.data.sessions.length).toBeLessThanOrEqual(25);
            seen.push(...out.data.sessions.map((session: { id: string }) => session.id));
            cursor = out.data.nextCursor ?? undefined;
            pages += 1;
        } while (cursor && pages < 20);
        expect(pages).toBe(Math.ceil(A.projects[0].sessionIds.length / 25));
        expect(new Set(seen).size).toBe(seen.length);
        expect([...seen].sort()).toEqual([...A.projects[0].sessionIds].sort());
        const first = await call('search_sessions', { projectId, ...SEED_RANGE });
        const starts = first.data.sessions.map((session: { startedAt: string }) => session.startedAt);
        expect(starts).toEqual([...starts].sort().reverse());
        expect(first.data.sessions[0].link).toBe(sessionLink(first.data.sessions[0].id));
    });

    it('applies each filter', async () => {
        const base = { projectId, ...SEED_RANGE };
        const rage = A.special.rageThenCrash.sessionId;
        const ids = async (args: Record<string, unknown>) => (await call('search_sessions', { ...base, ...args })).data.sessions.map((session: { id: string }) => session.id);

        expect(await ids({ userId: A.filterValues.userId })).toEqual([rage]);
        expect(await ids({ userId: A.filterValues.userId, issueType: 'crash', screenName: 'zebracheckout', customEventName: A.filterValues.customEventName, hasReplay: true, platform: 'ios' })).toEqual([rage]);
        expect(await ids({ userId: A.filterValues.userId, platform: 'android' })).toEqual([]);
        expect(await ids({ userId: A.filterValues.userId, hasReplay: false })).toEqual([]);
        expect(await ids({ userId: A.filterValues.userId, issueType: 'anr' })).toEqual([]);

        const crashed = await call('search_sessions', { ...base, issueType: 'crash' });
        expect(crashed.data.sessions.every((session: { crashes: number }) => session.crashes > 0)).toBe(true);
        const android = await call('search_sessions', { ...base, platform: 'android', appVersion: '3.2.0-zebra' });
        expect(android.data.sessions.length).toBeGreaterThan(0);
        expect(android.data.sessions.every((session: { platform: string; appVersion: string }) => session.platform === 'android' && session.appVersion === '3.2.0-zebra')).toBe(true);
        const byCode = await call('search_sessions', { ...base, country: 'pt' });
        const byName = await call('search_sessions', { ...base, country: 'Portugal' });
        expect(byCode.data.total.count).toBeGreaterThan(0);
        expect(byCode.data.total).toEqual(byName.data.total);
        expect(byCode.data.sessions.every((session: { country: string }) => session.country === 'Portugal')).toBe(true);
        const withReplay = await call('search_sessions', { ...base, hasReplay: true });
        const withoutReplay = await call('search_sessions', { ...base, hasReplay: false });
        expect(withReplay.data.total.count + withoutReplay.data.total.count).toBe(A.projects[0].sessionIds.length);
        expect(withReplay.data.sessions.every((session: { hasReplay: boolean }) => session.hasReplay)).toBe(true);
        const mobile = await call('search_sessions', { projectId: A.projects[1].id, ...SEED_RANGE, platform: 'mobile' });
        expect(mobile.data.total.count).toBe(0);
    });

    it('issue-type filters select the same sessions as the dashboard archive filters', async () => {
        const { getSessionArchiveIssueFilterCondition } = await import('../services/sessionArchiveFilters.js');
        const { sessionMetrics } = await import('../db/schema.js');
        const pairs = [['crash', 'crashes'], ['anr', 'anrs'], ['error', 'errors'], ['rage_tap', 'rage'], ['dead_tap', 'dead_taps'], ['slow_start', 'slow_start']] as const;
        for (const [issueType, dashboardFilter] of pairs) {
            const [row] = await h.pg.db
                .select({ n: sql<number>`count(*)::int` })
                .from(sessions)
                .leftJoin(sessionMetrics, eq(sessionMetrics.sessionId, sessions.id))
                .where(and(eq(sessions.projectId, projectId), getSessionArchiveIssueFilterCondition(dashboardFilter)));
            const mine = await call('search_sessions', { projectId, ...SEED_RANGE, issueType });
            expect(mine.data.total.count, issueType).toBe(row.n);
            expect(row.n, issueType).toBeGreaterThan(0);
        }
    });

    it('sample_sessions is deterministic for a seed, changes with it, and respects the filter', async () => {
        const args = { projectId, ...SEED_RANGE, size: 20 };
        const one = await call('sample_sessions', { ...args, seed: 11 });
        const same = await call('sample_sessions', { ...args, seed: 11 });
        const other = await call('sample_sessions', { ...args, seed: 12 });
        const idsOf = (out: typeof one) => out.data.sessions.map((session: { id: string }) => session.id);
        expect(idsOf(one)).toHaveLength(20);
        expect(new Set(idsOf(one)).size).toBe(20);
        expect(idsOf(same)).toEqual(idsOf(one));
        expect(idsOf(other)).not.toEqual(idsOf(one));
        expect(one.data).toMatchObject({ seed: 11, nextCursor: null, population: { count: A.projects[0].sessionIds.length, capped: false } });
        // Not "newest first": a sample of 20 from 225 is not the 20 most recent.
        const newest = (await call('search_sessions', { projectId, ...SEED_RANGE })).data.sessions.slice(0, 20).map((session: { id: string }) => session.id);
        expect(idsOf(one).filter((id: string) => newest.includes(id)).length).toBeLessThan(15);

        const errors = await call('sample_sessions', { projectId, ...SEED_RANGE, issueType: 'error', size: 50 });
        expect(errors.data.sessions.length).toBe(Math.min(50, errors.data.population.count));
        expect(errors.data.sessions.every((session: { errors: number }) => session.errors > 0)).toBe(true);
        expect((await call('sample_sessions', { projectId, ...SEED_RANGE })).data.sessions).toHaveLength(25);
    });

    it('every session is equally likely to be sampled (across seeds)', async () => {
        const picks = new Map<string, number>();
        const seeds = 40;
        for (let seed = 0; seed < seeds; seed += 1) {
            const out = await call('sample_sessions', { projectId, ...SEED_RANGE, size: 50, seed });
            for (const session of out.data.sessions) picks.set(session.id, (picks.get(session.id) ?? 0) + 1);
        }
        const population = A.projects[0].sessionIds.length;
        const expected = (seeds * 50) / population;
        // Nearly every session shows up, and none is picked wildly more often than chance.
        expect(picks.size).toBeGreaterThan(population * 0.95);
        expect(Math.max(...picks.values())).toBeLessThan(expected * 2.6);
    }, 60_000);
});

describe('get_session, digests and timeline', () => {
    it('get_session returns device, counts, ordered screens, replay state and a link, and no raw device id', async () => {
        const id = A.special.rageThenCrash.sessionId;
        const out = await call('get_session', { sessionId: id });
        expect(out.data.session).toMatchObject({
            id, projectId, platform: 'ios', durationSeconds: 96, userId: 'zebra-user-rage', crashes: 1, rageTaps: 5, deadTaps: 1,
            device: { model: 'iPhone 15', osVersion: '18.1', sdkVersion: '1.4.2', deviceHash: expect.stringMatching(/^[a-f0-9]{12}$/) },
            screens: ['ZebraHome', 'ZebraCart', 'ZebraCheckout'], replay: { available: true, unavailableReason: null }, link: sessionLink(id),
            location: { country: expect.any(String), countryCode: expect.any(String), city: expect.any(String) },
        });
        expect(Object.keys(out.data.session.location)).toEqual(['country', 'countryCode', 'city']);
        const expired = await call('get_session', { sessionId: A.special.expired.sessionId });
        expect(expired.data.session.replay).toEqual({ available: false, unavailableReason: 'expired' });
        // The same device hashes the same way; the hash is not the id.
        const again = await call('get_session', { sessionId: id });
        expect(again.data.session.device.deviceHash).toBe(out.data.session.device.deviceHash);
    });

    it('get_session_digests returns compact digests in the order asked, and charges by count', async () => {
        const ids = [A.special.failedCheckout.sessionId, A.special.rageThenCrash.sessionId, ...A.projects[0].sessionIds.slice(0, 10)];
        const out = await call('get_session_digests', { sessionIds: ids });
        expect(out.data.digests.map((digest: { id: string }) => digest.id)).toEqual(ids);
        expect(out.data.notFound).toEqual([]);
        expect(out.data.meta.credits).toBe(3);
        const rage = out.data.digests[1];
        expect(rage).toMatchObject({
            durationSeconds: 96, platform: 'ios', screens: ['ZebraHome', 'ZebraCart', 'ZebraCheckout'], screensTruncated: false,
            customEvents: [{ name: 'zebra_checkout_started', count: 1 }],
            friction: { rageTaps: 5, deadTaps: 1, crashes: 1, anrs: 0, errors: 0, apiErrors: 0 },
            topErrors: [{ kind: 'crash', name: 'ZebraCheckoutException', count: 1, message: expect.stringContaining('unrecognized selector') }],
            link: sessionLink(ids[1]),
        });
        expect(out.data.digests[0]).toMatchObject({ friction: { apiErrors: 2, errors: 1 }, topErrors: [{ kind: 'error', name: 'NetworkError' }] });
        for (const digest of out.data.digests) {
            expect(digest.screens.length).toBeLessThanOrEqual(20);
            expect(digest.topErrors.length).toBeLessThanOrEqual(5);
        }
        const fifty = await call('get_session_digests', { sessionIds: A.projects[0].sessionIds.slice(0, MAX_DIGEST_SESSIONS) });
        expect(fifty.data.digests).toHaveLength(50);
        expect(fifty.data.meta.credits).toBe(6);
    });

    it('get_session_timeline condenses the session relative to its start', async () => {
        const out = await call('get_session_timeline', { sessionId: A.special.rageThenCrash.sessionId });
        expect(out.data).toMatchObject({ eventStream: 'ok', durationSeconds: 96, nextCursor: null, totalEvents: out.data.events.length });
        const events = out.data.events as Array<Record<string, any>>;
        expect(events.map((event) => event.t)).toEqual([...events.map((event) => event.t)].sort((a, b) => a - b));
        expect(events.find((event) => event.type === 'screen' && event.name === 'ZebraCheckout')?.t).toBe(60);
        expect(events.find((event) => event.type === 'tap' && event.name === 'Pay now')).toMatchObject({ t: 80, count: 3, tEnd: 80.6, screen: 'ZebraCheckout' });
        // One inferred from the three taps, one reported by the SDK.
        expect(events.filter((event) => event.type === 'rage_tap').reduce((sum, event) => sum + event.count, 0)).toBe(2);
        expect(events.find((event) => event.type === 'scroll')).toMatchObject({ count: 3 });
        expect(events[events.length - 1]).toMatchObject({ t: 95, type: 'crash', name: 'ZebraCheckoutException', faultId: A.special.rageThenCrash.crashId });
    });

    it('get_session_timeline filters by window and type', async () => {
        const sessionId = A.special.rageThenCrash.sessionId;
        const windowed = await call('get_session_timeline', { sessionId, fromSeconds: 79, toSeconds: 89 });
        expect(windowed.data.events.every((event: { t: number }) => event.t >= 79 && event.t <= 89)).toBe(true);
        expect(windowed.data.events.map((event: { type: string }) => event.type)).toEqual(['tap', 'rage_tap', 'dead_tap']);
        const typed = await call('get_session_timeline', { sessionId, types: ['screen', 'crash'] });
        expect(typed.data.events.map((event: { type: string }) => event.type)).toEqual(['screen', 'screen', 'screen', 'crash']);
    });

    it('get_session_timeline reports failed requests without query strings and pages long sessions', async () => {
        const checkout = await call('get_session_timeline', { sessionId: A.special.failedCheckout.sessionId, types: ['network_error'] });
        expect(checkout.data.events.map((event: { name: string; detail: string }) => [event.name, event.detail.split(':')[0]])).toEqual([
            ['POST api.zebra.example/v1/checkout', 'status 500'],
            ['POST /v1/zebra/checkout/retry', 'status 502'],
        ]);

        const sessionId = A.special.long.sessionId;
        const names: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            const out = await call('get_session_timeline', { sessionId, limit: 400, ...(cursor ? { cursor } : {}) });
            expect(out.data.totalEvents).toBe(1501);
            expect(out.data.events.length).toBeLessThanOrEqual(400);
            names.push(...out.data.events.map((event: { name: string }) => event.name));
            cursor = out.data.nextCursor ?? undefined;
            pages += 1;
        } while (cursor && pages < 10);
        expect(pages).toBe(4);
        expect(names).toHaveLength(1501);
        expect(new Set(names).size).toBe(1501);
        expect((await call('get_session_timeline', { sessionId })).data.events).toHaveLength(200);
    });

    it('get_session_timeline says when the recorded stream is missing or expired, and still shows fault rows', async () => {
        const expired = await call('get_session_timeline', { sessionId: A.special.expired.sessionId });
        expect(expired.data.eventStream).toBe('expired');
        expect(expired.data.events.every((event: { type: string }) => ['custom', 'crash', 'anr', 'error'].includes(event.type))).toBe(true);
        const none = await call('get_session_timeline', { sessionId: A.anrSessionId });
        expect(['none', 'ok']).toContain(none.data.eventStream);
        expect(none.data.events.some((event: { type: string }) => event.type === 'anr')).toBe(true);
    });
});

describe('issues and context tools', () => {
    it('list_issues lists issues last seen in the range, most recent first, with filters', async () => {
        const out = await call('list_issues', { projectId, ...SEED_RANGE });
        expect(out.data.total.count).toBe(A.projects[0].issueIds.length);
        expect(out.data.issues.map((issue: { id: string }) => issue.id).sort()).toEqual([...A.projects[0].issueIds].sort());
        const lastSeen = out.data.issues.map((issue: { lastSeen: string }) => issue.lastSeen);
        expect(lastSeen).toEqual([...lastSeen].sort().reverse());
        expect(out.data.nextCursor).toBeNull();
        const crashes = await call('list_issues', { projectId, ...SEED_RANGE, type: 'crash' });
        expect(crashes.data.issues.map((issue: { type: string }) => issue.type)).toEqual(['crash', 'crash']);
        expect((await call('list_issues', { projectId, ...SEED_RANGE, status: 'resolved' })).data.issues).toEqual([]);
        expect((await call('list_issues', { projectId, from: '2026-01-01T00:00:00Z', to: '2026-01-05T00:00:00Z' })).data.total.count).toBe(0);
    });

    it('list_issues pages by keyset (data layer, page size 2)', async () => {
        const ctx: McpContext = { requestId: 'test', userId: A.users[0].id, grantId: 'g', teamId: A.id, allowedProjectIds: [projectId], scopes: [], maskIdentifiers: false };
        const filter = { projectId, range: { from: new Date(SEED_RANGE.from), to: new Date(SEED_RANGE.to) } };
        const seen: string[] = [];
        let after: { lastSeenKey: string; id: string } | undefined;
        for (let page = 0; page < 5; page += 1) {
            const result = await h.data.listIssues(ctx, filter, { limit: 2, after });
            seen.push(...result!.issues.map((issue) => issue.id));
            if (!result!.hasMore) break;
            after = result!.keys[result!.keys.length - 1];
        }
        expect(seen).toHaveLength(A.projects[0].issueIds.length);
        expect(new Set(seen).size).toBe(seen.length);
    });

    it('get_issue returns the stack capped at 60 frames, affected versions and devices, and sample sessions with seek links', async () => {
        const out = await call('get_issue', { issueId: A.special.rageThenCrash.issueId });
        const issue = out.data.issue;
        expect(issue).toMatchObject({ type: 'crash', title: 'ZebraCheckoutException', projectId, stack: { totalFrames: 24, truncated: false } });
        expect(issue.stack.frames).toHaveLength(24);
        expect(issue.affectedVersions.reduce((sum: number, entry: { count: number }) => sum + entry.count, 0)).toBe(issue.eventCount);
        expect(issue.sampleSessions.length).toBeGreaterThan(0);
        expect(issue.sampleSessions.length).toBeLessThanOrEqual(5);
        for (const sample of issue.sampleSessions) {
            expect(sample.link).toBe(`${sessionLink(sample.sessionId)}?seekToTimestamp=${Date.parse(sample.occurredAt)}`);
            expect(A.projects[0].sessionIds).toContain(sample.sessionId);
        }
        const list = await call('list_issues', { projectId, ...SEED_RANGE, type: 'crash' });
        const overflow = list.data.issues.find((candidate: { title: string }) => candidate.title === 'ZebraImageCacheOverflow');
        const capped = await call('get_issue', { issueId: overflow.id });
        expect(capped.data.issue.stack).toMatchObject({ totalFrames: 85, truncated: true });
        expect(capped.data.issue.stack.frames).toHaveLength(60);
    });

    it('get_crash_context returns the fault, device, stack and the 30 seconds before it', async () => {
        const out = await call('get_crash_context', { faultId: A.special.rageThenCrash.crashId });
        expect(out.data).toMatchObject({
            fault: { id: A.special.rageThenCrash.crashId, type: 'crash', name: 'ZebraCheckoutException', projectId },
            device: { platform: 'ios', model: 'iPhone 15', osVersion: '18.1' },
            stack: { totalFrames: 24, truncated: false },
            session: { id: A.special.rageThenCrash.sessionId, faultAtSeconds: 95, hasReplay: true, link: `${sessionLink(A.special.rageThenCrash.sessionId)}?seekToTimestamp=${Date.parse('2026-11-18T12:01:35.000Z')}` },
            timeline: { windowSeconds: 30, eventStream: 'ok', eventsDropped: false },
            frames: [],
            framesUnavailableReason: expect.stringContaining('not available'),
        });
        const events = out.data.timeline.events as Array<Record<string, any>>;
        expect(events.every((event) => event.t >= 65 && event.t <= 95)).toBe(true);
        expect(events.map((event) => event.type)).toEqual(['tap', 'rage_tap', 'dead_tap', 'scroll', 'crash']);
        // The screen was entered before the window but still labels the events.
        expect(events[0].screen).toBe('ZebraCheckout');
    });

    it('get_crash_context works for each fault type, with or without the type', async () => {
        const anr = await call('get_crash_context', { faultId: A.projects[0].anrIds[0] });
        expect(anr.data.fault).toMatchObject({ type: 'anr', durationMs: 6200 });
        expect(anr.data.stack.frames[0]).toContain('ZebraDatabase.queryBlocking');
        const error = await call('get_crash_context', { faultId: A.special.failedCheckout.errorId, type: 'error' });
        expect(error.data.fault).toMatchObject({ type: 'error', name: 'NetworkError', screenName: 'ZebraCheckout' });
        expect(error.data.timeline.events.some((event: { type: string }) => event.type === 'network_error')).toBe(true);
        // The right id with the wrong type is simply not found.
        expect((await call('get_crash_context', { faultId: A.special.failedCheckout.errorId, type: 'crash' })).error?.code).toBe('not_found');
    });

    it('get_session_context returns facts, screens with times, moments with lead-up and links, faults and a brief', async () => {
        const s = A.special.rageThenCrash;
        const out = await call('get_session_context', { sessionId: s.sessionId });
        expect(out.isError, out.text).toBe(false);
        expect(out.data.session).toMatchObject({ id: s.sessionId, durationSeconds: 96, device: { model: 'iPhone 15' } });
        expect(out.data.screens).toEqual([{ name: 'ZebraHome', t: 1, seconds: 19 }, { name: 'ZebraCart', t: 20, seconds: 40 }, { name: 'ZebraCheckout', t: 60, seconds: 35 }]);
        expect(out.data.timeline).toMatchObject({ eventStream: 'ok', totalEvents: 12, omittedFromMiddle: 0 });
        const moments = out.data.moments as Array<Record<string, any>>;
        expect(moments.map((moment) => moment.kind)).toEqual(['rage_tap_cluster', 'dead_tap', 'crash']);
        expect(moments[0]).toMatchObject({ t: 80.6, tEnd: 85, count: 2, screen: 'ZebraCheckout', name: 'Pay now' });
        expect(moments[0].before.map((event: { type: string; count: number }) => [event.type, event.count])).toEqual([['tap', 3]]);
        expect(moments[2]).toMatchObject({ t: 95, faultId: s.crashId, link: `${sessionLink(s.sessionId)}?seekToTimestamp=${Date.parse('2026-11-18T12:01:35.000Z')}` });
        expect(moments[2].before.map((event: { type: string }) => event.type)).toEqual(['dead_tap', 'scroll']);
        expect(out.data.faults).toEqual([expect.objectContaining({ id: s.crashId, type: 'crash', atSeconds: 95, stack: expect.objectContaining({ totalFrames: 24 }) })]);
        expect(out.data.customEvents).toEqual([{ name: 'zebra_checkout_started', count: 1 }]);
        expect(out.data.openQuestions.join(' ')).toMatch(/frames are not available/);

        const markdown: string = out.data.markdown;
        const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
        expect(headings).toEqual(['Session', 'What the user did', 'Where it went wrong', 'Evidence', 'Open questions', 'Links']);
        expect(markdown).toContain('ZebraHome (19 s) → ZebraCart (40 s) → ZebraCheckout (35 s)');
        expect(markdown).toContain('rage_tap_cluster on ZebraCheckout: Pay now');
        expect(markdown).toContain(`- Session: ${sessionLink(s.sessionId)}`);
        expect(markdown).not.toMatch(/likely|because|should|recommend|caused by/i);
    });

    it('get_session_context finds failed requests, abandonment and missing streams, and trims long timelines', async () => {
        const checkout = await call('get_session_context', { sessionId: A.special.failedCheckout.sessionId });
        const kinds = checkout.data.moments.map((moment: { kind: string }) => moment.kind);
        expect(kinds.filter((kind: string) => kind === 'failed_request')).toHaveLength(2);
        expect(kinds).toContain('error');
        expect(kinds[kinds.length - 1]).toBe('abandon_after_error');
        const failed = checkout.data.moments.find((moment: { kind: string }) => moment.kind === 'failed_request');
        expect(failed.before.map((event: { type: string }) => event.type)).toEqual(['custom', 'screen', 'tap']);
        expect(checkout.data.moments.find((moment: { kind: string; logs: unknown[] }) => moment.kind === 'failed_request' && moment.logs.length > 0)).toBeDefined();
        expect(checkout.data.markdown).toContain('## Where it went wrong');

        const long = await call('get_session_context', { sessionId: A.special.long.sessionId });
        expect(long.data.timeline.totalEvents).toBe(1501);
        expect(long.data.timeline.events.length).toBeLessThanOrEqual(200);
        expect(long.data.timeline.omittedFromMiddle).toBe(1501 - long.data.timeline.events.length);
        const names = long.data.timeline.events.map((event: { name: string }) => event.name);
        expect(names[0]).toBe('Zebra item A 0');
        expect(names[names.length - 1]).toBe('Zebra item B 1499');
        // The failed request in the middle and the taps just before it are kept.
        expect(names).toContain('GET api.zebra.example/v1/items');
        expect(names).toContain('Zebra item A 800');
        expect(long.data.openQuestions.join(' ')).toMatch(/\d+ of 1501 timeline events from the middle/);
        expect(Buffer.byteLength(long.text, 'utf8')).toBeLessThan(3 * 65_536);

        const expired = await call('get_session_context', { sessionId: A.special.expired.sessionId });
        expect(expired.data.timeline.eventStream).toBe('expired');
        expect(expired.data.openQuestions.join(' ')).toMatch(/past retention/);
        expect(expired.data.markdown).toMatch(/## Open questions[\s\S]*past retention/);
    });

    it('get_issue_context returns the issue, trend, who is affected, hash-sampled lead-ups and what they share', async () => {
        const out = await call('get_issue_context', { issueId: A.special.rageThenCrash.issueId });
        expect(out.isError, out.text).toBe(false);
        expect(out.data.issue).toMatchObject({ id: A.special.rageThenCrash.issueId, type: 'crash', title: 'ZebraCheckoutException' });
        expect(out.data.stack).toMatchObject({ totalFrames: 24 });
        expect(out.data.trend.daily.reduce((sum: number, day: { count: number }) => sum + day.count, 0)).toBe(out.data.issue.eventCount);
        expect(out.data.trend.last7Days + out.data.trend.previous7Days).toBeLessThanOrEqual(out.data.issue.eventCount);
        expect(out.data.affected.osVersions.reduce((sum: number, entry: { count: number }) => sum + entry.count, 0)).toBe(out.data.affected.osVersionsFromOccurrences);
        expect(out.data.examples).toHaveLength(3);
        for (const example of out.data.examples) {
            expect(A.projects[0].sessionIds).toContain(example.sessionId);
            expect(example.link).toBe(`${sessionLink(example.sessionId)}?seekToTimestamp=${Date.parse(example.occurredAt)}`);
            expect(example.leadUp.every((event: { t: number }) => event.t >= example.atSeconds - 30 && event.t <= example.atSeconds)).toBe(true);
            expect(example.leadUp[example.leadUp.length - 1]).toMatchObject({ type: 'crash' });
        }
        expect(out.data.commonLeadUp).toMatchObject({ sessionsSampled: 3, eventTypes: expect.arrayContaining([{ type: 'crash', sessions: 3 }]) });
        // The same three sessions every time.
        const again = await call('get_issue_context', { issueId: A.special.rageThenCrash.issueId });
        expect(again.data.examples.map((example: { sessionId: string }) => example.sessionId)).toEqual(out.data.examples.map((example: { sessionId: string }) => example.sessionId));

        const headings = [...(out.data.markdown as string).matchAll(/^## (.+)$/gm)].map((match) => match[1]);
        expect(headings).toEqual(['Issue', 'Who is affected', 'Stack', 'What users were doing before', 'Evidence', 'Open questions', 'Links']);
        expect(out.data.markdown).toContain('Sampled sessions: 3.');
        expect(out.data.markdown).not.toMatch(/likely|because|should|recommend|caused by/i);
    });
});

describe('summarize_faults', () => {
    it('breaks error rows down by group, version, platform, OS, device, screen and day, and the parts add up', async () => {
        const out = await call('summarize_faults', { projectId, type: 'error', ...SEED_RANGE });
        const total = A.projects[0].errorIds.length;
        expect(out.data).toMatchObject({ projectId, type: 'error', total: { count: total, capped: false }, blockedMs: null });
        expect(out.data.sessionsAffected).toBeGreaterThan(0);
        expect(out.data.sessionsAffected).toBeLessThanOrEqual(total);

        const groups = out.data.groups as Array<Record<string, any>>;
        expect(groups.length).toBeGreaterThan(0);
        expect(groups.length).toBeLessThanOrEqual(12);
        expect(out.data.groupCount).toBeGreaterThanOrEqual(groups.length);
        expect(groups.map((group) => group.count)).toEqual([...groups.map((group) => group.count)].sort((a, b) => b - a));
        if (out.data.groupCount === groups.length) expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(total);
        for (const group of groups) {
            expect(group.name, JSON.stringify(group)).toEqual(expect.any(String));
            expect(group.sessions).toBeLessThanOrEqual(group.count);
            expect(group.shareOfRows).toBeCloseTo(group.count / total, 3);
            expect(Date.parse(group.firstSeen)).toBeLessThanOrEqual(Date.parse(group.lastSeen));
            expect(group.examples.length).toBeGreaterThan(0);
            expect(group.examples.length).toBeLessThanOrEqual(2);
            for (const example of group.examples) {
                expect(A.projects[0].errorIds).toContain(example.faultId);
                expect(example.link).toContain(`${sessionLink(example.sessionId)}?seekToTimestamp=`);
            }
        }
        // An example goes straight into get_crash_context.
        const context = await call('get_crash_context', { faultId: groups[0].examples[0].faultId, type: 'error' });
        expect(context.data.fault).toMatchObject({ type: 'error', name: groups[0].name });

        const days = out.data.daily as Array<{ day: string; count: number }>;
        expect(days.map((entry) => entry.day)).toEqual([...days.map((entry) => entry.day)].sort());
        expect(days.reduce((sum, entry) => sum + entry.count, 0)).toBe(total);
        for (const key of ['byAppVersion', 'byPlatform', 'byOsVersion', 'byDevice', 'byScreen']) {
            const rows = out.data[key] as Array<{ name: string; count: number; sessions: number }>;
            expect(rows.length, key).toBeGreaterThan(0);
            expect(rows.reduce((sum, row) => sum + row.count, 0), key).toBeLessThanOrEqual(total);
            expect(rows.every((row) => row.name !== '' && row.sessions <= row.count), key).toBe(true);
        }
        expect(h.serverErrors).toEqual([]);
    });

    it('covers crashes and ANRs, with how long ANRs blocked, and honours filters and an empty range', async () => {
        const crashes = await call('summarize_faults', { projectId, type: 'crash', ...SEED_RANGE });
        expect(crashes.data.total.count).toBe(A.projects[0].crashIds.length);
        expect(crashes.data.byScreen).toEqual([]);
        expect(crashes.data.groups.some((group: { name: string }) => group.name === 'ZebraCheckoutException')).toBe(true);

        const anrs = await call('summarize_faults', { projectId, type: 'anr', ...SEED_RANGE });
        expect(anrs.data.total.count).toBe(A.projects[0].anrIds.length);
        expect(anrs.data.blockedMs).toEqual({ median: expect.any(Number), p90: expect.any(Number), longest: expect.any(Number) });
        expect(anrs.data.blockedMs.median).toBeLessThanOrEqual(anrs.data.blockedMs.p90);
        expect(anrs.data.blockedMs.p90).toBeLessThanOrEqual(anrs.data.blockedMs.longest);
        expect(anrs.data.groups[0].detail).toContain('ZebraDatabase.queryBlocking');

        const ios = await call('summarize_faults', { projectId, type: 'error', ...SEED_RANGE, platform: 'ios' });
        expect(ios.data.byPlatform.map((row: { name: string }) => row.name)).toEqual(['ios']);
        const all = await call('summarize_faults', { projectId, type: 'error', ...SEED_RANGE });
        expect(ios.data.total.count).toBeLessThan(all.data.total.count);
        const version = all.data.byAppVersion[0] as { name: string; count: number };
        const oneVersion = await call('summarize_faults', { projectId, type: 'error', ...SEED_RANGE, appVersion: version.name });
        expect(oneVersion.data.total.count).toBe(version.count);

        const empty = await call('summarize_faults', { projectId, type: 'crash', from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
        expect(empty.data).toMatchObject({ total: { count: 0, capped: false }, sessionsAffected: 0, groupCount: 0, groups: [], daily: [], blockedMs: null });
    });

    it('includeLeadUp reads the 30 seconds before a stable sample of the faults, one per session, around the fault only', async () => {
        const plain = await call('summarize_faults', { projectId, type: 'crash', ...SEED_RANGE });
        expect(plain.data.leadUp).toBeNull();
        expect(plain.data.meta.credits).toBe(2);

        h.artifacts.reads.splice(0, h.artifacts.reads.length);
        const out = await call('summarize_faults', { projectId, type: 'crash', ...SEED_RANGE, includeLeadUp: true });
        expect(out.data.meta.credits).toBe(5);
        const leadUp = out.data.leadUp as Record<string, any>;
        expect(leadUp.windowSeconds).toBe(30);
        const examples = leadUp.examples as Array<Record<string, any>>;
        expect(examples.length).toBeGreaterThan(0);
        expect(examples.length).toBeLessThanOrEqual(8);
        expect(leadUp.sessionsSampled).toBe(examples.length);
        expect(new Set(examples.map((example) => example.sessionId)).size).toBe(examples.length);
        for (const example of examples) {
            expect(A.projects[0].crashIds).toContain(example.faultId);
            expect(A.projects[0].sessionIds).toContain(example.sessionId);
            expect(example.events.length).toBeLessThanOrEqual(15);
            expect(example.events.every((event: { t: number }) => event.t <= example.atSeconds + 0.1 && event.t >= example.atSeconds - 30.1)).toBe(true);
            expect(example.link).toContain(`${sessionLink(example.sessionId)}?seekToTimestamp=`);
        }
        for (const entry of [...leadUp.commonScreens, ...leadUp.commonEventTypes, ...leadUp.commonEvents]) {
            expect(entry.sessions * 2).toBeGreaterThan(examples.length);
        }
        // One windowed read per sampled session, nothing else.
        const reads = h.artifacts.reads.splice(0, h.artifacts.reads.length);
        expect(reads.map((read) => read.sessionId).sort()).toEqual(examples.map((example) => example.sessionId).sort());
        expect(reads.every((read) => read.window && read.window.toMs - read.window.fromMs === 310_000)).toBe(true);

        // The same call again draws the same sample.
        const again = await call('summarize_faults', { projectId, type: 'crash', ...SEED_RANGE, includeLeadUp: true });
        expect(again.data.leadUp.examples.map((example: { faultId: string }) => example.faultId)).toEqual(examples.map((example) => example.faultId));
        // Nothing to sample: an empty lead-up, not an error.
        const empty = await call('summarize_faults', { projectId, type: 'crash', from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z', includeLeadUp: true });
        expect(empty.data.leadUp).toMatchObject({ sessionsSampled: 0, examples: [], commonScreens: [] });
    });

    it('links a group to the issue with the same fingerprint, in the same project only', async () => {
        const { errors, issues } = await import('../db/schema.js');
        const [row] = await h.pg.db.select({ fingerprint: errors.fingerprint, name: errors.errorName }).from(errors).where(eq(errors.id, A.projects[0].errorIds[0]));
        const insert = (project: string, title: string) => h.pg.db
            .insert(issues)
            .values({ projectId: project, fingerprint: row.fingerprint!, issueType: 'error', title, shortId: `T-${title}` } as any)
            .returning({ id: issues.id });
        const [own] = await insert(projectId, 'own');
        const [foreign] = await insert(B.projects[0].id, 'foreign');
        try {
            const out = await call('summarize_faults', { projectId, type: 'error', ...SEED_RANGE });
            const linked = (out.data.groups as Array<Record<string, any>>).filter((group) => group.issueId);
            expect(linked.map((group) => group.issueId)).toEqual([own.id]);
            expect(linked[0].issueLink).toBe(`${MCP_TEST_DASHBOARD_URL}/dashboard/general/${own.id}`);
            expect(out.raw).not.toContain(foreign.id);
        } finally {
            await h.pg.db.delete(issues).where(inArray(issues.id, [own.id, foreign.id]));
        }
    });
});

describe('result size', () => {
    it('no tool result is larger than a client can read, whatever the session or issue', async () => {
        const { MAX_RESULT_BYTES } = await import('../mcp/output/emit.js');
        for (const tool of MCP_TOOLS) {
            for (const args of toolCases(A)[tool.name]) {
                const out = await call(tool.name, args);
                expect(out.isError, `${tool.name} ${JSON.stringify(args).slice(0, 80)}: ${out.text.slice(0, 200)}`).toBe(false);
                expect(Buffer.byteLength(out.text, 'utf8'), `${tool.name} ${JSON.stringify(args).slice(0, 80)}`).toBeLessThanOrEqual(MAX_RESULT_BYTES);
            }
        }
    });

    it('get_session_context shrinks the timeline before it drops moments, and says what it left out', async () => {
        const { SESSION_CONTEXT_BYTE_TARGET } = await import('../mcp/tools/getSessionContext.js');
        const long = await call('get_session_context', { sessionId: A.special.long.sessionId });
        // The target is checked before scrubbing, which can only shorten text; allow the closing line and meta.
        expect(Buffer.byteLength(long.text, 'utf8')).toBeLessThanOrEqual(SESSION_CONTEXT_BYTE_TARGET + 2_000);
        expect(SESSION_CONTEXT_BYTE_TARGET).toBeLessThan(40 * 1024);
        expect(long.data.timeline.omittedFromMiddle).toBeGreaterThan(0);
        expect(long.data.openQuestions.some((line: string) => line.includes('from the middle of the session are not included'))).toBe(true);
        expect(long.data.timeline.totalEvents).toBeGreaterThan(long.data.timeline.events.length);
    });
});

describe('reading event files for context', () => {
    it('crash and issue context read only the files around the fault; session context and timeline read the session', async () => {
        const reads = () => h.artifacts.reads.splice(0, h.artifacts.reads.length);
        reads();
        const at = Date.parse('2026-11-18T12:01:35.000Z');
        await call('get_crash_context', { faultId: A.special.rageThenCrash.crashId });
        expect(reads()).toEqual([{ projectId, sessionId: A.special.rageThenCrash.sessionId, window: { fromMs: at - 300_000, toMs: at + 10_000, needFromMs: at - 40_000 } }]);

        await call('get_issue_context', { issueId: A.special.rageThenCrash.issueId });
        const issueReads = reads();
        expect(issueReads.length).toBeGreaterThan(0);
        expect(issueReads.every((read) => read.window && read.window.toMs - read.window.fromMs === 310_000)).toBe(true);

        await call('get_session_context', { sessionId: A.special.rageThenCrash.sessionId });
        await call('get_session_timeline', { sessionId: A.special.rageThenCrash.sessionId });
        expect(reads()).toEqual([
            { projectId, sessionId: A.special.rageThenCrash.sessionId },
            { projectId, sessionId: A.special.rageThenCrash.sessionId },
        ]);
    });
});

describe('argument validation happens before any query', () => {
    const uuid = '00000000-0000-4000-8000-00000000dead';
    const cases: Array<[string, string, Record<string, unknown>]> = [
        ['unknown argument', 'list_projects', { projectId: uuid }],
        ['project id that is not a uuid', 'search_sessions', { projectId: 'project-a' }],
        ['SQL in a project id', 'get_project_health', { projectId: "x' OR 1=1 --" }],
        ['missing project id', 'search_sessions', {}],
        ['range over 90 days', 'search_sessions', { projectId: uuid, from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }],
        ['from after to', 'get_project_health', { projectId: uuid, from: '2026-11-10T00:00:00Z', to: '2026-11-01T00:00:00Z' }],
        ['a date that is not ISO 8601', 'list_issues', { projectId: uuid, from: 'last tuesday' }],
        ['a fault type that does not exist', 'summarize_faults', { projectId: uuid, type: 'hang' }],
        ['no fault type', 'summarize_faults', { projectId: uuid }],
        ['friction range over 30 days', 'find_friction', { projectId: uuid, from: '2026-10-01T00:00:00Z', to: '2026-11-15T00:00:00Z' }],
        ['bad platform', 'search_sessions', { projectId: uuid, platform: 'symbian' }],
        ['bad issue type', 'search_sessions', { projectId: uuid, issueType: 'new_user' }],
        ['empty filter text', 'search_sessions', { projectId: uuid, screenName: '   ' }],
        ['garbage cursor', 'search_sessions', { projectId: uuid, cursor: '!!!not-base64!!!' }],
        ['cursor of the wrong shape', 'search_sessions', { projectId: uuid, cursor: Buffer.from(JSON.stringify({ projectId: uuid })).toString('base64url') }],
        ['cursor with SQL in it', 'list_issues', { projectId: uuid, cursor: Buffer.from(JSON.stringify({ t: "2026-11-01T00:00:00.000000'; drop table issues; --", id: uuid })).toString('base64url') }],
        ['sample size over the maximum', 'sample_sessions', { projectId: uuid, size: 51 }],
        ['negative seed', 'sample_sessions', { projectId: uuid, seed: -1 }],
        ['session id with odd characters', 'get_session', { sessionId: 'session 1; drop' }],
        ['more than 50 digests', 'get_session_digests', { sessionIds: Array.from({ length: 51 }, (_unused, index) => `session_${index}`) }],
        ['no digest ids', 'get_session_digests', { sessionIds: [] }],
        ['timeline window backwards', 'get_session_timeline', { sessionId: 'session_x', fromSeconds: 50, toSeconds: 10 }],
        ['unknown timeline type', 'get_session_timeline', { sessionId: 'session_x', types: ['keystroke'] }],
        ['timeline limit over the maximum', 'get_session_timeline', { sessionId: 'session_x', limit: 501 }],
        ['session context id that is too long', 'get_session_context', { sessionId: 'x'.repeat(65) }],
        ['issue id that is not a uuid', 'get_issue', { issueId: 'ZEBRA-21-1' }],
        ['issue context id that is not a uuid', 'get_issue_context', { issueId: '1' }],
        ['fault type that does not exist', 'get_crash_context', { faultId: uuid, type: 'oom' }],
    ];

    it.each(cases)('%s (%s)', async (_label, tool, args) => {
        h.resetDbRoundTrips();
        const outcome = await call(tool, args).then((out) => ({ out }), (error: Error) => ({ error }));
        expect(h.dbRoundTrips()).toBe(0);
        if ('out' in outcome) {
            expect(outcome.out.isError, outcome.out.text).toBe(true);
            expect(outcome.out.data).toEqual({});
        }
    });

    it('every case above was rejected, and every tool with arguments has at least one', () => {
        const covered = new Set(cases.map(([, tool]) => tool));
        for (const tool of MCP_TOOLS) {
            if (Object.keys(tool.argKinds).length > 0) expect(covered.has(tool.name), tool.name).toBe(true);
        }
    });

    it('our own argument errors carry a code, a plain message and a request id', async () => {
        const out = await call('search_sessions', { projectId, from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' });
        expect(out.error).toEqual({ code: 'invalid_argument', message: 'The time range may span at most 90 days.', requestId: expect.stringMatching(/^req_[0-9a-f]{32}$/) });
    });
});

describe('masking', () => {
    it('off: user ids, city and the device hash are returned; emails as user ids too', async () => {
        const out = await call('get_session', { sessionId: A.special.secrets.sessionId });
        expect(out.data.session.userId).toBe(A.special.secrets.userEmail);
        expect(out.data.session.location.city).not.toBe(REDACTED);
        expect(out.data.session.device.deviceHash).toMatch(/^[a-f0-9]{12}$/);
    });

    it('on: emails, user ids, device hash and city are replaced everywhere, and the user filter is refused', async () => {
        const session = await call('get_session', { sessionId: A.special.secrets.sessionId }, h.tokens.aMasked);
        expect(session.data.session).toMatchObject({ userId: REDACTED, location: { city: REDACTED, country: expect.not.stringMatching(/redacted/) }, device: { deviceHash: REDACTED } });
        const search = await call('search_sessions', { projectId, ...SEED_RANGE }, h.tokens.aMasked);
        expect(search.data.sessions.every((item: { userId: string | null }) => item.userId === null || item.userId === REDACTED)).toBe(true);
        const context = await call('get_session_context', { sessionId: A.special.secrets.sessionId }, h.tokens.aMasked);
        expect(context.raw).not.toContain(A.special.secrets.userEmail);
        expect(context.raw).not.toMatch(/@evil\.example|San Francisco|Zebraville|Berlin|Osaka/);
        expect(context.data.markdown).toContain(`User: ${REDACTED}`);

        h.resetDbRoundTrips();
        const filtered = await call('search_sessions', { projectId, userId: A.filterValues.userId }, h.tokens.aMasked);
        expect(filtered.error).toMatchObject({ code: 'invalid_argument', message: expect.stringContaining('masking') });
        const sampled = await call('sample_sessions', { projectId, userId: A.filterValues.userId }, h.tokens.aMasked);
        expect(sampled.error?.code).toBe('invalid_argument');
    });
});

describe('scopes and access', () => {
    it('a tool needs its scope; the free tools need none', async () => {
        h.addToken('rjm_issues_only', { grantId: 'grant-issues', scopes: ['issues:read'] });
        h.resetDbRoundTrips();
        const refused = await call('search_sessions', { projectId }, 'rjm_issues_only');
        expect(refused.error).toMatchObject({ code: 'insufficient_scope' });
        expect(h.dbRoundTrips()).toBe(0);
        expect((await call('list_issues', { projectId, ...SEED_RANGE }, 'rjm_issues_only')).isError).toBe(false);
        expect((await call('list_projects', {}, 'rjm_issues_only')).isError).toBe(false);
        h.addToken('rjm_sessions_only', { grantId: 'grant-sessions', scopes: ['sessions:read'] });
        expect((await call('get_issue', { issueId: A.special.rageThenCrash.issueId }, 'rjm_sessions_only')).error?.code).toBe('insufficient_scope');
    });

    it('a grant never reaches projects of another team, even if it names them', async () => {
        h.addToken('rjm_forged', { grantId: 'grant-forged', projectIds: [projectId, B.projects[0].id] });
        const out = await call('list_projects', {}, 'rjm_forged');
        expect(out.data.projects.map((project: { id: string }) => project.id)).toEqual([projectId]);
        expect((await call('search_sessions', { projectId: B.projects[0].id, ...SEED_RANGE }, 'rjm_forged')).error?.code).toBe('not_found');
        expect((await call('get_session', { sessionId: B.special.secrets.sessionId }, 'rjm_forged')).error?.code).toBe('not_found');
    });

    it('a removed member loses access on the next call', async () => {
        const member = A.users[1];
        h.addToken('rjm_member', { grantId: 'grant-member', userId: member.id });
        expect((await call('list_projects', {}, 'rjm_member')).data.projects).toHaveLength(2);
        expect((await call('get_session', { sessionId: A.special.long.sessionId }, 'rjm_member')).isError).toBe(false);

        await h.pg.db.delete(teamMembers).where(and(eq(teamMembers.teamId, A.id), eq(teamMembers.userId, member.id)));
        for (const tool of MCP_TOOLS) {
            const out = await call(tool.name, toolCases(A)[tool.name][0], 'rjm_member');
            expect(out.error, tool.name).toMatchObject({ code: 'access_revoked', requestId: expect.any(String) });
            expect(out.raw, tool.name).not.toMatch(/zebra/i);
        }
        // The owner is unaffected.
        expect((await call('list_projects')).data.projects).toHaveLength(2);
        await h.pg.db.insert(teamMembers).values({ teamId: A.id, userId: member.id, role: 'member' });
        expect((await call('list_projects', {}, 'rjm_member')).isError).toBe(false);
    });

    it('a deleted project disappears on the next call and looks like one that never existed', async () => {
        const web = A.projects[1];
        const sessionId = web.sessionIds[0];
        expect((await call('get_session', { sessionId })).isError).toBe(false);
        await h.pg.db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, web.id));
        try {
            expect((await call('list_projects')).data.projects.map((project: { id: string }) => project.id)).toEqual([projectId]);
            const gone = await call('get_session', { sessionId });
            const never = await call('get_session', { sessionId: 'session_1700000000000_00000000000000000000000000000000' });
            expect(gone.error).toMatchObject({ code: 'not_found', message: never.error!.message });
            expect((await call('search_sessions', { projectId: web.id, ...SEED_RANGE })).error?.code).toBe('not_found');
            expect((await call('get_issue', { issueId: web.issueIds[0] })).error?.code).toBe('not_found');
            const digests = await call('get_session_digests', { sessionIds: [sessionId, A.special.long.sessionId] });
            expect(digests.data.digests.map((digest: { id: string }) => digest.id)).toEqual([A.special.long.sessionId]);
            expect(digests.data.notFound).toEqual([sessionId]);
            // The other project still works.
            expect((await call('get_session', { sessionId: A.special.long.sessionId })).isError).toBe(false);
        } finally {
            await h.pg.db.update(projects).set({ deletedAt: null }).where(eq(projects.id, web.id));
        }
        expect((await call('get_session', { sessionId })).isError).toBe(false);
    });
});

describe('caps', () => {
    it('counts stop at 10,000 and say so; the page and the sample stay small', async () => {
        const web = A.projects[1].id;
        await h.pg.client.query(
            `insert into sessions (id, project_id, platform, status, started_at)
             select 'session_cap_' || g, $1::uuid, 'web', 'ready', timestamp '2026-11-10 00:00:00' + g * interval '1 second'
             from generate_series(1, 10050) g`,
            [web],
        );
        try {
            const search = await call('search_sessions', { projectId: web, ...SEED_RANGE });
            expect(search.data.total).toEqual({ count: 10_000, capped: true, display: '10,000+' });
            expect(search.data.sessions).toHaveLength(25);
            expect(search.data.nextCursor).toEqual(expect.any(String));
            const sample = await call('sample_sessions', { projectId: web, ...SEED_RANGE, size: 30, seed: 5 });
            expect(sample.data.population).toEqual({ count: 10_000, capped: true, display: '10,000+' });
            expect(sample.data.sessions).toHaveLength(30);
            expect((await call('sample_sessions', { projectId: web, ...SEED_RANGE, size: 30, seed: 5 })).data.sessions).toEqual(sample.data.sessions);
            const health = await call('get_project_health', { projectId: web, ...SEED_RANGE });
            expect(health.data.sessions.count).toBe(10_050 + A.projects[1].sessionIds.length);
        } finally {
            await h.pg.db.delete(sessions).where(sql`${sessions.id} like 'session_cap_%'`);
        }
    }, 60_000);
});
