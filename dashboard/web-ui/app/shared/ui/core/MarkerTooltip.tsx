import React from 'react';

interface MarkerTooltipProps {
    type: string;
    name?: string;
    timestamp: string;
    target?: string;
    statusCode?: number;
    success?: boolean;
    duration?: number;
    visible: boolean;
    x: number;
}

const EDGE_ALIGN_PCT = 14;

export const MarkerTooltip: React.FC<MarkerTooltipProps> = ({
    type,
    name,
    timestamp,
    target,
    statusCode,
    success,
    duration,
    visible,
    x,
}) => {
    if (!visible) return null;

    const isNetwork = type === 'network_request';
    const isError = type === 'error' || type === 'crash' || type === 'anr';
    const isFrustration = type === 'rage_tap' || type === 'dead_tap';

    // Near left/right edges, anchor the tooltip to that edge so a wide card does not spill into the
    // adjacent column (e.g. workbench sidebar) on narrow or split layouts.
    const align: 'start' | 'center' | 'end' =
        x <= EDGE_ALIGN_PCT ? 'start' : x >= 100 - EDGE_ALIGN_PCT ? 'end' : 'center';
    const transform =
        align === 'start'
            ? 'translateX(0) translateY(-4px)'
            : align === 'end'
              ? 'translateX(-100%) translateY(-4px)'
              : 'translateX(-50%) translateY(-4px)';

    return (
        <div
            className="absolute bottom-full mb-3 z-50 pointer-events-none transition-all duration-200 max-w-[min(280px,calc(100%-8px))]"
            style={{
                left: `${x}%`,
                transform,
            }}
        >
            <div className="bg-slate-900 border-2 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-2.5 min-w-0 w-max max-w-full flex flex-col gap-1.5 backdrop-blur-md">
                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${isError ? 'text-red-400' : isNetwork ? 'text-blue-400' : isFrustration ? 'text-pink-400' : 'text-slate-400'
                        }`}>
                        {type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-white/50">{timestamp}</span>
                </div>

                {/* Content */}
                <div className="flex flex-col gap-1">
                    <div className="text-[13px] font-black text-white leading-tight break-words">
                        {target || name || type}
                    </div>

                    {isNetwork && (
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`px-1 py-0.5 text-[9px] font-black font-mono rounded-sm border ${success ? 'bg-emerald-500/10 text-emerald-400 border-emerald-400/20' : 'bg-red-500/10 text-red-400 border-red-400/20'
                                }`}>
                                {statusCode || 'ERR'}
                            </span>
                            {duration && (
                                <span className="text-[9px] font-bold text-slate-400 font-mono">
                                    {duration}ms
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Pointer: keep the caret near the timeline marker when the card is left/right anchored */}
                <div
                    className={`absolute top-full -mt-[2px] ${
                        align === 'start' ? 'left-4' : align === 'end' ? 'right-4' : 'left-1/2 -translate-x-1/2'
                    }`}
                >
                    <div className="w-2.5 h-2.5 bg-slate-900 border-r-2 border-b-2 border-black rotate-45" />
                </div>
            </div>
        </div>
    );
};
