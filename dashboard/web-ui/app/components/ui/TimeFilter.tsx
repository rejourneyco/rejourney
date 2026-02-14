import React from 'react';

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'all';
export const DEFAULT_TIME_RANGE: TimeRange = '30d';

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: 'all', label: 'All' },
];

interface TimeFilterProps {
    value: TimeRange;
    onChange: (range: TimeRange) => void;
    className?: string;
}

export const TimeFilter: React.FC<TimeFilterProps> = ({ value, onChange, className = '' }) => {
    return (
        <div className={`flex rounded-lg border border-slate-200 bg-slate-100/85 p-1 ${className}`}>
            {TIME_RANGE_OPTIONS.map((option) => (
                <button
                    key={option.value}
                    onClick={() => onChange(option.value)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${value === option.value
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-800'
                        }`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
};
