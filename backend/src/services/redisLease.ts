import { randomUUID } from 'crypto';

type RedisLeaseClient = {
    eval: (...args: any[]) => Promise<any>;
    set: (...args: any[]) => Promise<any>;
};

export type RedisLease = {
    key: string;
    token: string;
    ttlMs: number;
    /**
     * Local time immediately before Redis was asked to acquire the lease.
     * Starting the safety deadline before the network round trip is
     * deliberately conservative: it can stop work slightly early, but never
     * lets a delayed response extend ownership beyond Redis' actual TTL.
     */
    confirmedAtMs: number;
};

export type RedisLeaseRenewal = {
    signal: AbortSignal;
    stop: () => void;
};

const RELEASE_LEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
`;

const RENEW_LEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

export async function acquireRedisLease(
    client: RedisLeaseClient,
    key: string,
    ttlMs: number,
    token: string = randomUUID(),
): Promise<RedisLease | null> {
    const confirmedAtMs = Date.now();
    const result = await client.set(key, token, 'PX', ttlMs, 'NX');
    if (result !== 'OK') return null;
    return { key, token, ttlMs, confirmedAtMs };
}

export async function renewRedisLease(
    client: RedisLeaseClient,
    lease: RedisLease,
): Promise<boolean> {
    const result = await client.eval(
        RENEW_LEASE_SCRIPT,
        1,
        lease.key,
        lease.token,
        String(lease.ttlMs),
    );
    return Number(result) === 1;
}

export async function releaseRedisLease(
    client: RedisLeaseClient,
    lease: RedisLease,
): Promise<boolean> {
    const result = await client.eval(
        RELEASE_LEASE_SCRIPT,
        1,
        lease.key,
        lease.token,
    );
    return Number(result) === 1;
}

export function startRedisLeaseRenewal(
    client: RedisLeaseClient,
    lease: RedisLease,
    options: {
        intervalMs?: number;
        onError?: (error: unknown) => void;
        onLeaseLost?: () => void;
    } = {},
): RedisLeaseRenewal {
    const intervalMs = options.intervalMs ?? Math.max(1_000, Math.floor(lease.ttlMs / 3));
    const abortController = new AbortController();
    let renewalInFlight = false;
    let stopped = false;
    let renewalTimer: ReturnType<typeof setInterval> | null = null;
    let ownershipExpiryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = (): void => {
        if (renewalTimer) {
            clearInterval(renewalTimer);
            renewalTimer = null;
        }
        if (ownershipExpiryTimer) {
            clearTimeout(ownershipExpiryTimer);
            ownershipExpiryTimer = null;
        }
    };

    const stop = (): void => {
        if (stopped) return;
        stopped = true;
        clearTimers();
    };

    const markLeaseLost = (): void => {
        if (stopped) return;
        stopped = true;
        clearTimers();
        abortController.abort();
        options.onLeaseLost?.();
    };

    const scheduleOwnershipExpiry = (confirmedAtMs: number): void => {
        if (stopped) return;
        if (ownershipExpiryTimer) clearTimeout(ownershipExpiryTimer);
        const remainingMs = Math.max(0, confirmedAtMs + lease.ttlMs - Date.now());
        if (remainingMs === 0) {
            markLeaseLost();
            return;
        }
        ownershipExpiryTimer = setTimeout(markLeaseLost, remainingMs);
        (ownershipExpiryTimer as unknown as { unref?: () => void }).unref?.();
    };

    // A renewal transport failure is indeterminate: retry while the last
    // confirmed TTL is still valid, but fail closed at that deadline. This
    // watchdog also covers an EVAL call that never settles during a partition.
    scheduleOwnershipExpiry(lease.confirmedAtMs);

    if (!stopped) {
        renewalTimer = setInterval(() => {
            if (stopped || renewalInFlight) return;
            renewalInFlight = true;
            const renewalStartedAtMs = Date.now();
            void renewRedisLease(client, lease)
                .then((renewed) => {
                    if (stopped) return;
                    if (!renewed) {
                        markLeaseLost();
                        return;
                    }

                    // The Redis PEXPIRE cannot have happened before this request
                    // started, so this is a conservative lower bound on the new
                    // ownership deadline. Ignore a response that arrived after even
                    // that lower bound had expired.
                    if (Date.now() >= renewalStartedAtMs + lease.ttlMs) {
                        markLeaseLost();
                        return;
                    }
                    scheduleOwnershipExpiry(renewalStartedAtMs);
                })
                .catch((error) => {
                    if (!stopped) options.onError?.(error);
                })
                .finally(() => {
                    renewalInFlight = false;
                });
        }, intervalMs);
        (renewalTimer as unknown as { unref?: () => void }).unref?.();
    }

    return {
        signal: abortController.signal,
        stop,
    };
}
