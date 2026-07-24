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
import { getGoogleAdsConversionId, getPublicRuntimeEnvSnapshot } from "./shared/config/runtimeEnv";
import {
    getLocalizedPublicUrl,
    getMarketingHomeCopy,
    MARKETING_LOCALES,
} from "./shared/lib/internationalMarketing";
import { isAuthBootstrapData, isDashboardShellBootstrapData } from "./shell/server/dashboardBootstrap";

function renderGoogleAdsBootstrap(conversionId: string): string {
    return [
        "(function(){",
        `var conversionId=${JSON.stringify(conversionId)};`,
        "var path=window.location.pathname;",
        "if(path.indexOf('/dashboard')===0){return;}",
        "window.dataLayer=window.dataLayer||[];",
        "function gtag(){dataLayer.push(arguments);}",
        "window.gtag=window.gtag||gtag;",
        "var consent='denied';",
        "try{if(window.localStorage.getItem('rejourney.webSdkConsent.v1')==='accepted'){consent='granted';}}catch(e){}",
        "gtag('consent','default',{ad_storage:consent,analytics_storage:consent,ad_user_data:consent,ad_personalization:consent,wait_for_update:500});",
        "gtag('set','ads_data_redaction',true);",
        "gtag('set','url_passthrough',true);",
        "var tag=document.createElement('script');",
        "tag.async=true;",
        "tag.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(conversionId);",
        "document.head.appendChild(tag);",
        "gtag('js',new Date());",
        "gtag('config',conversionId,{allow_enhanced_conversions:true});",
        "})();",
    ].join("");
}

export const links: Route.LinksFunction = () => [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap",
    },
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
    const googleAdsConversionId = getGoogleAdsConversionId();
    const locale = MARKETING_LOCALES.en;
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
                {googleAdsConversionId ? (
                    <script
                        dangerouslySetInnerHTML={{
                            __html: renderGoogleAdsBootstrap(googleAdsConversionId),
                        }}
                    />
                ) : null}
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
                                    "serviceType": "Revenue Leak Prediction for Web and Mobile Apps",
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
                                        { "@type": "SiteNavigationElement", "position": 1, "name": copy.header.pricing, "url": getLocalizedPublicUrl(locale, "/pricing") },
                                        { "@type": "SiteNavigationElement", "position": 2, "name": "Mobile Session Replay", "url": getLocalizedPublicUrl(locale, "/mobile-session-replay") },
                                        { "@type": "SiteNavigationElement", "position": 3, "name": "How Rejourney Works", "url": getLocalizedPublicUrl(locale, "/how-it-works") },
                                        { "@type": "SiteNavigationElement", "position": 4, "name": copy.header.docs, "url": getLocalizedPublicUrl(locale, "/docs") },
                                        { "@type": "SiteNavigationElement", "position": 5, "name": "Live Demo", "url": getLocalizedPublicUrl(locale, "/demo") },
                                        { "@type": "SiteNavigationElement", "position": 6, "name": copy.header.engineering, "url": getLocalizedPublicUrl(locale, "/engineering") }
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
import { TeamProvider } from "./shared/providers/TeamContext";
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
    const isDemoRoute = location.pathname === "/demo" || location.pathname.startsWith("/demo/");

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
        >
            {isDemoRoute ? appContent : (
                <TeamProvider
                    initialTeams={shellBootstrap?.teams ?? []}
                    initialCurrentTeamId={shellBootstrap?.currentTeamId ?? null}
                    initialHydrated={!!shellBootstrap}
                >
                    {appContent}
                </TeamProvider>
            )}
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
