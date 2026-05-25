/**
 * Rejourney Dashboard - Engineering Article Page
 * Renders a specific engineering article based on the route slug.
 */

import type { MetaFunction, LoaderFunctionArgs } from "react-router";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { ARTICLES, getAbsoluteArticleImage, getArticlePath } from "~/shared/data/engineering";
import { ArrowLeft } from "lucide-react";
import { Link, redirect, useLocation, useParams } from "react-router";
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
const MAX_TITLE_LENGTH = 60;

function getArticleUrl(article: (typeof ARTICLES)[number], locale = getMarketingLocaleFromPathname("/")): string {
    return getLocalizedPublicUrl(locale, getArticlePath(article));
}

function withArticleTitleSuffix(title: string, suffix: string): string {
    const withSuffix = `${title} | ${suffix}`;
    return withSuffix.length <= MAX_TITLE_LENGTH ? withSuffix : title;
}

// Loader to validate slug
export function loader({ params, request }: LoaderFunctionArgs) {
    const article = ARTICLES.find((a) => a.id === params.slug);
    if (!article) {
        throw new Response("Article not found", { status: 404 });
    }

    const requestUrl = new URL(request.url);
    const localeRedirectPath = getMarketingLocaleRedirectPath(request);
    if (localeRedirectPath) {
        const preferredLocale = getMarketingLocaleFromPathname(localeRedirectPath);
        throw redirect(`${getLocalizedPublicPath(preferredLocale, getArticlePath(article))}${requestUrl.search}`, {
            status: params.date !== article.urlDate ? 301 : 302,
            headers: {
                Vary: MARKETING_LOCALE_VARY_HEADER,
            },
        });
    }

    if (params.date !== article.urlDate) {
        const locale = getMarketingLocaleFromPathname(requestUrl.pathname);
        throw redirect(`${getLocalizedPublicPath(locale, getArticlePath(article))}${requestUrl.search}`, { status: 301 });
    }

    return null;
}

export const meta: MetaFunction = ({ params, location }) => {
    const article = ARTICLES.find((a) => a.id === params.slug);
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale);
    if (!article) {
        return [{ title: "Article Not Found - Rejourney" }];
    }
    const localizedArticle = getLocalizedArticleSeo(article, locale);
    const canonicalPath = getArticlePath(article);
    const canonicalUrl = getArticleUrl(article, locale);
    const imageUrl = getAbsoluteArticleImage(article);
    const imageAlt = article.imageAlt ?? localizedArticle.title;
    const metaTitle = localizedArticle.metaTitle;
    const metaDescription = localizedArticle.metaDescription;
    const pageTitle = withArticleTitleSuffix(metaTitle, copy.articleMetaTitleSuffix);
    const shouldIndex = locale.code === "en";
    const publishedTime = `${article.urlDate}T12:00:00.000Z`;
    const modifiedTime = `${article.dateModified ?? article.urlDate}T12:00:00.000Z`;
    const alternateLinks = getLocalizedAlternateLinksForPath(canonicalPath, MARKETING_ENGINEERING_LOCALE_ORDER).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath(canonicalPath, MARKETING_ENGINEERING_LOCALE_ORDER)
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));
    const metaTags = [
        { title: pageTitle },
        { name: "robots", content: shouldIndex ? "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" : "noindex, follow, max-image-preview:large" },
        { name: "description", content: metaDescription },
        { name: "keywords", content: localizedArticle.targetKeywords.join(", ") },
        { name: "news_keywords", content: article.seo.topicTags.join(", ") },
        { name: "author", content: article.author.name },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: metaTitle },
        { property: "og:description", content: metaDescription },
        { property: "og:type", content: "article" },
        { property: "og:url", content: canonicalUrl },
        { property: "og:image", content: imageUrl },
        { property: "og:image:secure_url", content: imageUrl },
        { property: "og:image:alt", content: imageAlt },
        { property: "og:site_name", content: "Rejourney" },
        { property: "og:updated_time", content: modifiedTime },
        { property: "article:published_time", content: publishedTime },
        { property: "article:modified_time", content: modifiedTime },
        { property: "article:section", content: "Engineering" },
        { property: "article:author", content: article.author.name },
        ...article.seo.topicTags.map((tag) => ({ property: "article:tag", content: tag })),
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: metaTitle },
        { name: "twitter:description", content: metaDescription },
        { name: "twitter:image", content: imageUrl },
        { name: "twitter:image:alt", content: imageAlt },
        { name: "twitter:label1", content: "Written by" },
        { name: "twitter:data1", content: article.author.name },
        { name: "twitter:label2", content: "Read time" },
        { name: "twitter:data2", content: localizedArticle.readTime },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
    ];
    return metaTags;
};

export default function EngineeringArticlePage() {
    const { slug } = useParams();
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale);
    const article = ARTICLES.find((a) => a.id === slug);

    if (!article) {
        return <div>{copy.documentationNotFoundHeading}</div>;
    }

    const canonicalUrl = getArticleUrl(article, locale);
    const localizedArticle = getLocalizedArticleSeo(article, locale);
    const imageUrl = getAbsoluteArticleImage(article);
    const imageAlt = article.imageAlt ?? localizedArticle.title;
    const sameAs = [article.author.url, article.author.github].filter(Boolean);
    const articleStructuredData = {
        ...article.schema,
        "@context": "https://schema.org",
        headline: localizedArticle.title,
        description: localizedArticle.metaDescription,
        inLanguage: locale.languageTag,
        url: canonicalUrl,
        datePublished: article.urlDate,
        keywords: localizedArticle.targetKeywords,
        dateModified: article.dateModified ?? article.urlDate,
        image: [{
            "@type": "ImageObject",
            url: imageUrl,
            caption: imageAlt,
        }],
        thumbnailUrl: imageUrl,
        articleSection: "Engineering",
        ...(article.wordCount ? { wordCount: article.wordCount } : {}),
        ...(article.timeRequired ? { timeRequired: article.timeRequired } : {}),
        author: {
            "@type": "Person",
            name: article.author.name,
            url: article.author.url,
            ...(sameAs.length ? { sameAs } : {}),
        },
        mainEntityOfPage: {
            "@type": "WebPage",
            "@id": canonicalUrl,
        },
        isPartOf: {
            "@type": "WebSite",
            name: "Rejourney",
            url: SITE_URL,
        },
        about: article.seo.topicTags.map((tag) => ({
            "@type": "Thing",
            name: tag,
        })),
        publisher: {
            "@type": "Organization",
            name: "Rejourney",
            logo: {
                "@type": "ImageObject",
                url: `${SITE_URL}/rejourneyIcon-removebg-preview.png`,
            },
        },
    };
    return (
        <div className="public-readable-scope engineering-article-page flex min-h-screen w-full flex-col bg-[#fbfbf8] font-sans text-slate-900 selection:bg-sky-100 selection:text-slate-950" lang={locale.languageTag} dir={locale.dir}>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(articleStructuredData),
                }}
            />
            <Header />

            <main className="flex-grow w-full">
                {/* Progress Bar (Conceptual - sticky top) */}
                <div className="sticky left-0 top-0 z-50 h-1 w-full bg-slate-200/70">
                    <div className="h-full w-full origin-left scale-x-0 bg-sky-600 animate-scroll-progress" />
                </div>

                <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 lg:px-8">

                    <Link to={getLocalizedPublicPath(locale, "/engineering")} className="mb-10 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-950">
                        <ArrowLeft size={16} /> {copy.backToEngineering}
                    </Link>

                    <article className="mx-auto max-w-[760px]">
                        <header className="mb-14 border-b border-slate-200 pb-10">
                            <div className="mb-6 flex flex-wrap items-center gap-3 text-sm font-semibold text-sky-700">
                                <span>{article.date}</span>
                                <span className="h-1 w-1 rounded-full bg-slate-300" />
                                <span>{localizedArticle.readTime}</span>
                            </div>

                            <h1 className="mb-7 text-pretty font-display text-[2.45rem] font-extrabold leading-[1.06] tracking-normal text-slate-950">
                                {localizedArticle.title}
                            </h1>

                            <p className="max-w-[720px] text-[1.15rem] font-normal leading-8 text-slate-600">
                                {localizedArticle.subtitle}
                            </p>

                            <div className="mt-8 flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-sm font-bold text-slate-500">
                                    {article.author.name.charAt(0)}
                                </div>
                                <div className="text-sm">
                                    <div className="font-semibold text-slate-900">{article.author.name}</div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                        <a href={article.author.url} target="_blank" rel="noopener noreferrer" className="font-medium text-sky-700 hover:underline">
                                            {copy.viewLinkedIn}
                                        </a>
                                        {article.author.github && (
                                            <a href={article.author.github} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-700 hover:text-slate-950 hover:underline">
                                                {copy.viewGitHub}
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </header>

                    </article>

                    <div className="relative mx-auto max-w-7xl">
                        <div className="engineering-article-body mx-auto max-w-[760px] space-y-8">
                            {article.content}
                        </div>

                        {article.tableOfContents?.length ? (
                            <aside className="absolute left-[calc(50%+25rem)] top-0 hidden w-56 2xl:block">
                                <nav className="sticky top-24 border-l border-slate-200 pl-5" aria-label={copy.articleOnThisPage}>
                                    <p className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-500">{copy.articleOnThisPage}</p>
                                    <ol className="space-y-3">
                                        {article.tableOfContents.map((item) => (
                                            <li key={item.id} className={item.level === 3 ? "pl-4" : undefined}>
                                                <a href={`#${item.id}`} className="block text-sm font-medium leading-snug text-slate-600 transition hover:text-slate-950">
                                                    {item.title}
                                                </a>
                                            </li>
                                        ))}
                                    </ol>
                                </nav>
                            </aside>
                        ) : null}
                    </div>

                    <article className="mx-auto max-w-[760px]">
                        <div className="mt-20 border-t border-slate-200 pt-10">
                            <h3 className="mb-8 font-display text-2xl font-bold tracking-normal text-slate-950">{copy.authorHeading}</h3>
                            <div className="flex items-start gap-4">
                                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-2xl font-bold text-slate-500">
                                    {article.author.name.charAt(0)}
                                </div>
                                <div>
                                    <div className="mb-1 text-xl font-semibold text-slate-900">{article.author.name}</div>
                                    <p className="mb-2 text-sm text-slate-500">{copy.engineeringTeamLabel}</p>
                                    <div className="flex gap-4">
                                        <a href={article.author.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-700 hover:underline">
                                            {copy.viewLinkedIn}
                                        </a>
                                        {article.author.github && (
                                            <a href={article.author.github} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-700 hover:text-slate-950 hover:underline">
                                                {copy.viewGitHub}
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </article>

                </div>
            </main>
            <Footer />
        </div>
    );
}
