import React from 'react';
import { Loader2 } from 'lucide-react';
import { dashboardButtonClass, type DashboardButtonVariant } from '../dashboardStyles';

interface NeoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

// The name is historical; this renders the dashboard's standard button. Success and
// warning predate the single-primary palette and map onto the remaining variants.
const VARIANT_STYLES: Record<NonNullable<NeoButtonProps['variant']>, DashboardButtonVariant> = {
    primary: 'primary',
    secondary: 'secondary',
    danger: 'danger',
    success: 'primary',
    warning: 'secondary',
    ghost: 'ghost',
};

export const NeoButton: React.FC<NeoButtonProps> = ({
    children,
    className = '',
    variant = 'primary',
    size = 'md',
    isLoading = false,
    leftIcon,
    rightIcon,
    disabled,
    ...props
}) => {
    const iconSizes = {
        sm: "[&>svg]:!h-3.5 [&>svg]:!w-3.5",
        md: "[&>svg]:!h-4 [&>svg]:!w-4",
        lg: "[&>svg]:!h-5 [&>svg]:!w-5"
    };
    const directIconClass = `${iconSizes[size]} [&>svg]:shrink-0`;
    const iconSlotClass = `inline-flex shrink-0 items-center justify-center ${iconSizes[size]} [&>svg]:shrink-0`;

    return (
        <button
            className={`${dashboardButtonClass(VARIANT_STYLES[variant], size)} ${directIconClass} ${className}`}
            disabled={isLoading || disabled}
            {...props}
        >
            {isLoading ? (
                <Loader2 className="animate-spin" />
            ) : (
                <>
                    {leftIcon && <span className={iconSlotClass}>{leftIcon}</span>}
                    {children}
                    {rightIcon && <span className={iconSlotClass}>{rightIcon}</span>}
                </>
            )}
        </button>
    );
};
