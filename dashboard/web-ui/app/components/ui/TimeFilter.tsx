import React from 'react';

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'all';
export const DEFAULT_TIME_RANGE: TimeRange = '30d';

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
    { value: '24h', label: '24H' },
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '90d', label: '90D' },
    { value: 'all', label: 'ALL' },
];

interface TimeFilterProps {
    value: TimeRange;
    onChange: (range: TimeRange) => void;
    className?: string;
}

/**
 * Unified time filter component for all analytics pages.
 * Neo-brutalist styled to match the dashboard theme.
 */
export const TimeFilter: React.FC<TimeFilterProps> = ({ value, onChange, className = '' }) => {
    return (
        <div className={`flex bg-slate-100 p-1 rounded-lg border border-slate-200 ${className}`}>
            {TIME_RANGE_OPTIONS.map((option) => (
                <button
                    key={option.value}
                    onClick={() => onChange(option.value)}
                    className={`px-3 py-1.5 text-xs font-bold uppercase transition-all rounded-md ${value === option.value
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                        }`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
};
