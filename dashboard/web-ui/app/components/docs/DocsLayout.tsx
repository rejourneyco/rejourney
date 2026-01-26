import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";
import { ReactNode } from "react";

interface DocsLayoutProps {
    children: ReactNode;
    sidebar: ReactNode;
    toc?: ReactNode;
}

export function DocsLayout({ children, sidebar, toc }: DocsLayoutProps) {
    return (
        <div className="min-h-screen bg-white flex flex-col font-sans">
            <Header />
            <div className="flex flex-1 w-full mx-auto border-t border-gray-200">
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
