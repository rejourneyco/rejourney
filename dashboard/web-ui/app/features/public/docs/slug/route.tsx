/**
 * Dynamic docs route for markdown-based documentation
 * Handles routes like /docs/contribute, /docs/selfhosted, etc.
 */

import type { Route } from "./+types/route";
import { useCallback } from "react";
import { redirect } from "react-router";
import { BookOpen } from "lucide-react";
import { DocsLayout } from "~/shared/docs/DocsLayout";
import { DocsSidebar } from "~/shared/docs/DocsSidebar";
import { DocsAIPromptCallout, getDocsAIPromptText, MarkdownContent } from "~/shared/docs/MarkdownContent";
import { getProjects, type ApiProject } from "~/shared/api/client";
import { buildProjectAIIntegrationPrompt, buildSelfHostedAIDeploymentPrompt } from "~/shared/constants/aiPrompts";
import { getDocMetadata } from "~/shared/lib/docsConfig";
import { getContentLocaleCopy, getLocalizedDocMetadata } from "~/shared/lib/contentLocalization";
import {
    MARKETING_LOCALE_ORDER,
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicPath,
    getLocalizedPublicUrl,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    MARKETING_LOCALE_VARY_HEADER,
    MARKETING_LOCALES,
} from "~/shared/lib/internationalMarketing";
import { useAuth } from "~/shared/providers/AuthContext";
import { useTeam } from "~/shared/providers/TeamContext";

function getSlugFromParams(params: any): string {
    // Route is configured as /docs/* so React Router provides the splat param as "*"
    const raw = (params as any)["*"] || "";
    // Normalize by trimming any leading/trailing slashes
    return String(raw).replace(/^\/+|\/+$/g, "");
}

const SELECTED_PROJECT_ID_KEY_PREFIX = "rejourney_selected_project_id";

function getStoredSelectedProjectId(teamId?: string | null): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    const teamStorageKey = teamId ? `${SELECTED_PROJECT_ID_KEY_PREFIX}:${teamId}` : null;
    return (teamStorageKey ? localStorage.getItem(teamStorageKey) : null)
        ?? localStorage.getItem(SELECTED_PROJECT_ID_KEY_PREFIX);
}

function selectProjectForDocsPrompt(projects: ApiProject[], teamId?: string | null): ApiProject | null {
    const teamProjects = projects.filter((project) => !teamId || !project.teamId || project.teamId === teamId);
    const candidateProjects = teamProjects.length > 0 ? teamProjects : projects;
    const storedProjectId = getStoredSelectedProjectId(teamId);

    if (storedProjectId) {
        const storedProject = candidateProjects.find((project) => project.id === storedProjectId);
        if (storedProject) {
            return storedProject;
        }
    }

    return candidateProjects[0] ?? null;
}

export const meta: Route.MetaFunction = ({ params, location }) => {
    const slug = getSlugFromParams(params as any);
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const metadata = getDocMetadata(slug);
    const domain = "https://rejourney.co";
    const canonicalPath = `/docs/${slug}`;
    const canonicalUrl = getLocalizedPublicUrl(locale, canonicalPath);
    const copy = getContentLocaleCopy(locale);
    const alternateLinks = getLocalizedAlternateLinksForPath(canonicalPath, MARKETING_LOCALE_ORDER).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath(canonicalPath, MARKETING_LOCALE_ORDER)
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));

    if (!metadata) {
        return [{ title: copy.documentationNotFoundTitle }];
    }

    const localizedMetadata = getLocalizedDocMetadata(metadata, locale);
    const title = `${localizedMetadata.title} - ${copy.docsTitleSuffix}`;
    const description = localizedMetadata.description ?? copy.docDefaultDescription(localizedMetadata.title);
    const keywords = localizedMetadata.keywords?.join(", ");
    const socialPreviewImageUrl = `${domain}/images/heatmaps.png`;

    return [
        { title },
        { name: "description", content: description },
        ...(keywords ? [{ name: "keywords", content: keywords }] : []),
        { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
        // OpenGraph
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: copy.docsSiteName },
        { property: "og:image", content: socialPreviewImageUrl },
        { property: "og:image:width", content: "998" },
        { property: "og:image:height", content: "794" },
        { property: "og:image:alt", content: "Rejourney heatmaps preview" },
        { property: "og:image:type", content: "image/png" },
        // Twitter
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: socialPreviewImageUrl },
        { name: "twitter:image:alt", content: "Rejourney heatmaps preview" },
    ];
};

export async function loader({ params, request }: Route.LoaderArgs) {
    const localeRedirectPath = getMarketingLocaleRedirectPath(request);
    if (localeRedirectPath) {
        throw redirect(localeRedirectPath, {
            status: 302,
            headers: {
                Vary: MARKETING_LOCALE_VARY_HEADER,
            },
        });
    }

    const { loadLocalizedDocContent, getDocMetadata } = await import("~/shared/lib/docsLoader.server");
    const slug = getSlugFromParams(params as any);
    const locale = getMarketingLocaleFromPathname(new URL(request.url).pathname);
    const localeCode = locale.code;

    if (slug === "web/overview") {
        throw redirect(getLocalizedPublicPath(locale, "/docs/web/getting-started"));
    }

    const loadedDoc = loadLocalizedDocContent(slug, localeCode);
    const metadata = getDocMetadata(slug);

    if (!loadedDoc || !metadata) {
        throw new Response("Documentation not found", { status: 404 });
    }

    return {
        content: loadedDoc.content,
        metadata,
        localeCode,
        contentLocaleCode: loadedDoc.localeCode,
    };
}

export default function DocPage({ loaderData }: Route.ComponentProps) {
    const { content, metadata, localeCode, contentLocaleCode } = loaderData;
    const { isAuthenticated } = useAuth();
    const { currentTeam } = useTeam();
    const locale = MARKETING_LOCALES[localeCode] ?? MARKETING_LOCALES.en;
    const contentLocale = MARKETING_LOCALES[contentLocaleCode] ?? MARKETING_LOCALES.en;
    const copy = getContentLocaleCopy(locale);
    const localizedMetadata = metadata ? getLocalizedDocMetadata(metadata, locale) : null;
    const aiPromptText = getDocsAIPromptText(content);
    const isSelfHostedOverview = metadata?.path === "selfhosted";
    const getDocsIntegrationPrompt = useCallback(async () => {
        if (isSelfHostedOverview) {
            return buildSelfHostedAIDeploymentPrompt();
        }

        if (!isAuthenticated) {
            return buildProjectAIIntegrationPrompt(null);
        }

        try {
            const projects = await getProjects();
            const project = selectProjectForDocsPrompt(projects, currentTeam?.id ?? null);
            return buildProjectAIIntegrationPrompt(project);
        } catch (error) {
            console.error("Failed to load project for docs AI integration prompt:", error);
            return buildProjectAIIntegrationPrompt(null);
        }
    }, [currentTeam?.id, isAuthenticated, isSelfHostedOverview]);

    if (!localizedMetadata) {
        return (
            <DocsLayout sidebar={<DocsSidebar />}>
                <div className="text-center py-12">
                    <h1 className="text-2xl font-bold text-black mb-4">{copy.documentationNotFoundHeading}</h1>
                    <p className="text-gray-600">{copy.documentationNotFoundCopy}</p>
                </div>
            </DocsLayout>
        );
    }

    return (
        <DocsLayout
            sidebar={<DocsSidebar />}
            contentDir={contentLocale.dir}
            contentLang={contentLocale.languageTag}
        >
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@graph": [
                            {
                                "@type": "TechArticle",
                                "headline": localizedMetadata.title,
                                "description": localizedMetadata.description ?? copy.docDefaultDescription(localizedMetadata.title),
                                "inLanguage": locale.languageTag,
                                ...(localizedMetadata.category ? { "articleSection": localizedMetadata.category } : {}),
                                "keywords": localizedMetadata.keywords,
                                "mainEntityOfPage": {
                                    "@type": "WebPage",
                                    "@id": getLocalizedPublicUrl(locale, `/docs/${localizedMetadata.path}`)
                                },
                                "publisher": {
                                    "@type": "Organization",
                                    "name": "Rejourney",
                                    "logo": "https://rejourney.co/rejourneyIcon-removebg-preview.png"
                                }
                            },
                            {
                                "@type": "BreadcrumbList",
                                "itemListElement": [
                                    {
                                        "@type": "ListItem",
                                        "position": 1,
                                        "name": copy.docsBreadcrumb,
                                        "item": getLocalizedPublicUrl(locale, "/docs/web/getting-started")
                                    },
                                    {
                                        "@type": "ListItem",
                                        "position": 2,
                                        "name": localizedMetadata.title,
                                        "item": getLocalizedPublicUrl(locale, `/docs/${localizedMetadata.path}`)
                                    }
                                ]
                            }
                        ]
                    })
                }}
            />
            <header className="mb-10 border border-slate-200 bg-white p-6 rounded-2xl shadow-sm sm:p-7 lg:p-8">
                <div className="mb-6 flex flex-wrap items-center gap-3">
                    {localizedMetadata.category && (
                        <p className="inline-flex items-center border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-bold uppercase text-indigo-700 rounded-md">
                            {localizedMetadata.category}
                        </p>
                    )}
                    <p className="inline-flex items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold uppercase text-slate-600 rounded-md">
                        <BookOpen className="h-3.5 w-3.5" />
                        {copy.docsBreadcrumb}
                    </p>
                </div>
                <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-end">
                    <div>
                        <h1 className="text-balance text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                            {localizedMetadata.title}
                        </h1>
                        {localizedMetadata.description && (
                            <p className="mt-5 max-w-3xl text-base font-medium leading-relaxed text-slate-600 sm:text-lg">
                                {localizedMetadata.description}
                            </p>
                        )}
                    </div>
                    <div className="text-sm font-bold text-slate-800">
                        {aiPromptText && (
                            <DocsAIPromptCallout
                                promptText={aiPromptText}
                                copyText={getDocsIntegrationPrompt}
                                compact
                                labels={isSelfHostedOverview
                                    ? {
                                        heading: "Use AI to deploy self-hosted",
                                        copyButton: "Copy Full Deployment Prompt",
                                        copied: copy.docsCopied,
                                    }
                                    : {
                                        heading: copy.docsAiHeading,
                                        copyButton: copy.docsCopyIntegrationPrompt,
                                        copied: copy.docsCopied,
                                    }}
                            />
                        )}
                    </div>
                </div>
            </header>

            <MarkdownContent
                content={content}
                showAIPrompt={false}
                checklistStorageKey={`${contentLocaleCode}:${metadata.path}`}
                aiPromptLabels={{
                    heading: copy.docsAiHeading,
                    copyButton: copy.docsCopyIntegrationPrompt,
                    copied: copy.docsCopied,
                }}
            />
        </DocsLayout>
    );
}
