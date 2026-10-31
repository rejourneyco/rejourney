/**
 * Redis cache for dashboard session lookups (see sessionAuth).
 *
 * Every code path that deletes a user session evicts its entry right away;
 * entries also expire within an hour so a missed eviction cannot outlive it.
 */

import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';

/** Upper bound on how long a cached session lookup is trusted. */
export const SESSION_AUTH_CACHE_MAX_TTL_SECONDS = 60 * 60;

export function sessionAuthCacheKey(token: string): string {
    return `session:${token}`;
}

export function sessionAuthCacheTtlSeconds(expiresAt: Date, nowMs: number = Date.now()): number {
    const remaining = Math.floor((expiresAt.getTime() - nowMs) / 1000);
    return Math.min(remaining, SESSION_AUTH_CACHE_MAX_TTL_SECONDS);
}

/** Drop cached session lookups so deleted sessions stop authenticating immediately. */
export async function evictSessionAuthCache(tokens: string | readonly string[]): Promise<void> {
    const list = (typeof tokens === 'string' ? [tokens] : [...tokens]).filter((token) => token.length > 0);
    if (list.length === 0) return;
    try {
        await getRedis().del(...list.map(sessionAuthCacheKey));
    } catch (err) {
        logger.warn({ err, count: list.length }, 'Failed to evict session auth cache');
    }
}
