import React from 'react';
import { Button } from './Button';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showCloseButton?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  showCloseButton = true,
  size = 'md'
}) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl'
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className={`bg-white text-slate-900 border-2 border-slate-900 shadow-[8px_8px_0_0_#0f172a] ${sizeClasses[size]} w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200`}>
        {(title || showCloseButton) && (
          <div className="border-b-2 border-slate-900 p-4 flex justify-between items-center bg-slate-50">
            <h2 className="text-lg font-black font-mono uppercase tracking-tight text-slate-900">{title}</h2>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1 hover:bg-red-500 hover:text-white border-2 border-transparent hover:border-slate-900 transition-all text-slate-900"
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </button>
            )}
          </div>
        )}
        <div className="p-6 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t-2 border-slate-900 p-4 flex justify-end gap-3 bg-slate-50">{footer}</div>}
      </div>
    </div>
  );
};
