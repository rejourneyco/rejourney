import React from 'react';
import { Settings } from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';

interface SettingsLayoutProps {
    children: React.ReactNode;
    title: string;
    description?: string;
    headerAction?: React.ReactNode;
    icon?: React.ReactNode;
    iconColor?: string;
}

export const SettingsLayout: React.FC<SettingsLayoutProps> = ({
    children,
    title,
    description,
    headerAction,
    icon = <Settings className="w-6 h-6" />,
    iconColor = 'bg-slate-200',
}) => (
    <div className="flex min-h-screen flex-col bg-transparent font-sans text-slate-900">
        <DashboardPageHeader title={title} subtitle={description} icon={icon} iconColor={iconColor}>
            {headerAction}
        </DashboardPageHeader>
        <div className="mx-auto w-full max-w-[1600px] flex-1 space-y-12 px-4 py-6 sm:px-6">
            {children}
        </div>
    </div>
);

export default SettingsLayout;
