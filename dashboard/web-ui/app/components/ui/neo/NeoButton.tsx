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
    const baseStyles = "inline-flex items-center justify-center font-bold tracking-wide transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed rounded-md";

    const variants = {
        primary: "bg-black text-white hover:bg-slate-800 shadow-sm",
        secondary: "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-sm",
        danger: "bg-red-500 text-white hover:bg-red-600 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]",
        success: "bg-green-400 text-black hover:bg-green-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]",
        warning: "bg-yellow-400 text-black hover:bg-yellow-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]",
        ghost: "bg-transparent border-transparent text-black hover:bg-gray-100 shadow-none hover:shadow-none"
    };

    const sizes = {
        sm: "text-[10px] px-3 py-1.5 h-8 gap-1.5",
        md: "text-xs px-4 py-2 h-10 gap-2",
        lg: "text-sm px-6 py-3 h-12 gap-2.5"
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
