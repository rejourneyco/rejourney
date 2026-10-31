/**
 * Lets a dashboard refresh skip a response cache without letting refreshes hammer
 * the database. The dashboard marks requests it sends right after the refresh
 * button or a browser reload with `X-Dashboard-Refresh: 1`; such a request
 * recomputes at most once per key per REFRESH_MIN_INTERVAL_SECONDS, however many
 * viewers refresh, and is otherwise served the cached response.
 */

import type { Request } from 'express';
import { getRedis } from '../db/redis.js';

export const DASHBOARD_REFRESH_HEADER = 'x-dashboard-refresh';
export const REFRESH_MIN_INTERVAL_SECONDS = 30;

export function isDashboardRefresh(req: Pick<Request, 'get'>): boolean {
    return req.get(DASHBOARD_REFRESH_HEADER) === '1';
}

/**
 * Cached response for `cacheKey`, or null when the caller should recompute: on a
 * miss, or on a refresh that won this key's recompute slot.
 */
export async function readRefreshableCache(req: Pick<Request, 'get'>, cacheKey: string): Promise<string | null> {
    const redis = getRedis();
    if (isDashboardRefresh(req)) {
        const won = await redis
            .set(`refresh-slot:${cacheKey}`, '1', 'EX', REFRESH_MIN_INTERVAL_SECONDS, 'NX')
            .catch(() => null);
        if (won) return null;
    }
    return redis.get(cacheKey);
}
