import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({ config: {
    SHOW_ISSUE_DETECTION_UI: true,
    ISSUE_DETECTION_API_URL: 'https://issues.example.test',
    ISSUE_DETECTION_SERVICE_SECRET: 'unit-test-secret',
} }));
vi.mock('../middleware/index.js', () => ({ ApiError: {
    notFound: (message: string) => new Error(message),
    forbidden: (message: string) => new Error(message),
    serviceUnavailable: (message: string) => new Error(message),
    gatewayTimeout: (message: string) => new Error(message),
} }));
// Route the client's node:timers import through the globals so fake timers apply.
vi.mock('node:timers', () => ({
    setTimeout: (...args: Parameters<typeof globalThis.setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof globalThis.clearTimeout>) => globalThis.clearTimeout(...args),
}));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/internalServiceAuth.js', () => ({ signInternalServiceRequest: () => ({}) }));
vi.mock('../services/projectAccess.js', () => ({ userCanAccessProject: vi.fn() }));
const { redisStore } = vi.hoisted(() => ({ redisStore: new Map<string, string>() }));
vi.mock('../db/redis.js', () => ({ getRedis: () => ({
    get: async (key: string) => redisStore.get(key) ?? null,
    set: async (key: string, value: string) => { redisStore.set(key, value); return 'OK'; },
    incr: async (key: string) => { const next = Number(redisStore.get(key) ?? 0) + 1; redisStore.set(key, String(next)); return next; },
}) }));

import { callIssueDetection, requireProjectAccess } from '../services/issueDetectionClient.js';
import { FRESH_MS, STALE_WAIT_MS } from '../services/issueStaleCache.js';
import { userCanAccessProject } from '../services/projectAccess.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('issue proxy reads', () => {
    it('coalesces list requests and invalidates them after a status mutation', async () => {
        let version = 0;
        const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ version: ++version })));
        vi.stubGlobal('fetch', fetch);
        const list = { pathWithQuery: '/v1/projects/cache-test/leaks' };
        const [a, b] = await Promise.all([callIssueDetection(list), callIssueDetection(list)]);
        expect(a).toEqual(b);
        expect(fetch).toHaveBeenCalledTimes(1);
        await callIssueDetection({ method: 'PATCH', pathWithQuery: '/v1/leaks/cache-test', body: { status: 'resolved' } });
        await callIssueDetection(list);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });

    it('keeps raw context streams and GitHub state uncached', async () => {
        const fetch = vi.fn(async () => new Response('{}'));
        vi.stubGlobal('fetch', fetch);
        for (let i = 0; i < 2; i++) {
            await callIssueDetection({ pathWithQuery: '/v1/leaks/stream-test/context/raw.md', raw: true });
            await callIssueDetection({ pathWithQuery: '/v1/projects/link-test/github-link' });
        }
        expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('rechecks project permission for every user even when reads are cached', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
        vi.mocked(userCanAccessProject).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        await requireProjectAccess('allowed', 'permission-test');
        await callIssueDetection({ pathWithQuery: '/v1/projects/permission-test/leaks' });
        await expect(requireProjectAccess('denied', 'permission-test')).rejects.toThrow('Access denied');
        expect(userCanAccessProject).toHaveBeenLastCalledWith('denied', 'permission-test');
    });

    it('retries a read once when the upstream stalls, then reports a timeout', async () => {
        vi.useFakeTimers();
        try {
            const stalled = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }));
            vi.stubGlobal('fetch', stalled);
            const read = callIssueDetection({ pathWithQuery: '/v1/projects/stall-test/leaks?view=inbox' });
            const outcome = expect(read).rejects.toThrow('Issue detection timed out');
            await vi.advanceTimersByTimeAsync(40_000);
            await outcome;
            expect(stalled).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns the second attempt when the first read fails transiently', async () => {
        const fetch = vi.fn()
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ leaks: [] })));
        vi.stubGlobal('fetch', fetch);
        await expect(callIssueDetection({ pathWithQuery: '/v1/projects/flaky-test/leaks' })).resolves.toEqual({ leaks: [] });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry writes', async () => {
        const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
        vi.stubGlobal('fetch', fetch);
        await expect(callIssueDetection({ method: 'PATCH', pathWithQuery: '/v1/leaks/write-test', body: { status: 'resolved' } }))
            .rejects.toThrow('Issue detection service unavailable');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('serves the last good inbox at once when the upstream is slow, and refreshes it behind', async () => {
        const list = { pathWithQuery: '/v1/projects/stale-test/leaks?view=inbox' };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 1 }))));
        await expect(callIssueDetection(list)).resolves.toEqual({ version: 1 });

        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        vi.setSystemTime(Date.now() + FRESH_MS + 11_000);
        let release!: () => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
            release = () => resolve(new Response(JSON.stringify({ version: 2 })));
        })));
        const slow = callIssueDetection(list);
        await vi.advanceTimersByTimeAsync(STALE_WAIT_MS);
        await expect(slow).resolves.toEqual({ version: 1, stale: true });

        release();
        await vi.advanceTimersByTimeAsync(0);
        await expect(callIssueDetection(list)).resolves.toEqual({ version: 2 });
    });

    it('still serves a copy from days ago while the upstream wakes up', async () => {
        const list = { pathWithQuery: '/v1/projects/long-gap/leaks?view=inbox' };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 1 }))));
        await callIssueDetection(list);

        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        vi.setSystemTime(Date.now() + 3 * 24 * 60 * 60 * 1000);
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
        const waking = callIssueDetection(list);
        await vi.advanceTimersByTimeAsync(STALE_WAIT_MS);
        await expect(waking).resolves.toEqual({ version: 1, stale: true });
    });

    it('serves the last good detail when the upstream fails', async () => {
        const detail = { pathWithQuery: '/v1/leaks/stale-detail?view=stored' };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'stale-detail' }))));
        await callIssueDetection(detail);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + FRESH_MS + 11_000);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
        await expect(callIssueDetection(detail)).resolves.toEqual({ id: 'stale-detail', stale: true });
    });
});
