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
    const baseStyles = "inline-flex items-center border-2 border-black font-black uppercase shadow-neo-sm rounded-none";

    const variants = {
        neutral: "bg-white text-black",
        success: "bg-[#86efac] text-black",
        warning: "bg-[#f9a8d4] text-black",
        danger: "bg-[#fb7185] text-black",
        info: "bg-[#67e8f9] text-black",
        anr: "bg-[#c4b5fd] text-black",
        rage: "bg-[#f9a8d4] text-black",
        dead_tap: "bg-[#f4f4f5] text-black",
        slow_start: "bg-[#f9a8d4] text-black",
        slow_api: "bg-[#dbeafe] text-black",
        low_exp: "bg-[#fef3c7] text-black"
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
