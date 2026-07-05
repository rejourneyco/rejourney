/**
 * Rejourney - Landing Page Route
 * 
 * This is the main landing page, server-side rendered for SEO/crawlers.
 */

import React from "react";
import { redirect } from "react-router";
import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { AiLeakHomepage } from "~/features/public/home/components/AiLeakHomepage";
import {
    MARKETING_HOME_LOCALE_ORDER,
    MARKETING_LOCALES,
    MARKETING_LOCALE_VARY_HEADER,
    getMarketingAlternateLinks,
    getMarketingLocaleRedirectPath,
    getMarketingLocaleUrl,
} from "~/shared/lib/internationalMarketing";

const homeLocale = MARKETING_LOCALES.en;
const canonicalUrl = getMarketingLocaleUrl(homeLocale);
const socialPreviewImage = "https://rejourney.co/images/growth-engines.png?v=20260619";
const socialPreviewAlt = "Rejourney Shopify and subscription revenue dashboard preview";
const homeKeywords = homeLocale.keywords;

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

export const meta: Route.MetaFunction = () => {
    const alternateLinks = getMarketingAlternateLinks(MARKETING_HOME_LOCALE_ORDER).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));

    return [
        { title: homeLocale.metaTitle },
        {
            name: "description",
            content: homeLocale.metaDescription,
        },
        {
            name: "keywords",
            content: homeKeywords.join(", "),
        },
        { httpEquiv: "Content-Language", content: homeLocale.languageTag },
        { property: "og:locale", content: homeLocale.ogLocale },
        { property: "og:title", content: homeLocale.metaTitle },
        {
            property: "og:description",
            content: homeLocale.metaDescription,
        },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "website" },
        { property: "og:image", content: socialPreviewImage },
        { property: "og:image:width", content: "1564" },
        { property: "og:image:height", content: "1078" },
        { property: "og:image:alt", content: socialPreviewAlt },
        { property: "og:image:type", content: "image/png" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: homeLocale.metaTitle },
        {
            name: "twitter:description",
            content: homeLocale.metaDescription,
        },
        { name: "twitter:image", content: socialPreviewImage },
        { name: "twitter:image:alt", content: socialPreviewAlt },
        { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
    ];
};

export default function LandingPage() {
    return (
        <div className="public-readable-scope min-h-screen w-full bg-white text-slate-900 overflow-x-hidden" lang={homeLocale.languageTag} dir={homeLocale.dir}>
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
                                name: homeLocale.metaTitle,
                                description: homeLocale.metaDescription,
                                inLanguage: homeLocale.languageTag,
                                primaryImageOfPage: {
                                    "@type": "ImageObject",
                                    url: socialPreviewImage,
                                    width: 1564,
                                    height: 1078,
                                },
                                isPartOf: {
                                    "@type": "WebSite",
                                    "@id": "https://rejourney.co/#website",
                                    name: "Rejourney",
                                    url: "https://rejourney.co/",
                                },
                                about: [
                                    ...homeKeywords,
                                ],
                            },
                            {
                                "@type": "SoftwareApplication",
                                "@id": "https://rejourney.co/#software",
                                name: "Rejourney",
                                applicationCategory: "BusinessApplication",
                                operatingSystem: "Web, iOS, Android",
                                description: "Revenue recovery for Shopify, ecommerce, and app subscription teams. Rejourney shows checkout drop-off, failed billing, churn risk, and the replay-backed evidence behind each lost conversion.",
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
            <main aria-label={homeLocale.mainAriaLabel} className="w-full">
                <AiLeakHomepage />
            </main>
            <Footer />
        </div>
    );
}
