/**
 * RSS Feed Route for Engineering Page
 */

import type { Route } from "./+types/feed.xml";

export async function loader() {
    const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Rejourney Engineering</title>
    <link>https://rejourney.co/engineering</link>
    <description>Engineering documentation and technical details for Rejourney</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="https://rejourney.co/feed.xml" rel="self" type="application/rss+xml" />
    <item>
      <title>Engineering - Rejourney</title>
      <link>https://rejourney.co/engineering</link>
      <description>Engineering documentation and technical details for Rejourney. Learn about our session replay implementation, crash detection, and observability architecture.</description>
      <author>contact@rejourney.co (Mohammad Rashid)</author>
      <pubDate>Fri, 10 Jan 2026 00:00:00 GMT</pubDate>
      <guid isPermaLink="true">https://rejourney.co/engineering</guid>
    </item>
  </channel>
</rss>`;

    return new Response(rssFeed, {
        headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
        },
    });
}
