import { EngineeringMarkdownContent } from "~/shared/engineering/EngineeringMarkdownContent";
import {
    extractMarkdownTableOfContents,
    markdownToPlainText,
} from "~/shared/lib/markdownHeadings";
import type { Article } from "./engineeringTypes";

const SITE_URL = "https://rejourney.co";
const DEFAULT_AUTHOR = {
    name: "Mohammad Rashid",
    url: "https://www.linkedin.com/in/mohammad-rashid7337/",
    github: "https://github.com/Mohammad-R-Rashid",
};

type FrontmatterValue = boolean | string | string[];
type Frontmatter = Record<string, FrontmatterValue>;

const markdownModules = import.meta.glob<string>(
    ["./engineeringArticlesMarkdown/*.md", "!./engineeringArticlesMarkdown/_*.md"],
    {
        eager: true,
        query: "?raw",
        import: "default",
    }
);

function basename(path: string): string {
    return path.split("/").pop() ?? path;
}

function stripMarkdownExtension(path: string): string {
    return basename(path).replace(/\.md$/i, "");
}

function parseScalar(value: string): string | boolean {
    const trimmed = value.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function parseFrontmatter(yaml: string): Frontmatter {
    const data: Frontmatter = {};
    const lines = yaml.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim() || line.trim().startsWith("#")) {
            continue;
        }

        const keyMatch = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
        if (!keyMatch) {
            continue;
        }

        const [, key, rawValue] = keyMatch;
        if (rawValue === "|" || rawValue === ">") {
            const blockLines: string[] = [];
            while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
                index += 1;
                blockLines.push(lines[index].replace(/^\s{2,}/, ""));
            }
            data[key] = rawValue === "|" ? blockLines.join("\n").trim() : blockLines.join(" ").trim();
            continue;
        }

        if (rawValue.trim()) {
            data[key] = parseScalar(rawValue);
            continue;
        }

        const listItems: string[] = [];
        while (index + 1 < lines.length) {
            const nextLine = lines[index + 1];
            const listMatch = /^\s*-\s+(.*)$/.exec(nextLine);
            if (!listMatch) {
                break;
            }
            index += 1;
            listItems.push(String(parseScalar(listMatch[1])));
        }
        data[key] = listItems;
    }

    return data;
}

function splitFrontmatter(source: string, filePath: string): { data: Frontmatter; body: string } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
    if (!match) {
        throw new Error(`Engineering markdown article "${filePath}" is missing frontmatter.`);
    }

    return {
        data: parseFrontmatter(match[1]),
        body: match[2].trim(),
    };
}

function optionalString(data: Frontmatter, key: string): string | undefined {
    const value = data[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(data: Frontmatter, key: string, filePath: string): string {
    const value = optionalString(data, key);
    if (!value) {
        throw new Error(`Engineering markdown article "${filePath}" is missing "${key}" frontmatter.`);
    }
    return value;
}

function stringArray(data: Frontmatter, key: string, filePath: string): string[] {
    const value = data[key];
    if (Array.isArray(value)) {
        return value.map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value === "string") {
        return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
    throw new Error(`Engineering markdown article "${filePath}" is missing "${key}" list frontmatter.`);
}

function booleanValue(data: Frontmatter, key: string): boolean {
    return data[key] === true;
}

function requiredCollection(data: Frontmatter, filePath: string): Article["collection"] {
    const value = requiredString(data, "collection", filePath);
    if (value !== "engineering" && value !== "guide") {
        throw new Error(`Article "${filePath}" has unsupported collection "${value}".`);
    }
    return value;
}

function deriveSlug(filePath: string, data: Frontmatter): string {
    const explicitSlug = optionalString(data, "slug");
    if (explicitSlug) {
        return explicitSlug;
    }

    return stripMarkdownExtension(filePath).replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

function deriveUrlDate(filePath: string, data: Frontmatter): string {
    const explicitUrlDate = optionalString(data, "urlDate");
    if (explicitUrlDate) {
        return explicitUrlDate;
    }

    const date = optionalString(data, "date");
    if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) {
        return date.slice(0, 10);
    }

    const fileDate = /^(\d{4}-\d{2}-\d{2})-/.exec(stripMarkdownExtension(filePath))?.[1];
    if (fileDate) {
        return fileDate;
    }

    throw new Error(`Engineering markdown article "${filePath}" needs a YYYY-MM-DD date in frontmatter or filename.`);
}

function formatDisplayDate(urlDate: string): string {
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(`${urlDate}T12:00:00.000Z`));
}

function absoluteUrl(url: string): string {
    return url.startsWith("/") ? `${SITE_URL}${url}` : url;
}

function estimateReadTime(wordCount: number): string {
    const minutes = Math.max(1, Math.ceil(wordCount / 220));
    return `${minutes} min read`;
}

function buildSchema(article: {
    collection: Article["collection"];
    id: string;
    title: string;
    subtitle: string;
    metaDescription: string;
    image: string;
    imageAlt?: string;
    author: Article["author"];
    urlDate: string;
    dateModified?: string;
    targetKeywords: string[];
    topicTags: string[];
    wordCount: number;
    timeRequired: string;
}) {
    const collectionPath = article.collection === "engineering" ? "engineering" : "guides";
    const url = `${SITE_URL}/${collectionPath}/${article.urlDate}/${article.id}`;
    const sameAs = [article.author.url, article.author.github].filter(Boolean);

    return {
        "@context": "https://schema.org",
        "@type": article.collection === "engineering" ? "TechArticle" : "Article",
        headline: article.title,
        description: article.metaDescription,
        url,
        image: [absoluteUrl(article.image)],
        thumbnailUrl: absoluteUrl(article.image),
        datePublished: article.urlDate,
        dateModified: article.dateModified ?? article.urlDate,
        articleSection: article.collection === "engineering" ? "Engineering" : "Guides",
        keywords: article.targetKeywords,
        wordCount: article.wordCount,
        timeRequired: article.timeRequired,
        author: {
            "@type": "Person",
            name: article.author.name,
            url: article.author.url,
            sameAs,
        },
        publisher: {
            "@type": "Organization",
            name: "Rejourney",
            logo: {
                "@type": "ImageObject",
                url: `${SITE_URL}/rejourneyIcon-removebg-preview.png`,
            },
        },
        mainEntityOfPage: {
            "@type": "WebPage",
            "@id": url,
        },
        about: article.topicTags.map((tag) => ({
            "@type": "Thing",
            name: tag,
        })),
    };
}

export function parseEngineeringMarkdownArticle(filePath: string, source: string): Article | null {
    const { data, body } = splitFrontmatter(source, filePath);
    if (booleanValue(data, "draft")) {
        return null;
    }

    const id = deriveSlug(filePath, data);
    const collection = requiredCollection(data, filePath);
    const urlDate = deriveUrlDate(filePath, data);
    const title = requiredString(data, "title", filePath);
    const subtitle = requiredString(data, "subtitle", filePath);
    const primaryKeyword = requiredString(data, "primaryKeyword", filePath);
    const metaTitle = optionalString(data, "metaTitle")
        ?? `${title} | ${collection === "engineering" ? "Rejourney Engineering" : "Rejourney Guides"}`;
    const metaDescription = requiredString(data, "metaDescription", filePath);
    const targetKeywords = stringArray(data, "targetKeywords", filePath);
    const topicTags = stringArray(data, "topicTags", filePath);
    const image = requiredString(data, "image", filePath);
    const imageAlt = optionalString(data, "imageAlt") ?? title;
    const author = {
        name: optionalString(data, "authorName") ?? DEFAULT_AUTHOR.name,
        url: optionalString(data, "authorUrl") ?? DEFAULT_AUTHOR.url,
        github: optionalString(data, "authorGithub") ?? DEFAULT_AUTHOR.github,
    };
    const plainText = markdownToPlainText(body);
    const wordCount = plainText ? plainText.split(/\s+/).length : 0;
    const readTime = optionalString(data, "readTime") ?? estimateReadTime(wordCount);
    const readTimeMinutes = readTime.match(/\d+/)?.[0] ?? "1";
    const timeRequired = `PT${readTimeMinutes}M`;
    const dateModified = optionalString(data, "dateModified");

    return {
        collection,
        id,
        title,
        subtitle,
        seoKeywords: optionalString(data, "seoKeywords") ?? targetKeywords.join(", "),
        seo: {
            primaryKeyword,
            metaTitle,
            metaDescription,
            targetKeywords,
            topicTags,
        },
        author,
        image,
        imageAlt,
        date: optionalString(data, "dateLabel") ?? formatDisplayDate(urlDate),
        urlDate,
        dateModified,
        readTime,
        timeRequired,
        wordCount,
        kind: "markdown",
        tableOfContents: extractMarkdownTableOfContents(body),
        schema: buildSchema({
            collection,
            id,
            title,
            subtitle,
            metaDescription,
            image,
            imageAlt,
            author,
            urlDate,
            dateModified,
            targetKeywords,
            topicTags,
            wordCount,
            timeRequired,
        }),
        content: <EngineeringMarkdownContent content={body} />,
    };
}

export const markdownEngineeringArticles: Article[] = Object.entries(markdownModules)
    .map(([filePath, source]) => parseEngineeringMarkdownArticle(filePath, source))
    .filter((article): article is Article => article !== null);
