import React from 'react';
import { Loader2 } from 'lucide-react';

interface NeoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

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
    // Softened UI: Thinner borders, softer shadows
    const baseStyles = "inline-flex items-center justify-center font-bold uppercase tracking-wide transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border border-transparent focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 rounded-lg";

    const variants = {
        primary: "bg-slate-900 text-white hover:bg-slate-800 shadow-sm active:scale-95",
        secondary: "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-95",
        danger: "bg-rose-500 text-white hover:bg-rose-600 shadow-sm active:scale-95",
        success: "bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm active:scale-95",
        warning: "bg-amber-400 text-slate-900 hover:bg-amber-500 shadow-sm active:scale-95",
        ghost: "bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 shadow-none active:scale-95"
    };

    const sizes = {
        sm: "text-xs px-3 py-1.5 h-8 gap-1.5",
        md: "text-sm px-4 py-2 h-10 gap-2",
        lg: "text-base px-6 py-3 h-12 gap-2.5"
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            disabled={isLoading || disabled}
            {...props}
        >
            {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
                <>
                    {leftIcon}
                    {children}
                    {rightIcon}
                </>
            )}
        </button>
    );
};
