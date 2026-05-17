/**
 * Component to render markdown content with proper styling
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocsCodeBlock } from '~/shared/docs/DocsCodeBlock';
import React, { useState } from 'react';
import { Check, Info, AlertTriangle, XCircle, Lightbulb, Code2 } from 'lucide-react';
import { AI_INTEGRATION_PROMPT } from '~/shared/constants/aiPrompts';
import { cn } from "~/shared/lib/cn";

interface MarkdownContentProps {
    content: string;
    onAIPromptRender?: (renderPrompt: () => React.JSX.Element) => void;
    showAIPrompt?: boolean;
    aiPromptLabels?: DocsAIPromptLabels;
}

const AI_PROMPT_START_MARKER = '<!-- AI_PROMPT_SECTION -->';
const AI_PROMPT_END_MARKER = '<!-- /AI_PROMPT_SECTION -->';

export function getDocsAIPromptText(content: string): string | null {
    const startIdx = content.indexOf(AI_PROMPT_START_MARKER);
    const endIdx = content.indexOf(AI_PROMPT_END_MARKER);

    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return null;
    }

    return content
        .substring(startIdx + AI_PROMPT_START_MARKER.length, endIdx)
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .trim();
}

export function stripDocsAIPromptSection(content: string): string {
    const startIdx = content.indexOf(AI_PROMPT_START_MARKER);
    const endIdx = content.indexOf(AI_PROMPT_END_MARKER);

    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return content;
    }

    return content.substring(0, startIdx) + content.substring(endIdx + AI_PROMPT_END_MARKER.length);
}

type DocsAIPromptLabels = {
    heading: string;
    copyButton: string;
    copied: string;
};

const defaultAIPromptLabels: DocsAIPromptLabels = {
    heading: "Use AI to integrate faster",
    copyButton: "Copy Integration Prompt",
    copied: "Copied!",
};

export function DocsAIPromptCallout({
    promptText,
    compact = false,
    labels = defaultAIPromptLabels,
}: {
    promptText: string;
    compact?: boolean;
    labels?: DocsAIPromptLabels;
}) {
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

    return (
        <div className={cn(
            "border-2 border-black bg-[#bbf7d0] shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]",
            compact ? "p-4" : "p-6"
        )}>
            <p className={cn(
                "flex items-center gap-2 font-black text-slate-900",
                compact ? "mb-2 text-sm" : "mb-4 text-lg"
            )}>
                <Code2 className="h-4 w-4 shrink-0" />
                {labels.heading}
            </p>
            <p className={cn(
                "font-medium leading-relaxed text-slate-800",
                compact ? "mb-3 text-sm" : "mb-6 text-base"
            )}>
                {promptText}
            </p>
            <button
                onClick={handleCopyPrompt}
                className={cn(
                    "bg-black font-bold text-white shadow-[4px_4px_0px_0px_rgba(100,100,100,1)] transition-colors hover:bg-gray-800 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none",
                    compact ? "px-4 py-2 text-sm" : "px-6 py-3"
                )}
            >
                {promptCopied ? labels.copied : labels.copyButton}
            </button>
        </div>
    );
}

const canonicalHeadingIds: Record<string, string> = {
    Installation: "installation",
    Instalación: "installation",
    التثبيت: "installation",
    تثبيت: "installation",
    Kurulum: "installation",
    "Basic Setup": "basic-setup",
    "Configuración básica": "basic-setup",
    "الإعداد الأساسي": "basic-setup",
    "Temel kurulum": "basic-setup",
    "Temel Kurulum": "basic-setup",
    "Route Tracking": "route-tracking",
    "Seguimiento de rutas": "route-tracking",
    "Seguimiento de ruta": "route-tracking",
    "تتبع المسارات": "route-tracking",
    "تتبع الطريق": "route-tracking",
    "Rota Takibi": "route-tracking",
    "User Identification": "user-identification",
    "Identificación de usuarios": "user-identification",
    "Identificación de usuario": "user-identification",
    "تعريف المستخدم": "user-identification",
    "تحديد هوية المستخدم": "user-identification",
    "Kullanıcı kimliği": "user-identification",
    "Kullanıcı Kimliği": "user-identification",
    "Custom Events": "custom-events",
    "Eventos personalizados": "custom-events",
    "الأحداث المخصصة": "custom-events",
    "Özel Etkinlikler": "custom-events",
    "Metadata": "metadata",
    Metadatos: "metadata",
    "البيانات الوصفية": "metadata",
    "Meta veriler": "metadata",
    "Privacy Controls": "privacy-controls",
    "Controles de privacidad": "privacy-controls",
    "عناصر التحكم بالخصوصية": "privacy-controls",
    "ضوابط الخصوصية": "privacy-controls",
    "Gizlilik kontrolleri": "privacy-controls",
    "Gizlilik Kontrolleri": "privacy-controls",
};

// Helper to generate ID from heading text
function generateId(text: string): string {
    const normalizedText = String(text).replace(/\s+/g, " ").trim();
    const canonicalId = canonicalHeadingIds[normalizedText];

    if (canonicalId) {
        return canonicalId;
    }

    return normalizedText
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
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

export function MarkdownContent({ content, onAIPromptRender, showAIPrompt = true, aiPromptLabels }: MarkdownContentProps) {
    // Check if content has AI prompt section
    const hasAIPrompt = content.includes(AI_PROMPT_START_MARKER);

    // Extract AI prompt section
    const processedContent = stripDocsAIPromptSection(content);
    const aiPromptSection = getDocsAIPromptText(content);

    // Render AI prompt section if present
    const renderAIPromptSection = () => {
        return (
            <section className="mb-12 pb-8 border-b-2 border-black">
                <DocsAIPromptCallout promptText={aiPromptSection ?? ""} labels={aiPromptLabels} />
            </section>
        );
    };

    // Notify parent about AI prompt renderer if callback provided
    if (onAIPromptRender && aiPromptSection) {
        onAIPromptRender(renderAIPromptSection);
    }

    return (
        <article className="border-2 border-black bg-white px-5 py-7 shadow-[8px_8px_0_0_rgba(0,0,0,1)] sm:px-8 sm:py-9 lg:px-10">
            <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-black prose-p:text-gray-800 prose-a:text-blue-600 prose-code:text-gray-700 prose-code:bg-gray-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                {aiPromptSection && showAIPrompt && renderAIPromptSection()}
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        pre: ({ children }) => <>{children}</>,
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
                            <h2 id={id} className="inline-flex scroll-mt-32 border-b-4 border-black pb-2 mt-12 mb-4 text-2xl font-black text-black">
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
                        <p className="mb-6 text-base leading-relaxed text-slate-700">
                            {children}
                        </p>
                    ),
                    // Style lists
                    ul: ({ children }) => (
                        <ul className="mb-6 ml-6 list-outside list-disc space-y-2 text-slate-700">
                            {children}
                        </ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="mb-6 ml-6 list-outside list-decimal space-y-2 text-slate-700">
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
                            <figure className="my-8 overflow-hidden border-2 border-black bg-slate-50 shadow-[5px_5px_0_0_rgba(0,0,0,1)]">
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
                                    "flex items-start gap-4 p-4 my-6 border-2 border-l-8 border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)] transition-all",
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
                            <blockquote className="my-6 border-l-4 border-black bg-slate-50 py-4 pl-4 pr-4 text-slate-700 italic">
                                {children}
                            </blockquote>
                        );
                    },
                    // Style tables
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-8 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                            <table className="min-w-full bg-white text-left text-sm">
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
        </article>
    );
}
