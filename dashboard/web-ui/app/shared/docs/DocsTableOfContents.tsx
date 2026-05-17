import { useEffect, useState } from "react";
import { cn } from "~/shared/lib/cn";

interface Section {
    id: string;
    title: string;
}

export function DocsTableOfContents({ sections }: { sections: Section[] }) {
    const [activeId, setActiveId] = useState<string>("");

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setActiveId(entry.target.id);
                    }
                });
            },
            { rootMargin: "0% 0% -80% 0%" }
        );

        sections.forEach(({ id }) => {
            const element = document.getElementById(id);
            if (element) observer.observe(element);
        });

        return () => observer.disconnect();
    }, [sections]);

    return (
        <div className="relative z-20 hidden w-64 flex-shrink-0 border-l-2 border-black bg-white/95 min-h-[calc(100vh-64px)] sticky top-[64px] xl:block">
            <div className="p-6">
                <h4 className="mb-4 inline-flex border-2 border-black bg-[#bbf7d0] px-2 py-1 text-xs font-black uppercase tracking-normal text-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                    On This Page
                </h4>
                <nav className="space-y-1">
                    {sections.map((section) => (
                        <a
                            key={section.id}
                            href={`#${section.id}`}
                            className={cn(
                                "block border-l-2 py-1.5 pl-3 text-sm font-semibold transition-colors",
                                activeId === section.id
                                    ? "border-black text-black bg-slate-50"
                                    : "border-transparent text-slate-500 hover:text-slate-900"
                            )}
                        >
                            {section.title}
                        </a>
                    ))}
                </nav>
            </div>
        </div>
    );
}
