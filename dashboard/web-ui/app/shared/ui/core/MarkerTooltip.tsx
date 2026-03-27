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
    const isRage = type === 'rage_tap';

    return (
        <div
            className="absolute bottom-full mb-3 z-50 pointer-events-none transition-all duration-200"
            style={{
                left: `${x}%`,
                transform: 'translateX(-50%) translateY(-4px)',
            }}
        >
            <div className="bg-slate-900 border-2 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-2.5 min-w-[200px] flex flex-col gap-1.5 backdrop-blur-md">
                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${isError ? 'text-red-400' : isNetwork ? 'text-blue-400' : isRage ? 'text-orange-400' : 'text-slate-400'
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

                {/* Pointer */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[2px]">
                    <div className="w-2.5 h-2.5 bg-slate-900 border-r-2 border-b-2 border-black rotate-45" />
                </div>
            </div>
        </div>
    );
};
