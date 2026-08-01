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
  assertIncludes(
    "app/features/public/seo/route.tsx",
    '"@type": "SoftwareApplication"',
    "Custom landing pages should expose SoftwareApplication JSON-LD."
  );
  assertIncludes(
    "app/features/public/seo/route.tsx",
    '"@type": "BreadcrumbList"',
    "Custom landing pages should expose BreadcrumbList JSON-LD."
  );
}

function checkRobotsAndSitemap() {
  assertNotIncludes("public/robots.txt", "Disallow: /demo", "robots.txt must not block the live demo.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", 'path: "/dashboard"', "Sitemap must not include authenticated dashboard routes.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", "<loc>https://rejourney.co/dashboard", "Sitemap must not output dashboard URLs.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", 'path: "/about"', "Sitemap should not promote the About page as a search sitelink.");
  assertIncludes("server.js", "LEGACY_PUBLIC_HTML_REDIRECTS", "Legacy /index.html public HTML redirects must stay in place.");
  assertIncludes("app/features/public/sitemap/route.tsx", "lastmod: page.lastModified", "SEO sitemap entries must use their reviewed per-page modification dates.");

  for (const [source, destination] of [
    ["/session-replay-tools", "/record-user-sessions"],
    ["/session-replay-software", "/record-user-sessions"],
    ["/ai-funnel-leak-detection", "/funnel-replay-evidence"],
    ["/ai-agent-handoff", "/rejourney-marlin"],
    ["/autonomous-debugging", "/rejourney-marlin"],
    ["/self-healing-software", "/rejourney-marlin"],
  ]) {
    assertIncludes("server.js", `['${source}', '${destination}']`, `Permanent redirect is missing: ${source} -> ${destination}.`);
  }
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

  assertNotIncludes("app/features/public/sitemap/route.tsx", "MARKETING_LOCALE_ORDER.flatMap", "Sitemap must not bulk-index every configured locale; localized SEO coverage must stay explicitly scoped.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", "getLocalizedPublicPath(MARKETING_LOCALES[code], `/docs/${slug}`)", "Docs sitemap entries must stay English-only.");
}

function checkLocalizedSeoCoverage() {
  const localizationFile = "app/features/public/seo/seoLocalization.ts";
  const requiredLocales = ["ar", "es", "fr", "de"];
  const priorityPaths = [
    "/record-user-sessions",
    "/web-session-replay",
    "/mobile-session-replay",
    "/what-is-session-replay",
    "/app-analytics",
    "/website-analytics",
    "/funnel-replay-evidence",
    "/heatmaps",
    "/stability-monitoring",
  ];

  for (const locale of requiredLocales) {
    assertIncludes(localizationFile, `"${locale}"`, `Localized SEO registry must include ${locale}.`);
  }
  for (const path of priorityPaths) {
    assertIncludes(localizationFile, `"${path}"`, `Localized SEO registry must include ${path}.`);
  }

  assertIncludes("app/shell/routing/publicRoutes.ts", "SEO_LOCALIZED_LOCALE_CODES.flatMap", "Priority localized SEO routes must be registered before the locale catch-all.");
  assertIncludes("app/shell/routing/publicRoutes.ts", "SEO_LOCALIZED_PAGE_PATHS.map", "Every priority path must receive each target locale route.");
  assertIncludes("app/features/public/seo/route.tsx", "getLocalizedSeoAlternateLinks", "Localized SEO pages must emit reciprocal hreflang links.");
  assertIncludes("app/features/public/seo/route.tsx", "localizedPage?.localizedPath", "Localized SEO pages must use a self-canonical path.");
  assertIncludes("app/features/public/seo/route.tsx", "buildLocalizedSeoJsonLd", "Localized SEO pages must emit language-aware JSON-LD.");
  assertIncludes("app/features/public/seo/route.tsx", "lang={localizedPage?.locale.languageTag", "Localized SEO content must declare its language on the shared landing layout.");
  assertIncludes("app/features/public/seo/route.tsx", "dir={localizedPage?.locale.dir", "The shared landing layout must support Arabic RTL direction.");
  assertIncludes("app/features/public/seo/route.tsx", "getSeoLocaleRedirectPath", "Priority SEO pages must negotiate the visitor's browser language automatically.");
  assertIncludes(localizationFile, "getPreferredSeoLocaleCode", "Localized SEO routing must use ordered browser language preferences.");
  assertNotIncludes("app/features/public/seo/route.tsx", "SeoLanguageSwitcher", "Priority SEO pages must not expose a manual language chooser.");
  assertIncludes("app/features/public/seo/route.tsx", "optimizedMarketingImage(heroImage)", "Localized priority pages must reuse the English landing-page hero media and layout.");
  assertIncludes("app/features/public/seo/route.tsx", "buildLocalizedSeoRenderPage(localizedPage, page)", "Localized SEO pages must reuse the English page configuration and component tree.");
  assertIncludes("app/features/public/seo/route.tsx", "<PaidAdLandingPage page={renderPage} localizedPage={localizedPage ?? undefined}", "English and localized SEO pages must render through the same landing-page component.");
  assertNotIncludes("app/features/public/seo/route.tsx", "? <LocalizedSeoLandingPage", "Localized SEO pages must not use a separate reduced landing-page UI.");
  assertIncludes("app/shell/components/layout/Header.tsx", "getLocalizedSeoPage", "Localized headers must link to translated priority pages instead of English targets.");
  assertIncludes("app/shell/components/layout/Footer.tsx", "getLocalizedSeoPage", "Localized footers must link to translated priority pages instead of English targets.");
  assertIncludes("app/root.tsx", "getMarketingLocaleFromPathname(location.pathname)", "The rendered HTML element must use the active localized route language and direction.");
  assertIncludes("app/features/public/sitemap/route.tsx", "localizedSeoRoutes", "Sitemap must include localized priority landing pages.");
  assertIncludes("app/features/public/sitemap/route.tsx", "getLocalizedSeoAlternateLinks(basePath)", "Localized sitemap entries must include reciprocal hreflang.");
  assertIncludes("app/features/public/home/redirect.tsx", "return redirect", "Unsupported locale-prefixed paths must continue redirecting to English.");
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
  assertIncludes("app/features/public/home/route.tsx", "Lightweight product analytics for web and mobile apps", "Home page metadata must stay aligned to lightweight product analytics for web and mobile apps.");
  assertIncludes("app/shared/lib/contentLocalization.ts", 'heading: "Pricing"', "Pricing H1 must remain concise.");
  for (const title of [
    "PostHog Alternative for Product Analytics | Rejourney",
    "Sentry Alternative with Session Replay | Rejourney",
    "Datadog Alternative for Product Analytics | Rejourney",
    "Amplitude Alternative with Session Replay | Rejourney",
    "Mixpanel Alternative with Session Replay | Rejourney",
    "Pendo Alternative for Product Analytics | Rejourney",
    "Smartlook Alternative for Session Replay | Rejourney",
    "Hotjar Alternative for Web & Mobile Replay | Rejourney",
    "Fullstory Alternative for Lightweight Replay | Rejourney",
  ]) {
    assertIncludes("app/features/public/seo/seoPages.ts", `metaTitle: "${title}"`, `Alternative-page title is missing: ${title}`);
  }
  assertIncludes("app/features/public/about/route.tsx", "noindex, follow", "About page should be noindexed so Google favors product/pricing sitelinks.");
  assertIncludes("app/root.tsx", "/website-analytics", "Homepage sitelink schema should promote Website Analytics.");
  assertIncludes("app/root.tsx", "/app-analytics", "Homepage sitelink schema should promote App Analytics.");
  assertIncludes("app/root.tsx", "/pricing", "Homepage sitelink schema should promote Pricing.");
  assertIncludes("app/shell/components/layout/Header.tsx", "Website Analytics", "Header Platform menu must include Website Analytics.");
  assertIncludes("app/shell/components/layout/Header.tsx", "App Analytics", "Header Platform menu must include App Analytics.");
  assertIncludes("app/shell/components/layout/Header.tsx", "Stability Monitoring", "Header Platform menu must include Stability Monitoring.");
  assertIncludes("app/shell/components/layout/Header.tsx", "API Endpoint Insights", "Header Platform menu must include API Endpoint Insights.");
  assertIncludes("app/shell/components/layout/Header.tsx", "Device Insights", "Header Platform menu must include Device Insights.");
  assertIncludes("app/shell/components/layout/Header.tsx", "Web Session Replay", "Header must use the Web Session Replay label.");
  assertIncludes("app/shell/components/layout/Header.tsx", "Mobile Session Replay", "Header must use the Mobile Session Replay label.");
  assertNotIncludes("app/shell/components/layout/Header.tsx", "Web Replay Evidence", "Header must not use the old Web Replay Evidence label.");
  assertNotIncludes("app/shell/components/layout/Header.tsx", "Mobile Replay Evidence", "Header must not use the old Mobile Replay Evidence label.");
  assertIncludes("app/shell/components/layout/Header.tsx", '"Toggle navigation menu"', "Header must preserve an accessible responsive-navigation control.");
  assertIncludes("app/features/public/seo/route.tsx", "GDPR compliant", "Custom landing pages must show the GDPR compliance trust signal.");
  assertIncludes("app/features/public/seo/route.tsx", "<EuFlag", "Custom landing pages must show the EU flag with the GDPR trust signal.");
  assertIncludes("app/features/public/seo/route.tsx", "<LandingPlatformLogos", "Custom landing pages must show supported platforms as accessible logos.");
  assertNotIncludes("app/features/public/seo/route.tsx", 'platforms.join(" · ")', "Custom landing pages must not render supported platforms as a plain text list.");
  assertNotIncludes("app/features/public/seo/route.tsx", "section.bullets.map((bullet)", "Priority landing summaries must not repeat feature bullet inventories.");
  assertIncludes("app/features/public/seo/route.tsx", "<LandingOutcomeSections page={page}", "Landing pages must retain the visual product walkthrough after the concise question-led summary.");
  assertIncludes("app/features/public/seo/route.tsx", 'src: "/images/engineering/heatmaps-mobile-touch-map.svg"', "The mobile heatmap outcome must use its own touch-map visual.");
  assertIncludes("app/features/public/seo/route.tsx", 'src: "/images/engineering/product-tools-live-replay.png"', "The replay-context outcome must use the replay workbench visual.");
  assertIncludes("app/shell/components/layout/Footer.tsx", "Product Analytics", "Footer must organize core pages under Product Analytics.");
  assertIncludes("app/shell/components/layout/Footer.tsx", "Session Replay", "Footer must include the Session Replay group.");
  assertIncludes("app/shell/components/layout/Footer.tsx", "Lightweight product analytics for web and mobile", "Footer summary must match the site-wide positioning.");
  assertIncludes("app/shell/components/layout/Footer.tsx", "Revenue Leak Guide", "Footer must promote the revenue leak guide instead of a commerce-specific resource.");
  assertNotIncludes("app/shell/components/layout/Footer.tsx", '{ label: "Shopify"', "Footer must not position Shopify as a primary resource.");
  assertNotIncludes("app/features/public/sitemap/route.tsx", 'slug === "shopify/getting-started"', "Sitemap must not give the Shopify setup guide elevated priority.");
  assertIncludes("app/features/public/home/components/AiLeakHomepage.tsx", ">('nextjs')", "Homepage SDK selector should default to a general web platform rather than Shopify.");
  assertIncludes("public/site.webmanifest", "Lightweight product analytics for web and mobile apps", "Web manifest description must match the primary product category.");
  assertIncludes("public/llms.txt", "lightweight product analytics", "llms.txt must describe Rejourney as lightweight product analytics.");
  assertIncludes("public/index.html", "Lightweight Product Analytics for Web &amp; Mobile", "Static home fallback title must match the primary product category.");
  for (const path of [
    "/web-session-replay",
    "/mobile-session-replay",
    "/funnel-replay-evidence",
    "/heatmaps",
    "/website-analytics",
    "/app-analytics",
    "/stability-monitoring",
    "/api-endpoint-insights",
    "/device-insights",
  ]) {
    assertIncludes("app/features/public/seo/seoPages.ts", `path: "${path}"`, `SEO page is missing: ${path}`);
    assertIncludes("app/shell/components/layout/Footer.tsx", path, `Footer must link to ${path}.`);
    assertIncludes("app/shell/components/layout/Header.tsx", path, `Header must link to ${path}.`);
  }
  for (const path of [
    "/web-session-replay",
    "/mobile-session-replay",
    "/record-user-sessions",
    "/what-is-session-replay",
    "/funnel-replay-evidence",
    "/heatmaps",
  ]) {
    assertIncludes("app/shell/components/layout/Footer.tsx", path, `Session Replay footer group must link to ${path}.`);
  }
  for (const title of [
    "Session Replay Tools to Record User Sessions | Rejourney",
    "Web Session Replay Software | Rejourney",
    "Mobile App Session Replay | Rejourney",
    "Mobile App Analytics with Session Replay | Rejourney",
    "User Experience Analytics for Websites | Rejourney",
    "Funnel Analysis with Session Replay | Rejourney",
    "Website and Mobile Heatmap Tools | Rejourney",
    "Mobile App Crash Reporting with Replay | Rejourney",
  ]) {
    assertIncludes("app/features/public/seo/seoPages.ts", `metaTitle: "${title}"`, `Audited landing-page title is missing: ${title}`);
  }
  assertNotIncludes("app/features/public/seo/seoPages.ts", '"API monitoring dashboard"', "API Endpoint Insights must not deliberately target API monitoring dashboard.");
  for (const removedPath of [
    "/ai-funnel-leak-detection",
    "/ai-agent-handoff",
    "/autonomous-debugging",
    "/self-healing-software",
  ]) {
    assertNotIncludes("app/features/public/seo/seoPages.ts", `path: "${removedPath}"`, `Removed SEO route must not remain in the registry: ${removedPath}`);
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
checkLocalizedSeoCoverage();
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
