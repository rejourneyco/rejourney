import React from 'react';

interface NeoBadgeProps {
    children: React.ReactNode;
    variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'anr' | 'rage' | 'slow_start' | 'slow_api' | 'low_exp';
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
    const baseStyles = "inline-flex items-center font-bold uppercase rounded-full";

    const variants = {
        neutral: "bg-gray-100 text-gray-700",
        success: "bg-green-400 text-black",
        warning: "bg-yellow-400 text-black",
        danger: "bg-red-500 text-white",
        info: "bg-cyan-400 text-black",
        anr: "bg-purple-400 text-white",
        rage: "bg-slate-500 text-white",
        slow_start: "bg-orange-400 text-black",
        slow_api: "bg-pink-400 text-black",
        low_exp: "bg-indigo-400 text-white"
    };

    const sizes = {
        sm: "text-[10px] px-1.5 py-0.5",
        md: "text-xs px-2 py-1"
    };

    return (
        <span
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            onClick={onClick}
        >
            {children}
        </span>
    );
};
