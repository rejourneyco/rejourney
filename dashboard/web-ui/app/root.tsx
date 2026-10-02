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
import { getPublicRuntimeEnvSnapshot } from "./shared/config/runtimeEnv";
import {
    getLocalizedPublicUrl,
    getMarketingHomeCopy,
    getMarketingLocaleFromPathname,
} from "./shared/lib/internationalMarketing";

import { isAuthBootstrapData, isDashboardShellBootstrapData } from "./shell/server/dashboardBootstrap";
import { readCookieValue } from "./shared/utils/selectionCookies";

interface PublicSessionHintData {
    __publicSessionHint: true;
    hasSessionCookie: boolean;
}

function isPublicSessionHintData(value: unknown): value is PublicSessionHintData {
    return Boolean(
        value
        && typeof value === "object"
        && "__publicSessionHint" in value
        && (value as PublicSessionHintData).__publicSessionHint
    );
}

export function loader({ request }: Route.LoaderArgs): PublicSessionHintData {
    return {
        __publicSessionHint: true,
        hasSessionCookie: Boolean(readCookieValue(request.headers.get("cookie"), "session")),
    };
}

export const links: Route.LinksFunction = () => [
    // DNS prefetch for external domains
    { rel: "dns-prefetch", href: "https://api.rejourney.co" },
    { rel: "dns-prefetch", href: "https://ingest.rejourney.co" },
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
    { name: "theme-color", content: "#ffffff" },
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
                {/* Must be first: prevent the browser from restoring a stale root-page
                    position before React Router takes over. */}
                <script dangerouslySetInnerHTML={{ __html: `(function(){try{window.history.scrollRestoration='manual';}catch(e){}if(window.location.pathname==='/'&&!window.location.hash){window.scrollTo(0,0);}})();` }} />
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
                                    "@id": "https://rejourney.co/#organization",
                                    "name": "Rejourney",
                                    "url": "https://rejourney.co/",
                                    "logo": "https://rejourney.co/rejourneyIcon-removebg-preview.png",
                                    "sameAs": [
                                        "https://x.com/rejourneyco",
                                        "https://www.linkedin.com/company/rejourneyco/",
                                        "https://github.com/rejourneyco"
                                    ],
                                    "contactPoint": {
                                        "@type": "ContactPoint",
                                        "contactType": "Customer Support",
                                        "email": "contact@rejourney.co"
                                    }
                                },
                                {
                                    "@type": "Service",
                                    "@id": "https://rejourney.co/#service",
                                    "name": "Rejourney",
                                    "serviceType": "Lightweight Product Analytics for Web and Mobile Apps",
                                    "provider": { "@id": "https://rejourney.co/#organization" },
                                    "url": "https://rejourney.co/",
                                    "description": locale.metaDescription,
                                    "areaServed": "Worldwide",
                                    "offers": {
                                        "@type": "Offer",
                                        "price": "0",
                                        "priceCurrency": "USD",
                                        "url": "https://rejourney.co/pricing"
                                    }
                                },
                                {
                                    "@type": "WebSite",
                                    "@id": "https://rejourney.co/#website",
                                    "name": "Rejourney",
                                    "inLanguage": locale.languageTag,
                                    "url": "https://rejourney.co/",
                                    "publisher": { "@id": "https://rejourney.co/#organization" }
                                },
                                {
                                    "@type": "ItemList",
                                    "name": "Sitelinks",
                                    "itemListElement": [
                                        { "@type": "SiteNavigationElement", "position": 1, "name": "Website Analytics", "url": getLocalizedPublicUrl(locale, "/website-analytics") },
                                        { "@type": "SiteNavigationElement", "position": 2, "name": "App Analytics", "url": getLocalizedPublicUrl(locale, "/app-analytics") },
                                        { "@type": "SiteNavigationElement", "position": 3, "name": copy.header.pricing, "url": getLocalizedPublicUrl(locale, "/pricing") },
                                        { "@type": "SiteNavigationElement", "position": 4, "name": "How Rejourney Works", "url": getLocalizedPublicUrl(locale, "/how-it-works") },
                                        { "@type": "SiteNavigationElement", "position": 5, "name": copy.header.docs, "url": getLocalizedPublicUrl(locale, "/docs") },
                                        { "@type": "SiteNavigationElement", "position": 6, "name": "Live Demo", "url": getLocalizedPublicUrl(locale, "/demo") }
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
            </head>
            <body>
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

import { AuthProvider } from "./shared/providers/AuthContext";
import { ToastProvider } from "./shared/providers/ToastContext";
import { RejourneyConsentBanner } from "~/shared/compliance/RejourneyConsentBanner";

export default function App() {
    const location = useLocation();
    const matches = useMatches();
    const shellBootstrap = matches
        .map((match) => match.data)
        .find((data) => isDashboardShellBootstrapData(data)) ?? null;
    const publicAuthBootstrap = matches
        .map((match) => match.data)
        .find((data) => isAuthBootstrapData(data)) ?? null;
    const publicSessionHint = matches
        .map((match) => match.data)
        .find((data) => isPublicSessionHintData(data)) ?? null;
    const appContent = (
        <ToastProvider>
            <Outlet />
            <RejourneyConsentBanner />
        </ToastProvider>
    );

    return (
        <AuthProvider
            initialUser={shellBootstrap?.user ?? publicAuthBootstrap?.user ?? null}
            initialHydrated={Boolean(shellBootstrap || publicAuthBootstrap)}
            initialAuthServiceUnavailable={publicAuthBootstrap?.authServiceUnavailable ?? false}
            initialError={publicAuthBootstrap?.error ?? null}
            initialSessionPresent={publicSessionHint?.hasSessionCookie ?? false}
        >
            {appContent}
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
                <h1 className="mb-3 text-6xl font-normal text-[#202124]">{message}</h1>
                <p className="mb-8 text-lg text-[#5f6368]">{details}</p>
                {stack && (
                    <pre className="w-full p-4 overflow-x-auto bg-gray-100 text-left text-sm font-mono">
                        <code>{stack}</code>
                    </pre>
                )}
                <a
                    href="/"
                    className="inline-block rounded-none bg-[#1a73e8] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1765cc]"
                >
                    Go home
                </a>
            </div>
        </main>
    );
}
