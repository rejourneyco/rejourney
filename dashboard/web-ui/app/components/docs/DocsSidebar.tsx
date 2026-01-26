import { useLocation, Link } from "react-router";
import { cn } from "~/lib/cn";
import { ChevronDown, ChevronRight, Hash } from "lucide-react";
import { useState, useEffect } from "react";
import { getAllDocs } from "~/utils/docsConfig";

type NavLink = { label: string; href: string; isRoute?: boolean };
type NavSection = { title: string; links: NavLink[] };
type NavCategory = { category: string; sections: NavSection[] };

// Get markdown-based docs
const markdownDocs = getAllDocs();
const selfhostedDocs = markdownDocs.filter(doc => doc.category === 'Self-Hosting');
const devDocs = markdownDocs.filter(doc => doc.category === 'Development');
const archDocs = markdownDocs.filter(doc => doc.category === 'Architecture');

const NAVIGATION: NavCategory[] = [
    {
        category: "React Native",
        sections: [
            {
                title: "Getting Started",
                links: [
                    { label: "Overview", href: "/docs/reactnative/overview", isRoute: true },
                    { label: "Installation", href: "/docs/reactnative/overview#installation", isRoute: false },
                    { label: "3 Line Setup", href: "/docs/reactnative/overview#3-line-setup", isRoute: false },
                    { label: "Screen Tracking", href: "/docs/reactnative/overview#screen-tracking", isRoute: false },
                    { label: "User Identification", href: "/docs/reactnative/overview#user-identification", isRoute: false },
                    { label: "Privacy Controls", href: "/docs/reactnative/overview#privacy-controls", isRoute: false },
                ]
            }
        ]
    },
    // Add Self-Hosting category if there are selfhosted docs
    ...(selfhostedDocs.length > 0 ? [{
        category: "Self-Hosting",
        sections: [
            {
                title: "Documentation",
                links: selfhostedDocs.map(doc => ({
                    label: doc.title,
                    href: `/docs/${doc.path}`,
                    isRoute: true,
                }))
            }
        ]
    }] : []),
    // Add Development category if there are dev docs
    ...(devDocs.length > 0 ? [{
        category: "Development",
        sections: [
            {
                title: "Contributing",
                links: devDocs.map(doc => ({
                    label: doc.title,
                    href: `/docs/${doc.path}`,
                    isRoute: true,
                }))
            }
        ]
    }] : []),
    // Add Architecture category if there are arch docs
    ...(archDocs.length > 0 ? [{
        category: "Architecture",
        sections: [
            {
                title: "Internal Architecture",
                links: archDocs.map(doc => ({
                    label: doc.title,
                    href: `/docs/${doc.path}`,
                    isRoute: true,
                }))
            }
        ]
    }] : [])
];

export function DocsSidebar({ className }: { className?: string }) {
    const location = useLocation();
    const [expandedCategories, setExpandedCategories] = useState<string[]>(["React Native", "Self-Hosting", "Development", "Architecture"]);
    const [activeHash, setActiveHash] = useState<string>("");

    // Scroll Spy implementation
    useEffect(() => {
        const handleScroll = () => {
            const headings = document.querySelectorAll('h1[id], h2[id], h3[id]');
            let currentActiveId = "";

            headings.forEach((heading) => {
                const rect = heading.getBoundingClientRect();
                // Check if heading is near the top of the viewport (with some offset)
                if (rect.top >= 0 && rect.top <= 200) {
                    currentActiveId = heading.id;
                } else if (rect.top < 0) {
                    // If heading scrolled past, it might still be the active section 
                    // (keep checking, the last one scrolled past is the active one)
                    currentActiveId = heading.id;
                }
            });

            // If we found an active ID, update state
            if (currentActiveId) {
                setActiveHash(currentActiveId);
            } else if (window.scrollY < 100) {
                // At the very top
                setActiveHash("");
            }
        };

        // Run once on mount and attach listener
        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => window.removeEventListener("scroll", handleScroll);
    }, [location.pathname]);

    // Update active hash if URL hash changes via click
    useEffect(() => {
        if (location.hash) {
            setActiveHash(location.hash.replace('#', ''));
        }
    }, [location.hash]);

    const isActive = (href: string, isRoute?: boolean) => {
        const pathname = location.pathname;

        if (isRoute) {
            // Fix: remove trailing slashes for comparison
            const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
            const normalizedHref = href.endsWith('/') ? href.slice(0, -1) : href;

            // Exact match for /docs (Overview) - ONLY if it's exactly /docs with no hash
            if (normalizedHref === '/docs') {
                return normalizedPath === '/docs' && !location.hash;
            }

            // For sub-routes (e.g. /docs/selfhosted)
            // We want exact matches for routes to avoid "Overview" staying active
            if (normalizedHref.startsWith('/docs/')) {
                return normalizedPath === normalizedHref;
            }

            // For root routes like /contribute
            return normalizedPath === normalizedHref;
        } else {
            // For hash links - check if we're on the right page and hash matches
            if (href.includes('#')) {
                const [path, hash] = href.split('#');
                // Must be on the correct page
                // Fix: remove trailing slashes for comparison
                const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
                const normalizedLinkPath = path.endsWith('/') ? path.slice(0, -1) : path;

                if (normalizedPath !== normalizedLinkPath) {
                    return false;
                }
                // Check against the scroll-spy active hash
                return activeHash === hash;
            }
            return false;
        }
    };

    const toggleCategory = (category: string) => {
        setExpandedCategories(prev =>
            prev.includes(category)
                ? prev.filter(c => c !== category)
                : [...prev, category]
        );
    };

    return (
        <aside className={cn("w-64 flex-shrink-0 border-r-2 border-black h-[calc(100vh-64px)] overflow-y-auto sticky top-[64px] hidden md:block bg-[#f4f4f5]", className)}>
            <div className="p-6">
                {NAVIGATION.map((cat) => (
                    <div key={cat.category} className="mb-6 last:mb-0">
                        {/* Category Header */}
                        <button
                            onClick={() => toggleCategory(cat.category)}
                            className="w-full flex items-center justify-between py-2 text-sm font-bold text-black border-b-2 border-black mb-3 hover:bg-white hover:pl-2 transition-all uppercase tracking-wide group"
                        >
                            <span>{cat.category}</span>
                            {expandedCategories.includes(cat.category)
                                ? <ChevronDown size={14} className="group-hover:translate-y-0.5 transition-transform" />
                                : <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                            }
                        </button>

                        {/* Sections */}
                        {expandedCategories.includes(cat.category) && (
                            <div className="space-y-4">
                                {cat.sections.map((section) => (
                                    <div key={section.title}>
                                        <h4 className="px-2 py-1 text-xs font-black text-gray-500 uppercase tracking-wider mb-1">
                                            {section.title}
                                        </h4>
                                        <nav className="space-y-0.5">
                                            {section.links.map((link) => {
                                                const active = isActive(link.href, link.isRoute);

                                                const LinkContent = (
                                                    <span className="flex items-center">
                                                        {!link.isRoute && <Hash size={10} className="mr-1.5 opacity-50" />}
                                                        {link.label}
                                                    </span>
                                                );

                                                const className = cn(
                                                    "block px-3 py-1.5 text-sm transition-all border border-transparent rounded-sm",
                                                    active
                                                        ? "text-black font-bold bg-white border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-1"
                                                        : "text-gray-600 hover:text-black hover:bg-gray-200 hover:border-gray-300"
                                                );

                                                if (link.isRoute) {
                                                    return (
                                                        <Link
                                                            key={link.href}
                                                            to={link.href}
                                                            className={className}
                                                        >
                                                            {LinkContent}
                                                        </Link>
                                                    );
                                                } else {
                                                    return (
                                                        <a
                                                            key={link.href}
                                                            href={link.href}
                                                            className={className}
                                                            onClick={(e) => {
                                                                // If on same page, smooth scroll
                                                                if (location.pathname === link.href.split('#')[0]) {
                                                                    e.preventDefault();
                                                                    const hash = link.href.split('#')[1];
                                                                    const el = document.getElementById(hash);
                                                                    if (el) {
                                                                        el.scrollIntoView({ behavior: 'smooth' });
                                                                        window.history.pushState(null, '', `#${hash}`);
                                                                        setActiveHash(hash);
                                                                    }
                                                                }
                                                            }}
                                                        >
                                                            {LinkContent}
                                                        </a>
                                                    );
                                                }
                                            })}
                                        </nav>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </aside>
    );
}
