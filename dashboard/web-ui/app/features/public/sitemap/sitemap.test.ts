import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loader as sitemapLoader } from "./route";

describe("Dynamic Sitemap generation", () => {
    it("generates a valid XML sitemap with existing images and reciprocal hreflang links", async () => {
        const response = await sitemapLoader();
        expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");

        const xml = await response.text();
        expect(xml.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")).toBe(true);

        // 1. Parse all <loc> tags
        const locRegex = /<loc>(https:\/\/rejourney\.co[^<]*)<\/loc>/g;
        const locs: string[] = [];
        let match;
        while ((match = locRegex.exec(xml)) !== null) {
            locs.push(match[1]);
        }

        expect(locs.length).toBeGreaterThan(100);

        // Check no duplicates
        const uniqueLocs = new Set(locs);
        expect(uniqueLocs.size).toBe(locs.length);

        // Check that essential pages are present
        const essentialPages = [
            "https://rejourney.co/",
            "https://rejourney.co/pricing",
            "https://rejourney.co/roadmap",
            "https://rejourney.co/docs",
            "https://rejourney.co/docs/web/getting-started",
            "https://rejourney.co/engineering",
            "https://rejourney.co/guides",
            "https://rejourney.co/how-it-works",
            "https://rejourney.co/rejourney-marlin",
            "https://rejourney.co/benchmarks",
            "https://rejourney.co/terms-of-service",
            "https://rejourney.co/privacy-policy",
            "https://rejourney.co/dpa",
            "https://rejourney.co/attributions",
            "https://rejourney.co/ai/responsibleusage",
        ];

        for (const page of essentialPages) {
            expect(locs).toContain(page);
        }

        // Verify no authenticated dashboard routes leaked into sitemap
        expect(locs.some((url) => url.includes("/dashboard"))).toBe(false);

        // 2. Validate all <image:loc> exist on disk (prevents broken 404 images)
        const imageRegex = /<image:loc>(https:\/\/rejourney\.co(\/[^<]*))<\/image:loc>/g;
        const missingImages: string[] = [];
        while ((match = imageRegex.exec(xml)) !== null) {
            const relPath = match[2].split("?")[0];
            const localFile = join(process.cwd(), "public", relPath);
            if (!existsSync(localFile)) {
                missingImages.push(match[1]);
            }
        }
        expect(missingImages).toEqual([]);

        // 3. Check hreflang reciprocity
        const urlEntries = xml.split("<url>").slice(1);
        const mapUrlToAlternates = new Map<string, Array<{ hreflang: string; href: string }>>();
        for (const entry of urlEntries) {
            const locMatch = /<loc>(https:\/\/rejourney\.co[^<]*)<\/loc>/.exec(entry);
            if (!locMatch) continue;
            const pageLoc = locMatch[1];
            const altRegex = /<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g;
            const pageAlternates: Array<{ hreflang: string; href: string }> = [];
            let altMatch;
            while ((altMatch = altRegex.exec(entry)) !== null) {
                pageAlternates.push({ hreflang: altMatch[1], href: altMatch[2] });
            }
            mapUrlToAlternates.set(pageLoc, pageAlternates);
        }

        const reciprocityErrors: string[] = [];
        for (const [pageLoc, alts] of mapUrlToAlternates.entries()) {
            for (const alt of alts) {
                if (!locs.includes(alt.href)) {
                    reciprocityErrors.push(`${pageLoc} points to alternate ${alt.href} (${alt.hreflang}) which is NOT in sitemap`);
                } else {
                    const targetAlts = mapUrlToAlternates.get(alt.href);
                    if (!targetAlts || !targetAlts.some((t) => t.href === pageLoc)) {
                        reciprocityErrors.push(`${pageLoc} -> ${alt.href} (${alt.hreflang}) is not reciprocal`);
                    }
                }
            }
        }
        expect(reciprocityErrors).toEqual([]);
    });
});
