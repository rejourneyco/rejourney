/**
 * Dynamic docs route for markdown-based documentation
 * Handles routes like /docs/contribute, /docs/selfhosted, etc.
 */

import type { Route } from "./+types/route";
import { redirect } from "react-router";
import { DocsLayout } from "~/shared/docs/DocsLayout";
import { DocsSidebar } from "~/shared/docs/DocsSidebar";
import { MarkdownContent } from "~/shared/docs/MarkdownContent";
import { getDocMetadata } from "~/shared/lib/docsConfig";
import { getContentLocaleCopy, getLocalizedDocMetadata } from "~/shared/lib/contentLocalization";
import {
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicUrl,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    MARKETING_LOCALE_VARY_HEADER,
    MARKETING_LOCALES,
} from "~/shared/lib/internationalMarketing";

function getSlugFromParams(params: any): string {
    // Route is configured as /docs/* so React Router provides the splat param as "*"
    const raw = (params as any)["*"] || "";
    // Normalize by trimming any leading/trailing slashes
    return String(raw).replace(/^\/+|\/+$/g, "");
}

export const meta: Route.MetaFunction = ({ params, location }) => {
    const slug = getSlugFromParams(params as any);
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const metadata = getDocMetadata(slug);
    const domain = "https://rejourney.co";
    const canonicalPath = `/docs/${slug}`;
    const canonicalUrl = getLocalizedPublicUrl(locale, canonicalPath);
    const copy = getContentLocaleCopy(locale);
    const alternateLinks = getLocalizedAlternateLinksForPath(canonicalPath).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath(canonicalPath)
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));

    if (!metadata) {
        return [{ title: copy.documentationNotFoundTitle }];
    }

    const localizedMetadata = getLocalizedDocMetadata(metadata, locale);
    const title = `${localizedMetadata.title} - ${copy.docsTitleSuffix}`;
    const description = localizedMetadata.description ?? copy.docDefaultDescription(localizedMetadata.title);
    const keywords = localizedMetadata.keywords?.join(", ");

    return [
        { title },
        { name: "description", content: description },
        ...(keywords ? [{ name: "keywords", content: keywords }] : []),
        { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
        // OpenGraph
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: "Rejourney Documentation" },
        { property: "og:image", content: `${domain}/rejourneyIcon-removebg-preview.png` },
        // Twitter
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: `${domain}/rejourneyIcon-removebg-preview.png` },
    ];
};

export async function loader({ params, request }: Route.LoaderArgs) {
    const localeRedirectPath = getMarketingLocaleRedirectPath(request);
    if (localeRedirectPath) {
        throw redirect(localeRedirectPath, {
            status: 302,
            headers: {
                Vary: MARKETING_LOCALE_VARY_HEADER,
            },
        });
    }

    const { loadLocalizedDocContent, getDocMetadata } = await import("~/shared/lib/docsLoader.server");
    const slug = getSlugFromParams(params as any);
    const localeCode = getMarketingLocaleFromPathname(new URL(request.url).pathname).code;
    const loadedDoc = loadLocalizedDocContent(slug, localeCode);
    const metadata = getDocMetadata(slug);

    if (!loadedDoc || !metadata) {
        throw new Response("Documentation not found", { status: 404 });
    }

    return {
        content: loadedDoc.content,
        metadata,
        localeCode,
        contentLocaleCode: loadedDoc.localeCode,
    };
}

export default function DocPage({ loaderData }: Route.ComponentProps) {
    const { content, metadata, localeCode, contentLocaleCode } = loaderData;
    const locale = MARKETING_LOCALES[localeCode] ?? MARKETING_LOCALES.en;
    const contentLocale = MARKETING_LOCALES[contentLocaleCode] ?? MARKETING_LOCALES.en;
    const copy = getContentLocaleCopy(locale);
    const localizedMetadata = metadata ? getLocalizedDocMetadata(metadata, locale) : null;

    if (!localizedMetadata) {
        return (
            <DocsLayout sidebar={<DocsSidebar />}>
                <div className="text-center py-12">
                    <h1 className="text-2xl font-bold text-black mb-4">{copy.documentationNotFoundHeading}</h1>
                    <p className="text-gray-600">{copy.documentationNotFoundCopy}</p>
                </div>
            </DocsLayout>
        );
    }

    return (
        <DocsLayout
            sidebar={<DocsSidebar />}
            contentDir={contentLocale.dir}
            contentLang={contentLocale.languageTag}
        >
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@graph": [
                            {
                                "@type": "TechArticle",
                                "headline": localizedMetadata.title,
                                "description": localizedMetadata.description ?? copy.docDefaultDescription(localizedMetadata.title),
                                "inLanguage": locale.languageTag,
                                "category": localizedMetadata.category,
                                "keywords": localizedMetadata.keywords,
                                "mainEntityOfPage": {
                                    "@type": "WebPage",
                                    "@id": getLocalizedPublicUrl(locale, `/docs/${localizedMetadata.path}`)
                                },
                                "publisher": {
                                    "@type": "Organization",
                                    "name": "Rejourney",
                                    "inLanguage": locale.languageTag,
                                    "logo": "https://rejourney.co/rejourneyIcon-removebg-preview.png"
                                }
                            },
                            {
                                "@type": "BreadcrumbList",
                                "inLanguage": locale.languageTag,
                                "itemListElement": [
                                    {
                                        "@type": "ListItem",
                                        "position": 1,
                                        "name": copy.docsBreadcrumb,
                                        "item": getLocalizedPublicUrl(locale, "/docs/reactnative/overview")
                                    },
                                    {
                                        "@type": "ListItem",
                                        "position": 2,
                                        "name": localizedMetadata.title,
                                        "item": getLocalizedPublicUrl(locale, `/docs/${localizedMetadata.path}`)
                                    }
                                ]
                            }
                        ]
                    })
                }}
            />
            <header className="mb-12">
                {localizedMetadata.category && (
                    <p className="text-sm text-gray-500 uppercase tracking-wide mb-2">
                        {localizedMetadata.category}
                    </p>
                )}
                <h1 className="text-3xl font-bold text-black mb-3">
                    {localizedMetadata.title}
                </h1>
            </header>

            <MarkdownContent content={content} />
        </DocsLayout>
    );
}
