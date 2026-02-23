/**
 * Rejourney Dashboard
 * 
 * Copyright (c) 2026 Rejourney
 * 
 * Licensed under the Server Side Public License 1.0 (the "License");
 * you may not use this file except in compliance with the License.
 * See LICENSE-SSPL for full terms.
 */

import {
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";

import "./styles/index.css";
import "./styles/landing.css";

export const links: Route.LinksFunction = () => [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap",
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
];

export const meta: Route.MetaFunction = () => [
    // charset and viewport are set explicitly in Layout head
    { name: "theme-color", content: "#ffffff" },
    { title: "Rejourney: Open Source React Native Sentry Alternative" },
    {
        name: "description",
        content: "Rejourney is the lightweight, open-source Sentry alternative for React Native. Get native crash monitoring, performant session replay, and heatmaps with a zero-dependency SDK.",
    },
    {
        name: "keywords",
        content: "Sentry alternative, React Native monitoring, open source session replay, mobile observability, crash reporting, LogRocket alternative, lightweight SDK, self-hosted",
    },
    { name: "robots", content: "index, follow" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://rejourney.co/" },
    { property: "og:title", content: "Rejourney: Lightweight Mobile-First Sentry Alternative" },
    {
        property: "og:description",
        content: "The definitive lightweight Sentry alternative for mobile apps. Crash monitoring and session replay built for performance.",
    },
    { property: "og:image", content: "https://rejourney.co/rejourneyIcon-removebg-preview.png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Rejourney - Open Source React Native Sentry Alternative" },
    { property: "og:image:type", content: "image/png" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:url", content: "https://rejourney.co/" },
    { name: "twitter:title", content: "Rejourney: Lightweight Mobile-First Sentry Alternative" },
    {
        name: "twitter:description",
        content: "Lightweight, mobile-first Sentry alternative. Zero-dependency SDK for React Native with pixel-perfect session replay.",
    },
    { name: "twitter:image", content: "https://rejourney.co/rejourneyIcon-removebg-preview.png" },
];

export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
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
                                    "url": "https://rejourney.co/",
                                    "logo": "https://rejourney.co/rejourneyIcon-removebg-preview.png",
                                    "contactPoint": {
                                        "@type": "ContactPoint",
                                        "contactType": "Customer Support",
                                        "email": "contact@rejourney.co"
                                    }
                                },
                                {
                                    "@type": "SoftwareApplication",
                                    "name": "Rejourney",
                                    "applicationCategory": "DeveloperApplication",
                                    "operatingSystem": "React Native",
                                    "offers": {
                                        "@type": "Offer",
                                        "price": "0",
                                        "priceCurrency": "USD"
                                    },
                                    "url": "https://rejourney.co/",
                                    "description": "Lightweight, open-source Sentry alternative for React Native with native crash monitoring, performant session replay, and heatmaps."
                                },
                                {
                                    "@type": "WebSite",
                                    "name": "Rejourney",
                                    "url": "https://rejourney.co/",
                                    "potentialAction": {
                                        "@type": "SearchAction",
                                        "target": "https://rejourney.co/search?q={search_term_string}",
                                        "query-input": "required name=search_term_string"
                                    }
                                },
                                {
                                    "@type": "ItemList",
                                    "name": "Sitelinks",
                                    "itemListElement": [
                                        { "@type": "SiteNavigationElement", "position": 1, "name": "Docs", "url": "https://rejourney.co/docs/reactnative/overview" },
                                        { "@type": "SiteNavigationElement", "position": 2, "name": "Engineering", "url": "https://rejourney.co/engineering" },
                                        { "@type": "SiteNavigationElement", "position": 3, "name": "Pricing", "url": "https://rejourney.co/pricing" },
                                        { "@type": "SiteNavigationElement", "position": 4, "name": "Self-Hosted", "url": "https://rejourney.co/docs/selfhosted" },
                                        { "@type": "SiteNavigationElement", "position": 5, "name": "Log In", "url": "https://rejourney.co/login" }
                                    ]
                                }
                            ]
                        })
                    }}
                />
                <script
                    dangerouslySetInnerHTML={{
                        __html: `window.ENV = ${JSON.stringify({
                            VITE_STRIPE_PUBLISHABLE_KEY: process.env.VITE_STRIPE_PUBLISHABLE_KEY,
                            VITE_MAPBOX_TOKEN: process.env.VITE_MAPBOX_TOKEN,
                        })}`,
                    }}
                />
                <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            </head>
            <body>
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

import { AuthProvider } from "./context/AuthContext";
import { TeamProvider } from "./context/TeamContext";
import { ToastProvider } from "./context/ToastContext";
import { ClarityConsentBanner } from "~/components/compliance/ClarityConsentBanner";

export default function App() {
    return (
        <AuthProvider>
            <TeamProvider>
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
