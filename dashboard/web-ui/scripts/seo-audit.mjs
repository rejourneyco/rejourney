import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const cwd = process.cwd();
const repoRoot = resolve(cwd, "..", "..");
const failures = [];

function read(path) {
  return readFileSync(join(cwd, path), "utf8");
}

function fail(message) {
  failures.push(message);
}

function assertIncludes(path, needle, message) {
  if (!read(path).includes(needle)) fail(message);
}

function assertNotIncludes(path, needle, message) {
  if (read(path).includes(needle)) fail(message);
}

function extractStringArray(source, exportName) {
  const match = source.match(new RegExp(`export const ${exportName}[^=]*= \\[([\\s\\S]*?)\\];`));
  if (!match) {
    fail(`Could not find ${exportName}.`);
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractDocFiles(source) {
  return [...source.matchAll(/file:\s*'([^']+)'/g)].map((item) => item[1]);
}

function checkStructuredData() {
  const files = [
    "app/root.tsx",
    "app/features/public/home/route.tsx",
    "app/features/public/pricing/route.tsx",
    "app/features/public/docs/slug/route.tsx",
    "app/features/public/engineering/list/route.tsx",
    "public/index.html",
    "public/pricing/index.html",
    "public/docs/index.html",
  ];
  const forbidden = [
    "availableLanguage",
    "codeRepository",
    '"@type": "Product"',
  ];

  for (const file of files) {
    const source = read(file);
    for (const token of forbidden) {
      if (source.includes(token)) fail(`${file} contains JSON-LD token Semrush flags: ${token}`);
    }
  }

  assertNotIncludes(
    "app/features/public/docs/slug/route.tsx",
    '"category": localizedMetadata.category',
    "Docs Article JSON-LD must use articleSection instead of the unsupported category field."
  );
  assertIncludes(
    "app/features/public/home/route.tsx",
    '"@type": "SoftwareApplication"',
    "Home page should expose SoftwareApplication JSON-LD for product rich-result eligibility."
  );
}

function checkRobotsAndSitemap() {
  assertNotIncludes("public/robots.txt", "Disallow: /demo", "robots.txt must not block the live demo.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", 'path: "/dashboard"', "Sitemap must not include authenticated dashboard routes.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", "<loc>https://rejourney.co/dashboard", "Sitemap must not output dashboard URLs.");
  assertIncludes("server.js", "LEGACY_PUBLIC_HTML_REDIRECTS", "Legacy /index.html public HTML redirects must stay in place.");
}

function checkHreflangScopes() {
  const sitemap = read("app/features/public/sitemap/route.tsx");
  for (const expected of [
    "getMarketingAlternateLinks(MARKETING_INDEXABLE_LOCALE_ORDER)",
    'getLocalizedAlternateLinksForPath("/pricing", MARKETING_INDEXABLE_LOCALE_ORDER)',
    'getLocalizedAlternateLinksForPath(`/docs/${slug}`, MARKETING_LOCALE_ORDER)',
    "getLocalizedAlternateLinksForPath(getArticlePath(article), MARKETING_ENGINEERING_LOCALE_ORDER)",
  ]) {
    if (!sitemap.includes(expected)) fail(`Sitemap hreflang scope changed or is missing: ${expected}`);
  }
}

function checkLocalizedDocsCoverage() {
  const localeSource = read("app/shared/lib/internationalMarketing.ts");
  const docsSource = read("app/shared/lib/docsConfig.ts");
  const locales = extractStringArray(localeSource, "MARKETING_LOCALE_ORDER").filter((locale) => locale !== "en");
  const docFiles = extractDocFiles(docsSource);

  for (const locale of locales) {
    for (const docFile of docFiles) {
      const localizedPath = join(repoRoot, "docs", "i18n", locale, docFile);
      if (!existsSync(localizedPath)) {
        fail(`Missing localized doc for hreflang ${locale}: docs/i18n/${locale}/${docFile}`);
      }
    }
  }
}

function checkTitles() {
  const files = [
    "app/shared/lib/internationalMarketing.ts",
    "app/shared/lib/contentLocalization.ts",
    "app/shared/data/engineeringArticles/architectureDeepDive.tsx",
    "app/shared/data/engineeringArticles/mapsPerformance.tsx",
    "app/shared/data/engineeringArticles/mobileSessionReplayCost.tsx",
    "app/shared/data/engineeringArticles/rejourney13MillionSessionReplays.tsx",
    "app/shared/data/engineeringArticles/swiftPackageOpenBeta.tsx",
    "app/shared/data/engineeringArticlesMarkdown/2026-05-18-ambiguity-kills-app-growth.md",
  ];

  for (const file of files) {
    const source = read(file);
    const matches = [...source.matchAll(/metaTitle:\s*"([^"]+)"/g)];
    for (const match of matches) {
      const title = match[1];
      if ([...title].length > 60) {
        fail(`${file} has a title longer than 60 characters: ${title}`);
      }
    }
  }
}

function checkOnPageAndLinks() {
  assertNotIncludes("app/shared/docs/MarkdownContent.tsx", "<h1 id={id}", "Docs markdown headings must not render extra H1 tags.");
  assertIncludes("app/features/public/home/components/Hero.tsx", 'to={LIVE_DEMO_PATH}', "Hero demo CTA must link directly to /demo/general.");
  assertIncludes("app/features/public/home/components/LandingNarrative.tsx", 'to="/demo/general"', "Narrative demo CTA must link directly to /demo/general.");
  assertIncludes("app/shell/components/layout/Footer.tsx", 'to="/demo/general"', "Footer should keep an internal link to the crawlable demo.");
  assertNotIncludes("app/features/public/legal/privacy/route.tsx", "ovhcloud.com/legal/data-processing-agreement", "Privacy page must not link to the 403 OVHCloud DPA URL.");
  assertNotIncludes("app/features/public/legal/dpa/route.tsx", "ovhcloud.com/legal/data-processing-agreement", "DPA page must not link to the 403 OVHCloud DPA URL.");
}

checkStructuredData();
checkRobotsAndSitemap();
checkHreflangScopes();
checkLocalizedDocsCoverage();
checkTitles();
checkOnPageAndLinks();

if (failures.length > 0) {
  console.error("SEO audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("SEO audit passed.");
