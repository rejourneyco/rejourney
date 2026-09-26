import React, { useMemo } from 'react';
import { Loader2 } from 'lucide-react';

export interface SessionLoadingOverlayProps {
    isCoreLoading?: boolean;
    isFramesLoading?: boolean;
    isReplayManifestLoading?: boolean;
    isRrwebSegmentsLoading?: boolean;
    framesProcessed?: number;
    framesTotal?: number;
    rrwebSegmentsLoaded?: number;
    rrwebSegmentsTotal?: number;
    replayMode?: 'screenshots' | 'rrweb' | 'none' | null;
}

export const SessionLoadingOverlay: React.FC<SessionLoadingOverlayProps> = ({
    isCoreLoading = true,
    isFramesLoading = false,
    isReplayManifestLoading = false,
    isRrwebSegmentsLoading = false,
    framesProcessed = 0,
    framesTotal = 0,
    rrwebSegmentsLoaded = 0,
    rrwebSegmentsTotal = 0,
}) => {
    const rrwebTotal = Math.max(0, rrwebSegmentsTotal);
    const rrwebLoaded = Math.min(Math.max(0, rrwebSegmentsLoaded), rrwebTotal || rrwebSegmentsLoaded);
    const frameTotal = Math.max(0, framesTotal);
    const frameLoaded = Math.min(Math.max(0, framesProcessed), frameTotal || framesProcessed);
    const isVisualLoading = isFramesLoading || isRrwebSegmentsLoading;

    const visualRatio = useMemo(() => {
        if (isRrwebSegmentsLoading && rrwebTotal > 0) return rrwebLoaded / rrwebTotal;
        if (isFramesLoading && frameTotal > 0) return frameLoaded / frameTotal;
        if (isRrwebSegmentsLoading || isFramesLoading) return 0.2;
        return 1;
    }, [frameLoaded, frameTotal, isFramesLoading, isRrwebSegmentsLoading, rrwebLoaded, rrwebTotal]);

    const progress = useMemo(() => {
        if (!isCoreLoading && !isReplayManifestLoading && !isVisualLoading) return 100;
        const core = isCoreLoading ? 0 : 35;
        const manifest = isCoreLoading || isReplayManifestLoading ? 0 : 25;
        const visual = isCoreLoading || isReplayManifestLoading ? 0 : Math.round(40 * visualRatio);
        return Math.min(96, Math.max(8, core + manifest + visual));
    }, [isCoreLoading, isReplayManifestLoading, isVisualLoading, visualRatio]);

    const message = useMemo(() => {
        if (isCoreLoading) return 'Opening replay…';
        if (isReplayManifestLoading) return 'Almost there…';
        if (isRrwebSegmentsLoading) {
            return rrwebTotal > 1 && rrwebLoaded > 0
                ? `Loading replay (${rrwebLoaded} of ${rrwebTotal})…`
                : 'Loading replay…';
        }
        if (isFramesLoading) {
            return frameTotal > 1 && frameLoaded > 0
                ? `Loading replay (${frameLoaded} of ${frameTotal})…`
                : 'Loading replay…';
        }
        return 'Opening replay…';
    }, [frameLoaded, frameTotal, isCoreLoading, isFramesLoading, isReplayManifestLoading, isRrwebSegmentsLoading, rrwebLoaded, rrwebTotal]);

    return (
        <div
            className="flex min-h-screen items-center justify-center bg-[var(--dashboard-canvas)] px-4"
            role="status"
            aria-live="polite"
            aria-label={message}
        >
            <div className="flex flex-col items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-none bg-[#e8f0fe]">
                    <Loader2 className="h-5 w-5 animate-spin text-[#1a73e8]" />
                </div>
                <p className="text-sm font-medium text-slate-500">{message}</p>
                <div className="h-1 w-48 overflow-hidden rounded-none bg-[#e8eaed]">
                    <div
                        className="h-full rounded-none bg-[#1a73e8] transition-[width] duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </div>
    );
};
