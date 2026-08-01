import type { ReactNode } from "react";

export interface ArticleTableOfContentsItem {
    id: string;
    title: string;
    level: 2 | 3;
}

export interface Article {
    /** Controls the public collection, URL namespace, schema, and index inclusion. */
    collection: "engineering" | "guide";
    id: string;
    title: string;
    subtitle: string;
    /** Comma-separated phrases for legacy meta keywords - helps match long-tail searches to article topics */
    seoKeywords?: string;
    seo: {
        primaryKeyword: string;
        metaTitle: string;
        metaDescription: string;
        targetKeywords: string[];
        topicTags: string[];
    };
    author: {
        name: string;
        url: string; // LinkedIn
        github?: string;
    };
    image: string;
    imageAlt?: string;
    date: string;
    urlDate: string;
    dateModified?: string;
    readTime: string;
    timeRequired?: string;
    wordCount?: number;
    kind?: "tsx" | "markdown";
    tableOfContents?: ArticleTableOfContentsItem[];
    schema: object;
    content: ReactNode;
}
