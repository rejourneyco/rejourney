/**
 * Rejourney Dashboard - Docs Page Route
 * Now loads content from markdown files in the docs/ folder
 */

import type { Route } from "./+types/route";
import { redirect } from "react-router";
import { getContentLocaleCopy } from "~/shared/lib/contentLocalization";
import {
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicPath,
    getLocalizedPublicUrl,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    MARKETING_LOCALE_VARY_HEADER,
} from "~/shared/lib/internationalMarketing";

export const meta: Route.MetaFunction = ({ location }) => {
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale);
    const title = copy.docsIndexTitle;
    const description = copy.docsIndexDescription;
    const domain = "https://rejourney.co";
    const canonicalUrl = getLocalizedPublicUrl(locale, "/docs");
    const alternateLinks = getLocalizedAlternateLinksForPath("/docs").map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath("/docs")
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));

    return [
        { title },
        { name: "description", content: description },
        { name: "robots", content: "index, follow" },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
        // OpenGraph
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "website" },
        { property: "og:image", content: `${domain}/rejourneyIcon-removebg-preview.png` },
        // Twitter
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: `${domain}/rejourneyIcon-removebg-preview.png` },
    ];
};

export async function loader({ request }: Route.LoaderArgs) {
    const localeRedirectPath = getMarketingLocaleRedirectPath(request);
    if (localeRedirectPath) {
        return redirect(localeRedirectPath, {
            status: 302,
            headers: {
                Vary: MARKETING_LOCALE_VARY_HEADER,
            },
        });
    }

    const locale = getMarketingLocaleFromPathname(new URL(request.url).pathname);
    return redirect(getLocalizedPublicPath(locale, "/docs/reactnative/overview"));
}

export default function Docs() {
    return null;
}
