/**
 * Rejourney Dashboard - Pricing Page Route
 */

import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { PricingTable } from "~/features/public/home/components/PricingTable";

export const meta: Route.MetaFunction = () => [
    { title: "Pricing - Rejourney" },
    {
        name: "description",
        content: "Simple, transparent pricing for Rejourney. Start free, scale as you grow. Self-hosted option available.",
    },
    { name: "robots", content: "index, follow" },
    { property: "og:title", content: "Pricing - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/pricing" },
    { tagName: "link", rel: "canonical", href: "https://rejourney.co/pricing" },
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
