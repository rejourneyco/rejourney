import React from 'react';

interface DashboardPageHeaderProps {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    iconColor?: string;
    children?: React.ReactNode;
}

export const DashboardPageHeader: React.FC<DashboardPageHeaderProps> = ({
    title,
    subtitle,
    icon,
    iconColor = 'bg-white', // Default to white if not provided
    children
}) => {
    return (
        <div className="bg-white border-b border-slate-100 w-full">
            <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-[1800px] mx-auto w-full">
                <div className="flex items-center gap-4 min-w-0">
                    {icon && (
                        <div className={`shrink-0 p-2.5 rounded-xl border border-slate-100 shadow-sm ${iconColor} ${iconColor.includes('white') || iconColor.includes('slate-50') ? 'text-black' : 'text-white'}`}>
                            {icon}
                        </div>
                    )}
                    <div className="min-w-0">
                        <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight leading-none">
                            {title}
                        </h1>
                        {subtitle && (
                            <div className="flex items-center gap-2 mt-1.5 opacity-70">
                                <p className="text-xs font-medium text-slate-500 leading-none">
                                    {subtitle}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {children}
                </div>
            </div>
        </div>
    );
};
