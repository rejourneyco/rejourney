import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocsCodeBlock } from "~/shared/docs/DocsCodeBlock";
import { createMarkdownHeadingIdGenerator } from "~/shared/lib/markdownHeadings";

export function EngineeringMarkdownContent({ content }: { content: string }) {
    const getHeadingId = createMarkdownHeadingIdGenerator();
    const paragraphClassName = "text-[1.0625rem] leading-8 text-slate-700";
    const hasImageChild = (node: any) => (
        Array.isArray(node?.children)
        && node.children.some((child: any) => child?.tagName === "img")
    );

    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                pre: ({ children }) => <>{children}</>,
                code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || "");
                    const language = match ? match[1] : "";
                    const rawCode = String(children).replace(/\n$/, "");
                    const trimmedCode = rawCode.trim();
                    const isBlock = !inline && (language || rawCode.includes("\n"));

                    if (isBlock && trimmedCode) {
                        const isTerminal = ["bash", "sh", "zsh", "term"].includes(language);
                        return (
                            <div className="my-9 overflow-hidden rounded-md border border-slate-800 bg-slate-950 shadow-sm">
                                {isTerminal && (
                                    <div className="flex items-center gap-1.5 border-b border-slate-800 bg-slate-900 px-4 py-2">
                                        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                                        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
                                        <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
                                    </div>
                                )}
                                <DocsCodeBlock code={trimmedCode} language={language} isTerminal={isTerminal} />
                            </div>
                        );
                    }

                    return (
                        <code className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] font-semibold text-slate-950" {...props}>
                            {children}
                        </code>
                    );
                },
                h2: ({ children }) => {
                    const text = String(children);
                    return (
                        <h2 id={getHeadingId(text)} className="scroll-mt-28 border-t border-slate-200 pt-10 font-display text-3xl font-bold leading-tight tracking-normal text-slate-950">
                            {children}
                        </h2>
                    );
                },
                h3: ({ children }) => {
                    const text = String(children);
                    return (
                        <h3 id={getHeadingId(text)} className="scroll-mt-28 font-display text-2xl font-bold leading-tight tracking-normal text-slate-950">
                            {children}
                        </h3>
                    );
                },
                h4: ({ children }) => (
                    <h4 className="text-lg font-bold tracking-normal text-slate-950">
                        {children}
                    </h4>
                ),
                p: ({ node, children }: any) => (
                    hasImageChild(node)
                        ? <div className={paragraphClassName}>{children}</div>
                        : <p className={paragraphClassName}>{children}</p>
                ),
                ul: ({ children }) => (
                    <ul className="ml-6 list-outside list-disc space-y-3 text-[1.0625rem] leading-8 text-slate-700">
                        {children}
                    </ul>
                ),
                ol: ({ children }) => (
                    <ol className="ml-6 list-outside list-decimal space-y-3 text-[1.0625rem] leading-8 text-slate-700">
                        {children}
                    </ol>
                ),
                li: ({ children }) => <li className="pl-1">{children}</li>,
                a: ({ href, children }) => (
                    <a
                        href={href}
                        className="font-semibold text-sky-700 underline decoration-sky-200 decoration-2 underline-offset-4 transition hover:text-sky-900 hover:decoration-sky-700"
                        target={href?.startsWith("http") ? "_blank" : undefined}
                        rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
                    >
                        {children}
                    </a>
                ),
                blockquote: ({ children }) => (
                    <blockquote className="my-9 border-l-4 border-sky-300 bg-slate-50 py-4 pl-5 pr-5 text-slate-700">
                        {children}
                    </blockquote>
                ),
                img: ({ src, alt }) => {
                    if (!src) return null;
                    return (
                        <figure className="my-10 overflow-hidden rounded-md border border-slate-200 bg-slate-50 shadow-sm">
                            <img src={src} alt={alt ?? ""} className="mx-auto h-auto max-h-[760px] max-w-full object-contain" loading="lazy" />
                            {alt && <figcaption className="border-t border-slate-200 px-4 py-3 text-sm font-medium text-slate-500">{alt}</figcaption>}
                        </figure>
                    );
                },
                table: ({ children }) => (
                    <div className="my-10 overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
                        <table className="min-w-full border-collapse bg-white text-left text-sm">
                            {children}
                        </table>
                    </div>
                ),
                thead: ({ children }) => (
                    <thead className="border-b border-slate-200 bg-slate-100 text-xs font-bold tracking-normal text-slate-950">
                        {children}
                    </thead>
                ),
                th: ({ children }) => <th className="px-4 py-3 align-top">{children}</th>,
                td: ({ children }) => <td className="border-t border-slate-200 px-4 py-3 align-top text-slate-700">{children}</td>,
                hr: () => <hr className="my-12 border-t border-slate-200" />,
                strong: ({ children }) => <strong className="font-bold text-slate-950">{children}</strong>,
            }}
        >
            {content}
        </ReactMarkdown>
    );
}
