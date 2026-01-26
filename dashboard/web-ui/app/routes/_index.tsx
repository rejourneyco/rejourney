/**
 * Rejourney Dashboard - Landing Page Route
 * 
 * This is the main landing page, server-side rendered for SEO/crawlers.
 */

import type { Route } from "./+types/_index";
import { Hero } from "~/components/landing/Hero";
import { TrustBanners } from "~/components/landing/TrustBanners";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";
import { ComparisonTable } from "~/components/landing/ComparisonTable";
import { EngineeringCTA } from "~/components/landing/EngineeringCTA";
import { EmbeddedDemoWindow } from "~/components/landing/EmbeddedDemoWindow";
import { PerformanceMetrics } from "~/components/landing/PerformanceMetrics";
import { Features } from "~/components/landing/Features";

export const meta: Route.MetaFunction = () => [
    { title: "Rejourney: Open Source React Native Sentry Alternative" },
    {
        name: "description",
        content: "Rejourney is the lightweight, open-source Sentry alternative for React Native. Get native crash monitoring, performant session replay, and heatmaps with a zero-dependency SDK.",
    },
    { property: "og:title", content: "Rejourney: Lightweight Mobile-First Sentry Alternative" },
    { property: "og:url", content: "https://rejourney.co/" },
    { name: "canonical", content: "https://rejourney.co/" },
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
                <ComparisonTable />
                <EngineeringCTA />
            </main>
            <Footer />
        </div>
    );
}
