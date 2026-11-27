/**
 * Runs one tool call: concurrency cap, deadline, live access check, scope
 * check, the handler, then the single output layer. Whatever goes wrong, the
 * client gets a tool error result with a generic message and a request id; the
 * real error goes to `onError` and nowhere else.
 */

import type { McpGrant } from './auth.js';
import { buildMcpContext } from './context.js';
import type { McpAccessChecker, McpContext } from './context.js';
import { McpToolError, newRequestId, toErrorResult } from './errors.js';
import type { McpErrorResult } from './errors.js';
import { finalizeToolOutput } from './output/emit.js';
import type { AnyMcpTool } from './tools/registry.js';
import type { McpToolDeps } from './tools/types.js';
import type { McpGate, KillSwitches } from './metering.js';
import type { McpCallRecord } from './usage.js';

export type { McpCallRecord } from './usage.js';

export const DEFAULT_TOOL_DEADLINE_MS = 20_000;
export const DEFAULT_MAX_CONCURRENT_TOOLS = 12;
export const DEFAULT_BUSY_RETRY_SECONDS = 2;
/** How long a call waits for a free slot before it is told to retry. */
export const DEFAULT_SLOT_WAIT_MS = 1_500;
/** Calls allowed to wait for a slot at once. Beyond that the answer is immediate. */
export const DEFAULT_MAX_WAITING_TOOLS = 24;

/**
 * A fixed number of tool executions per process. A call that finds every slot
 * taken waits a moment for one (a client often sends several calls at once,
 * and most finish in milliseconds); if none frees up, or too many are already
 * waiting, it is told to retry. A slot is held until the work has actually
 * finished, including work that outlived its deadline.
 */
export class ConcurrencyGate {
    private active = 0;
    private readonly waiters: Array<(release: (() => void) | null) => void> = [];

    constructor(readonly limit: number, readonly maxWaiting = 0) {}

    get inFlight(): number {
        return this.active;
    }

    get waiting(): number {
        return this.waiters.length;
    }

    private take(): () => void {
        this.active += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active -= 1;
            // Hand the slot straight to whoever has waited longest.
            this.waiters.shift()?.(this.take());
        };
    }

    tryAcquire(): (() => void) | null {
        if (this.active >= this.limit) return null;
        return this.take();
    }

    /** A slot now, a slot within `waitMs`, or null. */
    acquire(waitMs: number): Promise<(() => void) | null> {
        const now = this.tryAcquire();
        if (now || waitMs <= 0 || this.waiters.length >= this.maxWaiting) return Promise.resolve(now);
        return new Promise((resolve) => {
            const waiter = (release: (() => void) | null) => {
                clearTimeout(timer);
                resolve(release);
            };
            const timer = setTimeout(() => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0) this.waiters.splice(index, 1);
                resolve(null);
            }, waitMs);
            timer.unref?.();
            this.waiters.push(waiter);
        });
    }
}

export interface McpToolRuntimeOptions {
    access: McpAccessChecker;
    deps: McpToolDeps;
    /** Per-call deadline. */
    deadlineMs?: number;
    maxConcurrent?: number;
    /** How long a call waits for a free slot before the busy answer. 0 never waits. */
    slotWaitMs?: number;
    maxWaiting?: number;
    busyRetrySeconds?: number;
    bytesPerCredit?: number;
    /** Receives the real error behind an `internal` result, with the request id. */
    onError?: (error: Error, requestId: string) => void;
    /**
     * Called once per call with sizes, ids and the time taken, in addition to
     * `deps.usage.recordCall`. For logs and metrics.
     */
    onCall?: (record: McpCallRecord) => void;
    /** Allowance, per-user rate and concurrency limits. Without it calls are not metered. */
    gate?: McpGate;
    /** Server, tool, team and connection switches. */
    switches?: KillSwitches;
    /** True when the database is under pressure: MCP is refused first. */
    shouldShed?: () => boolean;
}

export interface McpToolSuccess {
    [key: string]: unknown;
    structuredContent: Record<string, unknown>;
    content: Array<{ type: 'text'; text: string }>;
    _meta: Record<string, unknown>;
}

export interface McpToolRuntime {
    gate: ConcurrencyGate;
    execute(tool: AnyMcpTool, args: unknown, grant: McpGrant | null, clientSignal?: AbortSignal): Promise<McpToolSuccess | McpErrorResult>;
}

/** Postgres `query_canceled` (57014), on the error or on what it wraps. */
export function isStatementTimeout(error: unknown): boolean {
    for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 4; depth += 1) {
        if ((current as { code?: unknown }).code === '57014') return true;
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}

export function createToolRuntime(options: McpToolRuntimeOptions): McpToolRuntime {
    const deadlineMs = options.deadlineMs ?? DEFAULT_TOOL_DEADLINE_MS;
    const busyRetrySeconds = options.busyRetrySeconds ?? DEFAULT_BUSY_RETRY_SECONDS;
    const slotWaitMs = options.slotWaitMs ?? DEFAULT_SLOT_WAIT_MS;
    const gate = new ConcurrencyGate(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_TOOLS, options.maxWaiting ?? DEFAULT_MAX_WAITING_TOOLS);

    async function run(
        tool: AnyMcpTool,
        args: unknown,
        grant: McpGrant,
        requestId: string,
        signal: AbortSignal,
        startedAtMs: number,
        onContext: (ctx: McpContext) => void,
    ) {
        if (tool.requiredScope !== null && !grant.scopes.includes(tool.requiredScope)) {
            throw new McpToolError('insufficient_scope');
        }
        // Argument checks beyond the schema come before any query.
        tool.validate?.(args, { now: options.deps.now() });
        const credits = tool.credits(args);

        const access = await options.access.check(grant);
        const ctx = buildMcpContext(grant, access, { requestId, signal, now: options.deps.now() });
        onContext(ctx);
        await options.switches?.check(tool.name, ctx);
        if (options.shouldShed?.()) {
            throw new McpToolError('busy', `The server is busy. Retry in ${busyRetrySeconds} seconds.`, { retryAfterSeconds: busyRetrySeconds });
        }
        const release = options.gate ? await options.gate.admit(ctx, { name: tool.name, credits }) : null;
        let ok = false;
        try {
            const output = await produce(ctx);
            ok = true;
            return { output, credits };
        } finally {
            if (release) {
                // Settling must not change the result of the call.
                await release({ ok: ok && !signal.aborted }).catch(() => undefined);
            }
        }

        async function produce(ctx: McpContext) {
        const result = await tool.handler(args, ctx, options.deps);
        const output = finalizeToolOutput({
            schema: tool.outputSchema,
            data: result.data,
            paging: result.paging,
            credits,
            bytesPerCredit: options.bytesPerCredit,
            startedAtMs,
            renderMarkdown: tool.renderMarkdown as ((result: Record<string, unknown>) => string) | undefined,
            env: { mask: ctx.maskIdentifiers, linkBase: options.deps.links.base },
        });
        return output;
        }
    }

    return {
        gate,
        async execute(tool, args, grant, clientSignal) {
            const requestId = newRequestId();
            // Monotonic clock, started before any argument check or query.
            const startedAtMs = performance.now();
            let billing: { scopeKey: string; period: string } | undefined;
            const onContext = (ctx: McpContext) => {
                if (ctx.allowance) billing = { scopeKey: ctx.allowance.scopeKey, period: ctx.allowance.period };
            };
            const record = (outcome: McpCallRecord['outcome'], credits: number, bytes: number, tookMs?: number) => {
                const entry: McpCallRecord = {
                    tool: tool.name,
                    requestId,
                    grantId: grant?.grantId ?? null,
                    teamId: grant?.teamId ?? null,
                    userId: grant?.userId ?? null,
                    credits,
                    bytes,
                    outcome,
                    durationMs: tookMs ?? Math.max(0, Math.round(performance.now() - startedAtMs)),
                    ...(billing ?? {}),
                };
                // Observers must not change the result of a call.
                try {
                    options.deps.usage.recordCall?.(entry);
                } catch {
                    // ignored
                }
                try {
                    options.onCall?.(entry);
                } catch {
                    // ignored
                }
            };
            const fail = (error: unknown) => {
                // A statement the database stopped at its time limit is the same
                // answer as our own deadline: say so, with the advice to narrow.
                const known = error instanceof McpToolError
                    ? error
                    : new McpToolError(isStatementTimeout(error) ? 'deadline_exceeded' : 'internal');
                if (!(error instanceof McpToolError)) {
                    try {
                        options.onError?.(error instanceof Error ? error : new Error(String(error)), requestId);
                    } catch {
                        // Same: reporting must not change the result.
                    }
                }
                record(known.code, 0, 0);
                return toErrorResult(known, requestId);
            };

            if (!grant) {
                // The HTTP layer authenticates first; reaching this is a wiring bug. Refuse.
                return fail(new Error('Tool call without a verified grant'));
            }

            const release = await gate.acquire(slotWaitMs);
            if (!release) {
                return fail(new McpToolError('busy', `The server is busy. Retry in ${busyRetrySeconds} seconds.`, { retryAfterSeconds: busyRetrySeconds }));
            }

            const controller = new AbortController();
            const onClientAbort = () => controller.abort();
            clientSignal?.addEventListener('abort', onClientAbort, { once: true });

            let timer: NodeJS.Timeout | undefined;
            const deadline = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new McpToolError('deadline_exceeded'));
                }, deadlineMs);
                timer.unref?.();
            });

            // The slot is released when the work itself settles, not when the
            // deadline answers for it, so slow work keeps counting against the cap.
            const work = run(tool, args, grant, requestId, controller.signal, startedAtMs, onContext).finally(() => {
                release();
                clientSignal?.removeEventListener('abort', onClientAbort);
            });
            work.catch(() => undefined);

            try {
                const { output, credits } = await Promise.race([work, deadline]);
                // The same figure the client sees in `meta.tookMs`.
                record('ok', credits, output.bytes, output.meta.tookMs);
                return { structuredContent: output.structuredContent, content: output.content, _meta: output._meta };
            } catch (error) {
                return fail(error);
            } finally {
                if (timer) clearTimeout(timer);
            }
        },
    };
}
