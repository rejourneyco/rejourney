import React from 'react';

interface NeoBadgeProps {
    children: React.ReactNode;
    variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'anr' | 'rage' | 'dead_tap' | 'slow_start' | 'slow_api' | 'low_exp';
    className?: string;
    size?: 'sm' | 'md';
    onClick?: () => void;
}

export const NeoBadge: React.FC<NeoBadgeProps> = ({
    children,
    variant = 'neutral',
    className = '',
    size = 'md',
    onClick
}) => {
    // Softened UI: Subtle borders, lighter backgrounds
    const baseStyles = "inline-flex items-center font-semibold border rounded-md tracking-tight shadow-sm";

    const variants = {
        neutral: "bg-slate-50 border-slate-200 text-slate-700",
        success: "bg-emerald-50 border-emerald-200 text-emerald-700",
        warning: "bg-amber-50 border-amber-200 text-amber-700",
        danger: "bg-rose-50 border-rose-200 text-rose-700",
        info: "bg-cyan-50 border-cyan-200 text-cyan-700",
        anr: "bg-purple-50 border-purple-200 text-purple-700",
        rage: "bg-pink-50 border-pink-200 text-pink-700",
        dead_tap: "bg-gray-50 border-gray-200 text-gray-700",
        slow_start: "bg-orange-50 border-orange-200 text-orange-700",
        slow_api: "bg-indigo-50 border-indigo-200 text-indigo-700",
        low_exp: "bg-blue-50 border-blue-200 text-blue-700"
    };

    const sizes = {
        sm: "text-[10px] px-2 py-0.5",
        md: "text-xs px-3 py-1"
    };

    return (
        <span
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
            onClick={onClick}
        >
            {children}
        </span>
    );
};
