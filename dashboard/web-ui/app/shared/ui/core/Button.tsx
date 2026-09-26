import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  className = '',
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  children,
  ...props
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-none font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ring-offset-background";

  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-white text-[#3c4043] border border-[#dadce0] hover:bg-[#f8fafd] hover:border-[#bdc1c6]",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
    outline: "border border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f8fafd] hover:border-[#bdc1c6]",
    ghost: "text-[#3c4043] hover:bg-[#f1f3f4]",
  };

  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-9 px-4 py-2 text-sm",
    lg: "h-11 px-8 text-base",
    icon: "h-9 w-9 p-0",
  };

  const iconSizes = {
    sm: "[&>svg]:!h-3.5 [&>svg]:!w-3.5",
    md: "[&>svg]:!h-4 [&>svg]:!w-4",
    lg: "[&>svg]:!h-5 [&>svg]:!w-5",
    icon: "[&>svg]:!h-4 [&>svg]:!w-4",
  };
  const directIconClass = `${iconSizes[size]} [&>svg]:shrink-0`;
  const iconSlotClass = `inline-flex shrink-0 items-center justify-center ${iconSizes[size]} [&>svg]:shrink-0`;
  const hasChildren = React.Children.count(children) > 0;

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${directIconClass} ${className}`}
      {...props}
    >
      {leftIcon && <span className={`${iconSlotClass} ${hasChildren ? 'mr-2' : ''}`}>{leftIcon}</span>}
      {children}
      {rightIcon && <span className={`${iconSlotClass} ${hasChildren ? 'ml-2' : ''}`}>{rightIcon}</span>}
    </button>
  );
};
