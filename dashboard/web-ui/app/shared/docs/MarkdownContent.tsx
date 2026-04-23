/**
 * Component to render markdown content with proper styling
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocsCodeBlock } from '~/shared/docs/DocsCodeBlock';
import React, { useState } from 'react';
import { Check, Info, AlertTriangle, XCircle, Lightbulb } from 'lucide-react';
import { AI_INTEGRATION_PROMPT } from '~/shared/constants/aiPrompts';
import { cn } from "~/shared/lib/cn";

interface MarkdownContentProps {
    content: string;
    onAIPromptRender?: (renderPrompt: () => React.JSX.Element) => void;
}

// Helper to generate ID from heading text
function generateId(text: string): string {
    return String(text)
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

// Custom plugin to parse GitHub Alerts
// This is a simple implementation that looks for blockquotes starting with [!NOTE] etc.
// In a full implementation, this could be a remark plugin
const getAlertProps = (children: any) => {
    let content = children;
    let type = 'note';
    let title = 'Note';

    if (Array.isArray(children) && children.length > 0) {
        const firstChild = children[0];
        if (typeof firstChild === 'string') {
            const match = firstChild.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/);
            if (match) {
                type = match[1].toLowerCase();
                title = match[1].charAt(0) + match[1].slice(1).toLowerCase();
                // Remove the tag from the content
                const newText = firstChild.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/, '');
                content = [newText, ...children.slice(1)];
            }
        }
        // Handle case where text is wrapped in paragraph
        if (firstChild?.props?.children) {
            // Recursive check or just simplified for the p tag structure
            const pText = firstChild.props.children[0];
            if (typeof pText === 'string') {
                const match = pText.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/);
                if (match) {
                    type = match[1].toLowerCase();
                    title = match[1].charAt(0) + match[1].slice(1).toLowerCase();
                    // We render custom alert, so we ignore the default children here
                    // and let the Alert rendering helper handle extraction if needed
                    // BUT: ReactMarkdown passes the paragraph as a child.
                }
            }
        }
    }
    return { type, title, content };
};

export function MarkdownContent({ content, onAIPromptRender }: MarkdownContentProps) {
    const [promptCopied, setPromptCopied] = useState(false);

    const handleCopyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(AI_INTEGRATION_PROMPT);
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Check if content has AI prompt section
    const hasAIPrompt = content.includes('<!-- AI_PROMPT_SECTION -->');

    // Extract AI prompt section
    let processedContent = content;
    let aiPromptSection: string | null = null;

    if (hasAIPrompt) {
        const startMarker = '<!-- AI_PROMPT_SECTION -->';
        const endMarker = '<!-- /AI_PROMPT_SECTION -->';
        const startIdx = content.indexOf(startMarker);
        const endIdx = content.indexOf(endMarker);

        if (startIdx !== -1 && endIdx !== -1) {
            aiPromptSection = content.substring(startIdx + startMarker.length, endIdx).trim();
            processedContent = content.substring(0, startIdx) + content.substring(endIdx + endMarker.length);
        }
    }
    // Render AI prompt section if present
    const renderAIPrompt = () => {
        // Remove markdown formatting (asterisks, etc.) from the text
        const cleanText = aiPromptSection?.replace(/\*\*/g, '').replace(/\*/g, '').trim() || '';

        return (
            <section className="mb-12 pb-8 border-b-2 border-black">
                <div className="bg-yellow-100 border-2 border-black p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-black font-bold mb-4 text-lg">
                        Use AI to integrate faster
                    </p>
                    <p className="text-black mb-6 font-medium">
                        {cleanText}
                    </p>
                    <button
                        onClick={handleCopyPrompt}
                        className="px-6 py-3 bg-black text-white font-bold hover:bg-gray-800 transition-colors shadow-[4px_4px_0px_0px_rgba(100,100,100,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(100,100,100,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                    >
                        {promptCopied ? "Copied!" : "Copy Integration Prompt"}
                    </button>
                </div>
            </section>
        );
    };

    // Notify parent about AI prompt renderer if callback provided
    if (onAIPromptRender && aiPromptSection) {
        onAIPromptRender(renderAIPrompt);
    }

    return (
        <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-black prose-p:text-gray-800 prose-a:text-blue-600 prose-code:text-gray-700 prose-code:bg-gray-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
            {aiPromptSection && renderAIPrompt()}
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    // Custom code block rendering to match existing style
                    code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : '';

                        // Properly extract code string from children
                        let codeString = '';
                        if (Array.isArray(children)) {
                            codeString = children.map(child =>
                                typeof child === 'string' ? child : String(child)
                            ).join('');
                        } else {
                            codeString = String(children);
                        }
                        const rawCode = codeString.replace(/\n$/, '');
                        const trimmedCode = rawCode.trim();

                        // HEURISTIC: Only use the big terminal block if it has a language 
                        // OR if it's explicitly NOT inline AND contains newlines (actual block)
                        const isActualBlock = !inline && (language || rawCode.includes('\n'));

                        if (isActualBlock && trimmedCode) {
                            // different style for terminals/commands
                            const isTerminal = ['bash', 'sh', 'zsh', 'term'].includes(language);

                            if (isTerminal) {
                                // Terminal commands get a simple black terminal look
                                return (
                                    <div className="my-6 rounded-md overflow-hidden bg-black border-2 border-gray-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] relative">
                                        <div className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 border-b border-gray-800">
                                            <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
                                        </div>
                                        <DocsCodeBlock code={trimmedCode} language={language} isTerminal={true} />
                                    </div>
                                );
                            }

                            return (
                                <div className="my-6">
                                    <DocsCodeBlock code={trimmedCode} language={language} isTerminal={false} />
                                </div>
                            );
                        }

                        // Inline code - make it subtle, not like a code block
                        return (
                            <code className="bg-gray-100/80 text-gray-900 font-mono text-[0.85em] px-1.5 py-0.5 rounded border border-gray-200" {...props}>
                                {children}
                            </code>
                        );
                    },
                    // Style headings with IDs for table of contents
                    h1: ({ children }) => {
                        const id = generateId(String(children));
                        return (
                            <h1 id={id} className="text-4xl font-black text-black mb-6 mt-10 first:mt-0 scroll-mt-32">
                                {children}
                            </h1>
                        );
                    },
                    h2: ({ children }) => {
                        const id = generateId(String(children));
                        return (
                            <h2 id={id} className="text-2xl font-black text-black mb-4 mt-12 scroll-mt-32 border-b-4 border-black pb-2 inline-block">
                                {children}
                            </h2>
                        );
                    },
                    h3: ({ children }) => {
                        const id = generateId(String(children));
                        return (
                            <h3 id={id} className="text-xl font-bold text-black mb-3 mt-8 scroll-mt-32">
                                {children}
                            </h3>
                        );
                    },
                    h4: ({ children }) => {
                        const id = generateId(String(children));
                        return (
                            <h4 id={id} className="text-lg font-bold text-black mb-2 mt-6 scroll-mt-32 uppercase tracking-wide">
                                {children}
                            </h4>
                        );
                    },
                    // Style paragraphs
                    p: ({ children }) => (
                        <p className="text-gray-800 mb-6 leading-relaxed text-base">
                            {children}
                        </p>
                    ),
                    // Style lists
                    ul: ({ children }) => (
                        <ul className="list-disc list-outside ml-6 text-gray-800 space-y-2 mb-6">
                            {children}
                        </ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="list-decimal list-outside ml-6 text-gray-800 space-y-2 mb-6">
                            {children}
                        </ol>
                    ),
                    li: ({ children }) => (
                        <li className="pl-1">
                            {children}
                        </li>
                    ),
                    // Style links
                    a: ({ href, children }) => (
                        <a
                            href={href}
                            className="text-black font-bold underline decoration-2 underline-offset-2 hover:bg-black hover:text-white transition-colors px-0.5 rounded-sm"
                            target={href?.startsWith('http') ? '_blank' : undefined}
                            rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                        >
                            {children}
                        </a>
                    ),
                    // Style images to match docs/engineering visual cards
                    img: ({ src, alt }) => {
                        if (!src) return null;
                        return (
                            <figure className="my-8 border-2 border-black bg-slate-50 overflow-hidden">
                                <img
                                    src={src as string}
                                    alt={alt || 'Documentation image'}
                                    className="w-full h-auto object-cover"
                                    loading="lazy"
                                />
                            </figure>
                        );
                    },
                    // Style blockquotes - handle Alerts
                    blockquote: ({ children }) => {
                        // Regular expression to match the alert tag
                        const alertRegex = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
                        let alertType: string | null = null;

                        // Deeply traverse children to look for the alert tag and strip it
                        const processChildren = (nodes: any): any => {
                            const nodeArray = React.Children.toArray(nodes);

                            // Check if the first node (or its first descendant) contains the tag
                            if (nodeArray.length > 0) {
                                const firstNode = nodeArray[0];

                                if (typeof firstNode === 'string') {
                                    const match = firstNode.match(alertRegex);
                                    if (match) {
                                        alertType = match[1].toLowerCase();
                                        // Remove the tag from this string
                                        const remainingText = firstNode.replace(alertRegex, '').trimStart();
                                        // Replace the original string with the stripped version
                                        const newArray = [...nodeArray];
                                        if (remainingText) {
                                            newArray[0] = remainingText;
                                        } else {
                                            newArray.shift(); // Remove entirely if empty
                                        }
                                        return newArray;
                                    }
                                } else if (React.isValidElement(firstNode) && (firstNode.props as any).children) {
                                    // Recurse into the first node's children
                                    const processedInner = processChildren((firstNode.props as any).children);

                                    // If we found a match during recursion, we need to rebuild this node
                                    if (alertType) {
                                        return [
                                            React.cloneElement(firstNode as React.ReactElement<any>, {}, processedInner),
                                            ...nodeArray.slice(1)
                                        ];
                                    }
                                }
                            }

                            return nodeArray;
                        };

                        const processedChildren = processChildren(children);

                        if (alertType) {
                            const alertStyles = {
                                note: {
                                    bg: 'bg-blue-50',
                                    border: 'border-blue-600',
                                    text: 'text-blue-900',
                                    icon: <Info className="w-5 h-5 text-blue-600 shrink-0" />
                                },
                                tip: {
                                    bg: 'bg-green-50',
                                    border: 'border-green-600',
                                    text: 'text-green-900',
                                    icon: <Lightbulb className="w-5 h-5 text-green-600 shrink-0" />
                                },
                                important: {
                                    bg: 'bg-purple-50',
                                    border: 'border-purple-600',
                                    text: 'text-purple-900',
                                    icon: <Info className="w-5 h-5 text-purple-600 shrink-0" />
                                },
                                warning: {
                                    bg: 'bg-yellow-50',
                                    border: 'border-yellow-600',
                                    text: 'text-yellow-900',
                                    icon: <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0" />
                                },
                                caution: {
                                    bg: 'bg-red-50',
                                    border: 'border-red-600',
                                    text: 'text-red-900',
                                    icon: <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                                }
                            };

                            const style = alertStyles[alertType as keyof typeof alertStyles] || alertStyles.note;

                            return (
                                <div className={cn(
                                    "flex items-start gap-4 p-4 my-6 border-l-4 shadow-sm rounded-r-md transition-all hover:shadow-md",
                                    style.bg,
                                    style.border
                                )}>
                                    <div className="mt-0.5">{style.icon}</div>
                                    <div className={cn("prose-p:my-0 text-base leading-relaxed flex-1", style.text)}>
                                        {processedChildren}
                                    </div>
                                </div>
                            );
                        }

                        // Standard blockquote
                        return (
                            <blockquote className="border-l-4 border-black pl-4 italic text-gray-700 my-6 bg-gray-50 py-4 pr-4 rounded-r-md">
                                {children}
                            </blockquote>
                        );
                    },
                    // Style tables
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-8 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                            <table className="min-w-full text-left text-sm">
                                {children}
                            </table>
                        </div>
                    ),
                    thead: ({ children }) => (
                        <thead className="bg-gray-100 border-b-2 border-black text-black uppercase tracking-wider font-bold">
                            {children}
                        </thead>
                    ),
                    th: ({ children }) => (
                        <th className="px-6 py-4 font-black text-black">
                            {children}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td className="px-6 py-4 border-t border-gray-200 text-gray-700">
                            {children}
                        </td>
                    ),
                    // Style horizontal rules
                    hr: () => (
                        <hr className="my-10 border-t-2 border-black" />
                    ),
                    // Style strong/bold
                    strong: ({ children }) => (
                        <strong className="font-black text-black">
                            {children}
                        </strong>
                    ),
                }}
            >
                {processedContent}
            </ReactMarkdown>

        </div>
    );
}
