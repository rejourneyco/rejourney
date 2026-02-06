import React, { useEffect, useState } from 'react';
import { Loader2, Database, CloudDownload, Layers } from 'lucide-react';

interface LoadingStep {
    id: string;
    label: string;
    icon: any;
}

const LOADING_STEPS: LoadingStep[] = [
    { id: 's3', label: 'Shaking hands with S3...', icon: Database },
    { id: 'telemetry', label: 'Downloading telemetry streams...', icon: CloudDownload },
    { id: 'hierarchy', label: 'Unpacking view hierarchy...', icon: Layers },
];

export const SessionLoadingOverlay: React.FC = () => {
    const [currentStepIdx, setCurrentStepIdx] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentStepIdx((prev) => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
        }, 1500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-white/80 backdrop-blur-xl transition-all duration-500">
            <div className="relative flex flex-col items-center max-w-md w-full px-8 text-center">
                {/* Animated Loader Core */}
                <div className="relative mb-8">
                    <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-2xl animate-pulse scale-150" />
                    <div className="relative bg-white border-4 border-black p-6 rounded-3xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" strokeWidth={2.5} />
                    </div>
                </div>

                {/* Messaging */}
                <div className="space-y-4 w-full">
                    <h2 className="text-xl font-black uppercase tracking-tighter text-black italic">
                        Preparing Session Replay
                    </h2>

                    <div className="flex flex-col gap-3">
                        {LOADING_STEPS.map((step, idx) => {
                            const isActive = idx === currentStepIdx;
                            const isPast = idx < currentStepIdx;
                            const Icon = step.icon;

                            return (
                                <div
                                    key={step.id}
                                    className={`flex items-center gap-3 px-4 py-2 border-2 border-black rounded-xl transition-all duration-300 ${isActive
                                            ? 'bg-black text-white shadow-[4px_4px_0px_0px_rgba(99,102,241,1)] translate-x-[-2px] translate-y-[-2px]'
                                            : isPast
                                                ? 'bg-slate-100 text-slate-400 border-slate-200'
                                                : 'bg-white text-slate-300 border-slate-100'
                                        }`}
                                >
                                    <Icon className={`w-4 h-4 ${isActive ? 'animate-bounce' : ''}`} />
                                    <span className="text-xs font-black uppercase tracking-widest leading-none">
                                        {step.label}
                                    </span>
                                    {isPast && <div className="ml-auto w-2 h-2 bg-emerald-500 rounded-full" />}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Indeterminate Progress Bar */}
                <div className="mt-10 w-full h-1.5 bg-slate-100 border border-black rounded-full overflow-hidden shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.1)]">
                    <div className="h-full bg-indigo-500 animate-[loading-bar_2s_infinite_linear]" style={{ width: '40%' }} />
                </div>
            </div>

            <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
        </div>
    );
};
