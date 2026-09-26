import React from 'react';

interface NeoCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    className?: string;
    title?: string;
    action?: React.ReactNode;
    variant?: 'default' | 'flat' | 'monitor';
    disablePadding?: boolean;
}

// The name is historical; every variant renders the dashboard's flat 8px card.
export const NeoCard: React.FC<NeoCardProps> = ({
    children,
    className = '',
    title,
    action,
    variant = 'default',
    disablePadding = false,
    ...props
}) => {
    const baseStyles = "dashboard-panel relative rounded-none border border-[#dadce0] bg-white";

    if (variant === 'monitor') {
        return (
            <div className={`${baseStyles} p-4 ${className}`} {...props}>
                <div className="relative h-full overflow-hidden rounded-none border border-[#e8eaed] bg-[#f8fafd] p-1">
                    {children}
                </div>
            </div>
        );
    }

    return (
        <div className={`${baseStyles} ${disablePadding ? '' : 'p-6'} ${className}`} {...props}>
            {(title || action) && (
                <div className={`flex justify-between items-center ${disablePadding ? 'p-6 pb-4' : 'mb-6 pb-4'} border-b border-[#e8eaed]`}>
                    {title && (
                        <h3 className="text-[15px] font-medium text-[#202124]">{title}</h3>
                    )}
                    {action && <div className="flex gap-2">{action}</div>}
                </div>
            )}
            {children}
        </div>
    );
};
