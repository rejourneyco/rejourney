/**
 * Distributed Lock
 *
 * Redis-backed single-flight lease that stops concurrent pods from repeating the
 * same expensive, deterministic build work.
 *
 * Every acquisition carries a random fencing token. Renewal, ownership checks and
 * release are all token-compared in Lua, so a lease that expires mid-build can
 * never be renewed, trusted, or released by its previous owner — the stale holder
 * finds out it lost the lease before it publishes anything.
 *
 * Redis being unreachable is reported as `unavailable` rather than throwing: the
 * caller keeps working unfenced (exactly as it behaved before locking existed)
 * instead of failing a build because coordination was impossible.
 */

import { randomUUID } from 'node:crypto';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';

/** Release the key only if we still own it. */
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
end
return 0
`;

/** Extend the lease only if we still own it. */
const RENEW_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

export interface HeldLock {
    /** True only while this holder's token is still the value in Redis. */
    isStillOwned(): Promise<boolean>;
    /** Stops renewal and releases the key if still owned. Never throws. */
    release(): Promise<void>;
}

export type LockAcquisition =
    /** We own the lease and must release it when done. */
    | { outcome: 'acquired'; lock: HeldLock }
    /** Another holder owns it; do not duplicate the work. */
    | { outcome: 'held_by_other' }
    /** Redis could not answer; proceed unfenced. */
    | { outcome: 'unavailable' };

export async function acquireLock(key: string, ttlMs: number): Promise<LockAcquisition> {
    const token = randomUUID();

    let redis: ReturnType<typeof getRedis>;
    try {
        redis = getRedis();
    } catch (err) {
        logger.warn({ event: 'lock.unavailable', err, key }, 'Lock client unavailable; proceeding unfenced');
        return { outcome: 'unavailable' };
    }

    try {
        const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
        if (result !== 'OK') {
            return { outcome: 'held_by_other' };
        }
    } catch (err) {
        logger.warn({ event: 'lock.acquire_failed', err, key }, 'Lock acquire failed; proceeding unfenced');
        return { outcome: 'unavailable' };
    }

    // Renew well inside the TTL so a slow build keeps its lease.
    const renewIntervalMs = Math.max(1_000, Math.floor(ttlMs / 3));
    let released = false;

    // Annotated because the callback clears the timer it is assigned to, and that
    // self-reference would otherwise defeat inference.
    const renewTimer: ReturnType<typeof setInterval> = setInterval(() => {
        void (async () => {
            if (released) return;
            try {
                const renewed = await redis.eval(RENEW_IF_OWNER_SCRIPT, 1, key, token, String(ttlMs));
                if (renewed !== 1) {
                    // Lease already lost; stop renewing and let isStillOwned() report it.
                    clearInterval(renewTimer);
                    logger.warn({ event: 'lock.renew_lost', key }, 'Lock lease lost before release');
                }
            } catch (err) {
                logger.warn({ event: 'lock.renew_failed', err, key }, 'Lock renewal failed');
            }
        })();
    }, renewIntervalMs);
    // Never hold the event loop open for a lease renewal. This project's ambient timer
    // types resolve to the DOM signature (number) even though Node returns a Timeout,
    // so feature-detect unref() instead of asserting a type the compiler disagrees with.
    (renewTimer as unknown as { unref?: () => void }).unref?.();

    const lock: HeldLock = {
        async isStillOwned() {
            if (released) return false;
            try {
                return (await redis.get(key)) === token;
            } catch (err) {
                // Unverifiable ownership must read as "not owned" so callers fail closed
                // and never publish a result the lease no longer covers.
                logger.warn({ event: 'lock.ownership_check_failed', err, key }, 'Lock ownership check failed');
                return false;
            }
        },
        async release() {
            if (released) return;
            released = true;
            clearInterval(renewTimer);
            try {
                await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, token);
            } catch (err) {
                // Worst case the lease simply expires on its own.
                logger.warn({ event: 'lock.release_failed', err, key }, 'Lock release failed');
            }
        },
    };

    return { outcome: 'acquired', lock };
}
