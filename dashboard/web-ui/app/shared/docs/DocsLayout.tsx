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
            <Header noSpacer />
            <div
                className="relative flex flex-1 min-h-[calc(100vh-64px)] w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-clip"
                dir={contentDir}
                lang={contentLang}
            >
                {sidebar}

                <main className="relative z-10 flex-1 min-w-0 pt-24">
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
