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
        success: "bg-emerald-50 text-emerald-700 border-emerald-100",
        warning: "bg-amber-50 text-amber-700 border-amber-100",
        danger: "bg-rose-50 text-rose-700 border-rose-100",
        info: "bg-sky-50 text-sky-700 border-sky-100",
        anr: "bg-violet-50 text-violet-700 border-violet-100",
        rage: "bg-pink-50 text-pink-700 border-pink-100",
        dead_tap: "bg-stone-50 text-stone-700 border-stone-200",
        slow_start: "bg-orange-50 text-orange-700 border-orange-100",
        slow_api: "bg-indigo-50 text-indigo-700 border-indigo-100",
        low_exp: "bg-blue-50 text-blue-700 border-blue-100"
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
