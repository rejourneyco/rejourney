import React from 'react';
import { LucideIcon } from 'lucide-react';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';

interface PageHeaderProps {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    badge?: {
        label: string;
        variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
    };
    actions?: React.ReactNode;
    iconClassName?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    subtitle,
    badge,
    actions,
}) => {
    return (
        <div className="border-b border-[#dadce0] bg-[#f8fafd] px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 md:flex-row md:items-center">
                <div className="min-w-0">
                    <div className="mb-0.5 flex flex-wrap items-center gap-2">
                        <h1 className="truncate text-lg font-normal leading-6 text-[#202124] sm:text-xl">
                            {title}
                        </h1>
                        {badge && (
                            <NeoBadge variant={badge.variant || 'neutral'}>
                                {badge.label}
                            </NeoBadge>
                        )}
                    </div>
                    {subtitle && (
                        <p className="max-w-2xl text-xs leading-4 text-[#5f6368]">
                            {subtitle}
                        </p>
                    )}
                </div>

                {actions && (
                    <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};
