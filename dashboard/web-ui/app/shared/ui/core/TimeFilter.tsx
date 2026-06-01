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
        <div className={`min-w-0 max-w-full sm:w-auto ${className}`.trim()}>
            <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
                <span className="shrink-0 text-[9px] font-black uppercase leading-none text-slate-400">
                    Range
                </span>
                <select
                    value={value}
                    onChange={(event) => onChange(event.target.value as TimeRange)}
                    className="h-8 min-w-[76px] rounded-md border border-slate-200 bg-white px-2 pr-7 text-[10px] font-bold uppercase leading-none text-slate-700 outline-none transition-colors hover:border-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-200"
                >
                    {TIME_RANGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    );
};
