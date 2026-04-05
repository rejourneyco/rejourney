/**
 * RSS feed for the engineering log — one item per article for discovery and readers.
 */

import { ARTICLES } from "~/shared/data/engineering";

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
    const itemsXml = ARTICLES.map((article) => {
        const link = `${base}/engineering/${article.urlDate}/${article.id}`;
        return `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${link}</link>
      <description>${escapeXml(article.subtitle)}</description>
      <author>contact@rejourney.co (${escapeXml(article.author.name)})</author>
      <pubDate>${articlePubDate(article.urlDate)}</pubDate>
      <guid isPermaLink="true">${link}</guid>
    </item>`;
    }).join("");

    const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Rejourney Engineering Log</title>
    <link>${base}/engineering</link>
    <description>Technical articles on React Native session replay, mobile observability, and how Rejourney is built.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml" />${itemsXml}
  </channel>
</rss>`;

    return new Response(rssFeed, {
        headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
        },
    });
}
