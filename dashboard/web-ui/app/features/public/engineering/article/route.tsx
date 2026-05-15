/**
 * Rejourney Dashboard - Engineering Article Page
 * Renders a specific engineering article based on the route slug.
 */

import type { MetaFunction, LoaderFunctionArgs } from "react-router";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { ARTICLES } from "~/shared/data/engineering";
import { ArrowLeft } from "lucide-react";
import { Link, redirect, useLocation, useParams } from "react-router";
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

function getArticleUrl(article: (typeof ARTICLES)[number], locale = getMarketingLocaleFromPathname("/")): string {
    return getLocalizedPublicUrl(locale, `/engineering/${article.urlDate}/${article.id}`);
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
        throw redirect(`${getLocalizedPublicPath(preferredLocale, `/engineering/${article.urlDate}/${article.id}`)}${requestUrl.search}`, {
            status: params.date !== article.urlDate ? 301 : 302,
            headers: {
                Vary: MARKETING_LOCALE_VARY_HEADER,
            },
        });
    }

    if (params.date !== article.urlDate) {
        const locale = getMarketingLocaleFromPathname(requestUrl.pathname);
        throw redirect(`${getLocalizedPublicPath(locale, `/engineering/${article.urlDate}/${article.id}`)}${requestUrl.search}`, { status: 301 });
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
    const canonicalPath = `/engineering/${article.urlDate}/${article.id}`;
    const canonicalUrl = getArticleUrl(article, locale);
    const metaTitle = localizedArticle.metaTitle;
    const metaDescription = localizedArticle.metaDescription;
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
    const metaTags = [
        { title: `${metaTitle} | ${copy.articleMetaTitleSuffix}` },
        { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
        { name: "description", content: metaDescription },
        { name: "keywords", content: localizedArticle.targetKeywords.join(", ") },
        { name: "author", content: article.author.name },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: metaTitle },
        { property: "og:description", content: metaDescription },
        { property: "og:type", content: "article" },
        { property: "og:url", content: canonicalUrl },
        { property: "og:image", content: article.image },
        { property: "og:image:alt", content: article.title },
        { property: "og:site_name", content: "Rejourney" },
        { property: "article:published_time", content: `${article.urlDate}T12:00:00.000Z` },
        { property: "article:modified_time", content: `${article.dateModified ?? article.urlDate}T12:00:00.000Z` },
        { property: "article:section", content: "Engineering" },
        { property: "article:author", content: article.author.name },
        ...article.seo.topicTags.map((tag) => ({ property: "article:tag", content: tag })),
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: metaTitle },
        { name: "twitter:description", content: metaDescription },
        { name: "twitter:image", content: article.image },
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
    const articleStructuredData = {
        ...article.schema,
        headline: localizedArticle.title,
        description: localizedArticle.metaDescription,
        inLanguage: locale.languageTag,
        url: canonicalUrl,
        keywords: localizedArticle.targetKeywords,
        dateModified: article.dateModified ?? article.urlDate,
        image: [article.image],
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
        <div className="public-readable-scope min-h-screen w-full bg-white text-slate-900 font-sans selection:bg-yellow-200 flex flex-col" lang={locale.languageTag} dir={locale.dir}>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(articleStructuredData),
                }}
            />
            <Header />

            <main className="flex-grow w-full">
                {/* Progress Bar (Conceptual - sticky top) */}
                <div className="sticky top-0 left-0 w-full h-1 bg-gray-100 z-50">
                    <div className="h-full bg-black w-full origin-left scale-x-0 animate-scroll-progress" />
                </div>

                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">

                    <Link to={getLocalizedPublicPath(locale, "/engineering")} className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-gray-500 hover:text-black mb-12 transition-colors">
                        <ArrowLeft size={16} /> {copy.backToEngineering}
                    </Link>

                    <article>
                        <header className="mb-16 border-b-4 border-black pb-12">
                            <div className="flex flex-wrap items-center gap-4 text-xs font-mono font-black uppercase tracking-widest text-blue-600 mb-6">
                                <span>{article.date}</span>
                                <span className="w-1 h-1 bg-gray-300 rounded-full" />
                                <span>{localizedArticle.readTime}</span>
                            </div>

                            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black uppercase tracking-tighter mb-8 leading-[0.9]">
                                {localizedArticle.title}
                            </h1>

                            <p className="text-xl sm:text-2xl font-medium text-gray-600 max-w-3xl leading-relaxed">
                                {localizedArticle.subtitle}
                            </p>

                            <div className="flex items-center gap-3 mt-8">
                                <div className="w-10 h-10 bg-gray-200 rounded-full overflow-hidden flex items-center justify-center font-bold text-gray-500">
                                    {article.author.name.charAt(0)}
                                </div>
                                <div className="text-sm">
                                    <div className="font-bold text-gray-900">{article.author.name}</div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                        <a href={article.author.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                            {copy.viewLinkedIn}
                                        </a>
                                        {article.author.github && (
                                            <a href={article.author.github} target="_blank" rel="noopener noreferrer" className="text-gray-900 hover:underline">
                                                {copy.viewGitHub}
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </header>

                        <div className="prose prose-xl prose-slate max-w-none prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter prose-img:rounded-none prose-img:border-2 prose-img:border-black">
                            {article.content}
                        </div>

                        <div className="mt-20 pt-12 border-t-2 border-gray-100">
                            <h3 className="text-2xl font-black uppercase tracking-tighter mb-8">{copy.authorHeading}</h3>
                            <div className="flex items-start gap-4">
                                <div className="w-16 h-16 bg-gray-200 rounded-full overflow-hidden flex items-center justify-center font-bold text-2xl text-gray-500">
                                    {article.author.name.charAt(0)}
                                </div>
                                <div>
                                    <div className="font-bold text-xl text-gray-900 mb-1">{article.author.name}</div>
                                    <p className="text-gray-500 text-sm mb-2">{copy.engineeringTeamLabel}</p>
                                    <div className="flex gap-4">
                                        <a href={article.author.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline">
                                            {copy.viewLinkedIn}
                                        </a>
                                        {article.author.github && (
                                            <a href={article.author.github} target="_blank" rel="noopener noreferrer" className="text-gray-900 font-bold hover:underline">
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
