import React from 'react';

interface DashboardPageHeaderProps {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    children?: React.ReactNode;
}

export const DashboardPageHeader: React.FC<DashboardPageHeaderProps> = ({
    title,
    subtitle,
    icon,
    children
}) => {
    return (
        <div className="dashboard-page-header w-full border-b border-[#dadce0] bg-[#f8fafd]">
            <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-3 px-3 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-2.5">
                    {icon && (
                        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center text-[#5f6368]">
                            {icon}
                        </span>
                    )}
                    <div className="min-w-0">
                        <h1 className="text-lg font-normal leading-6 text-[#202124] sm:text-xl">
                            {title}
                        </h1>
                        {subtitle && (
                            <p className="mt-0.5 max-w-3xl text-xs leading-4 text-[#5f6368]">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    {children}
                </div>
            </div>
        </div>
    );
};
