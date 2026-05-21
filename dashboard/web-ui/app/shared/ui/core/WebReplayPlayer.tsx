import React, { useEffect, useMemo, useRef, useState } from 'react';
import '@rrweb/replay/dist/style.css';
import { formatBackgroundGapDuration } from '~/shared/lib/replayTimeCompression';
import type { CompressedBackgroundGap } from '~/shared/lib/replayTimeCompression';

type WebReplayPlayerProps = {
    events: any[];
    currentTime: number;
    isPlaying: boolean;
    playbackRate: number;
    durationSeconds: number;
    backgroundGaps?: CompressedBackgroundGap[];
};

function applyScale(root: HTMLElement): boolean {
    const wrapper = root.querySelector<HTMLElement>('.replayer-wrapper');
    const iframe = root.querySelector<HTMLIFrameElement>('iframe');
    if (!wrapper || !iframe) return false;
    const iframeW = Number(iframe.getAttribute('width')) || iframe.offsetWidth;
    if (!iframeW) return false;
    const containerW = root.clientWidth;
    const containerH = root.clientHeight;
    if (containerW <= 0 || containerH <= 0) return false;
    const iframeH = Number(iframe.getAttribute('height')) || iframe.offsetHeight;
    if (iframeH <= 0) return false;
    // contain: scale so neither dimension overflows
    const scale = Math.min(containerW / iframeW, containerH / iframeH);
    if (!Number.isFinite(scale) || scale <= 0) return false;
    const scaledW = iframeW * scale;
    const scaledH = iframeH * scale;
    wrapper.style.transformOrigin = 'top left';
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.position = 'absolute';
    wrapper.style.left = `${(containerW - scaledW) / 2}px`;
    wrapper.style.top = `${(containerH - scaledH) / 2}px`;
    return true;
}

export default function WebReplayPlayer({
    events,
    currentTime,
    isPlaying,
    playbackRate,
    durationSeconds,
    backgroundGaps = [],
}: WebReplayPlayerProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const replayerRef = useRef<any>(null);
    const playerIsPlayingRef = useRef(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const replayEvents = useMemo(
        () => events.filter((event) => event && typeof event === 'object' && typeof event.timestamp === 'number'),
        [events],
    );
    const activeBackgroundGap = useMemo(() => {
        const firstTimestamp = replayEvents[0]?.timestamp;
        if (typeof firstTimestamp !== 'number') return null;
        const currentTimestamp = firstTimestamp + currentTime * 1000;
        if (!Number.isFinite(currentTimestamp)) return null;
        return backgroundGaps.find((gap) => currentTimestamp >= gap.compressedStartAt && currentTimestamp <= gap.compressedEndAt) ?? null;
    }, [backgroundGaps, currentTime, replayEvents]);
    const displayedBackgroundGap = activeBackgroundGap;
    const backgroundFreezeOffsetMs = useMemo(() => {
        const firstTimestamp = replayEvents[0]?.timestamp;
        if (!displayedBackgroundGap || typeof firstTimestamp !== 'number') return null;
        return Math.max(0, displayedBackgroundGap.compressedStartAt - firstTimestamp);
    }, [displayedBackgroundGap, replayEvents]);

    useEffect(() => {
        let cancelled = false;

        async function mountReplayer() {
            if (!rootRef.current || replayEvents.length === 0) return;

            setLoadError(null);
            rootRef.current.innerHTML = '';

            try {
                const { Replayer } = await import('@rrweb/replay');
                if (cancelled || !rootRef.current) return;

                const replayer = new Replayer(replayEvents, {
                    root: rootRef.current,
                    speed: playbackRate,
                    showWarning: false,
                    showDebug: false,
                    mouseTail: {
                        duration: 900,
                        lineCap: 'round',
                        lineWidth: 4,
                        strokeStyle: 'rgba(244, 63, 94, 0.82)',
                    },
                    UNSAFE_replayCanvas: true,
                    triggerFocus: false,
                });
                const initialOffsetMs = Math.max(0, Math.min(currentTime, durationSeconds || currentTime) * 1000);
                replayerRef.current = replayer;
                playerIsPlayingRef.current = false;
                replayer.pause(initialOffsetMs);
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to initialize rrweb replay:', error);
                    setLoadError('Unable to load browser replay.');
                }
            }
        }

        void mountReplayer();

        return () => {
            cancelled = true;
            playerIsPlayingRef.current = false;
            if (replayerRef.current) {
                try {
                    replayerRef.current.destroy();
                } catch {
                    // rrweb can throw when tearing down partially mounted iframes.
                }
                replayerRef.current = null;
            }
            if (rootRef.current) {
                rootRef.current.innerHTML = '';
            }
        };
    }, [replayEvents]);

    // Scale the rrweb iframe to fill the container (rrweb alpha doesn't scale itself).
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        let raf = 0;
        let retryTimer = 0;
        const rescale = () => {
            if (raf) cancelAnimationFrame(raf);
            if (retryTimer) window.clearTimeout(retryTimer);
            raf = requestAnimationFrame(() => {
                raf = 0;
                if (!applyScale(root) && root.isConnected) {
                    retryTimer = window.setTimeout(rescale, 50);
                }
            });
        };

        const resizeObserver = new ResizeObserver(rescale);
        resizeObserver.observe(root);

        // Re-scale when rrweb adds/mutates the iframe (e.g. on viewport resize events).
        const mutationObserver = new MutationObserver(rescale);
        mutationObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] });
        window.addEventListener('resize', rescale);
        window.addEventListener('orientationchange', rescale);
        rescale();

        return () => {
            if (raf) cancelAnimationFrame(raf);
            if (retryTimer) window.clearTimeout(retryTimer);
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            window.removeEventListener('resize', rescale);
            window.removeEventListener('orientationchange', rescale);
        };
    }, []);

    useEffect(() => {
        const replayer = replayerRef.current;
        if (!replayer) return;
        replayer.setConfig({ speed: playbackRate });
    }, [playbackRate]);

    useEffect(() => {
        const replayer = replayerRef.current;
        if (!replayer) return;

        const offsetMs = Math.max(0, Math.min(currentTime, durationSeconds || currentTime) * 1000);
        if (backgroundFreezeOffsetMs !== null) {
            replayer.pause(backgroundFreezeOffsetMs);
            playerIsPlayingRef.current = false;
            return;
        }

        if (isPlaying) {
            const actualOffset = typeof replayer.getTimeOffset === 'function' ? replayer.getTimeOffset() : offsetMs;
            if (!playerIsPlayingRef.current || Math.abs(actualOffset - offsetMs) > 1000) {
                replayer.play(offsetMs);
            }
            playerIsPlayingRef.current = true;
            return;
        }

        replayer.pause(offsetMs);
        playerIsPlayingRef.current = false;
    }, [backgroundFreezeOffsetMs, currentTime, durationSeconds, isPlaying]);

    if (replayEvents.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-white p-6 text-center text-sm font-bold text-slate-500">
                Browser replay events are not available for this session.
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-white p-6 text-center text-sm font-bold text-red-600">
                {loadError}
            </div>
        );
    }

    return (
        <div className={`web-rrweb-player relative h-full w-full overflow-hidden bg-white ${displayedBackgroundGap ? 'grayscale' : ''}`}>
            <div ref={rootRef} className="h-full min-h-[320px] w-full" />
            {displayedBackgroundGap ? (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70 px-6 text-center text-white">
                    <div className="border border-white/20 bg-slate-950 px-5 py-4 shadow-2xl">
                        <div className="text-xs font-black uppercase tracking-wide text-slate-300">User left the page</div>
                        <div className="mt-2 text-lg font-black">Away for {formatBackgroundGapDuration(displayedBackgroundGap.durationMs)}</div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
