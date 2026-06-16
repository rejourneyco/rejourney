import { index, route } from "@react-router/dev/routes";
import { SEO_PAGE_PATHS } from "../../features/public/seo/seoPages";
import { MARKETING_LOCALE_SLUGS } from "../../shared/lib/internationalMarketing";

export const publicRoutes = [
  index("features/public/home/route.tsx", { id: "public-home" }),
  ...MARKETING_LOCALE_SLUGS.map((locale) =>
    route(locale, "features/public/home/redirect.tsx", { id: `public-home-${locale}-redirect` })
  ),
  route("docs", "features/public/docs/index/route.tsx", { id: "public-docs-index" }),
  route("docs/*", "features/public/docs/slug/route.tsx", { id: "public-docs-slug" }),
  route("contribute", "features/public/contribute/route.tsx", { id: "public-contribute" }),
  route("changelog", "features/public/changelog/route.tsx", { id: "public-changelog" }),
  route("roadmap", "features/public/roadmap/route.tsx", { id: "public-roadmap" }),
  route("pricing", "features/public/pricing/route.tsx", { id: "public-pricing" }),
  route("setup", "shell/routing/redirects/SetupRedirect.tsx", { id: "public-setup-redirect" }),
  route("share/replay/:shareToken", "features/public/replay-share/route.tsx", { id: "public-replay-share" }),
  route("about", "features/public/about/route.tsx", { id: "public-about" }),
  ...SEO_PAGE_PATHS.map((path) =>
    route(path.replace(/^\//, ""), "features/public/seo/route.tsx", { id: `public-seo-${path.replace(/^\//, "").replace(/\//g, "-")}` })
  ),
  route("ai/responsibleusage", "features/public/ai/responsibleusage/route.tsx", { id: "public-ai-responsible-usage" }),
  route("terms-of-service", "features/public/legal/terms/route.tsx", { id: "public-terms" }),
  route("privacy-policy", "features/public/legal/privacy/route.tsx", { id: "public-privacy" }),
  route("dpa", "features/public/legal/dpa/route.tsx", { id: "public-dpa" }),
  route("attributions", "features/public/legal/attributions/route.tsx", { id: "public-attributions" }),
  route("engineering", "features/public/engineering/list/route.tsx", { id: "public-engineering-list" }),
  route("engineering/:date/:slug", "features/public/engineering/article/route.tsx", { id: "public-engineering-article" }),
  route("feed.xml", "features/public/feed/route.tsx", { id: "public-feed" }),
  route("sitemap.xml", "features/public/sitemap/route.tsx", { id: "public-sitemap" }),
  route("login", "features/public/auth/login/route.tsx", { id: "public-login" }),
  route("invite/accept/:token", "features/public/invite/accept/route.tsx", { id: "public-invite-accept" }),
  ...MARKETING_LOCALE_SLUGS.map((locale) =>
    route(`${locale}/*`, "features/public/home/redirect.tsx", { id: `public-locale-${locale}-catchall-redirect` })
  ),
];
