/**
 * Dynamic docs route for markdown-based documentation
 * Handles routes like /docs/contribute, /docs/selfhosted, etc.
 */

import type { Route } from "./+types/docs.$slug";
import { DocsLayout } from "~/components/docs/DocsLayout";
import { DocsSidebar } from "~/components/docs/DocsSidebar";
import { MarkdownContent } from "~/components/docs/MarkdownContent";
import { getDocMetadata } from "~/utils/docsConfig";

export const meta: Route.MetaFunction = ({ params, location }) => {
    // Extract slug parameter - for splat routes (*), use params["*"]
    const slug = (params as { "*"?: string })["*"] || "";
    const metadata = getDocMetadata(slug);
    const domain = "https://rejourney.co";
    const canonicalUrl = `${domain}${location.pathname}`;

    if (!metadata) {
        return [{ title: "Documentation Not Found - Rejourney" }];
    }

    const title = `${metadata.title} - Rejourney Documentation`;
    const description = metadata.category
        ? `${metadata.title}: Learn about ${metadata.category} in Rejourney's open-source session replay and monitoring documentation.`
        : `${metadata.title} documentation for Rejourney's open-source mobile observability platform.`;

    return [
        { title },
        { name: "description", content: description },
        { name: "canonical", content: canonicalUrl },
        // OpenGraph
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: "Rejourney Documentation" },
        { property: "og:image", content: `${domain}/rejourneyIcon-removebg-preview.png` },
        // Twitter
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: `${domain}/rejourneyIcon-removebg-preview.png` },
    ];
};

export async function loader({ params }: Route.LoaderArgs) {
    const { loadDocContent, getDocMetadata } = await import("~/utils/docsLoader.server");
    // Extract slug parameter - for splat routes (*), use params["*"]
    const slug = (params as { "*"?: string })["*"] || "";
    const content = loadDocContent(slug);
    const metadata = getDocMetadata(slug);

    if (!content || !metadata) {
        throw new Response("Documentation not found", { status: 404 });
    }

    return {
        content,
        metadata,
    };
}

export default function DocPage({ loaderData }: Route.ComponentProps) {
    const { content, metadata } = loaderData;

    if (!metadata) {
        return (
            <DocsLayout sidebar={<DocsSidebar />}>
                <div className="text-center py-12">
                    <h1 className="text-2xl font-bold text-black mb-4">Documentation Not Found</h1>
                    <p className="text-gray-600">The requested documentation page could not be found.</p>
                </div>
            </DocsLayout>
        );
    }

    return (
        <DocsLayout
            sidebar={<DocsSidebar />}
        >
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "TechArticle",
                        "headline": metadata.title,
                        "description": `${metadata.title} documentation for Rejourney.`,
                        "category": metadata.category,
                        "publisher": {
                            "@type": "Organization",
                            "name": "Rejourney",
                            "logo": "https://rejourney.co/rejourneyIcon-removebg-preview.png"
                        }
                    })
                }}
            />
            <header className="mb-12">
                {metadata.category && (
                    <p className="text-sm text-gray-500 uppercase tracking-wide mb-2">
                        {metadata.category}
                    </p>
                )}
                <h1 className="text-3xl font-bold text-black mb-3">
                    {metadata.title}
                </h1>
            </header>

            <MarkdownContent content={content} />
        </DocsLayout>
    );
}
