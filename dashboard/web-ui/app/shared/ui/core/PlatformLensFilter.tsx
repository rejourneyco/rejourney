import React from 'react';
import { Monitor, MonitorSmartphone, Smartphone } from 'lucide-react';
import type { PlatformLens } from '~/shared/hooks/useSharedPlatformLens';

const PLATFORM_LENS_OPTIONS: {
    value: PlatformLens;
    label: string;
    shortLabel: string;
    title: string;
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}[] = [
    { value: 'all', label: 'All data', shortLabel: 'All', title: 'Show web, iOS, and Android data', icon: MonitorSmartphone },
    { value: 'mobile', label: 'Mobile', shortLabel: 'Mobile', title: 'Show iOS and Android data', icon: Smartphone },
    { value: 'web', label: 'Web', shortLabel: 'Web', title: 'Show browser data', icon: Monitor },
];

interface PlatformLensFilterProps {
    value: PlatformLens;
    onChange: (value: PlatformLens) => void;
    availableValues?: readonly PlatformLens[];
    className?: string;
}

export const PlatformLensFilter: React.FC<PlatformLensFilterProps> = ({
    value,
    onChange,
    availableValues,
    className = '',
}) => {
    const availableSet = new Set<PlatformLens>(availableValues ?? PLATFORM_LENS_OPTIONS.map((option) => option.value));

    return (
        <div className={`min-w-0 max-w-full sm:w-auto ${className}`.trim()}>
            <div className="flex min-w-0 max-w-full flex-col gap-1 sm:flex-row sm:items-center">
                <span className="shrink-0 text-[10px] font-black uppercase leading-none text-slate-500">
                    Data view
                </span>
                <div
                    role="group"
                    aria-label="Data platform view"
                    className="grid min-w-0 grid-cols-3 overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm"
                >
                    {PLATFORM_LENS_OPTIONS.map((option) => {
                        const selected = value === option.value;
                        const available = availableSet.has(option.value);
                        const Icon = option.icon;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => available && onChange(option.value)}
                                aria-pressed={selected}
                                disabled={!available}
                                title={available ? option.title : `${option.label} is not configured for this project`}
                                className={`inline-flex h-9 min-w-0 items-center justify-center gap-1.5 border-r border-slate-200 px-2 text-[11px] font-bold uppercase leading-none transition-colors last:border-r-0 sm:min-w-[74px] sm:px-3
                                ${available
                                    ? selected
                                        ? 'bg-slate-950 text-white'
                                        : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                                    : 'cursor-not-allowed bg-white text-slate-300'
                                }
                                `}
                            >
                                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                <span className="truncate sm:hidden">{option.shortLabel}</span>
                                <span className="hidden truncate sm:inline">{option.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
