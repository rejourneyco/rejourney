import React from 'react';

export type TimeRange = '24h' | '7d' | '30d' | '90d' | '180d' | '1y' | 'all';
export const DEFAULT_TIME_RANGE: TimeRange = '30d';

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: '180d', label: '180d' },
    { value: '1y', label: '1Y' },
    { value: 'all', label: 'All' },
];

interface TimeFilterProps {
    value: TimeRange;
    onChange: (range: TimeRange) => void;
    className?: string;
}

export const TimeFilter: React.FC<TimeFilterProps> = ({ value, onChange, className = '' }) => {
    return (
        <div className={`min-w-0 max-w-full p-0.5 ${className}`.trim()}>
            <div className="max-w-full overflow-x-auto overflow-y-hidden rounded-lg border border-slate-200 bg-white shadow-sm no-scrollbar">
                <div className="inline-flex min-w-max items-center overflow-hidden">
                {TIME_RANGE_OPTIONS.map((option, index) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        aria-pressed={value === option.value}
                        className={`shrink-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors 
                        ${value === option.value
                                ? 'bg-slate-900 text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                            }
                        ${index !== TIME_RANGE_OPTIONS.length - 1 ? 'border-r border-slate-100' : ''}
                        `}
                    >
                        {option.label}
                    </button>
                ))}
                </div>
            </div>
        </div>
    );
};
