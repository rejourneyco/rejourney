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
        <div className={`flex items-center p-0.5 ${className}`}>
            <div className="flex items-center border border-slate-200 rounded-lg bg-white shadow-sm overflow-hidden">
                {TIME_RANGE_OPTIONS.map((option, index) => (
                    <button
                        key={option.value}
                        onClick={() => onChange(option.value)}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors 
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
    );
};
