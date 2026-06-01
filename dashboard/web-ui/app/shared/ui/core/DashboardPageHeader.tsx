import React from 'react';

interface DashboardPageHeaderProps {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    iconColor?: string;
    children?: React.ReactNode;
}

const HEADER_ICON_ACCENTS: Record<string, string> = {
    'bg-white': '#67e8f9',
    'bg-black': '#0f172a',
    'bg-[#cffafe]': '#67e8f9',
    'bg-[#ecfeff]': '#67e8f9',
    'bg-[#67e8f9]': '#67e8f9',
    'bg-[#d1fae5]': '#86efac',
    'bg-[#86efac]': '#86efac',
    'bg-[#fce7f3]': '#f9a8d4',
    'bg-[#f9a8d4]': '#f9a8d4',
    'bg-[#e0e7ff]': '#c4b5fd',
    'bg-[#c4b5fd]': '#c4b5fd',
    'bg-[#dbeafe]': '#5dadec',
    'bg-[#5dadec]': '#5dadec',
    'bg-[#ffe4e6]': '#fb7185',
    'bg-[#ede9fe]': '#c4b5fd',
    'bg-[#fee2e2]': '#fca5a5',
    'bg-[#f4f4f5]': '#94a3b8',
    'bg-emerald-500': '#86efac',
    'bg-fuchsia-500': '#f9a8d4',
    'bg-sky-600': '#5dadec',
    'bg-sky-50': '#5dadec',
    'bg-red-500': '#fca5a5',
    'bg-indigo-500': '#c4b5fd',
    'bg-rose-50': '#fb7185',
    'bg-violet-50': '#c4b5fd',
    'bg-slate-200': '#94a3b8',
};

export const DashboardPageHeader: React.FC<DashboardPageHeaderProps> = ({
    title,
    subtitle,
    iconColor = 'bg-white', // Default to white if not provided
    children
}) => {
    const iconAccent = HEADER_ICON_ACCENTS[iconColor] ?? HEADER_ICON_ACCENTS['bg-white'];
    const accentStyle = { backgroundColor: iconAccent };

    return (
        <div className="dashboard-page-header w-full border-b border-slate-200 bg-white">
            <div className="grid w-full gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <span
                        aria-hidden="true"
                        className="dashboard-page-header-accent h-5 w-1.5 shrink-0 border border-black/20"
                        style={accentStyle}
                    />
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
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end sm:justify-self-end">
                    {children}
                </div>
            </div>
        </div>
    );
};
