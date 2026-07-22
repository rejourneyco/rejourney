import React from 'react';
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

  if (!isOpen || typeof document === 'undefined') return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl'
  };

  const panelStyles = variant === 'modern'
    ? `bg-white text-slate-900 border border-slate-100/80 shadow-2xl rounded-2xl ${sizeClasses[size]} w-full max-h-[calc(100dvh-1.5rem)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 sm:max-h-[90vh] ${panelClassName}`
    : `bg-white text-slate-900 border-2 border-black shadow-[8px_8px_0_0_#000000] ${sizeClasses[size]} w-full max-h-[calc(100dvh-1.5rem)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 sm:max-h-[90vh] ${panelClassName}`;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px] animate-in fade-in duration-200 sm:p-4">
      <div className={panelStyles} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {(title || showCloseButton) && (
          <div className={variant === 'modern' ? "border-b border-slate-100 px-6 py-5 flex justify-between items-center bg-white" : "border-b-2 border-black p-4 flex justify-between items-center bg-[#f8fafc]"}>
            <h2 id={titleId} className={variant === 'modern' ? "text-lg font-bold text-slate-900 font-display" : "text-lg font-black uppercase text-black"}>{title}</h2>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className={variant === 'modern' ? "rounded-full p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700 transition-colors" : "border-2 border-transparent p-1 text-black transition-all hover:border-black hover:bg-[#fecaca] hover:shadow-neo-sm"}
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </button>
            )}
          </div>
        )}
        <div className={variant === 'modern' ? `flex-1 overflow-y-auto ${bodyClassName}` : `p-4 flex-1 overflow-y-auto sm:p-6 ${bodyClassName}`}>{children}</div>
        {footer && <div className={variant === 'modern' ? "border-t border-slate-100 px-6 py-4 flex flex-wrap justify-end gap-3 bg-white" : "border-t-2 border-black p-4 flex flex-wrap justify-end gap-3 bg-[#f8fafc]"}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};
