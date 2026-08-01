import { describe, expect, it } from "vitest";
import {
    ALL_ARTICLES,
    ENGINEERING_ARTICLES,
    GUIDE_ARTICLES,
    getArticlePath,
} from "./engineering";

const EXPECTED_ENGINEERING_IDS = [
    "architecture-deep-dive",
    "flutter-sdk-open-beta",
    "maps-performance",
    "mobile-session-replay-cost",
    "rejourney-1-3-million-session-replays",
    "swift-package-open-beta",
].sort();

describe("public article collections", () => {
    it("keeps only technical implementation posts in Engineering", () => {
        expect(ENGINEERING_ARTICLES.map((article) => article.id).sort()).toEqual(EXPECTED_ENGINEERING_IDS);
        expect(ENGINEERING_ARTICLES.every((article) => article.collection === "engineering")).toBe(true);
        expect(ENGINEERING_ARTICLES.every((article) => getArticlePath(article).startsWith("/engineering/"))).toBe(true);
        expect(ENGINEERING_ARTICLES.every((article) => (article.schema as { "@type"?: string })["@type"] === "TechArticle")).toBe(true);
    });

    it("publishes every Markdown article as a guide", () => {
        expect(GUIDE_ARTICLES).toHaveLength(26);
        expect(GUIDE_ARTICLES.every((article) => article.collection === "guide")).toBe(true);
        expect(GUIDE_ARTICLES.every((article) => getArticlePath(article).startsWith("/guides/"))).toBe(true);
        expect(GUIDE_ARTICLES.every((article) => (article.schema as { "@type"?: string })["@type"] === "Article")).toBe(true);
    });

    it("exposes a complete registry without duplicate slugs", () => {
        expect(ALL_ARTICLES).toHaveLength(ENGINEERING_ARTICLES.length + GUIDE_ARTICLES.length);
        expect(new Set(ALL_ARTICLES.map((article) => article.id)).size).toBe(ALL_ARTICLES.length);
    });
});
