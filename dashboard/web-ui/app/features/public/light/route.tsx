/**
 * Rejourney legacy landing page.
 *
 * This preserves the pre-AI homepage composition at /light while the primary
 * homepage continues to use AiLeakHomepage.
 */

import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { EngineeringCTA } from "~/features/public/home/components/EngineeringCTA";
import { Hero } from "~/features/public/home/components/Hero";
import { LandingNarrative } from "~/features/public/home/components/LandingNarrative";
import { PerformanceMetrics } from "~/features/public/home/components/PerformanceMetrics";
import { TrustBanners } from "~/features/public/home/components/TrustBanners";
import {
    MARKETING_LOCALES,
    SITE_URL,
    getMarketingHomeCopy,
} from "~/shared/lib/internationalMarketing";

const locale = MARKETING_LOCALES.en;
const copy = getMarketingHomeCopy(locale);
const canonicalUrl = `${SITE_URL}/light`;
const socialPreviewImage = `${SITE_URL}/images/heatmaps.png`;

export const meta: Route.MetaFunction = () => [
    { title: `Rejourney Classic | ${locale.metaTitle}` },
    {
        name: "description",
        content: locale.metaDescription,
    },
    {
        name: "keywords",
        content: locale.keywords.join(", "),
    },
    { name: "robots", content: "noindex, follow, max-image-preview:large" },
    { httpEquiv: "Content-Language", content: locale.languageTag },
    { property: "og:locale", content: locale.ogLocale },
    { property: "og:title", content: `Rejourney Classic | ${locale.metaTitle}` },
    { property: "og:description", content: locale.metaDescription },
    { property: "og:url", content: canonicalUrl },
    { property: "og:type", content: "website" },
    { property: "og:image", content: socialPreviewImage },
    { property: "og:image:width", content: "998" },
    { property: "og:image:height", content: "794" },
    { property: "og:image:alt", content: "Rejourney heatmaps preview" },
    { property: "og:image:type", content: "image/png" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: `Rejourney Classic | ${locale.metaTitle}` },
    { name: "twitter:description", content: locale.metaDescription },
    { name: "twitter:image", content: socialPreviewImage },
    { name: "twitter:image:alt", content: "Rejourney heatmaps preview" },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
];

export default function LightLandingPage() {
    return (
        <div
            className="public-readable-scope min-h-screen w-full overflow-x-hidden bg-background text-foreground"
            lang={locale.languageTag}
            dir={locale.dir}
        >
            <Header />
            <main aria-label={`${locale.mainAriaLabel} — classic landing page`} className="w-full">
                <Hero copy={locale.hero} homeCopy={copy.hero} dir={locale.dir} />
                <TrustBanners copy={copy.trust} />
                <LandingNarrative copy={copy.narrative} dir={locale.dir} />
                <PerformanceMetrics copy={copy.performance} dir={locale.dir} />
                <EngineeringCTA copy={copy.engineeringCta} />
            </main>
            <Footer />
        </div>
    );
}
