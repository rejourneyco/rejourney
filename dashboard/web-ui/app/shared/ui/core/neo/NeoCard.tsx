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
    const baseStyles = "transition-all duration-200 bg-white border-2 border-black relative";
    const variants = {
        default: "shadow-neo-sm hover:shadow-neo hover:-translate-y-1 transition-all rounded-none",
        flat: "shadow-none rounded-none",
        monitor: "p-6 relative bg-slate-900 border-4 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] rounded-none"
    };

    if (variant === 'monitor') {
        return (
            <div className={`${baseStyles} ${variants.monitor} ${className}`} {...props}>
                <div className="bg-slate-50 border-2 border-black h-full relative overflow-hidden shadow-inner p-1">
                    {children}
                </div>
            </div>
        );
    }

    return (
        <div className={`${baseStyles} ${variants[variant]} ${disablePadding ? '' : 'p-6'} ${className}`} {...props}>
            {(title || action) && (
                <div className={`flex justify-between items-center ${disablePadding ? 'p-6 pb-4' : 'mb-6 pb-4'} border-b-2 border-black`}>
                    {title && (
                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">{title}</h3>
                    )}
                    {action && <div className="flex gap-2">{action}</div>}
                </div>
            )}
            {children}
        </div>
    );
};
