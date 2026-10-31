import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSessionsArchiveTotalCount, getSessionsPaginated } from './client';
afterEach(() => { vi.unstubAllGlobals(); });
const empty = () => new Response(JSON.stringify({ sessions: [], hasMore: false, nextCursor: null, totalCount: 0 }));
describe('archive request reliability', () => {
    it('does not share an aborted request with a replacement for the same search', async () => {
        const first = new AbortController();
        const second = new AbortController();
        const fetcher = vi.fn()
            .mockImplementationOnce((_url, options: RequestInit) => new Promise((_resolve, reject) => {
                options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            }))
            .mockResolvedValueOnce(empty());
        vi.stubGlobal('fetch', fetcher);
        const query = { projectId: 'cancellation-test', q: 'user_123', includeTotal: false };
        const cancelled = getSessionsPaginated(query, { signal: first.signal });
        const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        first.abort();
        const replacement = await getSessionsPaginated(query, { signal: second.signal });
        await rejected;
        expect(replacement.sessions).toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
    it('retries transient pagination failures without another user tap', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(empty());
        vi.stubGlobal('fetch', fetcher);
        expect((await getSessionsPaginated({ projectId: 'pagination-test', cursor: 'next' })).sessions).toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
    it('refreshes cached totals on an explicit search and propagates cancellation', async () => {
        const controller = new AbortController();
        const fetcher = vi.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce(new Response(JSON.stringify({ totalCount: 4 })));
        vi.stubGlobal('fetch', fetcher);
        const query = { projectId: 'count-test', q: 'user_456' };
        expect(await getSessionsArchiveTotalCount(query)).toBe(0);
        expect(await getSessionsArchiveTotalCount(query, { fresh: true, signal: controller.signal })).toBe(4);
        expect(fetcher).toHaveBeenCalledTimes(2);

        // Aborting the caller aborts the in-flight request it alone is waiting on.
        const pendingController = new AbortController();
        let pendingFetchSignal: AbortSignal | null | undefined;
        fetcher.mockImplementationOnce((_url, options: RequestInit) => new Promise((_resolve, reject) => {
            pendingFetchSignal = options.signal;
            options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        const pending = getSessionsArchiveTotalCount(query, { fresh: true, signal: pendingController.signal });
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
        pendingController.abort();
        await rejected;
        expect(pendingFetchSignal?.aborted).toBe(true);
    });
    it('shares one in-flight request between callers and keeps it alive for callers that did not abort', async () => {
        let resolveFetch: (response: Response) => void = () => undefined;
        let fetchSignal: AbortSignal | null | undefined;
        const fetcher = vi.fn().mockImplementationOnce((_url, options: RequestInit) => new Promise<Response>((resolve) => {
            fetchSignal = options.signal;
            resolveFetch = resolve;
        }));
        vi.stubGlobal('fetch', fetcher);
        const query = { projectId: 'shared-count-test', q: 'user_789' };
        const leaving = new AbortController();
        const staying = new AbortController();
        const abandoned = getSessionsArchiveTotalCount(query, { signal: leaving.signal });
        const kept = getSessionsArchiveTotalCount(query, { signal: staying.signal });
        const abandonedRejects = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        leaving.abort();
        await abandonedRejects;
        expect(fetchSignal?.aborted).toBe(false);
        resolveFetch(new Response(JSON.stringify({ totalCount: 7 })));
        expect(await kept).toBe(7);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});
