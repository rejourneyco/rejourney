import { readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
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
    "getMarketingAlternateLinks(MARKETING_HOME_LOCALE_ORDER)",
    'getLocalizedAlternateLinksForPath("/pricing")',
    'getLocalizedAlternateLinksForPath(`/docs/${slug}`)',
    "getLocalizedAlternateLinksForPath(getArticlePath(article))",
  ]) {
    if (!sitemap.includes(expected)) fail(`Sitemap hreflang scope changed or is missing: ${expected}`);
  }

  assertNotIncludes("app/features/public/sitemap/route.tsx", "MARKETING_LOCALE_ORDER.flatMap", "Sitemap must not emit locale-prefixed public URLs.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", "getLocalizedPublicPath(MARKETING_LOCALES[code], `/docs/${slug}`)", "Docs sitemap entries must stay English-only.");
}

function checkLocalizedDocsCoverage() {
  assertNotIncludes("app/shared/lib/docsLoader.server.ts", "DOCS_ROOT, 'i18n'", "Docs loader must not read translated docs from docs/i18n.");
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
  assertIncludes("app/features/public/home/components/AiLeakHomepage.tsx", "AI funnel leak detection", "Home page must advertise AI funnel leak detection.");
  assertIncludes("app/features/public/home/components/AiLeakHomepage.tsx", 'to={DEMO_PATH}', "Home page demo CTA must link directly to /demo.");
  assertIncludes("app/features/public/home/components/AiLeakHomepage.tsx", "Find my leaks", "Home page must keep the primary leak-finding CTA.");
  assertNotIncludes("app/features/public/home/components/AiLeakHomepage.tsx", "<iframe", "Home page must not embed the live demo.");
  assertIncludes("app/shell/routing/publicRoutes.ts", 'features/public/home/redirect.tsx', "Bare localized homepage routes must redirect to the English homepage.");
  assertIncludes("app/shell/components/layout/Footer.tsx", 'to="/demo"', "Footer should keep an internal link to the crawlable demo.");
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
