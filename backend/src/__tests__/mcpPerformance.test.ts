/**
 * Speed by construction: every tool stays inside its declared database
 * round-trip budget, and answers within a generous ceiling against the seeded
 * in-process database.
 *
 * PGlite timings are not production timings (one in-process WebAssembly
 * Postgres, a few hundred rows). The ceilings exist to catch pathological
 * regressions such as an unbounded scan or a query per row, not to predict p95.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '../mcp/tools/registry.js';
import { toolCases } from './helpers/mcpToolCases.js';
import { startMcpToolHarness } from './helpers/mcpToolHarness.js';
import type { McpToolHarness } from './helpers/mcpToolHarness.js';
import { PGLITE_START_TIMEOUT_MS } from './helpers/pgliteHarness.js';

/** Per-tool ceiling for the server-side time of a warm call against PGlite. */
const CEILING_MS = 500;
const TIMED_RUNS = 5;

let h: McpToolHarness;
const report: Array<Record<string, unknown>> = [];

beforeAll(async () => {
    h = await startMcpToolHarness();
}, PGLITE_START_TIMEOUT_MS);

afterAll(async () => {
    process.stderr.write(`[mcp performance] ${JSON.stringify(report)}\n`);
    await h.close();
});

describe('database round trips', () => {
    it('every tool declares a small budget', () => {
        for (const tool of MCP_TOOLS) {
            expect(Number.isInteger(tool.maxDbRoundTrips), tool.name).toBe(true);
            expect(tool.maxDbRoundTrips, tool.name).toBeGreaterThanOrEqual(1);
            expect(tool.maxDbRoundTrips, tool.name).toBeLessThanOrEqual(6);
        }
    });

    it('no tool exceeds its budget, for any argument set, access check included', async () => {
        const cases = toolCases(h.manifest.teamA);
        for (const tool of MCP_TOOLS) {
            expect(cases[tool.name], `${tool.name} has no argument sets`).toBeDefined();
            const counts: number[] = [];
            let largest = 0;
            for (const args of cases[tool.name]) {
                h.resetDbRoundTrips();
                const out = await h.call(h.tokens.a, tool.name, args);
                expect(out.isError, `${tool.name}: ${out.text}`).toBe(false);
                const used = h.dbRoundTrips();
                expect(used, `${tool.name} ${JSON.stringify(args).slice(0, 100)} used ${used} round trips`).toBeLessThanOrEqual(tool.maxDbRoundTrips);
                counts.push(used);
                largest = Math.max(largest, Buffer.byteLength(out.text, 'utf8'));
            }
            report.push({ tool: tool.name, budget: tool.maxDbRoundTrips, commonPath: counts[0], max: Math.max(...counts), largestBytes: largest });
            expect(largest, tool.name).toBeLessThanOrEqual(Math.max(1, tool.credits(cases[tool.name][0])) * 65_536);
        }
    }, 60_000);

    it('round trips do not grow with the number of rows asked for', async () => {
        const ids = h.manifest.teamA.projects[0].sessionIds;
        const count = async (tool: string, args: Record<string, unknown>) => {
            h.resetDbRoundTrips();
            expect((await h.call(h.tokens.a, tool, args)).isError).toBe(false);
            return h.dbRoundTrips();
        };
        expect(await count('get_session_digests', { sessionIds: ids.slice(0, 50) })).toBe(await count('get_session_digests', { sessionIds: ids.slice(0, 1) }));
        expect(await count('sample_sessions', { projectId: h.manifest.teamA.projects[0].id, from: '2026-10-21T00:00:00.000Z', to: '2026-11-20T12:00:00.000Z', size: 50 }))
            .toBe(await count('sample_sessions', { projectId: h.manifest.teamA.projects[0].id, from: '2026-10-21T00:00:00.000Z', to: '2026-11-20T12:00:00.000Z', size: 1 }));
        // Not found costs no more than found.
        h.resetDbRoundTrips();
        await h.call(h.tokens.a, 'get_session_context', { sessionId: h.manifest.teamB.special.long.sessionId });
        expect(h.dbRoundTrips()).toBeLessThanOrEqual(3);
    });

    it('a cached access check saves one round trip per call', async () => {
        const cached = await startMcpToolHarness({ accessCacheTtlMs: 60_000 });
        try {
            const args = { sessionId: cached.manifest.teamA.special.rageThenCrash.sessionId };
            await cached.call(cached.tokens.a, 'get_session', args);
            cached.resetDbRoundTrips();
            await cached.call(cached.tokens.a, 'get_session', args);
            expect(cached.dbRoundTrips()).toBe(1);
        } finally {
            await cached.close();
        }
    }, PGLITE_START_TIMEOUT_MS);
});

describe('response time', () => {
    it(`every tool answers in under ${CEILING_MS} ms once warm, and reports the time it took`, async () => {
        const cases = toolCases(h.manifest.teamA);
        for (const tool of MCP_TOOLS) {
            const args = cases[tool.name][0];
            await h.call(h.tokens.a, tool.name, args); // warm-up, not timed
            const server: number[] = [];
            const wall: number[] = [];
            let bytes = 0;
            for (let run = 0; run < TIMED_RUNS; run += 1) {
                const started = performance.now();
                const out = await h.call(h.tokens.a, tool.name, args);
                wall.push(performance.now() - started);
                expect(out.isError, tool.name).toBe(false);
                server.push(out.data.meta.tookMs);
                bytes = Buffer.byteLength(out.text, 'utf8');
            }
            const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
            const entry = report.find((item) => item.tool === tool.name) ?? { tool: tool.name };
            Object.assign(entry, { serverMedianMs: median(server), serverMaxMs: Math.max(...server), wallMedianMs: Math.round(median(wall)), bytes });
            if (!report.includes(entry)) report.push(entry);
            expect(Math.max(...server), `${tool.name} took ${server.join(', ')} ms`).toBeLessThan(CEILING_MS);
            // What the client is told matches what happened, within the HTTP overhead.
            expect(median(server), tool.name).toBeLessThanOrEqual(Math.ceil(median(wall)) + 1);
        }
    }, 120_000);
});
