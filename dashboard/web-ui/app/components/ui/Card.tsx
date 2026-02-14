import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  title?: string;
  disablePadding?: boolean;
  headerAction?: React.ReactNode;
  variant?: 'default' | 'flat' | 'subtle';
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  className = '',
  disablePadding = false,
  headerAction,
  variant = 'default',
  ...props
}) => {
  const variantStyles = {
    default: 'bg-white border border-slate-200 shadow-sm rounded-xl',
    flat: 'bg-white border border-slate-300 rounded-xl',
    subtle: 'bg-white border border-slate-200 shadow-sm rounded-xl',
  };

  const headerStyles = {
    default: 'border-b border-slate-100 bg-white',
    flat: 'border-b border-slate-200 bg-slate-50',
    subtle: 'border-b border-slate-200 bg-slate-50',
  };

  return (
    <div className={`${variantStyles[variant]} overflow-hidden ${className}`} {...props}>
      {(title || headerAction) && (
        <div className={`px-5 py-3 flex justify-between items-center ${headerStyles[variant]}`}>
          {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className={disablePadding ? '' : 'p-5'}>
        {children}
      </div>
    </div>
  );
};
