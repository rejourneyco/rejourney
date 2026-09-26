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
        <div className="relative z-20 hidden w-64 flex-shrink-0 border-l border-[#dadce0] bg-transparent min-h-[calc(100vh-64px)] sticky top-[64px] xl:block">
            <div className="p-6">
                <h4 className="mb-3 px-2 py-1 text-xs font-medium uppercase tracking-wider text-[#5f6368]">
                    On This Page
                </h4>
                <nav className="space-y-1">
                    {sections.map((section) => (
                        <a
                            key={section.id}
                            href={`#${section.id}`}
                            className={cn(
                                "block border-l-2 py-1.5 pl-3 text-sm transition-colors rounded-none",
                                activeId === section.id
                                    ? "border-l-[#1a73e8] text-[#1967d2] font-medium bg-[#e8f0fe]/60"
                                    : "border-l-transparent text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4]"
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
