import React, { useMemo } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

export interface SessionLoadingOverlayProps {
    isCoreLoading?: boolean;
    isTimelineLoading?: boolean;
    isHierarchyLoading?: boolean;
    isStatsLoading?: boolean;
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
    isTimelineLoading = false,
    isHierarchyLoading = false,
    isStatsLoading = false,
    isFramesLoading = false,
    isReplayManifestLoading = false,
    isRrwebSegmentsLoading = false,
    framesProcessed = 0,
    framesTotal = 0,
    rrwebSegmentsLoaded = 0,
    rrwebSegmentsTotal = 0,
    replayMode = null,
}) => {
    const rrwebTotal = Math.max(0, rrwebSegmentsTotal);
    const rrwebLoaded = Math.min(Math.max(0, rrwebSegmentsLoaded), rrwebTotal || rrwebSegmentsLoaded);
    const frameTotal = Math.max(0, framesTotal);
    const frameLoaded = Math.min(Math.max(0, framesProcessed), frameTotal || framesProcessed);
    const isVisualLoading = isFramesLoading || isRrwebSegmentsLoading;
    const contextLoadingCount = [isTimelineLoading, isHierarchyLoading, isStatsLoading].filter(Boolean).length;
    const isContextLoading = contextLoadingCount > 0;
    const visualRatio = useMemo(() => {
        if (isRrwebSegmentsLoading) {
            return rrwebTotal > 0 ? rrwebLoaded / rrwebTotal : 0.25;
        }
        if (isFramesLoading) {
            return frameTotal > 0 ? frameLoaded / frameTotal : 0.35;
        }
        return 1;
    }, [frameLoaded, frameTotal, isFramesLoading, isRrwebSegmentsLoading, rrwebLoaded, rrwebTotal]);

    const progress = useMemo(() => {
        const core = isCoreLoading ? 0 : 35;
        const manifest = isReplayManifestLoading || isCoreLoading ? 0 : 25;
        const visual = isReplayManifestLoading || isCoreLoading ? 0 : Math.round(40 * visualRatio);
        const next = core + manifest + visual;
        const stillLoading = isCoreLoading || isReplayManifestLoading || isVisualLoading || isContextLoading;

        if (!stillLoading) return 100;
        return Math.min(96, Math.max(8, next));
    }, [isContextLoading, isCoreLoading, isReplayManifestLoading, isVisualLoading, visualRatio]);

    const phase = useMemo(() => {
        if (isCoreLoading) {
            return {
                title: 'Opening replay',
                detail: 'Loading the session shell and device context.',
            };
        }
        if (isReplayManifestLoading) {
            return {
                title: 'Preparing replay',
                detail: 'Fetching the lightweight replay manifest.',
            };
        }
        if (isRrwebSegmentsLoading) {
            return {
                title: 'Loading browser replay',
                detail: 'Starting with the first playable segment, then prefetching the rest.',
            };
        }
        if (isFramesLoading) {
            return {
                title: 'Preparing visual replay',
                detail: 'Materializing the first replay frames for playback.',
            };
        }
        return {
            title: 'Opening replay',
            detail: contextLoadingCount > 0 ? 'Syncing timeline context in the background.' : 'Almost ready.',
        };
    }, [
        contextLoadingCount,
        isCoreLoading,
        isFramesLoading,
        isReplayManifestLoading,
        isRrwebSegmentsLoading,
    ]);

    const steps = [
        { label: 'Session', done: !isCoreLoading, active: isCoreLoading },
        { label: 'Manifest', done: !isCoreLoading && !isReplayManifestLoading, active: !isCoreLoading && isReplayManifestLoading },
        {
            label: replayMode === 'rrweb' ? 'Segments' : replayMode === 'screenshots' ? 'Frames' : 'Replay',
            done: !isCoreLoading && !isReplayManifestLoading && !isVisualLoading,
            active: !isCoreLoading && !isReplayManifestLoading && isVisualLoading,
        },
    ];

    return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--dashboard-canvas)] px-4 py-10" role="status" aria-live="polite">
            <div className="w-full max-w-xl">
                <div className="overflow-hidden rounded-lg border border-[var(--dashboard-card-border)] bg-white shadow-sm">
                    <div className="h-1 w-full bg-slate-100">
                        <div
                            className="h-full bg-primary transition-[width] duration-500 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>

                    <div className="p-5 sm:p-6">
                        <div className="flex items-start gap-4">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <h2 className="text-sm font-semibold text-slate-950">{phase.title}</h2>
                                        <p className="mt-1 text-sm leading-5 text-slate-500">{phase.detail}</p>
                                    </div>
                                    <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">{progress}%</span>
                                </div>

                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                    {steps.map((step) => (
                                        <span
                                            key={step.label}
                                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                                                step.done
                                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                    : step.active
                                                        ? 'border-primary/30 bg-primary/10 text-primary'
                                                        : 'border-slate-200 bg-slate-50 text-slate-500'
                                            }`}
                                        >
                                            {step.done ? (
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                            ) : step.active ? (
                                                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                                            ) : (
                                                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" aria-hidden />
                                            )}
                                            {step.label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
