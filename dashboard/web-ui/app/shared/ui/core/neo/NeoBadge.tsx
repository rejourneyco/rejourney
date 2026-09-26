import React from 'react';
import { dashboardChipTones, type DashboardChipTone } from '../dashboardStyles';

interface NeoBadgeProps {
    children: React.ReactNode;
    variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'anr' | 'rage' | 'dead_tap' | 'slow_start' | 'slow_api' | 'low_exp';
    className?: string;
    size?: 'sm' | 'md';
    onClick?: () => void;
}

// The name is historical; this renders the dashboard's rounded, sentence-case status chip.
const VARIANT_TONES: Record<NonNullable<NeoBadgeProps['variant']>, DashboardChipTone> = {
    neutral: 'neutral',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    info: 'info',
    anr: 'purple',
    rage: 'danger',
    dead_tap: 'neutral',
    slow_start: 'warning',
    slow_api: 'warning',
    low_exp: 'warning',
};

export const NeoBadge: React.FC<NeoBadgeProps> = ({
    children,
    variant = 'neutral',
    className = '',
    size = 'md',
    onClick
}) => {
    const baseStyles = "inline-flex items-center gap-1 whitespace-nowrap rounded-none font-medium leading-4";

    const sizes = {
        sm: "text-[11px] px-2 py-0.5",
        md: "text-xs px-2.5 py-0.5"
    };

    // Raw data values such as "active" or "fatal crash" read as sentence case.
    const content = typeof children === 'string' && /^[a-z]/.test(children)
        ? children.charAt(0).toUpperCase() + children.slice(1)
        : children;

    return (
        <span
            className={`${baseStyles} ${dashboardChipTones[VARIANT_TONES[variant]]} ${sizes[size]} ${onClick ? 'cursor-pointer hover:opacity-80' : ''} ${className}`}
            onClick={onClick}
        >
            {content}
        </span>
    );
};
