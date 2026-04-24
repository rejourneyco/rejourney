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
    const isLightIconBackground = /-(50|100|200)\b/.test(iconColor) || iconColor.includes('white');
    const iconToneClass = iconColor.includes('sky-50')
        ? 'text-sky-600'
        : isLightIconBackground
            ? 'text-slate-800'
            : 'text-white';

    return (
        <div className="bg-white border-b border-slate-200 w-full">
            <div className="mx-auto grid w-full max-w-[1800px] gap-x-4 gap-y-3 px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                <div className="flex min-w-0 flex-wrap items-start gap-3 sm:gap-4">
                    {icon && (
                        <div className={`mt-0.5 shrink-0 rounded-xl border border-slate-200 p-2.5 shadow-sm ${iconColor} ${iconToneClass}`}>
                            {icon}
                        </div>
                    )}
                    <div className="min-w-0 flex-1" style={{ minWidth: 'min(100%, 13rem)' }}>
                        <h1 className="text-xl font-semibold uppercase tracking-wide leading-tight text-black sm:text-2xl">
                            {title}
                        </h1>
                        {subtitle && (
                            <div className="mt-1.5 flex min-w-0 items-start gap-2 opacity-80">
                                <p className="max-w-3xl text-xs font-medium leading-5 text-slate-500 sm:text-sm">
                                    {subtitle}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:gap-3 xl:justify-end">
                    {children}
                </div>
            </div>
        </div>
    );
};
