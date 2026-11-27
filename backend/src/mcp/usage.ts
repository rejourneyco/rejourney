/**
 * Allowance numbers and response-time figures for `get_usage`, and the
 * per-call record the server hands over after every tool call.
 *
 * Metering (the ledger, the gate, the plan limits) is built separately. This
 * is the seam it plugs into: tools read usage through this interface and never
 * compute it themselves, and the runtime reports every call to it.
 */

import type { McpContext } from './context.js';
import type { McpToolErrorCode } from './errors.js';

/** What metering, the activity view and logs get to see about a call: sizes and ids, never bodies. */
export interface McpCallRecord {
    tool: string;
    requestId: string;
    grantId: string | null;
    teamId: string | null;
    userId: string | null;
    /** Credits charged; zero for a call that failed. */
    credits: number;
    /** UTF-8 size of the text body sent; zero for a call that failed. */
    bytes: number;
    outcome: 'ok' | McpToolErrorCode;
    /** Server-side time for the call, from receiving the arguments to the serialised result. */
    durationMs: number;
    /** The allowance the call counted against; absent when the call failed before the access check. */
    scopeKey?: string;
    period?: string;
}

export interface McpUsage {
    /** Credits used in the current period. */
    creditsUsed: number;
    /** Credits allowed in the current period; null means unlimited. */
    creditsLimit: number | null;
    periodStart: Date;
    /** When the allowance resets. */
    periodEnd: Date;
}

/** Response times of this connection's most recent successful calls. */
export interface McpResponseTimes {
    /** How many calls the figures cover. */
    calls: number;
    p50Ms: number;
    p95Ms: number;
}

export interface McpUsageProvider {
    getUsage(ctx: McpContext): Promise<McpUsage>;
    /** Called once after every tool call. Must not throw. */
    recordCall?(record: McpCallRecord): void;
    /** Null when there is nothing to report yet. */
    getResponseTimes?(ctx: McpContext): Promise<McpResponseTimes | null>;
}

export const RESPONSE_TIME_WINDOW_CALLS = 100;
const MAX_TRACKED_CONNECTIONS = 2000;

/** Nearest-rank percentile of an unsorted list. */
export function percentile(values: readonly number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.min(sorted.length, Math.max(1, Math.ceil(fraction * sorted.length)));
    return sorted[rank - 1];
}

/**
 * The last N successful call durations per connection, in memory. Bounded
 * both ways: a ring of `windowSize` numbers per connection and at most
 * `maxConnections` connections (the least recently active is dropped).
 */
export class ResponseTimeWindow {
    private readonly rings = new Map<string, { values: number[]; next: number }>();

    constructor(
        private readonly windowSize = RESPONSE_TIME_WINDOW_CALLS,
        private readonly maxConnections = MAX_TRACKED_CONNECTIONS,
    ) {}

    record(record: McpCallRecord): void {
        if (record.outcome !== 'ok' || !record.grantId || !Number.isFinite(record.durationMs)) return;
        let ring = this.rings.get(record.grantId);
        if (ring) {
            // Re-insert so Map order is "least recently active first".
            this.rings.delete(record.grantId);
        } else {
            ring = { values: [], next: 0 };
            if (this.rings.size >= this.maxConnections) {
                const oldest = this.rings.keys().next().value;
                if (oldest !== undefined) this.rings.delete(oldest);
            }
        }
        if (ring.values.length < this.windowSize) {
            ring.values.push(record.durationMs);
        } else {
            ring.values[ring.next] = record.durationMs;
            ring.next = (ring.next + 1) % this.windowSize;
        }
        this.rings.set(record.grantId, ring);
    }

    summarize(grantId: string): McpResponseTimes | null {
        const ring = this.rings.get(grantId);
        if (!ring || ring.values.length === 0) return null;
        return {
            calls: ring.values.length,
            p50Ms: Math.round(percentile(ring.values, 0.5)),
            p95Ms: Math.round(percentile(ring.values, 0.95)),
        };
    }

    get trackedConnections(): number {
        return this.rings.size;
    }
}

/** Per-team allowance numbers and per-connection response times held in memory. For tests and demos. */
export class InMemoryUsageProvider implements McpUsageProvider {
    private readonly byTeam = new Map<string, McpUsage>();
    private readonly window: ResponseTimeWindow;
    /** Every record received, newest last, capped. For tests and a demo activity view. */
    readonly calls: McpCallRecord[] = [];

    constructor(
        private readonly fallback: McpUsage,
        options: { windowSize?: number; maxConnections?: number; maxCalls?: number } = {},
    ) {
        this.window = new ResponseTimeWindow(options.windowSize, options.maxConnections);
        this.maxCalls = options.maxCalls ?? 1000;
    }

    private readonly maxCalls: number;

    set(teamId: string, usage: McpUsage): void {
        this.byTeam.set(teamId, usage);
    }

    async getUsage(ctx: McpContext): Promise<McpUsage> {
        const usage = this.byTeam.get(ctx.teamId) ?? this.fallback;
        return { ...usage, periodStart: new Date(usage.periodStart), periodEnd: new Date(usage.periodEnd) };
    }

    recordCall(record: McpCallRecord): void {
        this.calls.push({ ...record });
        if (this.calls.length > this.maxCalls) this.calls.splice(0, this.calls.length - this.maxCalls);
        this.window.record(record);
    }

    async getResponseTimes(ctx: McpContext): Promise<McpResponseTimes | null> {
        return this.window.summarize(ctx.grantId);
    }
}

/**
 * No metering wired: reports zero use of an unlimited allowance for the
 * current calendar month. Response times are still tracked, per process.
 */
export function createUnmeteredUsageProvider(now: () => Date = () => new Date()): McpUsageProvider {
    const window = new ResponseTimeWindow();
    return {
        async getUsage() {
            const current = now();
            const periodStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
            const periodEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
            return { creditsUsed: 0, creditsLimit: null, periodStart, periodEnd };
        },
        recordCall(record) {
            window.record(record);
        },
        async getResponseTimes(ctx) {
            return window.summarize(ctx.grantId);
        },
    };
}
