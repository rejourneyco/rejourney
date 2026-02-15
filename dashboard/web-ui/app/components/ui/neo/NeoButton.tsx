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
    // Neo-Brutalism: Sharp corners, thick borders, hard shadows
    const baseStyles = "inline-flex items-center justify-center font-bold uppercase tracking-wide transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-black focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 rounded-lg";

    const variants = {
        primary: "bg-black text-white hover:bg-slate-800 shadow-[2px_2px_0_0_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]",
        secondary: "bg-white text-black hover:bg-slate-100 shadow-[2px_2px_0_0_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]",
        danger: "bg-red-500 text-white hover:bg-red-600 shadow-[2px_2px_0_0_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]",
        success: "bg-emerald-400 text-black hover:bg-emerald-500 shadow-[2px_2px_0_0_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]",
        warning: "bg-yellow-400 text-black hover:bg-yellow-500 shadow-[2px_2px_0_0_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]",
        ghost: "bg-transparent text-black border-transparent hover:bg-slate-100 hover:border-slate-200 shadow-none active:translate-x-[1px] active:translate-y-[1px]"
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
