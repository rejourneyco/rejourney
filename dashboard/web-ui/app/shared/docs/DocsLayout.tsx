import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { ReactNode } from "react";

interface DocsLayoutProps {
    children: ReactNode;
    sidebar: ReactNode;
    toc?: ReactNode;
    contentDir?: "ltr" | "rtl";
    contentLang?: string;
}

export function DocsLayout({ children, sidebar, toc, contentDir, contentLang }: DocsLayoutProps) {
    return (
        <div className="public-readable-scope min-h-screen bg-[#f8fafc] flex flex-col font-sans text-slate-950">
            <Header />
            <div
                className="relative flex flex-1 min-h-[calc(100vh-64px)] w-full mx-auto overflow-x-clip border-t border-slate-200"
                dir={contentDir}
                lang={contentLang}
            >
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:32px_32px]" aria-hidden="true" />
                <div className="pointer-events-none absolute -left-16 top-14 h-24 w-56 -rotate-6 border-2 border-black bg-[#fff08a] opacity-80 shadow-[6px_6px_0_0_rgba(0,0,0,1)]" aria-hidden="true" />
                <div className="pointer-events-none absolute -right-20 top-28 h-20 w-52 rotate-6 border-2 border-black bg-[#bbf7d0] opacity-80 shadow-[6px_6px_0_0_rgba(0,0,0,1)]" aria-hidden="true" />
                {sidebar}

                <main className="relative z-10 flex-1 min-w-0">
                    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:px-10 lg:px-14 lg:py-12">
                        {children}
                    </div>
                </main>

                {toc}
            </div>
            <Footer />
        </div>
    );
}
