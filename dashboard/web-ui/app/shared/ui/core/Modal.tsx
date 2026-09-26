import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showCloseButton?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  panelClassName?: string;
  bodyClassName?: string;
  // Both variants render the same dialog; 'modern' leaves body padding to bodyClassName.
  variant?: 'retro' | 'modern';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  showCloseButton = true,
  size = 'md',
  panelClassName = '',
  bodyClassName = '',
  variant = 'retro',
}) => {
  const titleId = React.useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl'
  };

  const bodyPadding = variant === 'modern' ? '' : 'p-5 sm:p-6';

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#202124]/50 p-3 sm:p-4">
      <div
        className={`flex w-full max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-none border border-[#dadce0] bg-white text-[#202124] shadow-[0_12px_32px_rgba(60,64,67,0.28)] sm:max-h-[90vh] ${sizeClasses[size]} ${panelClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between gap-4 border-b border-[#e8eaed] px-5 py-4">
            <h2 id={titleId} className="text-lg font-medium text-[#202124]">{title}</h2>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-none p-1.5 text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </button>
            )}
          </div>
        )}
        <div className={`flex-1 overflow-y-auto ${bodyPadding} ${bodyClassName}`}>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-[#e8eaed] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};
