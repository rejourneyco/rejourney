/**
 * Rejourney Dashboard - Landing Page Route
 * 
 * This is the main landing page, server-side rendered for SEO/crawlers.
 */

import { Suspense, lazy, useEffect } from "react";
import type { Route } from "./+types/route";
import { Hero } from "~/features/public/home/components/Hero";
import { TrustBanners } from "~/features/public/home/components/TrustBanners";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { EngineeringCTA } from "~/features/public/home/components/EngineeringCTA";
import { Features } from "~/features/public/home/components/Features";

const EmbeddedDemoWindow = lazy(async () => {
    const mod = await import("~/features/public/home/components/EmbeddedDemoWindow");
    return { default: mod.EmbeddedDemoWindow };
});

const PerformanceMetrics = lazy(async () => {
    const mod = await import("~/features/public/home/components/PerformanceMetrics");
    return { default: mod.PerformanceMetrics };
});

function DeferredSectionFallback({ label }: { label: string }) {
    return (
        <section className="w-full px-4 sm:px-6 lg:px-8 py-24 border-t-2 border-black bg-slate-50">
            <div className="max-w-7xl mx-auto">
                <div className="border-2 border-black bg-white px-6 py-10 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    <div className="h-4 w-40 bg-slate-100 border border-black" />
                    <div className="mt-4 h-10 w-72 bg-slate-100 border border-black" />
                    <div className="mt-8 h-48 w-full bg-slate-50 border-2 border-dashed border-slate-200" />
                    <p className="mt-4 text-[11px] font-mono uppercase tracking-[0.18em] text-slate-400">
                        Loading {label}
                    </p>
                </div>
            </div>
        </section>
    );
}

export const meta: Route.MetaFunction = () => [
    { title: "Rejourney: Open Source React Native Sentry Alternative" },
    {
        name: "description",
        content: "Rejourney is the lightweight, open-source Sentry alternative for React Native. Get native crash monitoring, performant session replay, and heatmaps with a zero-dependency SDK.",
    },
    { property: "og:title", content: "Rejourney: Lightweight Mobile-First Sentry Alternative" },
    { property: "og:url", content: "https://rejourney.co/" },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: "https://rejourney.co/" },
];

export default function LandingPage() {
    useEffect(() => {
        // Always start the landing page at the top instead of restoring prior scroll.
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="min-h-screen w-full bg-background text-foreground overflow-x-hidden">
            <Header />
            <main aria-label="Rejourney - Open Source Mobile Session Replay" className="w-full">
                <Hero />
                <TrustBanners />
                <Suspense fallback={<DeferredSectionFallback label="demo preview" />}>
                    <EmbeddedDemoWindow />
                </Suspense>
                <Features />
                <Suspense fallback={<DeferredSectionFallback label="bundle comparison" />}>
                    <PerformanceMetrics />
                </Suspense>
                <EngineeringCTA />
            </main>
            <Footer />
        </div>
    );
}
