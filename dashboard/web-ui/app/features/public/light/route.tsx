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
const pageTitle = "Lightweight Session Replay for Web & Mobile | Rejourney";
const pageDescription =
    "Lightweight session replay for web and mobile apps with console, network, error, and revenue-flow context. Start with 5,000 replays free each month.";
const socialPreviewImage = `${SITE_URL}/images/session-replay-preview.webp`;

export const meta: Route.MetaFunction = () => [
    { title: pageTitle },
    {
        name: "description",
        content: pageDescription,
    },
    {
        name: "keywords",
        content: locale.keywords.join(", "),
    },
    { name: "robots", content: "noindex, follow, max-image-preview:large" },
    { httpEquiv: "Content-Language", content: locale.languageTag },
    { property: "og:locale", content: locale.ogLocale },
    { property: "og:title", content: pageTitle },
    { property: "og:description", content: pageDescription },
    { property: "og:url", content: canonicalUrl },
    { property: "og:type", content: "website" },
    { property: "og:image", content: socialPreviewImage },
    { property: "og:image:width", content: "998" },
    { property: "og:image:height", content: "794" },
    { property: "og:image:alt", content: "Rejourney lightweight session replay preview" },
    { property: "og:image:type", content: "image/webp" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: pageTitle },
    { name: "twitter:description", content: pageDescription },
    { name: "twitter:image", content: socialPreviewImage },
    { name: "twitter:image:alt", content: "Rejourney lightweight session replay preview" },
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
