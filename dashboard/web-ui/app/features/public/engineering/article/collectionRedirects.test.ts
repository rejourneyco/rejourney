import { describe, expect, it } from "vitest";
import { GUIDE_ARTICLES } from "~/shared/data/engineering";
import { loader } from "./route";

function runLoader(url: string, date: string, slug: string): Response | null {
    try {
        return loader({
            request: new Request(url),
            params: { date, slug },
            context: {},
        } as never) as null;
    } catch (error) {
        return error as Response;
    }
}

describe("article collection redirects", () => {
    it("permanently redirects a moved guide from Engineering and preserves attribution", () => {
        const response = runLoader(
            "https://rejourney.co/engineering/2026-07-12/revenue-leak-detection?utm_source=search",
            "2026-07-12",
            "revenue-leak-detection",
        );
        expect(response).toBeInstanceOf(Response);
        expect(response?.status).toBe(308);
        expect(response?.headers.get("Location")).toBe("/guides/2026-07-12/revenue-leak-detection?utm_source=search");
    });

    it("serves a guide directly from its canonical namespace", () => {
        const response = runLoader(
            "https://rejourney.co/guides/2026-07-12/revenue-leak-detection",
            "2026-07-12",
            "revenue-leak-detection",
        );
        expect(response).toBeNull();
    });

    it("permanently redirects every moved Markdown article to Guides", () => {
        for (const article of GUIDE_ARTICLES) {
            const query = "?gclid=legacy&utm_source=engineering";
            const response = runLoader(
                `https://rejourney.co/engineering/${article.urlDate}/${article.id}${query}`,
                article.urlDate,
                article.id,
            );
            expect(response?.status, article.id).toBe(308);
            expect(response?.headers.get("Location"), article.id).toBe(
                `/guides/${article.urlDate}/${article.id}${query}`,
            );
        }
    });
});
