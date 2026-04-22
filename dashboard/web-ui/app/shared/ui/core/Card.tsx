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
    default: 'bg-white border-2 border-black shadow-neo-sm hover:shadow-neo transition-all duration-200',
    flat: 'bg-white border-2 border-black',
    subtle: 'bg-slate-50 border-2 border-slate-300 border-dashed',
  };

  const headerStyles = {
    default: 'border-b-2 border-black bg-slate-50',
    flat: 'border-b-2 border-black bg-slate-50',
    subtle: 'border-b-2 border-slate-200 bg-slate-50',
  };

  return (
    <div className={`${variantStyles[variant]} overflow-hidden ${className}`} {...props}>
      {(title || headerAction) && (
        <div className={`px-5 py-3 flex justify-between items-center ${headerStyles[variant]}`}>
          {title && <h3 className="text-xs font-black uppercase tracking-widest text-black">{title}</h3>}
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className={disablePadding ? '' : 'p-5'}>
        {children}
      </div>
    </div>
  );
};
