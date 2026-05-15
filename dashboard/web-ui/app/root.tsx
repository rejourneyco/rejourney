/**
 * Rejourney Dashboard
 * 
 * Copyright (c) 2026 Rejourney
 * 
 * Licensed under the Server Side Public License 1.0 (the "License");
 * you may not use this file except in compliance with the License.
 * See LICENSE-SSPL for full terms.
 */

import { useEffect } from "react";
import {
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    isRouteErrorResponse,
    useLocation,
    useMatches,
} from "react-router";
import type { Route } from "./+types/root";

import "./styles/index.css";
import "./styles/landing.css";
import { getPublicRuntimeEnvSnapshot } from "./shared/config/runtimeEnv";
import {
    MARKETING_AVAILABLE_LANGUAGES,
    getLocalizedPublicUrl,
    getMarketingHomeCopy,
    getMarketingLocaleFromPathname,
} from "./shared/lib/internationalMarketing";
import { isDashboardShellBootstrapData } from "./shell/server/dashboardBootstrap";

export const links: Route.LinksFunction = () => [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap",
    },
    // DNS prefetch for external domains
    { rel: "dns-prefetch", href: "https://api.rejourney.co" },
    { rel: "dns-prefetch", href: "https://challenges.cloudflare.com" },
    // Favicon links - using root-relative paths to work on all routes
    { rel: "icon", href: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
    { rel: "icon", type: "image/png", href: "/rejourneyIcon-removebg-preview.png", sizes: "192x192" },
    { rel: "apple-touch-icon", href: "/rejourneyIcon-removebg-preview.png" },
    // Web manifest for better favicon discovery by Google and modern browsers
    { rel: "manifest", href: "/site.webmanifest" },
    // RSS feed for engineering content
    { rel: "alternate", type: "application/rss+xml", title: "Rejourney Engineering RSS", href: "/feed.xml" },
    // AI/LLM context file for answer engines and developer agents
    { rel: "alternate", type: "text/plain", title: "Rejourney LLM context", href: "/llms.txt" },
];

export const meta: Route.MetaFunction = () => [
    // charset and viewport are set explicitly in Layout head
    { name: "theme-color", content: "#ffffff" },
    { title: "Rejourney: Open Source Mobile App Analytics & Observability" },
    {
        name: "description",
        content: "Open-source mobile analytics with session replay, crash reports, heatmaps, journeys, and a lightweight SDK for mobile apps.",
    },
    {
        name: "keywords",
        content: "mobile app analytics, mobile observability, open source session replay, crash reporting, heatmaps, product analytics, lightweight SDK, self-hosted",
    },
    { name: "robots", content: "index, follow" },
    { property: "og:locale", content: "en_US" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://rejourney.co/" },
    { property: "og:title", content: "Rejourney: Lightweight Mobile App Analytics & Observability" },
    {
        property: "og:description",
        content: "Everything analytics for mobile apps: session replay, crashes, journeys, heatmaps, and product signals in a light SDK.",
    },
    { property: "og:image", content: "https://rejourney.co/rejourneyIcon-removebg-preview.png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Rejourney - Open Source Mobile App Analytics" },
    { property: "og:image:type", content: "image/png" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:url", content: "https://rejourney.co/" },
    { name: "twitter:title", content: "Rejourney: Lightweight Mobile App Analytics & Observability" },
    {
        name: "twitter:description",
        content: "Everything analytics for mobile apps: session replay, crashes, journeys, heatmaps, and product signals in a light SDK.",
    },
    { name: "twitter:image", content: "https://rejourney.co/rejourneyIcon-removebg-preview.png" },
    { name: "twitter:site", content: "@rejourneyco" },
];

export function Layout({ children }: { children: React.ReactNode }) {
    const runtimeEnv = getPublicRuntimeEnvSnapshot();
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getMarketingHomeCopy(locale);

    useEffect(() => {
        document.documentElement.lang = locale.languageTag;
        document.documentElement.dir = locale.dir;
    }, [locale.dir, locale.languageTag]);

    return (
        <html lang={locale.languageTag} dir={locale.dir}>
            <head>
                {/* Must be first — sets scrollRestoration=manual globally before the
                    browser can restore any saved scroll position. ScrollRestoration
                    component handles restoring scroll on non-landing routes. */}
                <script dangerouslySetInnerHTML={{ __html: `(function(){try{window.history.scrollRestoration='manual';}catch(e){}if(window.location.pathname==='/'){window.scrollTo(0,0);}})();` }} />
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta httpEquiv="Content-Language" content={locale.languageTag} />
                <Meta />
                <Links />
                {/* Structured data for rich results */}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            "@context": "https://schema.org",
                            "@graph": [
                                {
                                    "@type": "Organization",
                                    "name": "Rejourney",
                                    "inLanguage": locale.languageTag,
                                    "availableLanguage": MARKETING_AVAILABLE_LANGUAGES,
                                    "url": "https://rejourney.co/",
                                    "logo": "https://rejourney.co/rejourneyIcon-removebg-preview.png",
                                    "sameAs": [
                                        "https://x.com/rejourneyco",
                                        "https://github.com/rejourneyco"
                                    ],
                                    "contactPoint": {
                                        "@type": "ContactPoint",
                                        "contactType": "Customer Support",
                                        "email": "contact@rejourney.co"
                                    }
                                },
                                {
                                    "@type": "SoftwareApplication",
                                    "name": "Rejourney",
                                    "inLanguage": locale.languageTag,
                                    "availableLanguage": MARKETING_AVAILABLE_LANGUAGES,
                                    "applicationCategory": "DeveloperApplication",
                                    "operatingSystem": "iOS, Android, Expo, React Native",
                                    "offers": {
                                        "@type": "Offer",
                                        "price": "0",
                                        "priceCurrency": "USD"
                                    },
                                    "url": "https://rejourney.co/",
                                    "description": locale.metaDescription
                                },
                                {
                                    "@type": "WebSite",
                                    "name": "Rejourney",
                                    "inLanguage": locale.languageTag,
                                    "availableLanguage": MARKETING_AVAILABLE_LANGUAGES,
                                    "url": "https://rejourney.co/"
                                },
                                {
                                    "@type": "ItemList",
                                    "name": "Sitelinks",
                                    "inLanguage": locale.languageTag,
                                    "itemListElement": [
                                        { "@type": "SiteNavigationElement", "position": 1, "name": copy.header.docs, "url": getLocalizedPublicUrl(locale, "/docs/reactnative/overview") },
                                        { "@type": "SiteNavigationElement", "position": 2, "name": copy.header.engineering, "url": getLocalizedPublicUrl(locale, "/engineering") },
                                        { "@type": "SiteNavigationElement", "position": 3, "name": copy.header.pricing, "url": getLocalizedPublicUrl(locale, "/pricing") },
                                        { "@type": "SiteNavigationElement", "position": 4, "name": copy.header.selfHosted, "url": getLocalizedPublicUrl(locale, "/docs/selfhosted") },
                                        { "@type": "SiteNavigationElement", "position": 5, "name": copy.header.login, "url": "https://rejourney.co/login" }
                                    ]
                                }
                            ]
                        })
                    }}
                />
                <script
                    dangerouslySetInnerHTML={{
                        __html: `window.ENV = ${JSON.stringify(runtimeEnv)}`,
                    }}
                />
                <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            </head>
            <body>
                {children}
                <ScrollRestoration
                    getKey={(location) => {
                        // Don't restore scroll on the landing page — always start at top
                        return location.pathname === '/' ? 'landing-always-top' : location.key;
                    }}
                />
                <Scripts />
            </body>
        </html>
    );
}

import { AuthProvider } from "./shared/providers/AuthContext";
import { TeamProvider } from "./shared/providers/TeamContext";
import { ToastProvider } from "./shared/providers/ToastContext";
import { ClarityConsentBanner } from "~/shared/compliance/ClarityConsentBanner";

export default function App() {
    const matches = useMatches();
    const shellBootstrap = matches
        .map((match) => match.data)
        .find((data) => isDashboardShellBootstrapData(data)) ?? null;

    return (
        <AuthProvider
            initialUser={shellBootstrap?.user ?? null}
            initialHydrated={!!shellBootstrap}
        >
            <TeamProvider
                initialTeams={shellBootstrap?.teams ?? []}
                initialCurrentTeamId={shellBootstrap?.currentTeamId ?? null}
                initialHydrated={!!shellBootstrap}
            >
                <ToastProvider>
                    <Outlet />
                    <ClarityConsentBanner />
                </ToastProvider>
            </TeamProvider>
        </AuthProvider>
    );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    let message = "Oops!";
    let details = "An unexpected error occurred.";
    let stack: string | undefined;

    if (isRouteErrorResponse(error)) {
        message = error.status === 404 ? "404" : "Error";
        details =
            error.status === 404
                ? "The requested page could not be found."
                : error.statusText || details;
    } else if (import.meta.env.DEV && error && error instanceof Error) {
        details = error.message;
        stack = error.stack;
    }

    return (
        <main className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="text-center">
                <h1 className="text-6xl font-black uppercase mb-4">{message}</h1>
                <p className="text-xl text-muted-foreground mb-8">{details}</p>
                {stack && (
                    <pre className="w-full p-4 overflow-x-auto bg-gray-100 text-left text-sm font-mono">
                        <code>{stack}</code>
                    </pre>
                )}
                <a
                    href="/"
                    className="inline-block px-6 py-3 bg-black text-white font-bold uppercase hover:bg-gray-800 transition-colors"
                >
                    Go Home
                </a>
            </div>
        </main>
    );
}
