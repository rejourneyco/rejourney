import React, { useEffect, useRef } from 'react';
import { X, Copy, Check, Download, ExternalLink } from 'lucide-react';
import { NeoButton } from './neo/NeoButton';

interface StackTraceModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    stackTrace: string;
    issueType: 'crash' | 'error' | 'anr';
    sessionId?: string;
    onViewReplay?: () => void;
}

export const StackTraceModal: React.FC<StackTraceModalProps> = ({
    isOpen,
    onClose,
    title,
    subtitle,
    stackTrace,
    issueType,
    sessionId,
    onViewReplay,
}) => {
    const [copied, setCopied] = React.useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    // Close on escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    // Close on backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(stackTrace);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        const blob = new Blob([stackTrace], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${issueType}-stacktrace-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!isOpen) return null;

    const typeColors = {
        crash: { bg: 'bg-red-500', border: 'border-red-500', text: 'text-red-500' },
        error: { bg: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-500' },
        anr: { bg: 'bg-amber-500', border: 'border-amber-500', text: 'text-amber-500' },
    };

    const colors = typeColors[issueType];

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div
                ref={modalRef}
                className="relative w-full max-w-4xl max-h-[90vh] bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-lg overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`px-6 py-4 border-b-4 border-black ${colors.bg} flex items-start justify-between`}>
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-white text-black border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                {issueType.toUpperCase()}
                            </span>
                            <span className="text-white/80 text-xs font-bold uppercase">Full Stack Trace</span>
                        </div>
                        <h2 className="text-lg font-black text-white truncate">{title}</h2>
                        {subtitle && (
                            <p className="text-white/70 text-sm font-medium mt-1 truncate">{subtitle}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                    >
                        <X className="w-5 h-5 text-black" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="px-6 py-3 bg-slate-100 border-b-2 border-black flex items-center justify-between gap-4">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        {stackTrace.split('\n').length} lines
                    </div>
                    <div className="flex items-center gap-2">
                        <NeoButton variant="ghost" size="sm" onClick={handleCopy}>
                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            <span className="ml-1.5">{copied ? 'Copied!' : 'Copy'}</span>
                        </NeoButton>
                        <NeoButton variant="ghost" size="sm" onClick={handleDownload}>
                            <Download className="w-4 h-4" />
                            <span className="ml-1.5">Download</span>
                        </NeoButton>
                        {sessionId && onViewReplay && (
                            <NeoButton variant="primary" size="sm" onClick={onViewReplay}>
                                <ExternalLink className="w-4 h-4" />
                                <span className="ml-1.5">View Replay</span>
                            </NeoButton>
                        )}
                    </div>
                </div>

                {/* Stack Trace Content */}
                <div className="flex-1 overflow-auto bg-slate-900 p-6">
                    <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap leading-relaxed">
                        {stackTrace || 'No stack trace available.'}
                    </pre>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 bg-slate-100 border-t-2 border-black flex items-center justify-end">
                    <NeoButton variant="secondary" size="sm" onClick={onClose}>
                        Close
                    </NeoButton>
                </div>
            </div>
        </div>
    );
};

export default StackTraceModal;
