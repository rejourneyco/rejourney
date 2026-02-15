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
    // Neo-Brutalism: Rectangular, bold
    const baseStyles = "inline-flex items-center font-bold border border-black uppercase tracking-tight shadow-[1px_1px_0_0_rgba(0,0,0,1)] rounded-sm";

    const variants = {
        neutral: "bg-white text-black",
        success: "bg-green-400 text-black",
        warning: "bg-yellow-400 text-black",
        danger: "bg-red-500 text-white",
        info: "bg-cyan-300 text-black",
        anr: "bg-purple-400 text-black",
        rage: "bg-pink-400 text-black",
        dead_tap: "bg-gray-400 text-black",
        slow_start: "bg-orange-400 text-black",
        slow_api: "bg-indigo-300 text-black",
        low_exp: "bg-blue-300 text-black"
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
