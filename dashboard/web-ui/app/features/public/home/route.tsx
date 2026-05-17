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
    MARKETING_AVAILABLE_LANGUAGES,
    MARKETING_LOCALE_VARY_HEADER,
    getMarketingAlternateLinks,
    getMarketingHomeCopy,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    getMarketingLocaleUrl,
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
    const alternateLinks = getMarketingAlternateLinks().map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getMarketingAlternateLinks()
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));

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
        { property: "og:image", content: "https://rejourney.co/rejourneyIcon-removebg-preview.png" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: locale.metaTitle },
        {
            name: "twitter:description",
            content: locale.metaDescription,
        },
        { name: "twitter:image", content: "https://rejourney.co/rejourneyIcon-removebg-preview.png" },
        { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
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
                                availableLanguage: MARKETING_AVAILABLE_LANGUAGES,
                                primaryImageOfPage: {
                                    "@type": "ImageObject",
                                    url: "https://rejourney.co/rejourneyIcon-removebg-preview.png",
                                },
                                isPartOf: {
                                    "@type": "WebSite",
                                    name: "Rejourney",
                                    url: "https://rejourney.co/",
                                    availableLanguage: MARKETING_AVAILABLE_LANGUAGES,
                                },
                                about: [
                                    ...locale.keywords,
                                ],
                            },
                            {
                                "@type": "SoftwareApplication",
                                name: "Rejourney",
                                inLanguage: locale.languageTag,
                                availableLanguage: MARKETING_AVAILABLE_LANGUAGES,
                                applicationCategory: "DeveloperApplication",
                                operatingSystem: "Web, iOS, Android, React Native, Expo",
                                softwareHelp: "https://rejourney.co/docs",
                                codeRepository: "https://github.com/rejourneyco/rejourney",
                                offers: {
                                    "@type": "Offer",
                                    price: "0",
                                    priceCurrency: "USD",
                                },
                                featureList: locale.features.map((feature) => `${feature.title} ${feature.highlight}`),
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
