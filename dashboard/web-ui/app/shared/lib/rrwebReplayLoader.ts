/**
 * Client-side rrweb segment loader.
 *
 * When the backend returns `rrwebReplay.loadMode === 'segments'`
 * (because the total payload exceeded RJ_REPLAY_CORE_INLINE_LIMIT_BYTES), the
 * `events` array is empty and the browser downloads each segment directly
 * from object storage/CDN, then concatenates the events.
 *
 * For small sessions (loadMode === 'inline' or unset), `events` is already
 * populated server-side and this hook is a no-op pass-through.
 *
 * Large sessions are loaded progressively: the first segment is published as
 * soon as it arrives, then the rest are prefetched with adaptive concurrency.
 * This lets the rrweb player become usable without forcing every viewer to
 * download every segment before first paint.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '~/shared/config/appConfig';
import {
    buildProxyCssFetcher,
    collectExternalStylesheetLinks,
    inlineExternalReplayStylesheets,
    type FetchCssText,
} from '~/shared/lib/replayCssInline';

export type RrwebReplaySegment = {
    artifactId?: string;
    index: number;
    startTime: number | null;
    endTime: number | null;
    eventCount: number;
    sizeBytes: number | null;
    url: string | null;
    proxyUrl?: string | null;
};

export type RrwebReplayPayload = {
    events: any[];
    eventCount: number;
    segments: RrwebReplaySegment[];
    page?: Record<string, unknown> | null;
    viewport?: Record<string, unknown> | null;
    loadMode?: 'inline' | 'segments';
    /** Backend proxy path for inlining external stylesheet links client-side. */
    cssProxyPath?: string;
};

export type RrwebReplayLoaderState = {
    /** Merged + chronologically sorted events array (empty until loaded). */
    events: any[];
    /** True while client-side segment fetches are in flight. */
    isLoading: boolean;
    /** Number of segments fetched so far / total. Used for progress display. */
    progress: { loaded: number; total: number };
    /** Set if any segment failed to fetch (still returns events from successful segments). */
    error: string | null;
    /**
     * Jump the fetch queue to the segment covering this 0..1 timeline fraction.
     * No-op for inline payloads or once everything is loaded.
     */
    prioritizeSeek: (fraction: number) => void;
    /** Loaded timeline coverage as 0..1 fractions, for a buffered-ranges indicator. */
    loadedRanges: Array<{ start: number; end: number }>;
};

export type SegmentTimeBounds = { min: number; max: number };

/**
 * Overall time bounds across every segment that carries start/end metadata.
 * Null when metadata is too sparse to reason about time at all.
 */
export function computeSegmentTimeBounds(segments: RrwebReplaySegment[]): SegmentTimeBounds | null {
    let min = Infinity;
    let max = -Infinity;
    for (const segment of segments) {
        if (typeof segment.startTime === 'number') min = Math.min(min, segment.startTime);
        if (typeof segment.endTime === 'number') max = Math.max(max, segment.endTime);
        else if (typeof segment.startTime === 'number') max = Math.max(max, segment.startTime);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    return { min, max };
}

/**
 * Pick which pending segment to fetch next.
 *
 * Without a seek target this is plain in-order loading. With one (a 0..1 fraction
 * of the timeline, set when the user scrubs), the segment covering that time jumps
 * the queue so a deep seek does not wait for everything before it. Falls back to a
 * proportional index guess when segments carry no time metadata.
 */
export function pickNextPendingSegment(
    pending: RrwebReplaySegment[],
    totalSegments: number,
    seekFraction: number | null,
    bounds: SegmentTimeBounds | null,
): number {
    if (pending.length === 0) return -1;
    if (seekFraction === null || pending.length === 1) return 0;

    if (bounds) {
        const targetTime = bounds.min + seekFraction * (bounds.max - bounds.min);
        let bestIdx = 0;
        let bestDistance = Infinity;
        for (let i = 0; i < pending.length; i += 1) {
            const { startTime, endTime } = pending[i];
            if (typeof startTime !== 'number') continue;
            const end = typeof endTime === 'number' ? endTime : startTime;
            const distance = targetTime < startTime
                ? startTime - targetTime
                : (targetTime > end ? targetTime - end : 0);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIdx = i;
            }
            if (distance === 0) break;
        }
        return bestIdx;
    }

    const targetIndex = Math.round(seekFraction * Math.max(0, totalSegments - 1));
    let bestIdx = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < pending.length; i += 1) {
        const distance = Math.abs((pending[i].index ?? 0) - targetIndex);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/**
 * Loaded timeline coverage as 0..1 fractions, for a buffered-ranges indicator.
 * Adjacent/overlapping ranges are merged so the UI draws a few bars, not dozens.
 */
export function computeLoadedRanges(
    segments: RrwebReplaySegment[],
    loadedIndexes: ReadonlySet<number>,
    bounds: SegmentTimeBounds | null,
): Array<{ start: number; end: number }> {
    if (segments.length === 0 || loadedIndexes.size === 0) return [];
    const span = bounds ? bounds.max - bounds.min : 0;
    const raw: Array<{ start: number; end: number }> = [];
    for (const segment of segments) {
        if (!loadedIndexes.has(segment.index)) continue;
        if (bounds && typeof segment.startTime === 'number' && span > 0) {
            const end = typeof segment.endTime === 'number' ? segment.endTime : segment.startTime;
            raw.push({
                start: Math.max(0, (segment.startTime - bounds.min) / span),
                end: Math.min(1, (end - bounds.min) / span),
            });
        } else {
            raw.push({
                start: segment.index / segments.length,
                end: (segment.index + 1) / segments.length,
            });
        }
    }
    raw.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of raw) {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end + 0.005) {
            last.end = Math.max(last.end, range.end);
        } else {
            merged.push({ ...range });
        }
    }
    return merged;
}

const DESKTOP_SEGMENT_FETCH_CONCURRENCY = 6;
const MOBILE_SEGMENT_FETCH_CONCURRENCY = 4;
const SLOW_SEGMENT_FETCH_CONCURRENCY = 3;
const BACKGROUND_PREFETCH_START_DELAY_MS = 120;

function getAdaptiveSegmentFetchConcurrency(): number {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return DESKTOP_SEGMENT_FETCH_CONCURRENCY;
    }

    const nav = navigator as Navigator & {
        connection?: { effectiveType?: string; saveData?: boolean };
        deviceMemory?: number;
    };
    const effectiveType = nav.connection?.effectiveType?.toLowerCase();
    const saveData = Boolean(nav.connection?.saveData);
    const coarsePointer = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
    const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
    const slowNetwork = saveData || effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g';

    if (slowNetwork) return SLOW_SEGMENT_FETCH_CONCURRENCY;
    if (coarsePointer || lowMemory) return MOBILE_SEGMENT_FETCH_CONCURRENCY;
    return DESKTOP_SEGMENT_FETCH_CONCURRENCY;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSegmentUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

async function fetchSegmentUrl(
    url: string,
    signal: AbortSignal,
    credentials: RequestCredentials,
): Promise<any[]> {
    const response = await fetch(resolveSegmentUrl(url), { signal, credentials });
    if (!response.ok) {
        throw new Error(`segment fetch ${response.status}`);
    }

    // Most rrweb segments are gzipped on R2; the browser transparently
    // decompresses based on Content-Encoding. If the artifact was stored as
    // raw .json.gz without that header, response.arrayBuffer() will give us
    // the gzipped bytes — try DecompressionStream as a fallback.
    const contentEncoding = response.headers.get('content-encoding');
    if (contentEncoding === 'gzip' || contentEncoding === 'br') {
        const parsed = await response.json();
        return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.events) ? parsed.events : []);
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isGzipMagic = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

    if (isGzipMagic) {
        const text = await gunzipSegmentText(buffer, bytes);
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.events) ? parsed.events : []);
    }

    const text = new TextDecoder().decode(buffer);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.events) ? parsed.events : []);
}

async function fetchOneSegment(segment: RrwebReplaySegment, signal: AbortSignal): Promise<any[]> {
    const attempts = [
        segment.url ? { url: segment.url, credentials: 'omit' as RequestCredentials } : null,
        segment.proxyUrl ? { url: segment.proxyUrl, credentials: 'include' as RequestCredentials } : null,
    ].filter((attempt): attempt is { url: string; credentials: RequestCredentials } => Boolean(attempt));

    let lastError: unknown = null;
    for (const attempt of attempts) {
        try {
            return await fetchSegmentUrl(attempt.url, signal, attempt.credentials);
        } catch (err) {
            if ((err as { name?: string } | null)?.name === 'AbortError') throw err;
            lastError = err;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('segment fetch failed');
}

async function gunzipSegmentText(buffer: ArrayBuffer, bytes: Uint8Array): Promise<string> {
    if (typeof DecompressionStream !== 'undefined') {
        try {
            const stream = new Response(buffer).body!.pipeThrough(new DecompressionStream('gzip'));
            return await new Response(stream).text();
        } catch {
            // Fall through to the JS inflater. Some mobile Safari builds expose
            // DecompressionStream but fail for raw .json.gz object responses.
        }
    }

    const { gunzipSync, strFromU8 } = await import('fflate');
    return strFromU8(gunzipSync(bytes));
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) return [];
    const output: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Math.max(1, Math.min(concurrency, items.length));

    async function worker(): Promise<void> {
        while (cursor < items.length) {
            const index = cursor++;
            output[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return output;
}

/**
 * Returns a unified events array regardless of whether the payload came
 * inline from /core or has to be assembled from R2 segments client-side.
 *
 * Designed to be a drop-in for `rrwebReplay?.events || []` consumers:
 * existing components just see the events array, with the loading state
 * exposed separately for an optional spinner / progress bar.
 */
export function useRrwebReplayEvents(rrwebReplay: RrwebReplayPayload | undefined | null): RrwebReplayLoaderState {
    const inlineEvents = useMemo(() => {
        return Array.isArray(rrwebReplay?.events) ? rrwebReplay!.events : [];
    }, [rrwebReplay]);

    const segments = useMemo(() => {
        return Array.isArray(rrwebReplay?.segments) ? rrwebReplay!.segments : [];
    }, [rrwebReplay]);

    const loadMode = rrwebReplay?.loadMode ?? 'inline';

    // Stylesheet links rrweb could not inline at record time are fetched through the
    // backend proxy and inlined into the events BEFORE the player mounts them; the
    // replay iframe then needs no style origins beyond the CSP's 'unsafe-inline'.
    const cssProxyPath = rrwebReplay?.cssProxyPath;
    const cssFetcher = useMemo<FetchCssText | null>(
        () => (cssProxyPath ? buildProxyCssFetcher(cssProxyPath, API_BASE_URL, 'include') : null),
        [cssProxyPath],
    );
    const cssFetcherRef = useRef<FetchCssText | null>(null);
    cssFetcherRef.current = cssFetcher;

    // null = inlining still in flight for inline-mode payloads.
    const [inlineReadyEvents, setInlineReadyEvents] = useState<any[] | null>(null);
    useEffect(() => {
        if (inlineEvents.length === 0) {
            setInlineReadyEvents(inlineEvents);
            return;
        }
        if (!cssFetcher || collectExternalStylesheetLinks(inlineEvents).length === 0) {
            setInlineReadyEvents(inlineEvents);
            return;
        }
        let cancelled = false;
        setInlineReadyEvents(null);
        inlineExternalReplayStylesheets(inlineEvents, cssFetcher)
            .catch(() => 0)
            .then(() => {
                if (!cancelled) setInlineReadyEvents(inlineEvents);
            });
        return () => {
            cancelled = true;
        };
    }, [inlineEvents, cssFetcher]);

    const [clientEvents, setClientEvents] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadedIndexes, setLoadedIndexes] = useState<ReadonlySet<number>>(new Set());
    const seekFractionRef = useRef<number | null>(null);
    const prioritizeSeek = useCallback((fraction: number) => {
        if (Number.isFinite(fraction)) {
            seekFractionRef.current = Math.max(0, Math.min(1, fraction));
        }
    }, []);
    const [progress, setProgress] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);

    // Stable key so we re-fetch when the actual segment set changes (different
    // session navigated to), not on every render.
    const segmentKey = useMemo(
        () => segments.map((s) => `${s.artifactId ?? ''}:${s.url ?? ''}:${s.proxyUrl ?? ''}`).join('|'),
        [segments],
    );
    const lastKeyRef = useRef<string>('');
    const loadedSegmentsRef = useRef<Map<number, any[]>>(new Map());

    useEffect(() => {
        if (loadMode !== 'segments') {
            // Inline mode — events are already in the payload, nothing to do.
            setClientEvents([]);
            setIsLoading(false);
            setProgress({ loaded: 0, total: 0 });
            setError(null);
            setLoadedIndexes(new Set());
            lastKeyRef.current = segmentKey;
            return;
        }

        if (lastKeyRef.current === segmentKey) return;
        lastKeyRef.current = segmentKey;

        const fetchable = segments
            .filter((s) => (
                (typeof s.url === 'string' && s.url.length > 0) ||
                (typeof s.proxyUrl === 'string' && s.proxyUrl.length > 0)
            ))
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (fetchable.length === 0) {
            setClientEvents([]);
            setIsLoading(false);
            setProgress({ loaded: 0, total: 0 });
            return;
        }

        const abort = new AbortController();
        let cancelled = false;
        let publishTimer: number | null = null;
        let loadedCount = 0;
        let failedCount = 0;
        const loadedIndexes = new Set<number>();
        const settledIndexes = new Set<number>();
        loadedSegmentsRef.current = new Map();
        setIsLoading(true);
        setError(null);
        setProgress({ loaded: 0, total: fetchable.length });

        const publishLoadedEvents = (immediate = false) => {
            if (cancelled) return;
            const run = () => {
                publishTimer = null;
                if (cancelled) return;
                const merged: any[] = [];
                for (const segment of fetchable) {
                    const hasEvents = loadedSegmentsRef.current.has(segment.index);
                    if (!hasEvents && !settledIndexes.has(segment.index)) break;
                    const events = loadedSegmentsRef.current.get(segment.index) ?? [];
                    if (events.length > 0) merged.push(...events);
                }
                merged.sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0));
                setClientEvents(merged);
            };

            if (immediate) {
                if (publishTimer) window.clearTimeout(publishTimer);
                run();
                return;
            }

            if (!publishTimer) {
                publishTimer = window.setTimeout(run, 100);
            }
        };

        const loadSegment = async (segment: RrwebReplaySegment, publishImmediately = false) => {
            if (loadedIndexes.has(segment.index)) return;
            loadedIndexes.add(segment.index);
            try {
                const events = await fetchOneSegment(segment, abort.signal);
                const fetchCss = cssFetcherRef.current;
                if (fetchCss && !cancelled) {
                    // Inline before publishing: the player will not re-render nodes
                    // that were already mounted from this segment.
                    await inlineExternalReplayStylesheets(events, fetchCss).catch(() => 0);
                }
                if (!cancelled) {
                    loadedSegmentsRef.current.set(segment.index, events);
                    publishLoadedEvents(publishImmediately);
                }
            } catch (err) {
                if ((err as any)?.name !== 'AbortError') {
                    failedCount += 1;
                }
            } finally {
                settledIndexes.add(segment.index);
                loadedCount += 1;
                if (!cancelled) {
                    setProgress({ loaded: loadedCount, total: fetchable.length });
                    setLoadedIndexes(new Set(loadedSegmentsRef.current.keys()));
                    publishLoadedEvents(false);
                }
            }
        };

        (async () => {
            await loadSegment(fetchable[0], true);
            if (cancelled) return;

            await sleep(BACKGROUND_PREFETCH_START_DELAY_MS);
            if (cancelled) return;

            // Seek-aware scheduler: workers pull from a shared queue, and when the
            // user scrubs, pickNextPendingSegment jumps the segment covering the
            // seek target to the front instead of finishing everything before it.
            const pending = fetchable.slice(1);
            const bounds = computeSegmentTimeBounds(fetchable);
            const worker = async () => {
                while (!cancelled && pending.length > 0) {
                    const pick = pickNextPendingSegment(
                        pending,
                        fetchable.length,
                        seekFractionRef.current,
                        bounds,
                    );
                    if (pick < 0) break;
                    const [segment] = pending.splice(pick, 1);
                    await loadSegment(segment, false);
                }
            };
            await Promise.all(
                Array.from(
                    { length: Math.max(1, Math.min(getAdaptiveSegmentFetchConcurrency(), pending.length || 1)) },
                    () => worker(),
                ),
            );
            setIsLoading(false);
            publishLoadedEvents(true);

            const hasAnyEvents = [...loadedSegmentsRef.current.values()].some((events) => events.length > 0);
            if (!hasAnyEvents && fetchable.length > 0) {
                setError('Failed to load any replay segments.');
            } else if (failedCount > 0) {
                setError('Some replay segments failed to load.');
            }
        })();

        return () => {
            cancelled = true;
            if (publishTimer) window.clearTimeout(publishTimer);
            abort.abort();
        };
    }, [loadMode, segmentKey, segments]);

    const loadedRanges = useMemo(
        () => (loadMode === 'segments'
            ? computeLoadedRanges(segments, loadedIndexes, computeSegmentTimeBounds(segments))
            : []),
        [loadMode, segments, loadedIndexes],
    );

    if (loadMode === 'segments') {
        return { events: clientEvents, isLoading, progress, error, prioritizeSeek, loadedRanges };
    }
    return {
        events: inlineReadyEvents ?? [],
        isLoading: inlineReadyEvents === null,
        progress: { loaded: 0, total: 0 },
        error: null,
        prioritizeSeek,
        loadedRanges,
    };
}
