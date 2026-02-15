import React from 'react';
import { Download, LucideIcon } from 'lucide-react';
import { NeoBadge } from '../ui/neo/NeoBadge';

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
        <div className="bg-white border-b border-slate-200 p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 max-w-7xl mx-auto">
                <div className="flex items-start gap-5">
                    <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg shadow-sm shrink-0">
                        <Icon className={`w-8 h-8 ${iconClassName}`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                                {title}
                            </h1>
                            {badge && (
                                <NeoBadge variant={badge.variant || 'neutral'}>
                                    {badge.label}
                                </NeoBadge>
                            )}
                        </div>
                        {subtitle && (
                            <p className="text-base text-slate-500 max-w-2xl leading-relaxed">
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
