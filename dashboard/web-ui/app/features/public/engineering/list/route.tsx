/**
 * Rejourney Dashboard - Engineering Page Index
 * Displays the list of available engineering articles.
 */

import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { ARTICLES } from "~/shared/data/engineering";
import { Link, redirect, useLocation } from "react-router";
import { getContentLocaleCopy, getLocalizedArticleSeo } from "~/shared/lib/contentLocalization";
import {
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicPath,
    getLocalizedPublicUrl,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    MARKETING_LOCALE_VARY_HEADER,
} from "~/shared/lib/internationalMarketing";

const SITE_URL = "https://rejourney.co";
const ENGINEERING_KEYWORDS = Array.from(
    new Set(ARTICLES.flatMap((article) => article.seo.targetKeywords))
).join(", ");
const ARTICLE_IMAGES: Record<string, string> = {
    "mobile-session-replay-cost": "/images/session-replay-preview.png",
    "swift-package-open-beta": "/images/hero-replay-workbench.png",
    "rejourney-1-3-million-session-replays": "/images/engineering/k3s-cloud-setup.svg",
    "maps-performance": "/images/geo-intelligence.png",
    "architecture-deep-dive": "/images/engineering/session-lifecycle.svg",
};

function getArticleImage(article: (typeof ARTICLES)[number]): string {
    return ARTICLE_IMAGES[article.id] ?? article.image;
}

function getArticleImageUrl(article: (typeof ARTICLES)[number]): string {
    const image = getArticleImage(article);
    return image.startsWith("/") ? `${SITE_URL}${image}` : image;
}

export function loader({ request }: LoaderFunctionArgs) {
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

export const meta: MetaFunction = ({ location }) => {
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale);
    const canonicalUrl = getLocalizedPublicUrl(locale, "/engineering");
    const alternateLinks = getLocalizedAlternateLinksForPath("/engineering").map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath("/engineering")
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));

    return [
        { title: copy.engineeringMetaTitle },
        {
            name: "description",
            content: copy.engineeringMetaDescription,
        },
        {
            name: "keywords",
            content: Array.from(new Set([...ENGINEERING_KEYWORDS.split(", "), ...copy.docKeywords])).join(", "),
        },
        { name: "robots", content: "index, follow" },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: copy.engineeringCollectionName },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonicalUrl },
        {
            property: "og:description",
            content: copy.engineeringMetaDescription,
        },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
    ];
};

export default function EngineeringIndexPage() {
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale);
    const engineeringPath = getLocalizedPublicPath(locale, "/engineering");

    return (
        <div className="public-readable-scope min-h-screen w-full bg-white text-slate-950 font-sans selection:bg-sky-100 selection:text-slate-950 flex flex-col" lang={locale.languageTag} dir={locale.dir}>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@graph": [
                            {
                                "@type": "CollectionPage",
                                "@id": `${getLocalizedPublicUrl(locale, "/engineering")}#webpage`,
                                url: getLocalizedPublicUrl(locale, "/engineering"),
                                name: copy.engineeringCollectionName,
                                inLanguage: locale.languageTag,
                                description: copy.engineeringMetaDescription,
                                isPartOf: {
                                    "@type": "WebSite",
                                    name: "Rejourney",
                                    url: "https://rejourney.co/",
                                },
                                mainEntity: { "@id": `${getLocalizedPublicUrl(locale, "/engineering")}#posts` },
                            },
                            {
                                "@type": "ItemList",
                                "@id": `${getLocalizedPublicUrl(locale, "/engineering")}#posts`,
                                name: copy.engineeringCollectionName,
                                inLanguage: locale.languageTag,
                                numberOfItems: ARTICLES.length,
                                itemListElement: ARTICLES.map((article, index) => {
                                    const localizedArticle = getLocalizedArticleSeo(article, locale);
                                    return {
                                        "@type": "ListItem",
                                        position: index + 1,
                                        url: getLocalizedPublicUrl(locale, `/engineering/${article.urlDate}/${article.id}`),
                                        name: localizedArticle.title,
                                        description: localizedArticle.metaDescription,
                                        image: getArticleImageUrl(article),
                                        keywords: localizedArticle.targetKeywords,
                                    };
                                }),
                            },
                        ],
                    }),
                }}
            />
            <Header />

            <main className="w-full flex-grow">
                <section className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:px-10 lg:pb-24">
                    <div className="mb-12 sm:mb-14">
                        <p className="text-base font-semibold text-slate-500">{copy.engineeringFromTeam}</p>
                        <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-none tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
                            {copy.engineeringHeading}
                        </h1>
                        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
                            {copy.engineeringIntro}
                        </p>
                    </div>

                    <div className="grid gap-x-10 gap-y-16 md:grid-cols-2 xl:grid-cols-3">
                        {ARTICLES.map((article, index) => {
                            const localizedArticle = getLocalizedArticleSeo(article, locale);
                            return (
                                <Link
                                    to={`${engineeringPath}/${article.urlDate}/${article.id}`}
                                    key={article.id}
                                    aria-label={copy.readArticleLabel(localizedArticle.title)}
                                    className={index < 2 ? "group block md:col-span-1" : "group block"}
                                >
                                    <div className="aspect-[1.9/1] overflow-hidden rounded-md border border-slate-200 bg-slate-50 shadow-sm">
                                        <img
                                            src={getArticleImage(article)}
                                            alt=""
                                            className="h-full w-full object-cover brightness-[0.96] saturate-[0.95] transition duration-300 group-hover:scale-[1.015] group-hover:brightness-100 group-hover:saturate-100"
                                            loading={index < 2 ? "eager" : "lazy"}
                                        />
                                    </div>
                                    <p className="mt-5 text-base font-semibold text-slate-500">
                                        {article.date} <span className="px-1.5 text-slate-300">·</span> {localizedArticle.readTime}
                                    </p>
                                    <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-normal text-slate-950 transition group-hover:text-sky-700 sm:text-3xl">
                                        {localizedArticle.title}
                                    </h2>
                                    <p className="mt-3 text-lg leading-relaxed text-slate-600">
                                        {localizedArticle.subtitle}
                                    </p>
                                </Link>
                            );
                        })}
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    );
}
