/**
 * Tenant isolation and leak scans.
 *
 * The isolation matrix is generated from the tool registry: every argument of
 * every tool is classified (`argKinds`), and each classification that can name
 * tenant data produces cases. A tool with no cases fails the suite, so a new
 * tool cannot be registered without them.
 *
 * "Indistinguishable from not found" is checked literally: the response to
 * another team's id must equal the response to an id that does not exist,
 * once the request id and the timing are blanked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoTeamManifest } from '../mcp/demo/seed.js';
import { MCP_TOOLS } from '../mcp/tools/registry.js';
import type { AnyMcpTool } from '../mcp/tools/registry.js';
import type { McpArgKind } from '../mcp/tools/types.js';
import { normalizeResponse, toolCases } from './helpers/mcpToolCases.js';
import { startMcpToolHarness } from './helpers/mcpToolHarness.js';
import type { McpToolHarness, ToolCallOutcome } from './helpers/mcpToolHarness.js';
import { PGLITE_START_TIMEOUT_MS } from './helpers/pgliteHarness.js';

let h: McpToolHarness;

beforeAll(async () => {
    h = await startMcpToolHarness();
}, PGLITE_START_TIMEOUT_MS);

afterAll(async () => {
    // Reported in the build notes: how much the matrix and the scan covered.
    process.stderr.write(`[mcp isolation] matrix cases per direction: ${JSON.stringify(matrixSizes)}; leak scan: ${scanTotals.responses} responses, ${scanTotals.bytes} bytes\n`);
    await h.close();
});

const MISSING_UUID = '00000000-0000-4000-8000-0000000dead1';
const MISSING_SESSION = 'session_1700000000000_0123456789abcdef0123456789abcdef';
const MISSING_SESSION_2 = 'session_1600000000000_fedcba9876543210fedcba9876543210';

interface IsolationCase {
    tool: string;
    argument: string;
    label: string;
    /** Arguments naming the other team's data. */
    foreign: Record<string, unknown>;
    /** The same call naming something that does not exist. */
    missing: Record<string, unknown>;
    /** Strings from the other team that the foreign response must not contain. */
    foreignValues: string[];
    expectation: 'not_found' | 'empty' | 'partial';
}

/** Cases for one argument, by kind. `neutral` arguments produce none. */
function casesForArgument(tool: AnyMcpTool, argument: string, kind: McpArgKind, own: DemoTeamManifest, other: DemoTeamManifest): IsolationCase[] {
    const base = toolCases(own)[tool.name][0];
    const otherProject = other.projects[0];
    const make = (label: string, foreignValue: unknown, missingValue: unknown, expectation: IsolationCase['expectation'], foreignValues: string[], extra: Record<string, unknown> = {}): IsolationCase => ({
        tool: tool.name,
        argument,
        label,
        foreign: { ...base, ...extra, [argument]: foreignValue },
        missing: { ...base, ...extra, [argument]: missingValue },
        foreignValues,
        expectation,
    });

    switch (kind) {
        case 'project':
            return [make("another team's project id", otherProject.id, MISSING_UUID, 'not_found', [otherProject.id, otherProject.name])];
        case 'session':
            return [
                make("another team's session id", other.special.rageThenCrash.sessionId, MISSING_SESSION, 'not_found', [other.special.rageThenCrash.sessionId]),
                make("another team's session id (secrets session)", other.special.secrets.sessionId, MISSING_SESSION, 'not_found', [other.special.secrets.userEmail]),
            ];
        case 'sessionList': {
            const ownIds = own.projects[0].sessionIds.slice(0, 2);
            const foreignId = other.special.rageThenCrash.sessionId;
            return [
                make("only another team's session ids", [foreignId, other.special.secrets.sessionId], [MISSING_SESSION, MISSING_SESSION_2], 'partial', []),
                make("another team's session id smuggled between own ids", [ownIds[0], foreignId, ownIds[1]], [ownIds[0], MISSING_SESSION, ownIds[1]], 'partial', []),
            ];
        }
        case 'issue':
            return [make("another team's issue id", other.special.rageThenCrash.issueId, MISSING_UUID, 'not_found', [other.special.rageThenCrash.issueId])];
        case 'fault': {
            const cases: IsolationCase[] = [];
            for (const [type, id] of [['crash', otherProject.crashIds[0]], ['anr', otherProject.anrIds[0]], ['error', otherProject.errorIds[0]]] as const) {
                cases.push(make(`another team's ${type} id`, id, MISSING_UUID, 'not_found', [id], { type: undefined }));
                cases.push(make(`another team's ${type} id with its type`, id, MISSING_UUID, 'not_found', [id], { type }));
            }
            return cases;
        }
        case 'filter': {
            const foreignValue = other.filterValues[argument as keyof DemoTeamManifest['filterValues']];
            if (foreignValue === undefined) throw new Error(`No foreign filter value for ${tool.name}.${argument}`);
            return [make(`a ${argument} value that only exists in another team's data`, foreignValue, 'no-such-value-anywhere', 'empty', [])];
        }
        case 'neutral':
            return [];
    }
}

function buildMatrix(own: DemoTeamManifest, other: DemoTeamManifest): IsolationCase[] {
    return MCP_TOOLS.flatMap((tool) =>
        Object.entries(tool.argKinds as Record<string, McpArgKind>).flatMap(([argument, kind]) => casesForArgument(tool, argument, kind, own, other)),
    );
}

/** Tools without a tenant-naming argument: what they must still not show. */
const ARGUMENT_FREE_CHECKS: Record<string, (own: DemoTeamManifest, other: DemoTeamManifest, out: ToolCallOutcome) => void> = {
    list_projects: (own, other, out) => {
        expect(out.data.projects.map((project: { id: string }) => project.id).sort()).toEqual(own.projects.map((project) => project.id).sort());
        for (const project of other.projects) expect(out.raw).not.toContain(project.id);
    },
    get_usage: (own, _other, out) => {
        // Team B's allowance is set apart in the test below; each team sees its own.
        expect(out.data.creditsUsed).toBe(own.key === 'a' ? 111 : 222);
    },
};

function emptiness(out: ToolCallOutcome): unknown {
    return {
        sessions: out.data.sessions,
        total: out.data.total?.count,
        population: out.data.population?.count,
        sessionsInRange: out.data.sessionsInRange,
        groups: out.data.groups,
    };
}

const matrixSizes: Record<string, number> = {};

describe('tenant isolation matrix (generated from the tool registry)', () => {
    it('every argument of every tool is classified, and every tool has isolation cases', () => {
        const matrix = buildMatrix(h.manifest.teamA, h.manifest.teamB);
        for (const tool of MCP_TOOLS) {
            const declared = Object.keys(tool.argKinds).sort();
            const actual = Object.keys((tool.inputSchema as { shape: Record<string, unknown> }).shape).sort();
            expect(declared, `${tool.name}: argKinds must list exactly the input arguments`).toEqual(actual);
            const cases = matrix.filter((entry) => entry.tool === tool.name);
            const hasCheck = tool.name in ARGUMENT_FREE_CHECKS;
            expect(cases.length > 0 || hasCheck, `${tool.name} has no isolation cases`).toBe(true);
            // A tool with tenant-naming arguments must not hide behind an argument-free check.
            if (Object.values(tool.argKinds as Record<string, McpArgKind>).some((kind) => kind !== 'neutral')) expect(cases.length, tool.name).toBeGreaterThan(0);
        }
        // Every tenant-naming kind is exercised somewhere.
        const kinds = new Set(MCP_TOOLS.flatMap((tool) => Object.values(tool.argKinds as Record<string, McpArgKind>)));
        expect([...kinds].sort()).toEqual(['fault', 'filter', 'issue', 'neutral', 'project', 'session', 'sessionList']);
        // 33 cases per direction with the current registry; they run in both directions.
        expect(matrix.length).toBeGreaterThanOrEqual(33);
    });

    for (const direction of ['a', 'b'] as const) {
        it(`team ${direction.toUpperCase()} obtains nothing from the other team, and cannot tell "theirs" from "does not exist"`, async () => {
            const own = direction === 'a' ? h.manifest.teamA : h.manifest.teamB;
            const other = direction === 'a' ? h.manifest.teamB : h.manifest.teamA;
            const token = h.tokens[direction];
            const matrix = buildMatrix(own, other);
            let checked = 0;

            for (const entry of matrix) {
                const where = `${entry.tool}.${entry.argument}: ${entry.label}`;
                const foreign = await h.call(token, entry.tool, entry.foreign);
                const missing = await h.call(token, entry.tool, entry.missing);

                expect(foreign.raw.toLowerCase(), where).not.toContain(other.tenantWord);
                for (const value of entry.foreignValues) expect(foreign.raw, where).not.toContain(value);

                if (entry.expectation === 'not_found') {
                    expect(foreign.error, where).toMatchObject({ code: 'not_found', message: 'Not found.' });
                    expect(normalizeResponse(foreign.text), where).toBe(normalizeResponse(missing.text));
                    expect(foreign.data, where).toEqual({});
                } else if (entry.expectation === 'empty') {
                    expect(foreign.isError, `${where}: ${foreign.text}`).toBe(false);
                    expect(emptiness(foreign), where).toEqual(emptiness(missing));
                    const empty = emptiness(foreign) as { sessions?: unknown[]; total?: number; population?: number; sessionsInRange?: number };
                    expect(empty.sessions ?? [], where).toEqual([]);
                    expect(empty.total ?? empty.population ?? empty.sessionsInRange, where).toBe(0);
                } else {
                    // Lists of ids: the foreign id is reported exactly like an unknown one.
                    expect(foreign.isError, `${where}: ${foreign.text}`).toBe(false);
                    const blank = (out: ToolCallOutcome, ids: unknown) => {
                        let text = normalizeResponse(out.text);
                        for (const id of ids as string[]) if (!own.projects.some((project) => project.sessionIds.includes(id))) text = text.split(id).join('ID');
                        return text;
                    };
                    expect(blank(foreign, entry.foreign[entry.argument]), where).toBe(blank(missing, entry.missing[entry.argument]));
                    const ownIds = (entry.foreign[entry.argument] as string[]).filter((id) => own.projects.some((project) => project.sessionIds.includes(id)));
                    expect(foreign.data.digests.map((digest: { id: string }) => digest.id), where).toEqual(ownIds);
                    expect(foreign.data.notFound, where).toEqual((entry.foreign[entry.argument] as string[]).filter((id) => !ownIds.includes(id)));
                }
                checked += 1;
            }
            expect(checked).toBe(matrix.length);
            matrixSizes[direction] = matrix.length;
        }, 120_000);
    }

    it('argument-free tools show only the caller\'s own data', async () => {
        h.usage.set(h.manifest.teamA.id, { creditsUsed: 111, creditsLimit: 300, periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-12-01T00:00:00Z') });
        h.usage.set(h.manifest.teamB.id, { creditsUsed: 222, creditsLimit: 300, periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-12-01T00:00:00Z') });
        for (const [name, check] of Object.entries(ARGUMENT_FREE_CHECKS)) {
            check(h.manifest.teamA, h.manifest.teamB, await h.call(h.tokens.a, name, {}));
            check(h.manifest.teamB, h.manifest.teamA, await h.call(h.tokens.b, name, {}));
        }
    });

    it("a cursor from another team's listing is only a position: it returns the caller's own rows", async () => {
        const range = { from: '2026-10-21T00:00:00.000Z', to: '2026-11-20T12:00:00.000Z' };
        const theirs = await h.call(h.tokens.b, 'search_sessions', { projectId: h.manifest.teamB.projects[0].id, ...range });
        expect(theirs.data.nextCursor).toEqual(expect.any(String));
        const mine = await h.call(h.tokens.a, 'search_sessions', { projectId: h.manifest.teamA.projects[0].id, ...range, cursor: theirs.data.nextCursor });
        expect(mine.isError).toBe(false);
        expect(mine.data.sessions.length).toBeGreaterThan(0);
        for (const session of mine.data.sessions) expect(h.manifest.teamA.projects[0].sessionIds).toContain(session.id);
        expect(mine.raw.toLowerCase()).not.toContain('quokka');
    });

    it('the artifact reader is only ever asked for sessions of the caller\'s own projects', async () => {
        h.artifacts.reads.length = 0;
        const b = h.manifest.teamB;
        await h.call(h.tokens.a, 'get_session_timeline', { sessionId: b.special.rageThenCrash.sessionId });
        await h.call(h.tokens.a, 'get_session_context', { sessionId: b.special.secrets.sessionId });
        await h.call(h.tokens.a, 'get_crash_context', { faultId: b.special.rageThenCrash.crashId });
        await h.call(h.tokens.a, 'get_issue_context', { issueId: b.special.rageThenCrash.issueId });
        expect(h.artifacts.reads).toEqual([]);
        await h.call(h.tokens.a, 'get_session_timeline', { sessionId: h.manifest.teamA.special.rageThenCrash.sessionId });
        expect(h.artifacts.reads).toEqual([{ projectId: h.manifest.teamA.projects[0].id, sessionId: h.manifest.teamA.special.rageThenCrash.sessionId }]);
    });
});

let scanTotals = { responses: 0, bytes: 0 };

describe('canary leak scan', () => {
    const REQUIRED_HITS = ['Authorization: Bearer [redacted]', 'with jwt [redacted] and key [redacted]', 'paid with card [redacted]', 'api.zebra.example/v1/checkout', 'promo (evil.example/pixel.png)'];

    it('no response to any user contains a planted secret, a storage key, a raw device id or another team\'s data', async () => {
        const { neverReturned, teamA, teamB } = h.manifest;
        const scans: Array<{ token: string; own: DemoTeamManifest; other: DemoTeamManifest; masked: boolean }> = [
            { token: h.tokens.a, own: teamA, other: teamB, masked: false },
            { token: h.tokens.b, own: teamB, other: teamA, masked: false },
            { token: h.tokens.aMasked, own: teamA, other: teamB, masked: true },
        ];
        const otherIds = (team: DemoTeamManifest) => [
            team.id,
            ...team.users.flatMap((user) => [user.id, user.email]),
            ...team.projects.flatMap((project) => [project.id, project.name, ...project.sessionIds, ...project.issueIds, ...project.crashIds, ...project.anrIds, ...project.errorIds]),
        ];
        const forbiddenEverywhere = [...neverReturned.substrings, ...neverReturned.rawDeviceIds, ...neverReturned.storageKeys, 'endpoint-', 'pk_', 'stripe', 'billing.'];
        let responses = 0;
        let bytes = 0;
        const seenByTeamA: string[] = [];

        for (const scan of scans) {
            const forbidden = [...forbiddenEverywhere, ...otherIds(scan.other), ...scan.own.users.map((user) => user.email)];
            const bodies: Array<{ where: string; raw: string }> = [];

            for (const tool of MCP_TOOLS) {
                // Valid calls, then the same tools pointed at the other team and at nonsense.
                const own = toolCases(scan.own)[tool.name];
                const foreign = toolCases(scan.other)[tool.name];
                for (const [index, args] of [...own, ...foreign].entries()) {
                    if (scan.masked && 'userId' in args) continue;
                    const out = await h.call(scan.token, tool.name, args);
                    if (index < own.length) expect(out.isError, `${tool.name} ${JSON.stringify(args)}: ${out.text}`).toBe(false);
                    // An id the caller sent and got back under "notFound" is an echo of
                    // its own input, not data: blank it before scanning.
                    let raw = out.raw;
                    for (const echoed of (out.data.notFound ?? []) as string[]) raw = raw.split(echoed).join('ECHOED_INPUT');
                    if (index >= own.length && !out.isError && Array.isArray(out.data.digests)) expect(out.data.digests, tool.name).toEqual([]);
                    bodies.push({ where: `${tool.name} ${JSON.stringify(args).slice(0, 120)}`, raw });
                    // Follow one page of anything that pages.
                    if (!out.isError && typeof out.data.nextCursor === 'string') {
                        bodies.push({ where: `${tool.name} page 2`, raw: (await h.call(scan.token, tool.name, { ...args, cursor: out.data.nextCursor })).raw });
                    }
                }
            }

            for (const body of bodies) {
                const lower = body.raw.toLowerCase();
                expect(lower.includes(scan.other.tenantWord), `${scan.own.key}: other team's word in ${body.where}`).toBe(false);
                for (const needle of forbidden) {
                    if (body.raw.includes(needle)) throw new Error(`${scan.own.key}${scan.masked ? ' (masked)' : ''}: "${needle.slice(0, 60)}" leaked in ${body.where}`);
                }
                if (scan.masked) {
                    expect(body.raw, body.where).not.toMatch(/zebra-user-|@zebra-users\.example|San Francisco|Zebraville|Berlin|Osaka|"deviceHash":"[a-f0-9]{12}"/);
                }
                responses += 1;
                bytes += body.raw.length;
            }
            if (scan.own.key === 'a' && !scan.masked) seenByTeamA.push(...bodies.map((body) => body.raw));
        }

        // The scan looked at the sessions that carry the planted secrets, after scrubbing.
        const everything = seenByTeamA.join('\n');
        for (const marker of REQUIRED_HITS) expect(everything, marker).toContain(marker);
        expect(everything).toContain(h.manifest.teamA.special.secrets.userEmail);
        expect(responses).toBeGreaterThan(150);
        expect(bytes).toBeGreaterThan(500_000);
        scanTotals = { responses, bytes };
        expect(h.serverErrors).toEqual([]);
    }, 240_000);

    it('error results never carry internal text', async () => {
        const out = await h.call(h.tokens.a, 'get_session', { sessionId: h.manifest.teamB.special.secrets.sessionId });
        expect(Object.keys(out.error!)).toEqual(['code', 'message', 'requestId']);
        expect(out.raw).not.toMatch(/select|from "|sessions|project_id|drizzle|pglite|stack|at \w+ \(/i);
    });
});
