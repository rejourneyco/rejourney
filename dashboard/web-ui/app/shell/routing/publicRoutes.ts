import { index, route } from "@react-router/dev/routes";
import { MARKETING_LOCALE_SLUGS } from "../../shared/lib/internationalMarketing";

export const publicRoutes = [
  index("features/public/home/route.tsx", { id: "public-home" }),
  ...MARKETING_LOCALE_SLUGS.map((locale) =>
    route(locale, "features/public/home/route.tsx", { id: `public-home-${locale}` })
  ),
  route("docs", "features/public/docs/index/route.tsx", { id: "public-docs-index" }),
  route("docs/*", "features/public/docs/slug/route.tsx", { id: "public-docs-slug" }),
  ...MARKETING_LOCALE_SLUGS.flatMap((locale) => [
    route(`${locale}/docs`, "features/public/docs/index/route.tsx", { id: `public-docs-index-${locale}` }),
    route(`${locale}/docs/*`, "features/public/docs/slug/route.tsx", { id: `public-docs-slug-${locale}` }),
  ]),
  route("contribute", "features/public/contribute/route.tsx", { id: "public-contribute" }),
  route("changelog", "features/public/changelog/route.tsx", { id: "public-changelog" }),
  route("roadmap", "features/public/roadmap/route.tsx", { id: "public-roadmap" }),
  ...MARKETING_LOCALE_SLUGS.map((locale) =>
    route(`${locale}/roadmap`, "features/public/roadmap/route.tsx", { id: `public-roadmap-${locale}` })
  ),
  route("pricing", "features/public/pricing/route.tsx", { id: "public-pricing" }),
  ...MARKETING_LOCALE_SLUGS.map((locale) =>
    route(`${locale}/pricing`, "features/public/pricing/route.tsx", { id: `public-pricing-${locale}` })
  ),
  route("terms-of-service", "features/public/legal/terms/route.tsx", { id: "public-terms" }),
  route("privacy-policy", "features/public/legal/privacy/route.tsx", { id: "public-privacy" }),
  route("dpa", "features/public/legal/dpa/route.tsx", { id: "public-dpa" }),
  route("engineering", "features/public/engineering/list/route.tsx", { id: "public-engineering-list" }),
  route("engineering/:date/:slug", "features/public/engineering/article/route.tsx", { id: "public-engineering-article" }),
  ...MARKETING_LOCALE_SLUGS.flatMap((locale) => [
    route(`${locale}/engineering`, "features/public/engineering/list/route.tsx", { id: `public-engineering-list-${locale}` }),
    route(`${locale}/engineering/:date/:slug`, "features/public/engineering/article/route.tsx", { id: `public-engineering-article-${locale}` }),
  ]),
  route("feed.xml", "features/public/feed/route.tsx", { id: "public-feed" }),
  route("sitemap.xml", "features/public/sitemap/route.tsx", { id: "public-sitemap" }),
  route("login", "features/public/auth/login/route.tsx", { id: "public-login" }),
  route("invite/accept/:token", "features/public/invite/accept/route.tsx", { id: "public-invite-accept" }),
];
