/**
 * Dynamic sitemap.xml route
 * Generates an up-to-date sitemap including all documentation pages
 */

import { DOCS_MAP } from "~/shared/lib/docsConfig";
import { ARTICLES, getAbsoluteArticleImage, getArticlePath } from "~/shared/data/engineering";
import { SEO_PAGES } from "~/features/public/seo/seoPages";
import {
    MARKETING_HOME_LOCALE_ORDER,
    MARKETING_LOCALES,
    getMarketingAlternateLinks,
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicPath,
} from "~/shared/lib/internationalMarketing";

function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

interface SitemapRoute {
    path: string;
    priority: string;
    changefreq: string;
    lastmod?: string;
    image?: string;
    imageTitle?: string;
    alternates?: ReturnType<typeof getMarketingAlternateLinks>;
}

export async function loader() {
    const baseUrl = "https://rejourney.co";
    const lastModified = new Date().toISOString().slice(0, 10);

    const marketingRoutes: SitemapRoute[] = MARKETING_HOME_LOCALE_ORDER.map((code) => ({
        path: MARKETING_LOCALES[code].path,
        priority: "1.0",
        changefreq: "daily",
        alternates: getMarketingAlternateLinks(MARKETING_HOME_LOCALE_ORDER),
    }));

    const roadmapRoutes: SitemapRoute[] = [{
        path: getLocalizedPublicPath(MARKETING_LOCALES.en, "/roadmap"),
        priority: "0.7",
        changefreq: "weekly",
        alternates: getLocalizedAlternateLinksForPath("/roadmap"),
    }];

    const pricingRoutes: SitemapRoute[] = [{
        path: getLocalizedPublicPath(MARKETING_LOCALES.en, "/pricing"),
        priority: "0.95",
        changefreq: "weekly",
        alternates: getLocalizedAlternateLinksForPath("/pricing"),
    }];

    const productRoutes: SitemapRoute[] = [
        {
            path: getLocalizedPublicPath(MARKETING_LOCALES.en, "/how-it-works"),
            priority: "0.85",
            changefreq: "weekly",
            image: `${baseUrl}/images/growth-engines.png`,
            imageTitle: "How Rejourney recovers checkout and subscription revenue",
        },
        {
            path: getLocalizedPublicPath(MARKETING_LOCALES.en, "/rejourney-marlin"),
            priority: "0.8",
            changefreq: "weekly",
            image: `${baseUrl}/images/rejourney-marlin.png`,
            imageTitle: "Rejourney Marlin GitHub App",
        },
        {
            path: getLocalizedPublicPath(MARKETING_LOCALES.en, "/benchmarks"),
            priority: "0.6",
            changefreq: "monthly",
            image: `${baseUrl}/images/growth-engines.png`,
            imageTitle: "Rejourney benchmarks",
        },
    ];

    const seoRoutes: SitemapRoute[] = SEO_PAGES.map((page) => ({
        path: page.path,
        priority: page.kind === "alternative" ? "0.8" : "0.9",
        changefreq: "weekly",
        image: `${baseUrl}${page.image}`,
        imageTitle: page.imageAlt,
    }));

    const docRoutes: SitemapRoute[] = Object.keys(DOCS_MAP).map(slug => ({
        path: getLocalizedPublicPath(MARKETING_LOCALES.en, `/docs/${slug}`),
        priority: slug === "shopify/getting-started" ? "0.9" : slug === "reactnative/overview" ? "0.8" : "0.6",
        changefreq: "weekly",
        alternates: getLocalizedAlternateLinksForPath(`/docs/${slug}`),
    }));

    const engineeringIndexRoutes: SitemapRoute[] = [{
        path: getLocalizedPublicPath(MARKETING_LOCALES.en, "/engineering"),
        priority: "0.9",
        changefreq: "weekly",
        alternates: getLocalizedAlternateLinksForPath("/engineering"),
    }];

    const engineeringRoutes: SitemapRoute[] = ARTICLES.map(article => ({
        path: getLocalizedPublicPath(MARKETING_LOCALES.en, getArticlePath(article)),
        priority: "0.8",
        changefreq: "monthly",
        lastmod: article.dateModified ?? article.urlDate,
        image: getAbsoluteArticleImage(article),
        imageTitle: article.imageAlt ?? article.title,
        alternates: getLocalizedAlternateLinksForPath(getArticlePath(article)),
    }));

    // Generate XML content
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${[...marketingRoutes, ...roadmapRoutes, ...pricingRoutes, ...productRoutes, ...seoRoutes, ...docRoutes, ...engineeringIndexRoutes, ...engineeringRoutes].map(route => `
  <url>
    <loc>${escapeXml(`${baseUrl}${route.path}`)}</loc>
    <lastmod>${"lastmod" in route && route.lastmod ? route.lastmod : lastModified}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
    ${route.alternates ? route.alternates.map((alternate) => `<xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hrefLang)}" href="${escapeXml(alternate.href)}" />`).join("\n    ") : ""}
    ${route.image && route.imageTitle ? `<image:image>
      <image:loc>${escapeXml(route.image)}</image:loc>
      <image:title>${escapeXml(route.imageTitle)}</image:title>
    </image:image>` : ""}
  </url>`).join('')}
</urlset>`.trim();

    return new Response(sitemap, {
        headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=3600, s-maxage=18000"
        },
    });
}
