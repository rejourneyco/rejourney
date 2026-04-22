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

  const baseStyles = "inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

  const variants = {
    neutral: "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200",
    primary: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100",
    secondary: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
    destructive: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    outline: "border-slate-200 text-slate-700 bg-transparent hover:bg-slate-100",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    error: "border-rose-200 bg-rose-50 text-rose-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
  };

  const sizes = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2.5 py-0.5",
  }

  const variantStyles = variants[variant] || variants.neutral;
  const sizeStyles = sizes[size] || sizes.md;

  return (
    <div className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className}`} {...props} />
  );
}
