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
    const baseStyles = "bg-white border-4 border-black transition-all duration-200";
    const variants = {
        default: "shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]",
        flat: "shadow-none",
        monitor: "p-6 relative bg-slate-900 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
    };

    if (variant === 'monitor') {
        return (
            <div className={`${baseStyles} ${variants.monitor} ${className}`} {...props}>
                {/* Monitor Screen Effect */}
                <div className="bg-white border-4 border-black h-full relative overflow-hidden shadow-[inset_4px_4px_12px_rgba(0,0,0,0.1)]">
                    {children}
                </div>
                {/* Monitor Base */}
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-1/2 h-4 bg-black"></div>
            </div>
        );
    }

    return (
        <div className={`${baseStyles} ${variants[variant]} ${disablePadding ? '' : 'p-6'} ${className}`} {...props}>
            {(title || action) && (
                <div className="flex justify-between items-center mb-8 pb-4 border-b-4 border-black">
                    {title && (
                        <h3 className="text-2xl font-black uppercase tracking-tighter text-black">{title}</h3>
                    )}
                    {action && <div className="flex gap-4">{action}</div>}
                </div>
            )}
            {children}
        </div>
    );
};
