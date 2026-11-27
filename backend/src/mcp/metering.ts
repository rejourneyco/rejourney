/**
 * MCP metering: the credit allowance, per-user limits and the call log.
 *
 * Before a tool runs (`gate.admit`):
 *  1. per-user calls per minute, by plan (a Redis counter per minute);
 *  2. per-user calls at once, at most 4 (a Redis counter with expiry);
 *  3. for tools that cost credits: reserve them atomically against the
 *     allowance in Redis. The counter is seeded from Postgres when missing,
 *     so losing Redis loses nothing. If Redis cannot answer, Postgres is
 *     checked instead; if neither can, the call is refused, never allowed.
 * After it ran (`release`): a failed call gets its credits back.
 *
 * After every call (`usage.recordCall`): one call-log row, the durable usage
 * total for the period, and the connection's last-used time, written in the
 * background so the client never waits for them.
 *
 * Redis holds counters only: a few dozen bytes each, all with an expiry.
 */

import { and, eq, sql } from 'drizzle-orm';
import { mcpCallLog, mcpGrants, mcpUsagePeriods } from '../db/schema.js';
import type { McpAllowance } from './allowance.js';
import type { McpContext } from './context.js';
import type { McpWriteDb } from './data/db.js';
import { McpToolError } from './errors.js';
import { ResponseTimeWindow } from './usage.js';
import type { McpCallRecord, McpResponseTimes, McpUsage, McpUsageProvider } from './usage.js';

/** The Redis commands metering uses. ioredis and ioredis-mock both satisfy it. */
export interface MeteringRedis {
    eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
    incr(key: string): Promise<number>;
    decr(key: string): Promise<number>;
    decrby(key: string, amount: number): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
}

export interface McpGateTool {
    name: string;
    credits: number;
}

export type McpGateRelease = (outcome: { ok: boolean }) => Promise<void>;

export interface McpGate {
    /** Throws `rate_limited`, `busy` or `limit_reached`; otherwise returns how to settle the call. */
    admit(ctx: McpContext, tool: McpGateTool): Promise<McpGateRelease>;
}

export interface McpMeteringOptions {
    db: McpWriteDb;
    /** Null runs without Redis: limits checked against Postgres, no per-minute or concurrency limits. */
    redis: MeteringRedis | null;
    /** Dashboard base URL, for the upgrade link in the limit message. */
    dashboardBaseUrl: string;
    now?: () => Date;
    maxConcurrentPerUser?: number;
    /** Background write failures. Must not throw. */
    onError?: (error: Error, where: string) => void;
    /** Minimum time between last-used updates of one connection. */
    lastUsedIntervalMs?: number;
}

export interface McpMetering {
    usage: McpUsageProvider;
    gate: McpGate;
    /** Resolves when every background write started so far has settled. For tests and shutdown. */
    flush(): Promise<void>;
}

export const MAX_CONCURRENT_CALLS_PER_USER = 4;

/**
 * Adds `n` to the counter unless that would pass the limit.
 * Returns the new total, -1 when over the limit, -2 when the counter is missing.
 */
const RESERVE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return -2 end
current = tonumber(current)
local n = tonumber(ARGV[1])
if current + n > tonumber(ARGV[2]) then return -1 end
local total = redis.call('INCRBY', KEYS[1], n)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return total
`;

function creditsKey(allowance: McpAllowance): string {
    return `mcp:credits:${allowance.scopeKey}:${allowance.period}`;
}

function counterTtlSeconds(allowance: McpAllowance, now: Date): number {
    // Kept a week past the period end, so a late refund still finds it.
    return Math.max(60, Math.ceil((allowance.periodEnd.getTime() - now.getTime()) / 1000) + 7 * 24 * 3600);
}

function formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function createMetering(options: McpMeteringOptions): McpMetering {
    const { db, redis } = options;
    const now = options.now ?? (() => new Date());
    const maxConcurrent = options.maxConcurrentPerUser ?? MAX_CONCURRENT_CALLS_PER_USER;
    const lastUsedIntervalMs = options.lastUsedIntervalMs ?? 60_000;
    const report = (error: unknown, where: string) => {
        try {
            options.onError?.(error instanceof Error ? error : new Error(String(error)), where);
        } catch {
            // ignored
        }
    };
    const window = new ResponseTimeWindow();
    const pending = new Set<Promise<unknown>>();
    const lastUsedWrittenAt = new Map<string, number>();
    const billingUrl = `${options.dashboardBaseUrl.replace(/\/$/, '')}/dashboard/billing`;

    function background(work: () => Promise<unknown>, where: string): void {
        const task = work().catch((error) => report(error, where));
        pending.add(task);
        void task.finally(() => pending.delete(task));
    }

    async function creditsUsedInPostgres(allowance: McpAllowance): Promise<number> {
        const [row] = await db
            .select({ credits: mcpUsagePeriods.credits })
            .from(mcpUsagePeriods)
            .where(and(eq(mcpUsagePeriods.scopeKey, allowance.scopeKey), eq(mcpUsagePeriods.period, allowance.period)))
            .limit(1);
        return row?.credits ?? 0;
    }

    async function creditsUsed(allowance: McpAllowance): Promise<number> {
        if (redis) {
            try {
                const value = await redis.get(creditsKey(allowance));
                if (value !== null) return Math.max(0, Number(value) || 0);
            } catch (error) {
                report(error, 'usage.redis');
            }
        }
        return creditsUsedInPostgres(allowance);
    }

    function limitError(allowance: McpAllowance, used: number): McpToolError {
        return new McpToolError(
            'limit_reached',
            `This team has used ${Math.min(used, allowance.creditLimit ?? used).toLocaleString('en-US')} of its ${(allowance.creditLimit ?? 0).toLocaleString('en-US')} MCP credits `
            + `for this billing period (${allowance.planName} plan). The allowance resets on ${formatDate(allowance.periodEnd)}. `
            + `list_projects and get_usage still work. To get more credits, upgrade the plan: ${billingUrl}`,
        );
    }

    /** Reserves credits; returns the amount to refund if the call fails. */
    async function reserve(allowance: McpAllowance, credits: number): Promise<number> {
        const limit = allowance.creditLimit;
        if (limit === null || credits <= 0) return 0;
        if (redis) {
            try {
                const key = creditsKey(allowance);
                const ttl = counterTtlSeconds(allowance, now());
                let result = Number(await redis.eval(RESERVE_SCRIPT, 1, key, credits, limit, ttl));
                if (result === -2) {
                    const settled = await creditsUsedInPostgres(allowance);
                    await redis.set(key, String(settled), 'EX', ttl, 'NX');
                    result = Number(await redis.eval(RESERVE_SCRIPT, 1, key, credits, limit, ttl));
                }
                if (result === -1) throw limitError(allowance, await creditsUsed(allowance));
                if (result >= 0) return credits;
                throw new Error(`unexpected reserve result ${result}`);
            } catch (error) {
                if (error instanceof McpToolError) throw error;
                report(error, 'reserve.redis');
                // Fall through to Postgres.
            }
        }
        let used: number;
        try {
            used = await creditsUsedInPostgres(allowance);
        } catch (error) {
            report(error, 'reserve.postgres');
            throw new McpToolError('busy', 'Usage could not be checked right now. Retry in a few seconds.', { retryAfterSeconds: 5 });
        }
        if (used + credits > limit) throw limitError(allowance, used);
        return 0;
    }

    async function refund(allowance: McpAllowance, credits: number): Promise<void> {
        if (!redis || credits <= 0) return;
        try {
            await redis.decrby(creditsKey(allowance), credits);
        } catch (error) {
            report(error, 'refund.redis');
        }
    }

    const gate: McpGate = {
        async admit(ctx, tool) {
            const allowance = ctx.allowance;
            if (!allowance) return async () => undefined;
            const current = now();

            if (redis) {
                // 1. Calls per minute, per user.
                try {
                    const minute = Math.floor(current.getTime() / 60_000);
                    const key = `mcp:rate:${ctx.userId}:${minute}`;
                    const count = await redis.incr(key);
                    if (count === 1) await redis.expire(key, 70);
                    if (count > allowance.perMinute) {
                        throw new McpToolError(
                            'rate_limited',
                            `Too many calls: this plan allows ${allowance.perMinute} MCP calls per minute per person. Retry in ${60 - current.getUTCSeconds()} seconds.`,
                            { retryAfterSeconds: Math.max(1, 60 - current.getUTCSeconds()) },
                        );
                    }
                } catch (error) {
                    if (error instanceof McpToolError) throw error;
                    report(error, 'rate.redis');
                }
            }

            // 2. Calls at once, per user.
            let holdsSlot = false;
            if (redis) {
                const key = `mcp:inflight:${ctx.userId}`;
                try {
                    const count = await redis.incr(key);
                    await redis.expire(key, 120);
                    holdsSlot = true;
                    if (count > maxConcurrent) {
                        holdsSlot = false;
                        await redis.decr(key);
                        throw new McpToolError('busy', `At most ${maxConcurrent} calls can run at once for one person. Retry in 2 seconds.`, { retryAfterSeconds: 2 });
                    }
                } catch (error) {
                    if (error instanceof McpToolError) throw error;
                    report(error, 'inflight.redis');
                }
            }
            const leaveSlot = async () => {
                if (!holdsSlot || !redis) return;
                holdsSlot = false;
                try {
                    await redis.decr(`mcp:inflight:${ctx.userId}`);
                } catch (error) {
                    report(error, 'inflight.release');
                }
            };

            // 3. Credits.
            if (allowance.paymentFailed && tool.credits > 0) {
                await leaveSlot();
                throw new McpToolError(
                    'limit_reached',
                    `MCP is paused for this team because the last payment failed. Update the payment method in Rejourney billing: ${billingUrl}. list_projects and get_usage still work.`,
                );
            }
            let reserved = 0;
            try {
                reserved = await reserve(allowance, tool.credits);
            } catch (error) {
                await leaveSlot();
                throw error;
            }

            let settled = false;
            return async ({ ok }) => {
                if (settled) return;
                settled = true;
                await leaveSlot();
                if (!ok) await refund(allowance, reserved);
            };
        },
    };

    const usage: McpUsageProvider = {
        async getUsage(ctx): Promise<McpUsage> {
            const allowance = ctx.allowance;
            if (!allowance) {
                const current = now();
                return {
                    creditsUsed: 0,
                    creditsLimit: null,
                    periodStart: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1)),
                    periodEnd: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)),
                };
            }
            return {
                creditsUsed: await creditsUsed(allowance),
                creditsLimit: allowance.creditLimit,
                periodStart: allowance.periodStart,
                periodEnd: allowance.periodEnd,
            };
        },

        async getResponseTimes(ctx): Promise<McpResponseTimes | null> {
            return window.summarize(ctx.grantId);
        },

        recordCall(record: McpCallRecord) {
            window.record(record);
            if (!record.teamId) return;
            const teamId = record.teamId;
            background(async () => {
                await db.insert(mcpCallLog).values({
                    teamId,
                    grantId: record.grantId,
                    userId: record.userId,
                    tool: record.tool.slice(0, 64),
                    credits: Math.max(0, Math.round(record.credits)),
                    bytes: Math.max(0, Math.round(record.bytes)),
                    outcome: record.outcome,
                    durationMs: Math.max(0, Math.round(record.durationMs)),
                    period: record.period ?? '',
                });
            }, 'record.log');

            if (record.outcome === 'ok' && record.scopeKey && record.period) {
                const { scopeKey, period } = record;
                const credits = Math.max(0, Math.round(record.credits));
                const bytes = Math.max(0, Math.round(record.bytes));
                background(async () => {
                    await db
                        .insert(mcpUsagePeriods)
                        .values({ scopeKey, period, credits, calls: 1, bytes })
                        .onConflictDoUpdate({
                            target: [mcpUsagePeriods.scopeKey, mcpUsagePeriods.period],
                            set: {
                                credits: sql`${mcpUsagePeriods.credits} + ${credits}`,
                                calls: sql`${mcpUsagePeriods.calls} + 1`,
                                bytes: sql`${mcpUsagePeriods.bytes} + ${bytes}`,
                                updatedAt: sql`now()`,
                            },
                        });
                }, 'record.usage');
            }

            if (record.grantId) {
                const grantId = record.grantId;
                const at = now().getTime();
                const last = lastUsedWrittenAt.get(grantId) ?? 0;
                if (at - last >= lastUsedIntervalMs) {
                    if (lastUsedWrittenAt.size > 10_000) lastUsedWrittenAt.clear();
                    lastUsedWrittenAt.set(grantId, at);
                    background(async () => {
                        await db.update(mcpGrants).set({ lastUsedAt: sql`now()` as unknown as Date }).where(eq(mcpGrants.grantId, grantId));
                    }, 'record.lastUsed');
                }
            }
        },
    };

    return {
        usage,
        gate,
        async flush() {
            while (pending.size > 0) await Promise.allSettled([...pending]);
        },
    };
}

// --- Kill switches -------------------------------------------------------------

/** Reads the switch hash. ioredis and ioredis-mock both satisfy it. */
export interface SwitchesRedis {
    hgetall(key: string): Promise<Record<string, string>>;
}

export const MCP_SWITCHES_KEY = 'mcp:switches';

export interface KillSwitchOptions {
    /** `MCP_ENABLED`: the master switch, from the environment. */
    enabled: boolean;
    /** `MCP_DISABLED_TOOLS`, from the environment. */
    disabledTools?: readonly string[];
    /**
     * Switches that take effect without a deploy, in the Redis hash
     * `mcp:switches`: field `all`, `tool:<name>`, `team:<id>` or
     * `grant:<id>` set to "off" turns that off.
     */
    redis?: SwitchesRedis | null;
    cacheMs?: number;
    now?: () => number;
    onError?: (error: Error) => void;
}

export interface KillSwitches {
    /** Throws `disabled` when the server, the tool, the team or the connection is switched off. */
    check(tool: string, ctx: Pick<McpContext, 'teamId' | 'grantId'>): Promise<void>;
}

export function createKillSwitches(options: KillSwitchOptions): KillSwitches {
    const disabledTools = new Set(options.disabledTools ?? []);
    const cacheMs = options.cacheMs ?? 5_000;
    const now = options.now ?? Date.now;
    let cached: { at: number; fields: Record<string, string> } | null = null;

    async function fields(): Promise<Record<string, string>> {
        if (!options.redis) return {};
        if (cached && now() - cached.at < cacheMs) return cached.fields;
        try {
            const value = await options.redis.hgetall(MCP_SWITCHES_KEY);
            cached = { at: now(), fields: value ?? {} };
        } catch (error) {
            // Keep the last known switches; with none, run on the environment alone.
            options.onError?.(error instanceof Error ? error : new Error(String(error)));
            cached = { at: now(), fields: cached?.fields ?? {} };
        }
        return cached.fields;
    }

    const off = (value: string | undefined) => value !== undefined && ['off', '0', 'false', 'disabled'].includes(value.toLowerCase());

    return {
        async check(tool, ctx) {
            if (!options.enabled) {
                throw new McpToolError('disabled', 'The Rejourney MCP server is switched off for now. Try again later.');
            }
            if (disabledTools.has(tool)) {
                throw new McpToolError('disabled', `The ${tool} tool is switched off for now. The other tools still work.`);
            }
            const live = await fields();
            if (off(live.all)) throw new McpToolError('disabled', 'The Rejourney MCP server is switched off for now. Try again later.');
            if (off(live[`tool:${tool}`])) throw new McpToolError('disabled', `The ${tool} tool is switched off for now. The other tools still work.`);
            if (off(live[`team:${ctx.teamId}`]) || off(live[`grant:${ctx.grantId}`])) throw new McpToolError('disabled');
        },
    };
}
