/**
 * Rejourney Dashboard - Engineering Page Index
 * Displays the list of available engineering articles.
 */

import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { ARTICLES, getArticlePath } from "~/shared/data/engineering";
import { Link, redirect, useLocation } from "react-router";
import { getContentLocaleCopy, getLocalizedArticleSeo } from "~/shared/lib/contentLocalization";
import {
    MARKETING_ENGINEERING_LOCALE_ORDER,
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
    "mobile-session-replay-cost": "/images/session-replay-preview.webp",
    "swift-package-open-beta": "/images/hero-replay-workbench.png",
    "rejourney-1-3-million-session-replays": "/images/engineering/k3s-cloud-setup.svg",
    "maps-performance": "/images/geo-intelligence.webp",
    "architecture-deep-dive": "/images/engineering/session-lifecycle.svg",
};

type EngineeringArticle = (typeof ARTICLES)[number];
type EngineeringSectionId = "latest" | "ux-research" | "team-tips" | "sdk-technicals" | "backend-technicals";

const ENGINEERING_SECTIONS: Array<{
    id: EngineeringSectionId;
    label: string;
    description: string;
    badgeClassName: string;
}> = [
    {
        id: "latest",
        label: "Latest",
        description: "Newest engineering notes from the Rejourney team.",
        badgeClassName: "bg-[#fef08a]",
    },
    {
        id: "ux-research",
        label: "UX Research",
        description: "Original Rejourney research backed by session evidence, cohorts, and product behavior data.",
        badgeClassName: "bg-[#bbf7d0]",
    },
    {
        id: "team-tips",
        label: "Tips from the Team",
        description: "Practical playbooks from the Rejourney team for reading analytics, replay, heatmaps, and friction signals.",
        badgeClassName: "bg-[#ddd6fe]",
    },
    {
        id: "sdk-technicals",
        label: "SDK Technicals",
        description: "Native SDK capture, mobile replay internals, maps, and runtime architecture.",
        badgeClassName: "bg-[#bfdbfe]",
    },
    {
        id: "backend-technicals",
        label: "Backend Technicals",
        description: "Infrastructure, replay storage, cost controls, ingest pipelines, and scaling notes.",
        badgeClassName: "bg-[#fbcfe8]",
    },
];

const ARTICLE_SECTIONS: Record<string, Exclude<EngineeringSectionId, "latest">> = {
    "fullstory-alternatives-small-teams": "team-tips",
    "smartlook-alternatives-cisco-eol": "team-tips",
    "hotjar-alternatives-replay-heatmaps": "team-tips",
    "product-analytics-tools-show-the-event": "team-tips",
    "churn-story-of-friction": "team-tips",
    "conversion-funnel-analytics-friction": "team-tips",
    "swift-package-open-beta": "sdk-technicals",
    "maps-performance": "sdk-technicals",
    "architecture-deep-dive": "sdk-technicals",
    "ambiguity-kills-app-growth": "ux-research",
    "mobile-session-replay-cost": "backend-technicals",
    "rejourney-1-3-million-session-replays": "backend-technicals",
};

function getArticleImage(article: (typeof ARTICLES)[number]): string {
    return ARTICLE_IMAGES[article.id] ?? article.image;
}

function getArticleImageUrl(article: (typeof ARTICLES)[number]): string {
    const image = getArticleImage(article);
    return image.startsWith("/") ? `${SITE_URL}${image}` : image;
}

function getEngineeringSectionFromSearch(search: string) {
    const requestedSection = new URLSearchParams(search).get("section");
    return ENGINEERING_SECTIONS.find((section) => section.id === requestedSection) ?? ENGINEERING_SECTIONS[0];
}

function getEngineeringSectionById(sectionId: EngineeringSectionId) {
    return ENGINEERING_SECTIONS.find((section) => section.id === sectionId) ?? ENGINEERING_SECTIONS[0];
}

function getEngineeringArticlesForSection(sectionId: EngineeringSectionId): EngineeringArticle[] {
    if (sectionId === "latest") return ARTICLES;
    return ARTICLES.filter((article) => ARTICLE_SECTIONS[article.id] === sectionId);
}

function getSectionArticleCount(sectionId: EngineeringSectionId): number {
    return getEngineeringArticlesForSection(sectionId).length;
}

function getArticleSection(article: EngineeringArticle) {
    return getEngineeringSectionById(ARTICLE_SECTIONS[article.id] ?? "latest");
}

function getArticleImageCropClass(article: EngineeringArticle): string {
    return article.id === "ambiguity-kills-app-growth"
        ? "origin-top-left object-left-top"
        : "object-center";
}

function ArticleGrid({
    articles,
    copy,
    engineeringPath,
    locale,
}: {
    articles: EngineeringArticle[];
    copy: ReturnType<typeof getContentLocaleCopy>;
    engineeringPath: string;
    locale: ReturnType<typeof getMarketingLocaleFromPathname>;
}) {
    return (
        <div className="grid gap-x-14 gap-y-20 lg:grid-cols-2">
            {articles.map((article, index) => {
                const localizedArticle = getLocalizedArticleSeo(article, locale);
                const articleSection = getArticleSection(article);
                return (
                    <Link
                        to={`${engineeringPath}/${article.urlDate}/${article.id}`}
                        key={article.id}
                        aria-label={copy.readArticleLabel(localizedArticle.title)}
                        className="group block"
                    >
                        <div className="aspect-[1.95/1] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm transition duration-300 group-hover:shadow-md group-hover:scale-[1.01]">
                            <img
                                src={getArticleImage(article)}
                                alt={article.imageAlt ?? localizedArticle.title}
                                className={`h-full w-full object-cover ${getArticleImageCropClass(article)} brightness-[0.96] saturate-[0.95] transition duration-300 group-hover:brightness-100 group-hover:saturate-100`}
                                loading={index < 2 ? "eager" : "lazy"}
                                decoding="async"
                            />
                        </div>
                        <div className="mt-6 flex flex-wrap items-center gap-3">
                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700 ${articleSection.badgeClassName}`}>
                                {articleSection.label}
                            </span>
                            <p className="text-sm font-medium text-slate-400">
                                {article.date} <span className="px-1 text-slate-300">·</span> {localizedArticle.readTime}
                            </p>
                        </div>
                        <h2 className="mt-4 text-2xl font-bold leading-snug tracking-tight text-slate-950 transition duration-200 group-hover:text-indigo-600">
                            {localizedArticle.title}
                        </h2>
                        <p className="mt-3 text-base font-normal leading-relaxed text-slate-500">
                            {localizedArticle.subtitle}
                        </p>
                    </Link>
                );
            })}
        </div>
    );
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
    const shouldIndex = locale.code === "en";
    const alternateLinks = getLocalizedAlternateLinksForPath("/engineering", MARKETING_ENGINEERING_LOCALE_ORDER).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath("/engineering", MARKETING_ENGINEERING_LOCALE_ORDER)
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
        { name: "robots", content: shouldIndex ? "index, follow" : "noindex, follow" },
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
    const selectedSection = getEngineeringSectionFromSearch(location.search);
    const selectedArticles = getEngineeringArticlesForSection(selectedSection.id);

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
                                numberOfItems: ARTICLES.length,
                                itemListElement: ARTICLES.map((article, index) => {
                                    const localizedArticle = getLocalizedArticleSeo(article, locale);
                                    return {
                                        "@type": "ListItem",
                                        position: index + 1,
                                        url: getLocalizedPublicUrl(locale, getArticlePath(article)),
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
                <section className="mx-auto max-w-[1500px] px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:px-10 lg:pb-24">
                    <div className="border-b border-slate-200 pb-12">
                        <p className="font-mono text-xs font-bold uppercase tracking-wider text-slate-400">{copy.engineeringFromTeam}</p>
                        <h1 className="mt-6 max-w-5xl text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                            {copy.engineeringHeading}
                        </h1>
                    </div>

                    <nav aria-label="Engineering sections" className="flex gap-8 overflow-x-auto border-b border-slate-200 pt-8">
                        {ENGINEERING_SECTIONS.map((section) => {
                            const isActive = section.id === selectedSection.id;
                            const href = section.id === "latest" ? engineeringPath : `${engineeringPath}?section=${section.id}`;

                            return (
                                <Link
                                    key={section.id}
                                    to={href}
                                    aria-current={isActive ? "page" : undefined}
                                    className={`shrink-0 border-b-2 px-1 pb-4 text-sm font-semibold transition ${
                                        isActive
                                            ? "border-indigo-600 text-indigo-600"
                                            : "border-transparent text-slate-500 hover:text-slate-800"
                                    }`}
                                >
                                    {section.label}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-14">
                        <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <p className="font-mono text-xs font-bold uppercase tracking-wider text-slate-400">
                                    {selectedSection.id === "latest" ? "Newest first" : "Selected track"}
                                </p>
                                <p className="mt-2 max-w-2xl text-lg font-semibold leading-7 text-slate-600">
                                    {selectedSection.description}
                                </p>
                            </div>
                            <p className="w-fit rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-600">
                                {selectedArticles.length} articles
                            </p>
                        </div>

                        <ArticleGrid
                            articles={selectedArticles}
                            copy={copy}
                            engineeringPath={engineeringPath}
                            locale={locale}
                        />
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    );
}
