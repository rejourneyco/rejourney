import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'neutral' | 'primary' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'error' | 'danger';
  size?: 'sm' | 'md';
}

export function Badge({
  className = '',
  variant = 'neutral',
  size = 'md',
  ...props
}: BadgeProps) {

  const baseStyles = "inline-flex items-center rounded-md border-2 px-2.5 py-0.5 font-bold font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

  const variants = {
    neutral: "border-slate-900 bg-slate-100 text-slate-900 hover:bg-slate-200",
    primary: "border-slate-900 bg-blue-500 text-white hover:bg-blue-600",
    secondary: "border-slate-900 bg-purple-500 text-white hover:bg-purple-600",
    destructive: "border-slate-900 bg-red-500 text-white hover:bg-red-600",
    outline: "border-slate-900 text-slate-900 bg-transparent hover:bg-slate-100",
    success: "border-slate-900 bg-emerald-400 text-slate-900",
    warning: "border-slate-900 bg-amber-400 text-slate-900",
    error: "border-slate-900 bg-rose-500 text-white",
    danger: "border-slate-900 bg-rose-500 text-white",
  };

  const sizes = {
    sm: "text-[10px] px-1.5 py-0.5 shadow-[2px_2px_0_0_#0f172a]",
    md: "text-xs px-2.5 py-0.5 shadow-[2px_2px_0_0_#0f172a]",
  }

  const variantStyles = variants[variant] || variants.neutral;
  const sizeStyles = sizes[size] || sizes.md;

  return (
    <div className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className}`} {...props} />
  );
}
