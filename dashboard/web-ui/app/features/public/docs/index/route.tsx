/**
 * Rejourney Dashboard - Docs Landing Page
 * Platform selector — choose your integration to get started.
 */

import type { Route } from "./+types/route";
import React from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight } from "lucide-react";
import { redirect } from "react-router";
import { DocsLayout } from "~/shared/docs/DocsLayout";
import { DocsSidebar } from "~/shared/docs/DocsSidebar";
import { getContentLocaleCopy } from "~/shared/lib/contentLocalization";
import {
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicPath,
    getLocalizedPublicUrl,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    MARKETING_LOCALE_VARY_HEADER,
    MARKETING_LOCALE_ORDER,
} from "~/shared/lib/internationalMarketing";
import {
    MarkShopify,
    MarkReactNative,
    MarkFlutter,
    MarkRedux,
    MarkSwift,
    MarkNextJs,
    MarkVue,
    MarkAngular,
    MarkSvelte,
    MarkRemix,
    MarkGatsby,
    MarkHydrogen,
} from "~/features/public/home/components/PlatformMarks";

export const meta: Route.MetaFunction = ({ location }) => {
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale);
    const title = copy.docsIndexTitle;
    const description = copy.docsIndexDescription;
    const domain = "https://rejourney.co";
    const canonicalUrl = getLocalizedPublicUrl(locale, "/docs");
    const socialPreviewImageUrl = `${domain}/images/heatmaps.png`;
    const alternateLinks = getLocalizedAlternateLinksForPath("/docs", MARKETING_LOCALE_ORDER).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath("/docs", MARKETING_LOCALE_ORDER)
        .filter((a) => a.hrefLang !== "x-default" && a.hrefLang !== locale.languageTag)
        .map((a) => ({ property: "og:locale:alternate", content: getMarketingLocaleFromPathname(new URL(a.href).pathname).ogLocale }));

    return [
        { title },
        { name: "description", content: description },
        { name: "robots", content: "index, follow" },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "website" },
        { property: "og:image", content: socialPreviewImageUrl },
        { property: "og:image:width", content: "998" },
        { property: "og:image:height", content: "794" },
        { property: "og:image:alt", content: "Rejourney heatmaps preview" },
        { property: "og:image:type", content: "image/png" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: socialPreviewImageUrl },
        { name: "twitter:image:alt", content: "Rejourney heatmaps preview" },
    ];
};

export async function loader({ request }: Route.LoaderArgs) {
    const localeRedirectPath = getMarketingLocaleRedirectPath(request);
    if (localeRedirectPath) {
        return redirect(localeRedirectPath, {
            status: 302,
            headers: { Vary: MARKETING_LOCALE_VARY_HEADER },
        });
    }
    return {};
}

// ─── Platform definitions ────────────────────────────────────────────────────

interface Platform {
    name: string;
    description: string;
    href: string;
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    iconColor: string;
    iconBg: string;
    badge?: string;
}

interface PlatformGroup {
    heading: string;
    platforms: Platform[];
}

const PLATFORM_GROUPS: PlatformGroup[] = [
    {
        heading: "E-commerce",
        platforms: [
            {
                name: "Shopify",
                description: "Custom themes, headless storefronts, and checkout analytics.",
                href: "/docs/shopify/getting-started",
                Icon: MarkShopify,
                iconColor: "#96bf48",
                iconBg: "#f0fae6",
            },
            {
                name: "Hydrogen",
                description: "Shopify's React-based headless commerce framework.",
                href: "/docs/web/getting-started",
                Icon: MarkHydrogen,
                iconColor: "#00a878",
                iconBg: "#e6faf5",
            },
        ],
    },
    {
        heading: "Web",
        platforms: [
            {
                name: "Next.js / React",
                description: "React apps with SPA, SSR, or full-stack routing.",
                href: "/docs/web/getting-started#nextjs",
                Icon: MarkNextJs,
                iconColor: "#0f172a",
                iconBg: "#f1f5f9",
            },
            {
                name: "Redux / Redux Toolkit",
                description: "Replay actions with synchronized before-and-after state.",
                href: "/docs/web/getting-started#redux-and-redux-toolkit",
                Icon: MarkRedux,
                iconColor: "#764abc",
                iconBg: "#f5f0ff",
                badge: "State replay",
            },
            {
                name: "Vue / Nuxt",
                description: "Vue 3 and Nuxt applications.",
                href: "/docs/web/getting-started",
                Icon: MarkVue,
                iconColor: "#42b883",
                iconBg: "#f0fdf7",
            },
            {
                name: "Angular",
                description: "Enterprise Angular single-page applications.",
                href: "/docs/web/getting-started",
                Icon: MarkAngular,
                iconColor: "#dd0031",
                iconBg: "#fff1f2",
            },
            {
                name: "SvelteKit",
                description: "Svelte and SvelteKit web apps.",
                href: "/docs/web/getting-started",
                Icon: MarkSvelte,
                iconColor: "#ff3e00",
                iconBg: "#fff4ef",
            },
            {
                name: "Remix",
                description: "Full-stack Remix apps with nested routing.",
                href: "/docs/web/getting-started",
                Icon: MarkRemix,
                iconColor: "#0f172a",
                iconBg: "#f1f5f9",
            },
            {
                name: "Gatsby",
                description: "Static and server-rendered Gatsby sites.",
                href: "/docs/web/getting-started",
                Icon: MarkGatsby,
                iconColor: "#663399",
                iconBg: "#f5f0ff",
            },
        ],
    },
    {
        heading: "Mobile",
        platforms: [
            {
                name: "React Native",
                description: "iOS & Android apps, including Expo managed workflow.",
                href: "/docs/reactnative/overview",
                Icon: MarkReactNative,
                iconColor: "#2563eb",
                iconBg: "#eff6ff",
                badge: "Expo supported",
            },
            {
                name: "Flutter",
                description: "Native iOS & Android replay for Flutter applications.",
                href: "/docs/flutter/overview",
                Icon: MarkFlutter,
                iconColor: "#027dfd",
                iconBg: "#eff6ff",
                badge: "iOS + Android",
            },
            {
                name: "Swift (iOS)",
                description: "Native SwiftUI and UIKit iOS applications.",
                href: "/docs/swift/overview",
                Icon: MarkSwift,
                iconColor: "#f97316",
                iconBg: "#fff7ed",
            },
        ],
    },
];

// ─── Card component ──────────────────────────────────────────────────────────

function PlatformCard({ platform, locale }: { platform: Platform; locale: ReturnType<typeof getMarketingLocaleFromPathname> }) {
    const { name, description, href, Icon, iconColor, iconBg, badge } = platform;
    const localizedHref = getLocalizedPublicPath(locale, href);

    return (
        <Link
            to={localizedHref}
            className="group relative flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
            {/* Icon */}
            <div
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: iconBg }}
            >
                <Icon className="h-6 w-6" style={{ color: iconColor }} />
            </div>

            {/* Text */}
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {name}
                    </span>
                    {badge && (
                        <span className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                            {badge}
                        </span>
                    )}
                </div>
                <p className="mt-0.5 text-sm leading-snug text-slate-500">{description}</p>
            </div>

            {/* Arrow */}
            <ArrowRight
                size={16}
                className="mt-0.5 flex-shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-indigo-400"
            />
        </Link>
    );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DocsIndex() {
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);

    return (
        <DocsLayout sidebar={<DocsSidebar />}>
            {/* Hero */}
            <div className="mb-10">
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-indigo-500">
                    Documentation
                </p>
                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
                    Choose your platform
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-500">
                    Rejourney works across web, mobile, and e-commerce. Pick your stack below to get started with session replay, heatmaps, and product analytics in minutes.
                </p>
            </div>

            {/* Platform groups */}
            <div className="space-y-10">
                {PLATFORM_GROUPS.map((group) => (
                    <section key={group.heading}>
                        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-400">
                            {group.heading}
                        </h2>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {group.platforms.map((platform) => (
                                <PlatformCard
                                    key={platform.name}
                                    platform={platform}
                                    locale={locale}
                                />
                            ))}
                        </div>
                    </section>
                ))}
            </div>

            {/* Self-hosting callout */}
            <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Self-Hosting
                </p>
                <h3 className="text-base font-bold text-slate-900 mb-1">
                    Running your own infrastructure?
                </h3>
                <p className="text-sm text-slate-500 mb-4">
                    Deploy Rejourney on your own servers with Docker or Kubernetes.
                </p>
                <Link
                    to={getLocalizedPublicPath(locale, "/docs/selfhosted")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-indigo-200 hover:text-indigo-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                    Self-hosted docs
                    <ArrowRight size={14} />
                </Link>
            </div>
        </DocsLayout>
    );
}
