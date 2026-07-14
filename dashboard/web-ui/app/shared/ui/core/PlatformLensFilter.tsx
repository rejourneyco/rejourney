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
    { value: 'all', label: 'All', shortLabel: 'All', title: 'Show web, iOS, and Android session data', icon: MonitorSmartphone },
    { value: 'mobile', label: 'Mobile', shortLabel: 'Mobile', title: 'Show iOS and Android session data', icon: Smartphone },
    { value: 'web', label: 'Web', shortLabel: 'Web', title: 'Show web session data', icon: Monitor },
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
        <div className={`w-full min-w-0 max-w-full sm:w-auto ${className}`.trim()}>
            <div
                role="group"
                aria-label="Session platform"
                className="grid w-full min-w-0 grid-cols-3 gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 shadow-sm sm:w-auto"
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
                            className={`inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold leading-none transition-all sm:min-w-[72px] sm:px-3
                            ${available
                                ? selected
                                    ? 'bg-[#2563eb] text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-white hover:text-slate-950'
                                : 'cursor-not-allowed text-slate-300'
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
    );
};
