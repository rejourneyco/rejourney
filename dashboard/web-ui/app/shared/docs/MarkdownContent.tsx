/**
 * Component to render markdown content with proper styling
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocsCodeBlock } from '~/shared/docs/DocsCodeBlock';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Info, AlertTriangle, XCircle, Lightbulb, Code2 } from 'lucide-react';
import { cn } from "~/shared/lib/cn";

interface MarkdownContentProps {
    content: string;
    onAIPromptRender?: (renderPrompt: () => React.JSX.Element) => void;
    showAIPrompt?: boolean;
    aiPromptLabels?: DocsAIPromptLabels;
    checklistStorageKey?: string;
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

type CopyTextResolver = string | (() => string | Promise<string>);

const defaultAIPromptLabels: DocsAIPromptLabels = {
    heading: "Use AI to integrate faster",
    copyButton: "Copy Integration Prompt",
    copied: "Copied!",
};

const CHECKLIST_STORAGE_PREFIX = "rejourney_docs_checklist:";

export function DocsAIPromptCallout({
    promptText,
    copyText,
    compact = false,
    labels = defaultAIPromptLabels,
}: {
    promptText: string;
    copyText?: CopyTextResolver;
    compact?: boolean;
    labels?: DocsAIPromptLabels;
}) {
    const [promptCopied, setPromptCopied] = useState(false);

    const handleCopyPrompt = async () => {
        try {
            const resolvedCopyText = typeof copyText === "function" ? await copyText() : copyText;
            await navigator.clipboard.writeText(resolvedCopyText ?? promptText);
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <div className={cn(
            "border border-emerald-100 bg-emerald-50/60 p-5 rounded-2xl shadow-sm dark:bg-emerald-950/20 dark:border-emerald-900/30",
            compact ? "p-4" : "p-6"
        )}>
            <p className={cn(
                "flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300",
                compact ? "mb-2 text-sm" : "mb-4 text-lg"
            )}>
                <Code2 className="h-4 w-4 shrink-0" />
                {labels.heading}
            </p>
            <p className={cn(
                "font-medium leading-relaxed text-emerald-700/95 dark:text-emerald-400/90",
                compact ? "mb-3 text-sm" : "mb-6 text-base"
            )}>
                {promptText}
            </p>
            <button
                onClick={handleCopyPrompt}
                className={cn(
                    "inline-flex items-center justify-center font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors rounded-lg shadow-sm",
                    compact ? "px-4 py-2 text-sm" : "px-5 py-2.5"
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

export function MarkdownContent({
    content,
    onAIPromptRender,
    showAIPrompt = true,
    aiPromptLabels,
    checklistStorageKey,
}: MarkdownContentProps) {
    // Check if content has AI prompt section
    const hasAIPrompt = content.includes(AI_PROMPT_START_MARKER);

    // Extract AI prompt section
    const processedContent = stripDocsAIPromptSection(content);
    const aiPromptSection = getDocsAIPromptText(content);
    const checklistLocalStorageKey = useMemo(() => {
        if (!checklistStorageKey) return null;
        return `${CHECKLIST_STORAGE_PREFIX}${checklistStorageKey}`;
    }, [checklistStorageKey]);
    const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});
    const [isChecklistReady, setIsChecklistReady] = useState(false);

    useEffect(() => {
        setIsChecklistReady(false);

        if (!checklistLocalStorageKey || typeof window === "undefined") {
            setChecklistState({});
            setIsChecklistReady(true);
            return;
        }

        try {
            const stored = window.localStorage.getItem(checklistLocalStorageKey);
            const parsed = stored ? JSON.parse(stored) : {};
            setChecklistState(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
        } catch {
            setChecklistState({});
        }

        setIsChecklistReady(true);
    }, [checklistLocalStorageKey]);

    const persistChecklistState = useCallback((nextState: Record<string, boolean>) => {
        if (!checklistLocalStorageKey || typeof window === "undefined") return;

        try {
            window.localStorage.setItem(checklistLocalStorageKey, JSON.stringify(nextState));
        } catch {
            // localStorage can be unavailable in private browsing or locked-down embeds.
        }
    }, [checklistLocalStorageKey]);

    // Render AI prompt section if present
    const renderAIPromptSection = () => {
        return (
            <section className="mb-12 pb-8 border-b border-slate-200">
                <DocsAIPromptCallout promptText={aiPromptSection ?? ""} labels={aiPromptLabels} />
            </section>
        );
    };

    // Notify parent about AI prompt renderer if callback provided
    if (onAIPromptRender && aiPromptSection) {
        onAIPromptRender(renderAIPromptSection);
    }

    let checkboxFallbackIndex = 0;

    return (
        <article className="border border-slate-200 bg-white px-5 py-8 shadow-sm rounded-2xl sm:px-8 sm:py-10 lg:px-12">
            <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-700 prose-a:text-indigo-600 prose-code:text-slate-800 prose-code:bg-slate-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
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
                                    <div className="my-6 rounded-lg overflow-hidden bg-black border border-gray-800 shadow-sm relative">
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
                            <h2 id={id} className="text-3xl font-extrabold text-slate-900 mb-6 mt-10 first:mt-0 scroll-mt-32">
                                {children}
                            </h2>
                        );
                    },
                    h2: ({ children }) => {
                        const id = generateId(String(children));
                        return (
                            <h2 id={id} className="scroll-mt-32 border-b border-slate-200 pb-2 mt-12 mb-4 text-2xl font-bold text-slate-800">
                                {children}
                            </h2>
                        );
                    },
                    h3: ({ children }) => {
                        const id = generateId(String(children));
                        return (
                            <h3 id={id} className="text-xl font-bold text-slate-800 mb-3 mt-8 scroll-mt-32">
                                {children}
                            </h3>
                        );
                    },
                    h4: ({ children }) => {
                        const id = generateId(String(children));
                        return (
                            <h4 id={id} className="text-lg font-bold text-slate-700 mb-2 mt-6 scroll-mt-32 uppercase tracking-wide">
                                {children}
                            </h4>
                        );
                    },
                    // Style paragraphs
                    p: ({ children }) => (
                        <p className="mb-6 text-base leading-relaxed text-slate-600">
                            {children}
                        </p>
                    ),
                    // Style lists
                    ul: ({ children }) => (
                        <ul className="mb-6 ml-6 list-outside list-disc space-y-2 text-slate-600">
                            {children}
                        </ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="mb-6 ml-6 list-outside list-decimal space-y-2 text-slate-600">
                            {children}
                        </ol>
                    ),
                    li: ({ node, children }: any) => {
                        const isTaskListItem = typeof node?.checked === "boolean";

                        return (
                            <li className={cn(
                                "pl-1",
                                isTaskListItem && "list-none pl-0"
                            )}>
                                {children}
                            </li>
                        );
                    },
                    input: ({ node, type, checked, ...props }: any) => {
                        if (type !== "checkbox") {
                            return <input type={type} {...props} />;
                        }

                        const start = node?.position?.start;
                        const itemKey = start
                            ? `${start.line}:${start.column}`
                            : `checkbox-${checkboxFallbackIndex++}`;
                        const fallbackChecked = Boolean(checked);
                        const isChecked = checklistState[itemKey] ?? fallbackChecked;

                        return (
                            <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!isChecklistReady}
                                onChange={(event) => {
                                    const nextChecked = event.currentTarget.checked;
                                    setChecklistState((previous) => {
                                        const nextState = {
                                            ...previous,
                                            [itemKey]: nextChecked,
                                        };
                                        persistChecklistState(nextState);
                                        return nextState;
                                    });
                                }}
                                className="mr-3 mt-1 h-4 w-4 cursor-pointer accent-indigo-600 disabled:cursor-wait disabled:opacity-60 rounded"
                                aria-label="Toggle checklist item"
                            />
                        );
                    },
                    // Style links
                    a: ({ href, children }) => (
                        <a
                            href={href}
                            className="text-indigo-600 dark:text-indigo-400 font-semibold underline decoration-1 underline-offset-4 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
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
                            <figure className="my-8 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
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
                                    bg: 'bg-blue-50/60 dark:bg-blue-950/20',
                                    border: 'border border-blue-100 dark:border-blue-900/30 border-l-4 border-l-blue-600',
                                    text: 'text-blue-800 dark:text-blue-300',
                                    icon: <Info className="w-5 h-5 text-blue-600 shrink-0" />
                                },
                                tip: {
                                    bg: 'bg-emerald-50/60 dark:bg-emerald-950/20',
                                    border: 'border border-emerald-100 dark:border-emerald-900/30 border-l-4 border-l-emerald-600',
                                    text: 'text-emerald-800 dark:text-emerald-300',
                                    icon: <Lightbulb className="w-5 h-5 text-emerald-600 shrink-0" />
                                },
                                important: {
                                    bg: 'bg-purple-50/60 dark:bg-purple-950/20',
                                    border: 'border border-purple-100 dark:border-purple-900/30 border-l-4 border-l-purple-600',
                                    text: 'text-purple-800 dark:text-purple-300',
                                    icon: <Info className="w-5 h-5 text-purple-600 shrink-0" />
                                },
                                warning: {
                                    bg: 'bg-amber-50/60 dark:bg-amber-950/20',
                                    border: 'border border-amber-100 dark:border-amber-900/30 border-l-4 border-l-amber-500',
                                    text: 'text-amber-800 dark:text-amber-300',
                                    icon: <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                                },
                                caution: {
                                    bg: 'bg-red-50/60 dark:bg-red-950/20',
                                    border: 'border border-red-100 dark:border-red-900/30 border-l-4 border-l-red-600',
                                    text: 'text-red-800 dark:text-red-300',
                                    icon: <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                                }
                            };

                            const style = alertStyles[alertType as keyof typeof alertStyles] || alertStyles.note;

                            return (
                                <div className={cn(
                                    "flex items-start gap-4 p-4 my-6 rounded-r-xl transition-all shadow-sm",
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
                            <blockquote className="my-6 border-l-4 border-slate-300 bg-slate-50/60 py-4 pl-4 pr-4 text-slate-600 rounded-r-lg italic">
                                {children}
                            </blockquote>
                        );
                    },
                    // Style tables
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-8 rounded-xl border border-slate-200 bg-white shadow-sm">
                            <table className="min-w-full bg-white text-left text-sm">
                                {children}
                            </table>
                        </div>
                    ),
                    thead: ({ children }) => (
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-900 uppercase tracking-wider font-bold">
                            {children}
                        </thead>
                    ),
                    th: ({ children }) => (
                        <th className="px-6 py-4 font-bold text-slate-800">
                            {children}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td className="px-6 py-4 border-t border-slate-200 text-slate-600">
                            {children}
                        </td>
                    ),
                    // Style horizontal rules
                    hr: () => (
                        <hr className="my-10 border-t border-slate-200" />
                    ),
                    // Style strong/bold
                    strong: ({ children }) => (
                        <strong className="font-bold text-slate-900">
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
