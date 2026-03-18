import React, { useMemo } from 'react';
import { Loader2, CheckCircle2, Smartphone, Activity, LayoutTemplate, Database, Image as ImageIcon } from 'lucide-react';

export interface SessionLoadingOverlayProps {
    isCoreLoading?: boolean;
    isTimelineLoading?: boolean;
    isHierarchyLoading?: boolean;
    isStatsLoading?: boolean;
    isFramesLoading?: boolean;
    framesProcessed?: number;
    framesTotal?: number;
}

export const SessionLoadingOverlay: React.FC<SessionLoadingOverlayProps> = ({
    isCoreLoading = true,
    isTimelineLoading = true,
    isHierarchyLoading = true,
    isStatsLoading = true,
    isFramesLoading = false,
    framesProcessed = 0,
    framesTotal = 0,
}) => {
    const progress = useMemo(() => {
        let totalWeight = 0;
        let completedWeight = 0;

        const addStep = (isLoading: boolean, weight: number) => {
            totalWeight += weight;
            if (!isLoading) completedWeight += weight;
        };

        addStep(isCoreLoading, 20);
        addStep(isTimelineLoading, 20);
        addStep(isHierarchyLoading, 20);
        addStep(isStatsLoading, 10);

        totalWeight += 30;
        if (!isFramesLoading) {
            completedWeight += 30;
        } else if (framesTotal > 0) {
            completedWeight += Math.floor((framesProcessed / framesTotal) * 30);
        }

        return Math.floor((completedWeight / totalWeight) * 100);
    }, [isCoreLoading, isTimelineLoading, isHierarchyLoading, isStatsLoading, isFramesLoading, framesProcessed, framesTotal]);

    const steps = [
        { id: 'core', label: 'Session data', isLoading: isCoreLoading, icon: Smartphone },
        { id: 'timeline', label: 'Event timeline', isLoading: isTimelineLoading, icon: Activity },
        { id: 'hierarchy', label: 'View hierarchy', isLoading: isHierarchyLoading, icon: LayoutTemplate },
        { id: 'stats', label: 'Statistics', isLoading: isStatsLoading, icon: Database },
        { id: 'frames', label: 'Screenshot frames', isLoading: isFramesLoading, icon: ImageIcon },
    ];

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--dashboard-canvas)] p-4">
            <div className="w-full max-w-sm">
                {/* Card */}
                <div className="bg-white rounded-xl border border-[var(--dashboard-card-border)] shadow-sm overflow-hidden">
                    <div className="px-6 pt-6 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-slate-900">
                                    Preparing replay
                                </h2>
                                <p className="text-sm text-slate-500 mt-0.5">
                                    Loading session data
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="px-6 pb-6">
                        {/* Progress bar */}
                        <div className="mb-5">
                            <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                                <span>Progress</span>
                                <span className="font-medium text-slate-700">{progress}%</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>

                        {/* Steps */}
                        <div className="space-y-2">
                            {steps.map((step) => {
                                const Icon = step.icon;
                                const isDone = !step.isLoading;
                                const isFrames = step.id === 'frames';
                                const showFrameCount = isFrames && isFramesLoading && framesTotal > 0;

                                return (
                                    <div
                                        key={step.id}
                                        className="flex items-center gap-3 py-2 px-3 rounded-lg transition-colors"
                                    >
                                        <div
                                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                                                isDone
                                                    ? 'bg-emerald-50 text-emerald-600'
                                                    : 'bg-slate-100 text-slate-400'
                                            }`}
                                        >
                                            {isDone ? (
                                                <CheckCircle2 className="h-4 w-4" />
                                            ) : (
                                                <Icon className="h-4 w-4" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p
                                                className={`text-sm font-medium ${
                                                    isDone ? 'text-slate-700' : 'text-slate-500'
                                                }`}
                                            >
                                                {step.label}
                                            </p>
                                            {showFrameCount && (
                                                <p className="text-xs text-slate-400 mt-0.5">
                                                    {framesProcessed} of {framesTotal} segments
                                                </p>
                                            )}
                                        </div>
                                        {!isDone && (
                                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-300" />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
