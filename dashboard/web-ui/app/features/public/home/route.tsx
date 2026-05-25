/**
 * Rejourney Dashboard - Landing Page Route
 * 
 * This is the main landing page, server-side rendered for SEO/crawlers.
 */

import React from "react";
import { redirect, useLocation } from "react-router";
import type { Route } from "./+types/route";
import { Hero } from "~/features/public/home/components/Hero";
import { TrustBanners } from "~/features/public/home/components/TrustBanners";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { EngineeringCTA } from "~/features/public/home/components/EngineeringCTA";
import { LandingNarrative } from "~/features/public/home/components/LandingNarrative";
import { PerformanceMetrics } from "~/features/public/home/components/PerformanceMetrics";
import {
    MARKETING_INDEXABLE_LOCALE_ORDER,
    MARKETING_LOCALE_VARY_HEADER,
    getMarketingAlternateLinks,
    getMarketingHomeCopy,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    getMarketingLocaleUrl,
    isIndexableMarketingLocale,
} from "~/shared/lib/internationalMarketing";

export function loader({ request }: Route.LoaderArgs) {
    const redirectPath = getMarketingLocaleRedirectPath(request);
    if (redirectPath) {
        throw redirect(redirectPath, {
            status: 302,
            headers: {
                Vary: MARKETING_LOCALE_VARY_HEADER,
            },
        });
    }

    return null;
}

export const meta: Route.MetaFunction = ({ location }) => {
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const canonicalUrl = getMarketingLocaleUrl(locale);
    const alternateLinks = getMarketingAlternateLinks(MARKETING_INDEXABLE_LOCALE_ORDER).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getMarketingAlternateLinks(MARKETING_INDEXABLE_LOCALE_ORDER)
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));
    const robots = isIndexableMarketingLocale(locale)
        ? "index, follow, max-image-preview:large, max-snippet:-1"
        : "noindex, follow, max-image-preview:large";

    return [
        { title: locale.metaTitle },
        {
            name: "description",
            content: locale.metaDescription,
        },
        {
            name: "keywords",
            content: locale.keywords.join(", "),
        },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: locale.metaTitle },
        {
            property: "og:description",
            content: locale.metaDescription,
        },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "website" },
        { property: "og:image", content: "https://rejourney.co/images/heatmaps.png" },
        { property: "og:image:width", content: "998" },
        { property: "og:image:height", content: "794" },
        { property: "og:image:alt", content: "Rejourney heatmaps preview" },
        { property: "og:image:type", content: "image/png" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: locale.metaTitle },
        {
            name: "twitter:description",
            content: locale.metaDescription,
        },
        { name: "twitter:image", content: "https://rejourney.co/images/heatmaps.png" },
        { name: "twitter:image:alt", content: "Rejourney heatmaps preview" },
        { name: "robots", content: robots },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
    ];
};

export default function LandingPage() {
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getMarketingHomeCopy(locale);
    const canonicalUrl = getMarketingLocaleUrl(locale);

    return (
        <div className="public-readable-scope min-h-screen w-full bg-background text-foreground overflow-x-hidden" lang={locale.languageTag} dir={locale.dir}>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@graph": [
                            {
                                "@type": "WebPage",
                                "@id": `${canonicalUrl}#webpage`,
                                url: canonicalUrl,
                                name: locale.metaTitle,
                                description: locale.metaDescription,
                                inLanguage: locale.languageTag,
                                primaryImageOfPage: {
                                    "@type": "ImageObject",
                                    url: "https://rejourney.co/images/heatmaps.png",
                                    width: 998,
                                    height: 794,
                                },
                                isPartOf: {
                                    "@type": "WebSite",
                                    "@id": "https://rejourney.co/#website",
                                    name: "Rejourney",
                                    url: "https://rejourney.co/",
                                },
                                about: [
                                    ...locale.keywords,
                                ],
                            },
                            {
                                "@type": "SoftwareApplication",
                                "@id": "https://rejourney.co/#software",
                                name: "Rejourney",
                                applicationCategory: "BusinessApplication",
                                operatingSystem: "Web, iOS, Android",
                                description: "Record user sessions with web and mobile session replay, heatmaps, user journeys, crash context, API context, product analytics, and privacy masking.",
                                url: "https://rejourney.co/",
                                offers: {
                                    "@type": "Offer",
                                    price: "0",
                                    priceCurrency: "USD",
                                    url: "https://rejourney.co/pricing",
                                },
                                publisher: {
                                    "@type": "Organization",
                                    "@id": "https://rejourney.co/#organization",
                                    name: "Rejourney",
                                },
                            },
                        ],
                    }),
                }}
            />
            <Header />
            <main aria-label={locale.mainAriaLabel} className="w-full">
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
