import React from 'react';

export type TimeRange = '24h' | '7d' | '30d' | '90d' | '180d' | '1y' | 'all';
export const DEFAULT_TIME_RANGE: TimeRange = '30d';

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
    { value: '24h', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '180d', label: 'Last 180 days' },
    { value: '1y', label: 'Last 12 months' },
    { value: 'all', label: 'All time' },
];

interface TimeFilterProps {
    value: TimeRange;
    onChange: (range: TimeRange) => void;
    className?: string;
}

export const TimeFilter: React.FC<TimeFilterProps> = ({ value, onChange, className = '' }) => {
    return (
        <div className={`min-w-0 max-w-full sm:w-auto ${className}`.trim()}>
            <label className="flex min-w-0 items-center">
                <span className="sr-only">Date range</span>
                <select
                    value={value}
                    onChange={(event) => onChange(event.target.value as TimeRange)}
                    className="h-8 min-w-[128px] rounded-none border border-[#dadce0] bg-white pl-3 pr-8 text-xs font-medium leading-none text-[#3c4043] outline-none transition-colors hover:bg-[#f8fafd] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
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
