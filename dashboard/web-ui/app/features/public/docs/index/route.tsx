/**
 * Rejourney Dashboard - Docs Page Route
 * Now loads content from markdown files in the docs/ folder
 */

import type { Route } from "./+types/route";
import { DocsLayout } from "~/shared/docs/DocsLayout";
import { DocsSidebar } from "~/shared/docs/DocsSidebar";
import { DocsTableOfContents } from "~/shared/docs/DocsTableOfContents";
import { MarkdownContent } from "~/shared/docs/MarkdownContent";
import { extractTOCFromMarkdown } from "~/shared/lib/markdownTOC";

export const meta: Route.MetaFunction = ({ location }) => {
    const title = "React Native Documentation - Rejourney";
    const description = "Rejourney React Native SDK: Open-source session replay, crash monitoring, and mobile observability. Get started in 3 lines of code.";
    const domain = "https://rejourney.co";
    const canonicalUrl = `${domain}${location.pathname}`;

    return [
        { title },
        { name: "description", content: description },
        { name: "robots", content: "index, follow" },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        // OpenGraph
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "website" },
        { property: "og:image", content: `${domain}/rejourneyIcon-removebg-preview.png` },
        // Twitter
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: `${domain}/rejourneyIcon-removebg-preview.png` },
    ];
};

import { redirect } from "react-router";

export async function loader() {
    return redirect("/docs/reactnative/overview");
}

export default function Docs() {
    return null;
}
