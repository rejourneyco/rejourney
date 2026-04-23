/**
 * Rejourney Dashboard - Landing Page Route
 * 
 * This is the main landing page, server-side rendered for SEO/crawlers.
 */

import React from "react";
import type { Route } from "./+types/route";
import { Hero } from "~/features/public/home/components/Hero";
import { TrustBanners } from "~/features/public/home/components/TrustBanners";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { EngineeringCTA } from "~/features/public/home/components/EngineeringCTA";
import { Features } from "~/features/public/home/components/Features";
import { EmbeddedDemoWindow } from "~/features/public/home/components/EmbeddedDemoWindow";
import { PerformanceMetrics } from "~/features/public/home/components/PerformanceMetrics";

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
    return (
        <div className="min-h-screen w-full bg-background text-foreground overflow-x-hidden">
            <Header />
            <main aria-label="Rejourney - Open Source Mobile Session Replay" className="w-full">
                <Hero />
                <TrustBanners />
                <EmbeddedDemoWindow />
                <Features />
                <PerformanceMetrics />
                <EngineeringCTA />
            </main>
            <Footer />
        </div>
    );
}
