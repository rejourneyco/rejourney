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
    const typeWords = type.replace(/_/g, ' ');
    const typeLabel = type === 'anr' ? 'ANR' : typeWords.charAt(0).toUpperCase() + typeWords.slice(1);

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
            <div className="flex w-max min-w-0 max-w-full flex-col gap-1 rounded-none bg-[#202124] px-2.5 py-2 shadow-[0_4px_16px_rgba(60,64,67,0.3)]">
                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                    <span className={`text-[11px] font-medium ${isError ? 'text-[#f28b82]' : isNetwork ? 'text-[#8ab4f8]' : isFrustration ? 'text-[#fdd663]' : 'text-[#bdc1c6]'
                        }`}>
                        {typeLabel}
                    </span>
                    <span className="text-[11px] tabular-nums text-[#9aa0a6]">{timestamp}</span>
                </div>

                {/* Content */}
                <div className="flex flex-col gap-1">
                    <div className="break-words text-[13px] font-medium leading-tight text-white">
                        {target || name || typeLabel}
                    </div>

                    {isNetwork && (
                        <div className="mt-0.5 flex items-center gap-2">
                            <span className={`rounded-none px-1.5 py-0.5 text-[11px] font-medium leading-4 tabular-nums ${success ? 'bg-[#81c995]/15 text-[#81c995]' : 'bg-[#f28b82]/15 text-[#f28b82]'
                                }`}>
                                {statusCode || 'Error'}
                            </span>
                            {duration && (
                                <span className="text-[11px] tabular-nums text-[#9aa0a6]">
                                    {duration} ms
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Pointer: keep the caret near the timeline marker when the card is left/right anchored */}
                <div
                    className={`absolute top-full -mt-1 ${
                        align === 'start' ? 'left-4' : align === 'end' ? 'right-4' : 'left-1/2 -translate-x-1/2'
                    }`}
                >
                    <div className="h-2 w-2 rotate-45 bg-[#202124]" />
                </div>
            </div>
        </div>
    );
};
