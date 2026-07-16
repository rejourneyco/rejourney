import { useLocation, Link } from "react-router";
import { cn } from "~/shared/lib/cn";
import { ChevronDown, ChevronRight, Hash } from "lucide-react";
import { useState, useEffect } from "react";
import { getAllDocs } from "~/shared/lib/docsConfig";
import { getContentLocaleCopy } from "~/shared/lib/contentLocalization";
import { getLocalizedPublicPath, getMarketingLocaleFromPathname, stripMarketingLocaleFromPathname } from "~/shared/lib/internationalMarketing";

type NavLink = { label: string; href: string; isRoute?: boolean };
type NavSection = { title: string; links: NavLink[] };
type NavCategory = { category: string; sections: NavSection[] };

// Get markdown-based docs
const markdownDocs = getAllDocs();
const selfhostedDocs = markdownDocs.filter(doc => doc.category === 'Self-Hosting');
const communityDocs = markdownDocs.filter(doc => doc.category === 'Community' || doc.category === 'Development');
const archDocs = markdownDocs.filter(doc => doc.category === 'Architecture');
const swiftDocs = markdownDocs.filter(doc => doc.category === 'Swift (iOS)');
const shopifyDocs = markdownDocs.filter(doc => doc.category === 'Shopify');
const webDocs = markdownDocs.filter(doc => doc.category === 'Web');

const NAVIGATION: NavCategory[] = [
    ...(shopifyDocs.length > 0 ? [{
        category: "Shopify",
        sections: [
            {
                title: "Getting Started",
                links: [
                    { label: "Overview", href: "/docs/shopify/getting-started", isRoute: true },
                    { label: "Before You Start", href: "/docs/shopify/getting-started#before-you-start", isRoute: false },
                    { label: "Headless Shopify", href: "/docs/shopify/getting-started#headless-shopify", isRoute: false },
                    { label: "Theme Install", href: "/docs/shopify/getting-started#shopify-theme-install", isRoute: false },
                    { label: "Consent", href: "/docs/shopify/getting-started#consent", isRoute: false },
                    { label: "Commerce Events", href: "/docs/shopify/getting-started#commerce-events", isRoute: false },
                    { label: "Privacy Controls", href: "/docs/shopify/getting-started#privacy-controls", isRoute: false },
                    { label: "Checkout Limits", href: "/docs/shopify/getting-started#checkout-limits", isRoute: false },
                    { label: "Verify", href: "/docs/shopify/getting-started#verify", isRoute: false },
                ]
            }
        ]
    }] : []),
    ...(webDocs.length > 0 ? [{
        category: "Web",
        sections: [
            {
                title: "Getting Started",
                links: [
                    { label: "Getting Started", href: "/docs/web/getting-started", isRoute: true },
                    { label: "Installation", href: "/docs/web/getting-started#installation", isRoute: false },
                    { label: "Basic Setup", href: "/docs/web/getting-started#basic-setup", isRoute: false },
                    { label: "Redux Replay", href: "/docs/web/getting-started#redux-and-redux-toolkit", isRoute: false },
                    { label: "Route Tracking", href: "/docs/web/getting-started#route-tracking", isRoute: false },
                    { label: "User Identification", href: "/docs/web/getting-started#user-identification", isRoute: false },
                    { label: "Custom Events", href: "/docs/web/getting-started#custom-events", isRoute: false },
                    { label: "Metadata", href: "/docs/web/getting-started#metadata", isRoute: false },
                    { label: "Privacy Controls", href: "/docs/web/getting-started#privacy-controls", isRoute: false },
                ]
            }
        ]
    }] : []),
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
                    { label: "Custom Events", href: "/docs/reactnative/overview#custom-events", isRoute: false },
                    { label: "Metadata", href: "/docs/reactnative/overview#metadata", isRoute: false },
                    { label: "Privacy Controls", href: "/docs/reactnative/overview#privacy-controls", isRoute: false },
                ]
            }
        ]
    },
    ...(swiftDocs.length > 0 ? [{
        category: "Swift (iOS)",
        sections: [
            {
                title: "Getting Started",
                links: [
                    { label: "Overview", href: "/docs/swift/overview", isRoute: true },
                    { label: "Installation", href: "/docs/swift/overview#installation", isRoute: false },
                    { label: "Swift Setup", href: "/docs/swift/overview#swift-setup", isRoute: false },
                    { label: "Screen Tracking", href: "/docs/swift/overview#screen-tracking", isRoute: false },
                    { label: "User Identification", href: "/docs/swift/overview#user-identification", isRoute: false },
                    { label: "Custom Events", href: "/docs/swift/overview#custom-events", isRoute: false },
                    { label: "Privacy Controls", href: "/docs/swift/overview#privacy-controls", isRoute: false },
                ]
            }
        ]
    }] : []),
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
    ...(communityDocs.length > 0 ? [{
        category: "Community",
        sections: [
            {
                title: "Contributing",
                links: communityDocs.map(doc => ({
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
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale);
    const [expandedCategories, setExpandedCategories] = useState<string[]>(["Shopify", "Web", "React Native", "Swift (iOS)", "Self-Hosting", "Community", "Architecture"]);
    const [activeHash, setActiveHash] = useState<string>("");
    const navigation = NAVIGATION.map((cat) => {
        if (cat.category !== "Web") {
            return cat;
        }

        return {
            ...cat,
            sections: cat.sections.map((section) => ({
                ...section,
                title: copy.docsNavGettingStarted,
                links: [
                    { label: copy.docsNavGettingStarted, href: "/docs/web/getting-started", isRoute: true },
                    { label: copy.docsNavInstallation, href: "/docs/web/getting-started#installation", isRoute: false },
                    { label: copy.docsNavBasicSetup, href: "/docs/web/getting-started#basic-setup", isRoute: false },
                    { label: "Redux Replay", href: "/docs/web/getting-started#redux-and-redux-toolkit", isRoute: false },
                    { label: copy.docsNavRouteTracking, href: "/docs/web/getting-started#route-tracking", isRoute: false },
                    { label: copy.docsNavUserIdentification, href: "/docs/web/getting-started#user-identification", isRoute: false },
                    { label: copy.docsNavCustomEvents, href: "/docs/web/getting-started#custom-events", isRoute: false },
                    { label: copy.docsNavMetadata, href: "/docs/web/getting-started#metadata", isRoute: false },
                    { label: copy.docsNavPrivacyControls, href: "/docs/web/getting-started#privacy-controls", isRoute: false },
                ],
            })),
        };
    });

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
        const pathname = stripMarketingLocaleFromPathname(location.pathname).pathname;
        const localizedHref = stripMarketingLocaleFromPathname(href.split("#")[0]).pathname + (href.includes("#") ? `#${href.split("#")[1]}` : "");

        if (isRoute) {
            // Fix: remove trailing slashes for comparison
            const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
            const normalizedHref = localizedHref.endsWith('/') ? localizedHref.slice(0, -1) : localizedHref;

            // Exact match for /docs (Overview) - ONLY if it's exactly /docs with no hash
            if (normalizedHref === '/docs') {
                return normalizedPath === '/docs' && !location.hash;
            }

            // For sub-routes (e.g. /docs/selfhosted)
            // We want exact matches for routes to avoid "Overview" staying active
            if (normalizedHref.startsWith('/docs/')) {
                return normalizedPath === normalizedHref && !activeHash;
            }

            // For root routes like /contribute
            return normalizedPath === normalizedHref && !activeHash;
        } else {
            // For hash links - check if we're on the right page and hash matches
            if (href.includes('#')) {
                const [path, hash] = localizedHref.split('#');
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
        <aside className={cn("relative z-20 hidden w-64 flex-shrink-0 self-stretch border-r border-slate-200/40 bg-transparent md:block", className)}>
            <div className="pt-28 pb-5 pr-6 pl-2">
                {navigation.map((cat) => (
                    <div key={cat.category} className="mb-6 last:mb-0">
                        {/* Category Header */}
                        <button
                            onClick={() => toggleCategory(cat.category)}
                            className="group mb-3 flex w-full items-center justify-between border-b border-slate-200/60 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 transition-all hover:text-slate-900"
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
                                        <h4 className="px-2 py-1 text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
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
                                                    "block px-3 py-1.5 text-sm font-semibold transition-all border border-transparent rounded-lg",
                                                    active
                                                        ? "text-indigo-600 bg-indigo-50 border-indigo-100/50 font-bold"
                                                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 hover:border-slate-200"
                                                );

                                                const localizedHref = getLocalizedPublicPath(locale, link.href);

                                                if (link.isRoute) {
                                                    return (
                                                        <Link
                                                            key={link.href}
                                                            to={localizedHref}
                                                            className={className}
                                                        >
                                                            {LinkContent}
                                                        </Link>
                                                    );
                                                } else {
                                                    return (
                                                        <a
                                                            key={link.href}
                                                            href={localizedHref}
                                                            className={className}
                                                            onClick={(e) => {
                                                                // If on same page, smooth scroll
                                                                if (location.pathname === localizedHref.split('#')[0]) {
                                                                    e.preventDefault();
                                                                    const hash = localizedHref.split('#')[1];
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
