import React from 'react';

interface NeoCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    className?: string;
    title?: string;
    action?: React.ReactNode;
    variant?: 'default' | 'flat' | 'monitor';
    disablePadding?: boolean;
}

export const NeoCard: React.FC<NeoCardProps> = ({
    children,
    className = '',
    title,
    action,
    variant = 'default',
    disablePadding = false,
    ...props
}) => {
    const baseStyles = "transition-all duration-200 rounded-xl";
    const variants = {
        default: "dashboard-card-surface hover:shadow-sm",
        flat: "dashboard-card-surface shadow-none bg-white",
        monitor: "p-6 relative bg-slate-900 shadow-lg border border-slate-800"
    };

    if (variant === 'monitor') {
        return (
            <div className={`${baseStyles} ${variants.monitor} ${className}`} {...props}>
                {/* Monitor Screen Effect - Modernized */}
                <div className="bg-white border border-slate-700 h-full relative overflow-hidden shadow-inner rounded-xl">
                    {children}
                </div>
                {/* Monitor Base - Subtle */}
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-1/3 h-4 bg-slate-800 rounded-b-lg opacity-35"></div>
            </div>
        );
    }

    return (
        <div className={`${baseStyles} ${variants[variant]} ${disablePadding ? '' : 'p-6'} ${className}`} {...props}>
            {(title || action) && (
                <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100/80">
                    {title && (
                        <h3 className="text-lg font-semibold text-slate-900 tracking-tight">{title}</h3>
                    )}
                    {action && <div className="flex gap-3">{action}</div>}
                </div>
            )}
            {children}
        </div>
    );
};
