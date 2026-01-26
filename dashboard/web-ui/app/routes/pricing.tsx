/**
 * Rejourney Dashboard - Pricing Page Route
 */

import type { Route } from "./+types/pricing";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";
import { PricingTable } from "~/components/landing/PricingTable";

export const meta: Route.MetaFunction = () => [
    { title: "Pricing - Rejourney" },
    {
        name: "description",
        content: "Simple, transparent pricing for Rejourney. Start free, scale as you grow. Self-hosted option available.",
    },
    { property: "og:title", content: "Pricing - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/pricing" },
];

export default function Pricing() {
    return (
        <div className="min-h-screen w-full bg-white text-black">
            <Header />
            <main aria-label="Pricing" className="w-full">
                <PricingTable />
            </main>
            <Footer />
        </div>
    );
}
