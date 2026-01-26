/**
 * Dynamic sitemap.xml route
 * Generates an up-to-date sitemap including all documentation pages
 */

import { DOCS_MAP } from "~/utils/docsConfig";

export async function loader() {
    const baseUrl = "https://rejourney.co";
    const lastModified = "2026-01-18"; // Last significant update date

    const staticRoutes = [
        { path: "/", priority: "1.0", changefreq: "daily" },
        { path: "/dashboard", priority: "0.9", changefreq: "daily" },
        { path: "/pricing", priority: "0.8", changefreq: "weekly" },
        { path: "/engineering", priority: "0.9", changefreq: "weekly" },
    ];

    const docRoutes = Object.keys(DOCS_MAP).map(slug => ({
        path: `/docs/${slug}`,
        priority: slug === "reactnative/overview" ? "0.9" : "0.7",
        changefreq: "weekly"
    }));

    // Generate XML content
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticRoutes, ...docRoutes].map(route => `
  <url>
    <loc>${baseUrl}${route.path}</loc>
    <lastmod>${lastModified}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
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
