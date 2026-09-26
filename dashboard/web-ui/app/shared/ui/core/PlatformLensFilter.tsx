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
                className="grid w-full min-w-0 grid-cols-3 gap-0.5 overflow-hidden rounded-none border border-[#dadce0] bg-white p-0.5 sm:w-auto"
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
                            className={`inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-none px-2.5 text-xs font-medium leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 sm:min-w-[72px] sm:px-3
                            ${available
                                ? selected
                                    ? 'bg-[#e8f0fe] text-[#1967d2]'
                                    : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'
                                : 'cursor-not-allowed text-[#bdc1c6]'
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
