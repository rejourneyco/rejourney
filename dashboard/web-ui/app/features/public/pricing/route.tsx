/**
 * Rejourney Dashboard - Pricing Page Route
 */

import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { PricingTable } from "~/features/public/home/components/PricingTable";
import { redirect, useLocation } from "react-router";
import { getContentLocaleCopy } from "~/shared/lib/contentLocalization";
import {
    MARKETING_INDEXABLE_LOCALE_ORDER,
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicUrl,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    isIndexableMarketingLocale,
    MARKETING_LOCALE_VARY_HEADER,
} from "~/shared/lib/internationalMarketing";

export function loader({ request }: Route.LoaderArgs) {
    const localeRedirectPath = getMarketingLocaleRedirectPath(request);
    if (localeRedirectPath) {
        throw redirect(localeRedirectPath, {
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
    const copy = getContentLocaleCopy(locale).pricing;
    const canonicalUrl = getLocalizedPublicUrl(locale, "/pricing");
    const alternateLinks = getLocalizedAlternateLinksForPath("/pricing", MARKETING_INDEXABLE_LOCALE_ORDER).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath("/pricing", MARKETING_INDEXABLE_LOCALE_ORDER)
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));
    const robots = isIndexableMarketingLocale(locale)
        ? "index, follow, max-image-preview:large, max-snippet:-1"
        : "noindex, follow, max-image-preview:large";

    return [
        { title: copy.metaTitle },
        {
            name: "description",
            content: copy.metaDescription,
        },
        {
            name: "keywords",
            content: copy.metaKeywords.join(", "),
        },
        { name: "robots", content: robots },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: copy.ogTitle },
        {
            property: "og:description",
            content: copy.ogDescription,
        },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "website" },
        { property: "og:image", content: "https://rejourney.co/images/heatmaps.png" },
        { property: "og:image:width", content: "998" },
        { property: "og:image:height", content: "794" },
        { property: "og:image:alt", content: "Rejourney heatmaps preview" },
        { property: "og:image:type", content: "image/png" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: copy.twitterTitle },
        {
            name: "twitter:description",
            content: copy.ogDescription,
        },
        { name: "twitter:image", content: "https://rejourney.co/images/heatmaps.png" },
        { name: "twitter:image:alt", content: "Rejourney heatmaps preview" },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
    ];
};

export default function Pricing() {
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale).pricing;
    const canonicalUrl = getLocalizedPublicUrl(locale, "/pricing");

    return (
        <div className="public-readable-scope min-h-screen w-full bg-white text-black" lang={locale.languageTag} dir={locale.dir}>
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
                                name: copy.pageName,
                                inLanguage: locale.languageTag,
                                description: copy.metaDescription,
                                isPartOf: {
                                    "@type": "WebSite",
                                    name: "Rejourney",
                                    url: "https://rejourney.co/",
                                },
                            },
                            {
                                "@type": "OfferCatalog",
                                name: copy.pageName,
                                itemListElement: [
                                    {
                                        "@type": "Offer",
                                        name: "Starter",
                                        price: "5",
                                        priceCurrency: "USD",
                                        url: canonicalUrl,
                                        itemOffered: {
                                            "@type": "Service",
                                            name: "Rejourney Starter",
                                            serviceType: "Shopify and app subscription revenue recovery",
                                        },
                                    },
                                    {
                                        "@type": "Offer",
                                        name: "Growth",
                                        price: "15",
                                        priceCurrency: "USD",
                                        url: canonicalUrl,
                                        itemOffered: {
                                            "@type": "Service",
                                            name: "Rejourney Growth",
                                            serviceType: "Shopify and app subscription revenue recovery",
                                        },
                                    },
                                    {
                                        "@type": "Offer",
                                        name: "Pro",
                                        price: "35",
                                        priceCurrency: "USD",
                                        url: canonicalUrl,
                                        itemOffered: {
                                            "@type": "Service",
                                            name: "Rejourney Pro",
                                            serviceType: "Shopify and app subscription revenue recovery",
                                        },
                                    },
                                    {
                                        "@type": "Offer",
                                        name: "Scale",
                                        price: "149",
                                        priceCurrency: "USD",
                                        url: canonicalUrl,
                                        itemOffered: {
                                            "@type": "Service",
                                            name: "Rejourney Scale",
                                            serviceType: "Shopify and app subscription revenue recovery with Smart Capture",
                                        },
                                    },
                                ],
                            },
                        ],
                    }),
                }}
            />
            <Header noSpacer />
            <main aria-label={copy.ariaLabel} className="w-full">
                <PricingTable />
            </main>
            <Footer />
        </div>
    );
}
