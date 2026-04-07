import React from 'react';
import { Download, LucideIcon } from 'lucide-react';
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
    icon: Icon,
    title,
    subtitle,
    badge,
    actions,
    iconClassName = "text-slate-900"
}) => {
    return (
        <div className="bg-white border-b-2 border-black p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 max-w-7xl mx-auto">
                <div className="flex items-start gap-5">
                    <div className="p-3 bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-none shrink-0">
                        <Icon className={`w-8 h-8 ${iconClassName}`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                            <h1 className="text-2xl md:text-3xl font-black font-mono uppercase tracking-wide text-black">
                                {title}
                            </h1>
                            {badge && (
                                <NeoBadge variant={badge.variant || 'neutral'}>
                                    {badge.label}
                                </NeoBadge>
                            )}
                        </div>
                        {subtitle && (
                            <p className="text-xs font-medium text-gray-500 max-w-2xl leading-relaxed">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>

                {actions && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};
