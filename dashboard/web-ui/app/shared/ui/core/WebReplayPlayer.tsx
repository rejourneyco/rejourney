import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@rrweb/replay/dist/style.css';
import { formatBackgroundGapDuration } from '~/shared/lib/replayTimeCompression';
import type { CompressedBackgroundGap } from '~/shared/lib/replayTimeCompression';
import type { Replayer as RrwebReplayer } from '@rrweb/replay';

type WebReplayPlayerProps = {
    events: any[];
    replayKey?: string;
    currentTime: number;
    isPlaying: boolean;
    playbackRate: number;
    durationSeconds: number;
    backgroundGaps?: CompressedBackgroundGap[];
    fitMode?: 'contain' | 'width' | 'document-width';
    documentWidth?: number | null;
    documentHeight?: number | null;
};

function replayEventSignature(event: any): string {
    const timestamp = typeof event?.timestamp === 'number' && Number.isFinite(event.timestamp) ? event.timestamp : '';
    const type = event?.type ?? '';
    return `${timestamp}:${type}`;
}

function canAppendReplayEvents(previousEvents: any[], nextEvents: any[]): boolean {
    if (nextEvents.length < previousEvents.length) return false;

    for (let index = 0; index < previousEvents.length; index += 1) {
        if (replayEventSignature(previousEvents[index]) !== replayEventSignature(nextEvents[index])) {
            return false;
        }
    }

    return true;
}

function buildReplayKey(events: any[]): string {
    const first = events[0];
    const firstHref = typeof first?.data?.href === 'string' ? first.data.href : '';
    return `${replayEventSignature(first)}:${firstHref}`;
}

const REPLAY_MASK_PLACEHOLDER_STYLE_RULES = [
    '.rr-block { color: transparent !important; background-color: #f8fafd !important; background-image: repeating-linear-gradient(135deg, rgba(95, 99, 104, 0.1) 0 10px, rgba(255, 255, 255, 0) 10px 20px) !important; background-repeat: repeat !important; background-size: 28px 28px !important; box-shadow: inset 0 0 0 1px #dadce0 !important; }',
    '.rr-block.rj-media-mask { background-color: #f1f3f4 !important; background-image: repeating-linear-gradient(135deg, rgba(95, 99, 104, 0.14) 0 10px, rgba(255, 255, 255, 0) 10px 20px) !important; box-shadow: inset 0 0 0 1px #dadce0 !important; }',
    '.rr-block:not(img):not(video):not(canvas):not(svg):not(image) { position: relative !important; display: flex !important; align-items: center !important; justify-content: center !important; }',
    '.rr-block:not(img):not(video):not(canvas):not(svg):not(image)::after { content: "Content masked"; display: inline-flex !important; align-items: center !important; justify-content: center !important; min-width: 132px !important; min-height: 34px !important; padding: 0 14px !important; border: 1px solid #dadce0 !important; border-radius: 0 !important; background: #ffffff !important; color: #3c4043 !important; font: 500 13px/1.2 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important; box-shadow: none !important; }',
    '.rr-block.rj-media-mask:not(img):not(video):not(canvas):not(svg):not(image)::after { content: "Media masked"; }',
];

function applyScale(
    root: HTMLElement,
    fitMode: 'contain' | 'width' | 'document-width',
    documentWidth?: number | null,
    documentHeight?: number | null,
): boolean {
    const wrapper = root.querySelector<HTMLElement>('.replayer-wrapper');
    const iframe = root.querySelector<HTMLIFrameElement>('iframe');
    if (!wrapper || !iframe) return false;
    const documentFit = fitMode === 'document-width';
    const sourceWidth = documentFit && documentWidth && Number.isFinite(documentWidth) && documentWidth > 0
        ? documentWidth
        : null;
    const sourceHeight = documentFit && documentHeight && Number.isFinite(documentHeight) && documentHeight > 0
        ? documentHeight
        : null;
    if (sourceWidth) {
        iframe.setAttribute('width', `${Math.round(sourceWidth)}`);
        iframe.style.width = `${sourceWidth}px`;
        wrapper.style.width = `${sourceWidth}px`;
    }
    if (sourceHeight) {
        iframe.setAttribute('height', `${Math.round(sourceHeight)}`);
        iframe.style.height = `${sourceHeight}px`;
        wrapper.style.height = `${sourceHeight}px`;
    }
    const iframeW = sourceWidth || Number(iframe.getAttribute('width')) || iframe.offsetWidth;
    if (!iframeW) return false;
    // Take the recorded page out of flow before measuring. Below the xl layout the root's
    // height comes from its content, so measuring first would size the stage to the
    // recorded page and centre the replay outside the visible area.
    wrapper.style.position = 'absolute';
    const containerW = root.clientWidth;
    const containerH = root.clientHeight;
    if (containerW <= 0 || containerH <= 0) return false;
    const iframeH = sourceHeight || Number(iframe.getAttribute('height')) || iframe.offsetHeight;
    if (iframeH <= 0) return false;
    const scale = fitMode === 'width' || documentFit
        ? containerW / iframeW
        : Math.min(containerW / iframeW, containerH / iframeH);
    if (!Number.isFinite(scale) || scale <= 0) return false;
    const scaledW = iframeW * scale;
    const scaledH = iframeH * scale;
    wrapper.style.transformOrigin = 'top left';
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.left = fitMode === 'width' || documentFit ? '0px' : `${(containerW - scaledW) / 2}px`;
    wrapper.style.top = fitMode === 'width' || documentFit ? '0px' : `${(containerH - scaledH) / 2}px`;
    return true;
}

export default function WebReplayPlayer({
    events,
    replayKey,
    currentTime,
    isPlaying,
    playbackRate,
    durationSeconds,
    backgroundGaps = [],
    fitMode = 'contain',
    documentWidth = null,
    documentHeight = null,
}: WebReplayPlayerProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const replayerRef = useRef<RrwebReplayer | null>(null);
    const mountedEventsRef = useRef<any[]>([]);
    const mountedReplayKeyRef = useRef<string | null>(null);
    const mountGenerationRef = useRef(0);
    const playbackStateRef = useRef({ currentTime, durationSeconds, playbackRate });
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
        playbackStateRef.current = { currentTime, durationSeconds, playbackRate };
    }, [currentTime, durationSeconds, playbackRate]);

    const destroyReplayer = useCallback((clearRoot = true) => {
        playerIsPlayingRef.current = false;
        if (replayerRef.current) {
            try {
                replayerRef.current.destroy();
            } catch {
                // rrweb can throw when tearing down partially mounted iframes.
            }
            replayerRef.current = null;
        }
        mountedEventsRef.current = [];
        mountedReplayKeyRef.current = null;
        if (clearRoot && rootRef.current) {
            rootRef.current.innerHTML = '';
        }
    }, []);

    const mountReplayer = useCallback(async (eventsToMount: any[], key: string, clearRoot: boolean) => {
        if (!rootRef.current || eventsToMount.length === 0) return;

        const generation = mountGenerationRef.current + 1;
        mountGenerationRef.current = generation;
        setLoadError(null);
        destroyReplayer(clearRoot);
        if (clearRoot && rootRef.current) {
            rootRef.current.innerHTML = '';
        }

        try {
            const { Replayer } = await import('@rrweb/replay');
            if (mountGenerationRef.current !== generation || !rootRef.current) return;

            const {
                currentTime: initialCurrentTime,
                durationSeconds: initialDurationSeconds,
                playbackRate: initialPlaybackRate,
            } = playbackStateRef.current;
            const replayer = new Replayer(eventsToMount, {
                root: rootRef.current,
                speed: initialPlaybackRate,
                showWarning: false,
                showDebug: false,
                mouseTail: {
                    duration: 900,
                    lineCap: 'round',
                    lineWidth: 4,
                    strokeStyle: 'rgba(244, 63, 94, 0.82)',
                },
                UNSAFE_replayCanvas: true,
                insertStyleRules: REPLAY_MASK_PLACEHOLDER_STYLE_RULES,
                triggerFocus: false,
            });
            const initialOffsetMs = Math.max(0, Math.min(initialCurrentTime, initialDurationSeconds || initialCurrentTime) * 1000);
            replayerRef.current = replayer;
            mountedEventsRef.current = eventsToMount;
            mountedReplayKeyRef.current = key;
            playerIsPlayingRef.current = false;
            replayer.pause(initialOffsetMs);
        } catch (error) {
            if (mountGenerationRef.current === generation) {
                console.error('Failed to initialize rrweb replay:', error);
                setLoadError('Unable to load browser replay.');
            }
        }
    }, [destroyReplayer]);

    useEffect(() => {
        const key = replayKey ?? buildReplayKey(replayEvents);

        if (replayEvents.length === 0) {
            destroyReplayer();
            return;
        }

        const replayer = replayerRef.current;
        if (!replayer || mountedReplayKeyRef.current !== key) {
            void mountReplayer(replayEvents, key, true);
            return;
        }

        if (canAppendReplayEvents(mountedEventsRef.current, replayEvents)) {
            const mountedEventCount = mountedEventsRef.current.length;
            if (replayEvents.length === mountedEventCount) return;

            try {
                for (let index = mountedEventCount; index < replayEvents.length; index += 1) {
                    replayer.addEvent(replayEvents[index]);
                }
                mountedEventsRef.current = replayEvents;
                return;
            } catch (error) {
                console.warn('Failed to append rrweb replay events; remounting replay.', error);
            }
        }

        void mountReplayer(replayEvents, key, true);
    }, [destroyReplayer, mountReplayer, replayEvents, replayKey]);

    useEffect(() => () => {
        mountGenerationRef.current += 1;
        destroyReplayer();
    }, [destroyReplayer]);

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
                if (!applyScale(root, fitMode, documentWidth, documentHeight) && root.isConnected) {
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
    }, [documentHeight, documentWidth, fitMode]);

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
            // getCurrentTime() is rrweb's live playhead; getTimeOffset() only reports where the
            // last play()/pause() started, so comparing against it restarted playback every second.
            // rrweb stops at its last event, so drift is measured against that point, not past it.
            let targetOffsetMs = offsetMs;
            let actualOffsetMs = offsetMs;
            try {
                const totalTimeMs = replayer.getMetaData().totalTime;
                if (Number.isFinite(totalTimeMs) && totalTimeMs >= 0) {
                    targetOffsetMs = Math.min(offsetMs, totalTimeMs);
                }
                if (typeof replayer.getCurrentTime === 'function') {
                    actualOffsetMs = replayer.getCurrentTime();
                }
            } catch {
                // Treat an unreadable playhead as in sync rather than restarting playback.
            }
            if (!playerIsPlayingRef.current || Math.abs(actualOffsetMs - targetOffsetMs) > 1000) {
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
            <div className="flex h-full w-full items-center justify-center bg-white p-6 text-center text-sm font-medium text-[#5f6368]">
                Browser replay events are not available for this session.
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-white p-6 text-center text-sm font-medium text-[#c5221f]">
                {loadError}
            </div>
        );
    }

    return (
        <div className={`web-rrweb-player relative h-full w-full overflow-hidden bg-white ${displayedBackgroundGap ? 'grayscale' : ''}`}>
            <div ref={rootRef} className="h-full min-h-[320px] w-full" />
            {displayedBackgroundGap ? (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#202124]/70 px-6 text-center text-white">
                    <div className="rounded-none border border-white/20 bg-[#202124] px-5 py-4">
                        <div className="text-xs font-medium text-[#bdc1c6]">User left the page</div>
                        <div className="mt-1 text-lg font-medium tabular-nums">Away for {formatBackgroundGapDuration(displayedBackgroundGap.durationMs)}</div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
