import React from 'react';
import { Link } from 'react-router';
import { usePathPrefix } from '../../hooks/usePathPrefix';

interface SettingsLayoutProps {
    children: React.ReactNode;
    title: string;
    description?: string;
    headerAction?: React.ReactNode;
}

export const SettingsLayout: React.FC<SettingsLayoutProps> = ({
    children,
    title,
    description,
    headerAction,
}) => {
    const pathPrefix = usePathPrefix();

    return (
        <div className="min-h-screen bg-white flex flex-col font-sans text-black">
            {/* Sticky Header */}
            <div className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200">
                <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-6 flex-1">
                        <Link to={`${pathPrefix}/sessions`} className="flex items-center gap-2 hover:opacity-70 transition-opacitygroup">
                            <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-3">
                                {title}
                            </h1>
                        </Link>
                        <div className="h-8 w-[2px] bg-black hidden md:block"></div>
                        <div className="hidden md:block">
                            <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest">
                                {description}
                            </p>
                        </div>
                    </div>
                    {headerAction && (
                        <div className="flex items-center gap-4">
                            {headerAction}
                        </div>
                    )}
                </div>
            </div>

            {/* Content - Standardized Width */}
            <div className="flex-1 p-6 md:p-8 space-y-12 max-w-[1600px] mx-auto w-full">
                {children}
            </div>
        </div>
    );
};

export default SettingsLayout;
