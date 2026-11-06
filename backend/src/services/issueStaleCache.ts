/**
 * Shared last-good copies of issue-detection reads (leak inbox and leak details),
 * so the Leaks page opens instantly and survives a slow or cold upstream.
 *
 * A copy younger than FRESH_MS is served as is. An older copy is served, marked
 * `stale: true`, when the upstream has not answered within STALE_WAIT_MS (or fails),
 * while the upstream read carries on and refreshes the copy for the next load. The
 * upstream can scale to zero and take ~30s to wake, so copies outlive long gaps
 * between visits. Without a copy the caller waits for the upstream as before. Any
 * write through the proxy bumps a generation that retires every copy, so the
 * dashboard never shows its own edits stale. Authorization stays in the routes and
 * runs on every request.
 */

import { createHash } from 'node:crypto';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';

export const FRESH_MS = 30_000;
export const STALE_WAIT_MS = 1_500;
const STALE_TTL_SECONDS = 14 * 24 * 60 * 60;
const GENERATION_KEY = 'issue-detection:reads:gen';

type StoredRead = { storedAt: number; body: unknown };

async function copyKey(key: string): Promise<string | null> {
    try {
        const generation = (await getRedis().get(GENERATION_KEY)) ?? '0';
        return `issue-detection:reads:${generation}:${createHash('sha1').update(key).digest('hex')}`;
    } catch {
        return null;
    }
}

async function readCopy(redisKey: string): Promise<StoredRead | null> {
    try {
        const raw = await getRedis().get(redisKey);
        return raw ? JSON.parse(raw) as StoredRead : null;
    } catch {
        return null;
    }
}

export async function readWithStaleCopy<T>(key: string, load: () => Promise<T>): Promise<T> {
    const redisKey = await copyKey(key);
    const copy = redisKey ? await readCopy(redisKey) : null;
    if (copy && Date.now() - copy.storedAt < FRESH_MS) return copy.body as T;

    const upstream = load().then(async (body) => {
        if (redisKey) {
            await getRedis()
                .set(redisKey, JSON.stringify({ storedAt: Date.now(), body }), 'EX', STALE_TTL_SECONDS)
                .catch((err: unknown) => logger.warn({ err }, 'Failed to store issue-detection read'));
        }
        return body;
    });
    if (!copy) return upstream;

    upstream.catch((err: unknown) => logger.warn({ err, key }, 'Issue-detection refresh failed; serving last good copy'));
    const staleCopy = { ...(copy.body as object), stale: true } as T;
    return Promise.race([
        upstream.catch(() => staleCopy),
        new Promise<T>((resolve) => setTimeout(() => resolve(staleCopy), STALE_WAIT_MS)),
    ]);
}

/** Retires every stored copy (after a write through the proxy). */
export async function retireStaleCopies(): Promise<void> {
    await getRedis().incr(GENERATION_KEY).catch((err: unknown) => logger.warn({ err }, 'Failed to retire issue-detection reads'));
}
