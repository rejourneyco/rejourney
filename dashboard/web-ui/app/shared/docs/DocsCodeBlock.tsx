import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { CodeBlock } from '~/shared/ui/core/CodeBlock';
import { useLocation } from 'react-router';
import { getContentLocaleCopy } from '~/shared/lib/contentLocalization';
import { getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';

interface DocsCodeBlockProps {
    code: string;
    language?: string;
    isTerminal?: boolean;
}

export const DocsCodeBlock: React.FC<DocsCodeBlockProps> = ({ code, language, isTerminal = false }) => {
    const [copied, setCopied] = useState(false);
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale);

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
            <div className="relative p-4 overflow-x-auto bg-[#202124]">
                <button
                    onClick={handleCopy}
                    className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 text-xs font-mono font-medium text-[#bdc1c6] hover:text-white hover:bg-white/10 border border-[#5f6368]/60 rounded-none transition-colors z-10"
                    title={copy.docsCopyCommandTitle}
                >
                    {copied ? (
                        <>
                            <Check size={12} className="text-[#81c995]" />
                            <span className="text-[#81c995]">{copy.docsCopied}</span>
                        </>
                    ) : (
                        <>
                            <Copy size={12} />
                            <span>{copy.docsCopyCode}</span>
                        </>
                    )}
                </button>
                <pre className="text-sm font-mono leading-relaxed m-0">
                    <code className="text-[#81c995]">
                        {code}
                    </code>
                </pre>
            </div>
        );
    }

    // Application code gets the full styled code block
    return (
        <div className="group relative bg-[#202124] border border-[#dadce0] rounded-none overflow-hidden mb-6">
            {/* Header with clean indicator and language */}
            <div className="flex items-center justify-between border-b border-[#3c4043] bg-[#292a2d] px-4 py-2">
                <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#ea4335]/80"></div>
                        <div className="w-2.5 h-2.5 rounded-full bg-[#fbbc04]/80"></div>
                        <div className="w-2.5 h-2.5 rounded-full bg-[#34a853]/80"></div>
                    </div>
                    {language && (
                        <span className="ml-2 text-[11px] font-mono uppercase tracking-wider text-[#9aa0a6]">
                            {language}
                        </span>
                    )}
                </div>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium text-[#bdc1c6] hover:text-white hover:bg-white/10 border border-[#5f6368]/60 rounded-none transition-colors"
                    title={copy.docsCopyCodeTitle}
                >
                    {copied ? (
                        <>
                            <Check size={13} className="text-[#81c995]" />
                            <span className="text-[#81c995]">{copy.docsCopied}</span>
                        </>
                    ) : (
                        <>
                            <Copy size={13} />
                            <span>{copy.docsCopyCode}</span>
                        </>
                    )}
                </button>
            </div>
            {/* Code content with enhanced padding */}
            <div className="p-5 overflow-x-auto text-sm font-mono leading-relaxed text-[#e8eaed]">
                <CodeBlock code={code} language={language} />
            </div>
        </div>
    );
};
