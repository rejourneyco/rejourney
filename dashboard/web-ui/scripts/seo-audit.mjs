import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const failures = [];

function read(path) {
  return readFileSync(join(cwd, path), "utf8");
}

function fail(message) {
  failures.push(message);
}

function assertFileExists(path, message) {
  if (!existsSync(join(cwd, path))) fail(message);
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
  assertNotIncludes("app/features/public/sitemap/route.tsx", 'path: "/about"', "Sitemap should not promote the About page as a search sitelink.");
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
    "app/features/public/seo/seoPages.ts",
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
  assertIncludes("app/features/public/home/route.tsx", "Revenue leak prediction for web and mobile apps", "Home page metadata must stay aligned to revenue leak prediction for web and mobile apps.");
  assertIncludes("app/shared/lib/contentLocalization.ts", 'heading: "Revenue Leak Prediction Pricing"', "Pricing H1 must stay aligned to revenue leak prediction.");
  for (const title of [
    "Sentry Session Replay Pricing & Alternative | Rejourney",
    "Datadog Session Replay Pricing & Alternative | Rejourney",
    "Amplitude Session Replay Pricing & Alternative | Rejourney",
    "Mixpanel Session Replay Alternative | Rejourney",
    "Pendo Session Replay Alternative | Rejourney",
    "Smartlook Alternatives After Cisco EOL | Rejourney",
  ]) {
    assertIncludes("app/features/public/seo/seoPages.ts", `metaTitle: "${title}"`, `Search Console CTR title is missing: ${title}`);
  }
  assertIncludes("app/features/public/about/route.tsx", "noindex, follow", "About page should be noindexed so Google favors product/pricing sitelinks.");
  assertIncludes("app/root.tsx", "/mobile-session-replay", "Homepage sitelink schema should promote Mobile Session Replay.");
  assertIncludes("app/root.tsx", "/pricing", "Homepage sitelink schema should promote Pricing.");
  assertIncludes("app/shell/components/layout/Header.tsx", "Self-Healing Software", "Header Platform menu must include Self-Healing Software.");
  assertIncludes("app/shell/components/layout/Header.tsx", "Stability Monitoring", "Header Platform menu must include Stability Monitoring.");
  assertIncludes("app/shell/components/layout/Header.tsx", "API Endpoint Insights", "Header Platform menu must include API Endpoint Insights.");
  assertIncludes("app/shell/components/layout/Header.tsx", "Device Insights", "Header Platform menu must include Device Insights.");
  assertIncludes("app/shell/components/layout/Footer.tsx", "Replay & Analytics", "Footer must keep features organized into a Replay & Analytics group.");
  assertIncludes("app/shell/components/layout/Footer.tsx", "Revenue Leak Guide", "Footer must promote the revenue leak guide instead of a commerce-specific resource.");
  assertNotIncludes("app/shell/components/layout/Footer.tsx", '{ label: "Shopify"', "Footer must not position Shopify as a primary resource.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", 'slug === "shopify/getting-started"', "Sitemap must not give the Shopify setup guide elevated priority.");
  assertIncludes("app/features/public/home/components/AiLeakHomepage.tsx", ">('nextjs')", "Homepage SDK selector should default to a general web platform rather than Shopify.");
  for (const path of [
    "/self-healing-software",
    "/stability-monitoring",
    "/api-endpoint-insights",
    "/device-insights",
  ]) {
    assertIncludes("app/features/public/seo/seoPages.ts", `path: "${path}"`, `SEO page is missing: ${path}`);
    assertIncludes("app/shell/components/layout/Footer.tsx", path, `Footer must link to ${path}.`);
    assertIncludes("app/shell/components/layout/Header.tsx", path, `Header must link to ${path}.`);
  }
  assertFileExists("public/images/engineering/product-tools-live-api-endpoints.png", "API endpoint insights screenshot is missing.");
  assertFileExists("public/images/engineering/product-tools-live-devices.png", "Device insights screenshot is missing.");
  assertNotIncludes("app/features/public/home/components/AiLeakHomepage.tsx", "<iframe", "Home page must not embed the live demo.");
  assertIncludes("app/shell/routing/publicRoutes.ts", 'features/public/home/redirect.tsx', "Bare localized homepage routes must redirect to the English homepage.");
  assertIncludes("app/shell/components/layout/Footer.tsx", 'to="/demo"', "Footer should keep an internal link to the crawlable demo.");
  assertNotIncludes("app/features/public/legal/privacy/route.tsx", "ovhcloud.com/legal/data-processing-agreement", "Privacy page must not link to the 403 OVHCloud DPA URL.");
  assertNotIncludes("app/features/public/legal/dpa/route.tsx", "ovhcloud.com/legal/data-processing-agreement", "DPA page must not link to the 403 OVHCloud DPA URL.");
}

function checkEditorialReadability() {
  const articleDir = join(cwd, "app/shared/data/engineeringArticlesMarkdown");
  const articles = readdirSync(articleDir).filter((name) => name.startsWith("2026-07-12-") && name.endsWith(".md"));

  for (const article of articles) {
    const source = readFileSync(join(articleDir, article), "utf8");
    const body = source.split(/^---$/m).slice(2).join("---");
    const bodyBullets = body.match(/^[-*] /gm)?.length ?? 0;

    if (bodyBullets > 12) fail(`${article} has ${bodyBullets} body bullets; use connected prose for the main argument.`);
    if (body.includes("## Where Rejourney fits")) fail(`${article} uses the repeated Where Rejourney fits template.`);
    if (/\*\*[^*]+:\*\*/.test(body)) fail(`${article} uses inline-header list formatting associated with templated writing.`);
    if (body.includes("The review should also include")) fail(`${article} repeats a canned transition instead of editorial prose.`);
  }
}

checkStructuredData();
checkRobotsAndSitemap();
checkHreflangScopes();
checkLocalizedDocsCoverage();
checkTitles();
checkOnPageAndLinks();
checkEditorialReadability();

if (failures.length > 0) {
  console.error("SEO audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("SEO audit passed.");
