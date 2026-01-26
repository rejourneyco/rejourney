import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { CodeBlock } from '~/components/ui/CodeBlock';

interface DocsCodeBlockProps {
    code: string;
    language?: string;
    isTerminal?: boolean;
}

export const DocsCodeBlock: React.FC<DocsCodeBlockProps> = ({ code, language, isTerminal = false }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Terminal commands get simpler, terminal-like styling
    if (isTerminal) {
        return (
            <div className="relative p-4 overflow-x-auto">
                <button
                    onClick={handleCopy}
                    className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 text-xs font-mono font-bold text-gray-400 hover:text-white hover:bg-white/10 border border-white/10 rounded transition-all z-10"
                    title="Copy command"
                >
                    {copied ? (
                        <>
                            <Check size={12} className="text-green-400" />
                            <span className="text-green-400">Copied!</span>
                        </>
                    ) : (
                        <>
                            <Copy size={12} />
                            <span>Copy</span>
                        </>
                    )}
                </button>
                <pre className="text-sm font-mono leading-relaxed m-0">
                    <code className="text-green-400">
                        {code}
                    </code>
                </pre>
            </div>
        );
    }

    // Application code gets the full styled code block
    return (
        <div className="group relative bg-[#0f172a] border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] transition-all duration-300 mb-8">
            {/* Header with macOS style buttons and glassmorphism */}
            <div className="flex items-center justify-between border-b-2 border-black bg-white/5 backdrop-blur-md px-4 py-3">
                <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-black/20 shadow-inner"></div>
                    <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-black/20 shadow-inner"></div>
                    <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-black/20 shadow-inner"></div>
                </div>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold text-gray-400 hover:text-white hover:bg-white/10 border border-white/10 rounded-md transition-all active:scale-95"
                    title="Copy code"
                >
                    {copied ? (
                        <>
                            <Check size={14} className="text-[#34d399]" />
                            <span className="text-[#34d399]">Copied!</span>
                        </>
                    ) : (
                        <>
                            <Copy size={14} />
                            <span>Copy</span>
                        </>
                    )}
                </button>
            </div>
            {/* Code content with enhanced padding */}
            <div className="p-6 overflow-x-auto text-sm font-mono leading-relaxed">
                <CodeBlock code={code} language={language} />
            </div>
        </div>
    );
};
