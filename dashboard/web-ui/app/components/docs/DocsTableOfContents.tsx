import { useEffect, useState } from "react";
import { cn } from "~/lib/cn";

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
        <div className="hidden xl:block w-64 flex-shrink-0 border-l border-gray-200 bg-white min-h-[calc(100vh-64px)] sticky top-[64px]">
            <div className="p-6">
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4">
                    On This Page
                </h4>
                <nav className="space-y-1">
                    {sections.map((section) => (
                        <a
                            key={section.id}
                            href={`#${section.id}`}
                            className={cn(
                                "block text-sm py-1 transition-colors border-l-2 pl-3",
                                activeId === section.id
                                    ? "border-black text-black font-medium"
                                    : "border-transparent text-gray-500 hover:text-gray-900"
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
