/**
 * RSS feed for Rejourney engineering articles and practical guides.
 */

import { ALL_ARTICLES, getAbsoluteArticleImage, getArticlePath } from "~/shared/data/engineering";

function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function articlePubDate(urlDate: string): string {
    const d = new Date(`${urlDate}T12:00:00.000Z`);
    return d.toUTCString();
}

export async function loader() {
    const base = "https://rejourney.co";
    const itemsXml = ALL_ARTICLES.map((article) => {
        const link = `${base}${getArticlePath(article)}`;
        const image = getAbsoluteArticleImage(article);
        return `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${link}</link>
      <description>${escapeXml(article.seo.metaDescription)}</description>
      <author>contact@rejourney.co (${escapeXml(article.author.name)})</author>
      <pubDate>${articlePubDate(article.urlDate)}</pubDate>
      <guid isPermaLink="true">${link}</guid>
      <category>${article.collection === "engineering" ? "Engineering" : "Guides"}</category>
      ${article.seo.topicTags.map((tag) => `<category>${escapeXml(tag)}</category>`).join("")}
      <media:content url="${escapeXml(image)}" medium="image" />
      <media:thumbnail url="${escapeXml(image)}" />
    </item>`;
    }).join("");

    const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Rejourney Articles</title>
    <link>${base}/guides</link>
    <description>Technical engineering notes and practical guides to product analytics, session replay, conversion, and mobile app behavior.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <ttl>60</ttl>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml" />${itemsXml}
  </channel>
</rss>`;

    return new Response(rssFeed, {
        headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
        },
    });
}
