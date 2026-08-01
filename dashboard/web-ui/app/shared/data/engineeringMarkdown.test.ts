import { describe, expect, it } from "vitest";
import { parseEngineeringMarkdownArticle } from "./engineeringMarkdown";

const researchArticle = `---
collection: guide
title: "Replay Cost Benchmark"
subtitle: "A measured comparison of mobile replay upload cost across capture strategies."
slug: "replay-cost-benchmark"
date: "2026-06-01"
dateModified: "2026-06-02"
image: "/images/engineering/session-lifecycle.svg"
imageAlt: "Session replay lifecycle diagram"
authorName: "Ada Lovelace"
authorUrl: "https://example.com/ada"
primaryKeyword: "mobile replay cost benchmark"
metaTitle: "Replay Cost Benchmark | Rejourney Engineering"
metaDescription: "A benchmark of mobile replay upload cost, storage cost, and capture strategy tradeoffs for session replay teams."
targetKeywords:
  - mobile replay cost benchmark
  - session replay storage cost
topicTags:
  - Research
  - Session Replay
---

## Summary

The benchmark compares three capture strategies and shows the default capture profile keeps upload bytes lower.

## Results

| Strategy | Upload bytes |
| --- | ---: |
| Baseline | 100 MB |
| Rejourney | 38 MB |

## Results

Repeated headings should still produce stable unique anchors.
`;

describe("engineering markdown articles", () => {
    it("parses research article frontmatter into SEO-ready article metadata", () => {
        const article = parseEngineeringMarkdownArticle(
            "./engineeringArticlesMarkdown/2026-06-01-replay-cost-benchmark.md",
            researchArticle
        );

        expect(article).not.toBeNull();
        expect(article?.id).toBe("replay-cost-benchmark");
        expect(article?.collection).toBe("guide");
        expect(article?.urlDate).toBe("2026-06-01");
        expect(article?.seo.primaryKeyword).toBe("mobile replay cost benchmark");
        expect(article?.image).toBe("/images/engineering/session-lifecycle.svg");
        expect(article?.schema).toMatchObject({
            "@type": "Article",
            headline: "Replay Cost Benchmark",
            articleSection: "Guides",
            thumbnailUrl: "https://rejourney.co/images/engineering/session-lifecycle.svg",
        });
        expect(article?.tableOfContents).toEqual([
            { id: "summary", title: "Summary", level: 2 },
            { id: "results", title: "Results", level: 2 },
            { id: "results-2", title: "Results", level: 2 },
        ]);
    });
});
