import { index, route } from "@react-router/dev/routes";

export const publicRoutes = [
  index("features/public/home/route.tsx", { id: "public-home" }),
  route("docs", "features/public/docs/index/route.tsx", { id: "public-docs-index" }),
  route("docs/*", "features/public/docs/slug/route.tsx", { id: "public-docs-slug" }),
  route("contribute", "features/public/contribute/route.tsx", { id: "public-contribute" }),
  route("pricing", "features/public/pricing/route.tsx", { id: "public-pricing" }),
  route("terms-of-service", "features/public/legal/terms/route.tsx", { id: "public-terms" }),
  route("privacy-policy", "features/public/legal/privacy/route.tsx", { id: "public-privacy" }),
  route("dpa", "features/public/legal/dpa/route.tsx", { id: "public-dpa" }),
  route("engineering", "features/public/engineering/list/route.tsx", { id: "public-engineering-list" }),
  route("engineering/:date/:slug", "features/public/engineering/article/route.tsx", { id: "public-engineering-article" }),
  route("feed.xml", "features/public/feed/route.tsx", { id: "public-feed" }),
  route("sitemap.xml", "features/public/sitemap/route.tsx", { id: "public-sitemap" }),
  route("login", "features/public/auth/login/route.tsx", { id: "public-login" }),
  route("changelog", "features/public/changelog/route.tsx", { id: "public-changelog" }),
  route("invite/accept/:token", "features/public/invite/accept/route.tsx", { id: "public-invite-accept" }),
];
