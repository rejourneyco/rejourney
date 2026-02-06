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
    // Pill shape, font weight normal/medium, tracking normal
    const baseStyles = "inline-flex items-center font-medium rounded-full border";

    const variants = {
        neutral: "bg-slate-50 text-slate-600 border-slate-200",
        success: "bg-emerald-50 text-emerald-700 border-emerald-200",
        warning: "bg-amber-50 text-amber-700 border-amber-200",
        danger: "bg-red-50 text-red-700 border-red-200",
        info: "bg-cyan-50 text-cyan-700 border-cyan-200",
        anr: "bg-purple-50 text-purple-700 border-purple-200",
        rage: "bg-rose-50 text-rose-700 border-rose-200",
        dead_tap: "bg-stone-50 text-stone-700 border-stone-300",
        slow_start: "bg-orange-50 text-orange-700 border-orange-200",
        slow_api: "bg-pink-50 text-pink-700 border-pink-200",
        low_exp: "bg-indigo-50 text-indigo-700 border-indigo-200"
    };

    const sizes = {
        sm: "text-[10px] px-2 py-0.5",
        md: "text-xs px-2.5 py-0.5"
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
