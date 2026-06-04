import React from 'react';

interface DashboardPageHeaderProps {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    iconColor?: string;
    iconAccent?: string;
    children?: React.ReactNode;
}

const HEADER_ICON_ACCENTS: Record<string, string> = {
    'bg-white': '#0891b2',
    'bg-[#ecfeff]': '#0891b2',
    'bg-[#eff6ff]': '#2563eb',
    'bg-[#ecfdf5]': '#059669',
    'bg-[#fdf2f8]': '#db2777',
    'bg-[#fff7ed]': '#f97316',
    'bg-[#fef2f2]': '#dc2626',
    'bg-[#f0fdf4]': '#16a34a',
    'bg-[#f5f3ff]': '#7c3aed',
    'bg-[#fffbeb]': '#d97706',
    'bg-[#f8fafc]': '#475569',
    'bg-[#f0fdfa]': '#0f766e',
    'bg-[#fefce8]': '#ca8a04',
    'bg-[#eef2ff]': '#4f46e5',
    'bg-[#cffafe]': '#0891b2',
    'bg-[#67e8f9]': '#0891b2',
    'bg-[#d1fae5]': '#16a34a',
    'bg-[#86efac]': '#16a34a',
    'bg-[#fce7f3]': '#db2777',
    'bg-[#f9a8d4]': '#db2777',
    'bg-[#e0e7ff]': '#7c3aed',
    'bg-[#c4b5fd]': '#7c3aed',
    'bg-[#dbeafe]': '#2563eb',
    'bg-[#e8f0fe]': '#2563eb',
    'bg-[#5dadec]': '#2563eb',
    'bg-[#ffe4e6]': '#dc2626',
    'bg-[#ede9fe]': '#7c3aed',
    'bg-[#fee2e2]': '#dc2626',
    'bg-[#f4f4f5]': '#64748b',
};

const HEADER_ICON_BACKGROUNDS: Record<string, string> = {
    'bg-white': '#ffffff',
};

function getHeaderIconBackground(iconColor: string) {
    const arbitraryHex = iconColor.match(/^bg-\[(#[0-9a-fA-F]{3,8})\]$/)?.[1];
    return arbitraryHex ?? HEADER_ICON_BACKGROUNDS[iconColor] ?? '#ffffff';
}

export const DashboardPageHeader: React.FC<DashboardPageHeaderProps> = ({
    title,
    subtitle,
    icon,
    iconColor = 'bg-white', // Default to white if not provided
    iconAccent,
    children
}) => {
    const resolvedIconAccent = iconAccent ?? HEADER_ICON_ACCENTS[iconColor] ?? HEADER_ICON_ACCENTS['bg-white'];
    const accentStyle = { backgroundColor: resolvedIconAccent };
    const iconStyle = {
        backgroundColor: getHeaderIconBackground(iconColor),
        color: resolvedIconAccent,
    };

    return (
        <div className="dashboard-page-header w-full border-b border-slate-200 bg-white">
            <div className="grid w-full gap-x-4 gap-y-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 sm:py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <span
                        aria-hidden="true"
                        className="dashboard-page-header-accent h-5 w-1.5 shrink-0 border border-black/20"
                        style={accentStyle}
                    />
                    {icon && (
                        <span
                            aria-hidden="true"
                            className="dashboard-page-header-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-black/10"
                            style={iconStyle}
                        >
                            {icon}
                        </span>
                    )}
                    <div className="min-w-0 flex-1" style={{ minWidth: 'min(100%, 13rem)' }}>
                        <h1 className="text-[15px] font-extrabold uppercase leading-none text-slate-950 sm:text-base">
                            {title}
                        </h1>
                        {subtitle && (
                            <div className="mt-1 flex min-w-0 items-start gap-2 opacity-90">
                                <p className="max-w-3xl text-xs font-medium leading-4 text-slate-600">
                                    {subtitle}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:justify-self-end">
                    {children}
                </div>
            </div>
        </div>
    );
};
