import { describe, expect, it } from "vitest";
import { GUIDE_ARTICLES, getArticlePath } from "~/shared/data/engineering";
import { loader as sitemapLoader } from "~/features/public/sitemap/route";
import { SEO_PAGES } from "./seoPages";
import {
    SEO_LOCALIZED_LOCALE_CODES,
    SEO_LOCALIZED_PAGE_PATHS,
    getLocalizedSeoAlternateLinks,
    getLocalizedSeoPage,
    getLocalizedSeoPath,
    getPreferredSeoLocaleCode,
} from "./seoLocalization";
import {
    buildLocalizedSeoJsonLd,
    buildLocalizedSeoRenderPage,
    buildSeoJsonLd,
    getSeoLandingHeadline,
    getSeoLocaleRedirectPath,
    landingHrefWithAttribution,
    meta,
} from "./route";

const PRIORITY_KEYWORD_OWNERS = {
    "/record-user-sessions": "session replay tools",
    "/web-session-replay": "web session replay",
    "/mobile-session-replay": "mobile session replay",
    "/what-is-session-replay": "what is session replay",
    "/app-analytics": "mobile app analytics",
    "/website-analytics": "user experience analytics",
    "/funnel-replay-evidence": "funnel analysis",
    "/heatmaps": "website heatmap tools",
    "/stability-monitoring": "mobile app crash reporting",
} as const;

describe("SEO landing-page configurations", () => {
    it("defines the complete route inventory across three intentional families", () => {
        expect(SEO_PAGES).toHaveLength(27);
        expect(SEO_PAGES.filter((page) => page.kind === "capability")).toHaveLength(13);
        expect(SEO_PAGES.filter((page) => page.kind === "educational")).toHaveLength(5);
        expect(SEO_PAGES.filter((page) => page.kind === "alternative")).toHaveLength(9);
    });

    it("provides conversion, outcome, and SEO data for every page", () => {
        for (const page of SEO_PAGES) {
            expect(page.pageFamily).toBe(page.kind);
            expect(page.hero.title).toBeTruthy();
            expect(page.outcomes).toHaveLength(3);
            expect(page.proofStory.metric).toBeTruthy();
            expect(page.cta.primaryHref).toBe("/login");
            expect(page.cta.secondaryHref).toBe("/demo");
            expect(page.metaTitle).toBeTruthy();
            expect([...page.metaTitle].length).toBeLessThanOrEqual(60);
            expect(page.metaDescription).toBeTruthy();
            expect(page.primaryKeyword.trim()).toBeTruthy();
            expect(page.secondaryKeywords).not.toContain(page.primaryKeyword);
            expect(["commercial", "comparison", "informational"]).toContain(page.searchIntent);
            expect(page.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(page.image.startsWith("/images/")).toBe(true);
            expect(page.faq.length).toBeGreaterThan(0);
        }
    });

    it("assigns the audited commercial and informational keyword owners", () => {
        for (const [path, primaryKeyword] of Object.entries(PRIORITY_KEYWORD_OWNERS)) {
            const page = SEO_PAGES.find((entry) => entry.path === path);
            expect(page?.primaryKeyword).toBe(primaryKeyword);
        }

        expect(GUIDE_ARTICLES.find((article) => getArticlePath(article) === "/guides/2026-07-12/customer-journey-analytics")?.seo.primaryKeyword).toBe("customer journey analytics");
        expect(GUIDE_ARTICLES.find((article) => getArticlePath(article) === "/guides/2026-05-25/product-analytics-tools-show-the-event")?.seo.primaryKeyword).toBe("product analytics tools");
        expect(GUIDE_ARTICLES.find((article) => getArticlePath(article) === "/guides/2026-05-25/conversion-funnel-analytics-friction")?.seo.primaryKeyword).toBe("conversion funnel analytics");
    });

    it("keeps primary keywords unique across landing pages and guides", () => {
        const owners = [
            ...SEO_PAGES.map((page) => ({ keyword: page.primaryKeyword, path: page.path })),
            ...GUIDE_ARTICLES.map((article) => ({ keyword: article.seo.primaryKeyword, path: getArticlePath(article) })),
        ];
        const normalizedOwners = owners.map((owner) => ({ ...owner, keyword: owner.keyword.trim().toLocaleLowerCase("en-US") }));

        expect(new Set(normalizedOwners.map((owner) => owner.keyword)).size).toBe(normalizedOwners.length);
    });

    it("keeps API endpoint insights narrow and creates specific capability sections", () => {
        const apiPage = SEO_PAGES.find((page) => page.path === "/api-endpoint-insights");
        const deliberateApiKeywords = [apiPage?.primaryKeyword, ...(apiPage?.secondaryKeywords ?? [])]
            .filter((keyword): keyword is string => Boolean(keyword))
            .map((keyword) => keyword.toLocaleLowerCase("en-US"));

        expect(deliberateApiKeywords).not.toContain("api monitoring");
        expect(deliberateApiKeywords).not.toContain("api monitoring dashboard");
        for (const path of ["/mobile-session-replay", "/heatmaps", "/stability-monitoring"]) {
            expect(SEO_PAGES.find((page) => page.path === path)?.keywordSections?.length).toBeGreaterThanOrEqual(3);
        }
    });

    it("uses question-led landing content for mobile replay instead of platform shorthand", () => {
        const mobileReplayPage = SEO_PAGES.find((page) => page.path === "/mobile-session-replay");

        expect(mobileReplayPage?.keywordSections?.map((section) => section.title)).toEqual([
            "What did the user tap before the flow broke?",
            "Was it app state, network, or stability?",
            "Which devices and releases share the pattern?",
        ]);
        expect(JSON.stringify(mobileReplayPage)).not.toContain("Native iOS + Android");
    });

    it("keeps priority capability summaries concise and question-led", () => {
        const priorityCapabilityPages = Object.keys(PRIORITY_KEYWORD_OWNERS)
            .filter((path) => path !== "/what-is-session-replay")
            .map((path) => SEO_PAGES.find((page) => page.path === path));

        for (const page of priorityCapabilityPages) {
            expect(page?.keywordSections).toHaveLength(3);
            for (const section of page?.keywordSections ?? []) {
                expect(section.title.endsWith("?")).toBe(true);
                expect(section.description.length).toBeLessThanOrEqual(120);
            }
        }
    });

    it("renders one audited H1 and indexable metadata contract per page", () => {
        const expectedHeadlines = new Map([
            ["/web-session-replay", "Web Session Replay Software"],
            ["/mobile-session-replay", "Mobile App Session Replay"],
            ["/app-analytics", "Mobile App Analytics with Session Replay"],
            ["/website-analytics", "User Experience Analytics for Websites"],
            ["/funnel-replay-evidence", "Funnel Analysis with Replay Evidence"],
            ["/stability-monitoring", "Mobile App Crash Reporting with Replay"],
            ["/revenue-recovery-analytics", "Product Analytics For Revenue Leaks"],
        ]);

        for (const page of SEO_PAGES) {
            expect(getSeoLandingHeadline(page)).toBe(expectedHeadlines.get(page.path) ?? page.hero.title);

            const descriptors = meta({ location: { pathname: page.path } } as Parameters<typeof meta>[0]) as Array<Record<string, string>>;
            expect(descriptors.filter((descriptor) => descriptor.title)).toEqual([{ title: page.metaTitle }]);
            expect(descriptors).toContainEqual({ name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" });
            expect(descriptors).toContainEqual({ tagName: "link", rel: "canonical", href: `https://rejourney.co${page.path}` });
        }
    });

    it("keeps valid webpage, software, FAQ, and breadcrumb JSON-LD on every page", () => {
        for (const page of SEO_PAGES) {
            const jsonLd = JSON.parse(JSON.stringify(buildSeoJsonLd(page))) as { "@graph": Array<{ "@type": string; "@id"?: string }> };
            const types = jsonLd["@graph"].map((entry) => entry["@type"]);

            expect(types).toEqual(expect.arrayContaining(["WebPage", "SoftwareApplication", "FAQPage", "BreadcrumbList"]));
            expect(jsonLd["@graph"].find((entry) => entry["@type"] === "WebPage")?.["@id"]).toBe(`https://rejourney.co${page.path}#webpage`);
        }
    });

    it("keeps comparison claims sourced", () => {
        for (const page of SEO_PAGES.filter((entry) => entry.kind === "alternative")) {
            expect(page.comparison.enabled).toBe(true);
            expect(page.comparisonRows.length).toBeGreaterThanOrEqual(5);
            expect(page.officialSources?.length).toBeGreaterThan(0);
            expect(page.lastReviewed).toBeTruthy();
            expect(page.relatedPages.some((related) => !related.href.startsWith("/alternatives/"))).toBe(true);
        }
    });

    it("keeps outcomes and next steps distinct instead of repeating generic modules", () => {
        for (const page of SEO_PAGES) {
            expect(new Set(page.outcomes.map((outcome) => outcome.title)).size).toBe(3);
            expect(new Set(page.relatedPages.map((related) => related.href)).size).toBe(page.relatedPages.length);
            expect(page.relatedPages).toHaveLength(3);
            expect(page.relatedPages.every((related) => related.href !== page.path)).toBe(true);
        }
    });
});

describe("localized priority SEO pages", () => {
    it("uses browser language preferences rather than geography", () => {
        expect(getPreferredSeoLocaleCode("ar-SA,ar;q=0.9,en;q=0.8")).toBe("ar");
        expect(getPreferredSeoLocaleCode("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
        expect(getPreferredSeoLocaleCode("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
        expect(getPreferredSeoLocaleCode("de-DE,de;q=0.9,en;q=0.8")).toBe("de");
        expect(getPreferredSeoLocaleCode("fr;q=0.2,de;Q=0.8")).toBe("de");
        expect(getPreferredSeoLocaleCode("en-US,en;q=0.9,ar;q=0.8")).toBe("en");
        expect(getPreferredSeoLocaleCode("ja-JP,pt-BR;q=0.9")).toBe("en");
    });

    it("redirects humans from English owner URLs while preserving stable crawler URLs", () => {
        const browserUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";
        const humanRequest = new Request("https://rejourney.co/app-analytics?utm_source=google&gclid=click-1", {
            headers: {
                "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8",
                "User-Agent": browserUserAgent,
            },
        });
        const crawlerRequest = new Request("https://rejourney.co/app-analytics", {
            headers: {
                "Accept-Language": "ar",
                "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
            },
        });
        const localizedRequest = new Request("https://rejourney.co/ar/app-analytics", {
            headers: {
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": browserUserAgent,
            },
        });

        expect(getSeoLocaleRedirectPath(humanRequest)).toBe("/ar/app-analytics?utm_source=google&gclid=click-1");
        expect(getSeoLocaleRedirectPath(crawlerRequest)).toBeNull();
        expect(getSeoLocaleRedirectPath(localizedRequest)).toBeNull();
    });

    it("reuses every English page module while replacing only localized content", () => {
        for (const localeCode of SEO_LOCALIZED_LOCALE_CODES) {
            for (const basePath of SEO_LOCALIZED_PAGE_PATHS) {
                const localizedPage = getLocalizedSeoPage(localeCode, basePath);
                const englishPage = SEO_PAGES.find((candidate) => candidate.path === basePath)!;
                const renderPage = buildLocalizedSeoRenderPage(localizedPage, englishPage);

                expect(renderPage.path).toBe(englishPage.path);
                expect(renderPage.kind).toBe(englishPage.kind);
                expect(renderPage.setupVariant).toBe(englishPage.setupVariant);
                expect(renderPage.pricingVariant).toBe(englishPage.pricingVariant);
                expect(renderPage.comparison).toEqual(englishPage.comparison);
                expect(renderPage.image).toBe(englishPage.image);
                expect(Boolean(renderPage.keywordSections)).toBe(Boolean(englishPage.keywordSections));
                expect(renderPage.hero.title).toBe(localizedPage.h1);
                expect(renderPage.outcomes).toHaveLength(englishPage.outcomes.length);
                expect(renderPage.relatedPages).toHaveLength(englishPage.relatedPages.length);
                expect(new Set(renderPage.relatedPages.map((related) => related.href)).size).toBe(renderPage.relatedPages.length);
                expect(renderPage.relatedPages.every((related) => related.href.startsWith(`/${localeCode}/`))).toBe(true);
            }
        }
    });

    it("defines 36 native Arabic, Spanish, French, and German landing pages", () => {
        const pages = SEO_LOCALIZED_LOCALE_CODES.flatMap((localeCode) => (
            SEO_LOCALIZED_PAGE_PATHS.map((path) => getLocalizedSeoPage(localeCode, path))
        ));

        expect(pages).toHaveLength(36);
        for (const page of pages) {
            const englishPage = SEO_PAGES.find((candidate) => candidate.path === page.basePath);
            expect(page.localizedPath).toBe(`/${page.localeCode}${page.basePath}`);
            expect(page.h1.trim()).toBeTruthy();
            expect(page.intro.length).toBeGreaterThan(60);
            expect(page.benefits).toHaveLength(3);
            expect(page.primaryKeyword.trim()).toBeTruthy();
            expect(page.secondaryKeywords.length).toBeGreaterThanOrEqual(3);
            expect([...page.metaTitle].length).toBeLessThanOrEqual(60);
            expect(page.metaDescription.length).toBeGreaterThan(100);
            expect(englishPage).toBeTruthy();
            expect(page.h1).not.toBe(getSeoLandingHeadline(englishPage!));
            expect(page.locale.dir).toBe(page.localeCode === "ar" ? "rtl" : "ltr");
        }

        for (const path of SEO_LOCALIZED_PAGE_PATHS) {
            expect(getLocalizedSeoPage("ar", path).metaTitle).not.toMatch(/\b(?:Replay|Analytics|Heatmap)\b/i);
        }
    });

    it("keeps translated primary keywords unique inside each language", () => {
        for (const localeCode of SEO_LOCALIZED_LOCALE_CODES) {
            const keywords = SEO_LOCALIZED_PAGE_PATHS.map((path) => (
                getLocalizedSeoPage(localeCode, path).primaryKeyword.toLocaleLowerCase(localeCode)
            ));
            expect(new Set(keywords).size).toBe(keywords.length);
        }
    });

    it("uses self-canonicals, indexable robots, and reciprocal hreflang", () => {
        for (const localeCode of SEO_LOCALIZED_LOCALE_CODES) {
            for (const basePath of SEO_LOCALIZED_PAGE_PATHS) {
                const page = getLocalizedSeoPage(localeCode, basePath);
                const descriptors = meta({ location: { pathname: page.localizedPath } } as Parameters<typeof meta>[0]) as Array<Record<string, string>>;
                const alternates = descriptors.filter((descriptor) => descriptor.rel === "alternate");

                expect(descriptors.filter((descriptor) => descriptor.title)).toEqual([{ title: page.metaTitle }]);
                expect(descriptors).toContainEqual({ name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" });
                expect(descriptors).toContainEqual({ httpEquiv: "Content-Language", content: page.locale.languageTag });
                expect(descriptors).toContainEqual({ tagName: "link", rel: "canonical", href: `https://rejourney.co${page.localizedPath}` });
                expect(alternates).toHaveLength(6);
                expect(alternates).toContainEqual({
                    tagName: "link",
                    rel: "alternate",
                    hrefLang: page.locale.languageTag,
                    href: `https://rejourney.co${page.localizedPath}`,
                });
                expect(getLocalizedSeoAlternateLinks(basePath).at(-1)?.hrefLang).toBe("x-default");
            }
        }
    });

    it("emits localized WebPage, software, FAQ, and breadcrumb schema", () => {
        for (const localeCode of SEO_LOCALIZED_LOCALE_CODES) {
            for (const basePath of SEO_LOCALIZED_PAGE_PATHS) {
                const localizedPage = getLocalizedSeoPage(localeCode, basePath);
                const englishPage = SEO_PAGES.find((page) => page.path === basePath);
                expect(englishPage).toBeTruthy();
                const jsonLd = JSON.parse(JSON.stringify(buildLocalizedSeoJsonLd(localizedPage, englishPage!))) as {
                    "@graph": Array<{ "@type": string; "@id"?: string; inLanguage?: string }>;
                };
                const types = jsonLd["@graph"].map((entry) => entry["@type"]);
                const webPage = jsonLd["@graph"].find((entry) => entry["@type"] === "WebPage");

                expect(types).toEqual(expect.arrayContaining(["WebPage", "SoftwareApplication", "FAQPage", "BreadcrumbList"]));
                expect(webPage?.["@id"]).toBe(`https://rejourney.co${localizedPage.localizedPath}#webpage`);
                expect(webPage?.inLanguage).toBe(localizedPage.locale.languageTag);
            }
        }
    });

    it("includes every localized page and its alternates in the sitemap", async () => {
        const response = await sitemapLoader();
        const xml = await response.text();

        for (const localeCode of SEO_LOCALIZED_LOCALE_CODES) {
            for (const basePath of SEO_LOCALIZED_PAGE_PATHS) {
                expect(xml).toContain(`<loc>https://rejourney.co${getLocalizedSeoPath(localeCode, basePath)}</loc>`);
            }
        }
        expect(xml).toContain('hreflang="ar"');
        expect(xml).toContain('hreflang="es"');
        expect(xml).toContain('hreflang="fr"');
        expect(xml).toContain('hreflang="de"');
        expect(xml).toContain('hreflang="x-default"');
    });
});

describe("landing attribution links", () => {
    it("carries paid attribution without copying unrelated query state", () => {
        expect(landingHrefWithAttribution(
            "/login",
            "?gclid=click-1&utm_source=google&utm_campaign=replay&debug=true",
        )).toBe("/login?gclid=click-1&utm_source=google&utm_campaign=replay");
    });

    it("merges attribution before fragments without duplicating existing parameters", () => {
        expect(landingHrefWithAttribution(
            "/docs/web/getting-started?utm_source=old#remix",
            "?gclid=click-2&utm_source=google",
        )).toBe("/docs/web/getting-started?utm_source=google&gclid=click-2#remix");
    });
});
