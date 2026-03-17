import React, { useMemo } from 'react';
import { Loader2, CheckCircle2, Clock, Image as ImageIcon, LayoutTemplate, Activity, Database, Smartphone } from 'lucide-react';

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
    // Generate an exact progress score based on the loading variables
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

        // Frame extraction takes the longest, make it worth 30 points
        totalWeight += 30;
        if (!isFramesLoading) {
            completedWeight += 30;
        } else if (framesTotal > 0) {
            completedWeight += Math.floor((framesProcessed / framesTotal) * 30);
        }

        return Math.floor((completedWeight / totalWeight) * 100);
    }, [isCoreLoading, isTimelineLoading, isHierarchyLoading, isStatsLoading, isFramesLoading, framesProcessed, framesTotal]);

    const steps = [
        {
            id: 'core',
            label: 'Session Core',
            isLoading: isCoreLoading,
            icon: Smartphone,
        },
        {
            id: 'timeline',
            label: 'Event Timeline',
            isLoading: isTimelineLoading,
            icon: Activity,
        },
        {
            id: 'hierarchy',
            label: 'View Hierarchy',
            isLoading: isHierarchyLoading,
            icon: LayoutTemplate,
        },
        {
            id: 'stats',
            label: 'Session Statistics',
            isLoading: isStatsLoading,
            icon: Database,
        },
    ];

    return (
        <div className="min-h-screen bg-slate-50 relative">
            <div className="absolute inset-0 bg-slate-900/5 backdrop-blur-sm z-10 flex items-center justify-center p-4">
                <div className="w-full max-w-md bg-white rounded-2xl shadow-[0_22px_55px_rgba(15,23,42,0.1)] border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <Loader2 className="w-5 h-5 animate-spin text-cyan-600" />
                            Preparing Session Replay
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 font-medium">
                            Synthesizing timeline, hierarchy, and multimedia payloads.
                        </p>
                    </div>

                    <div className="p-6 space-y-5">
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs font-semibold text-slate-600">
                                <span>Overall Progress</span>
                                <span className="text-cyan-600 font-bold">{progress}%</span>
                            </div>
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-cyan-500 rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>

                        <div className="space-y-3 pt-2">
                            {steps.map((step) => {
                                const Icon = step.icon;
                                const isDone = !step.isLoading;
                                return (
                                    <div key={step.id} className="flex items-center gap-3">
                                        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border transition-colors ${
                                            isDone 
                                                ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
                                                : 'bg-slate-50 border-slate-200 text-slate-400'
                                        }`}>
                                            <Icon className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm font-semibold ${isDone ? 'text-slate-900' : 'text-slate-500'}`}>
                                                {step.label}
                                            </p>
                                        </div>
                                        <div className="shrink-0 flex items-center">
                                            {isDone ? (
                                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                            ) : (
                                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-bold tracking-wide text-slate-500 uppercase">
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                    Pending
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}

                            <div className="flex items-center gap-3">
                                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border transition-colors ${
                                    !isFramesLoading 
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
                                        : 'bg-cyan-50 border-cyan-200 text-cyan-600'
                                }`}>
                                    <ImageIcon className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold ${!isFramesLoading ? 'text-slate-900' : 'text-slate-700'}`}>
                                        Screenshot Frames
                                    </p>
                                    {isFramesLoading && framesTotal > 0 && (
                                        <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                                            Extracting {framesProcessed} of {framesTotal} segments
                                        </p>
                                    )}
                                </div>
                                <div className="shrink-0 flex items-center">
                                    {!isFramesLoading ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                    ) : (
                                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-[10px] font-bold tracking-wide text-cyan-700 uppercase">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Extracting
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Background Skeleton for visual stability */}
            <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 py-4 opacity-40 grayscale blur-[2px] pointer-events-none">
                <div className="h-14 rounded-2xl border border-slate-200 bg-white" />
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:col-span-7">
                        <div className="h-16 border-b border-slate-200 bg-slate-950" />
                        <div className="flex justify-center px-4 py-6 sm:px-6">
                            <div className="relative w-[320px] max-w-[80vw] rounded-[2.8rem] border border-slate-700 bg-slate-950 p-2 shadow-[0_22px_55px_rgba(15,23,42,0.2)]">
                                <div className="rounded-[2.3rem] bg-slate-900 p-1.5">
                                    <div className="aspect-[9/19.5] overflow-hidden rounded-[2rem] bg-[linear-gradient(180deg,_rgba(248,250,252,0.95)_0%,_rgba(226,232,240,0.9)_100%)]">
                                        <div className="mx-auto mt-5 h-5 w-24 rounded-full bg-white/80" />
                                        <div className="mx-auto mt-10 h-28 w-[82%] rounded-[2rem] bg-white/65" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section className="space-y-4 xl:col-span-5">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm h-[400px]" />
                    </section>
                </div>
            </div>
        </div>
    );
};
