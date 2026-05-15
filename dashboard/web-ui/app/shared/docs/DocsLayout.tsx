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
        <div className="public-readable-scope min-h-screen bg-white flex flex-col font-sans">
            <Header />
            <div
                className="flex flex-1 min-h-[calc(100vh-64px)] w-full mx-auto border-t border-gray-200"
                dir={contentDir}
                lang={contentLang}
            >
                {sidebar}

                <main className="flex-1 min-w-0 bg-white">
                    <div className="max-w-4xl mx-auto px-8 py-12 md:px-16">
                        {children}
                    </div>
                </main>

                {toc}
            </div>
            <Footer />
        </div>
    );
}
