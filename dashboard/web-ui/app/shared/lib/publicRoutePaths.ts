import { stripMarketingLocaleFromPathname } from "~/shared/lib/internationalMarketing";

const PUBLIC_EXACT_PATHS = new Set([
  "/",
  "/login",
  "/terms-of-service",
  "/privacy-policy",
  "/dpa",
  "/contribute",
  "/changelog",
  "/feed.xml",
  "/sitemap.xml",
]);

const PUBLIC_PREFIXES = [
  "/docs",
  "/engineering",
  "/pricing",
  "/invite",
];

export function getPublicComparablePath(pathname: string): string {
  return stripMarketingLocaleFromPathname(pathname).pathname;
}

export function isPublicRoutePath(pathname: string): boolean {
  const comparablePath = getPublicComparablePath(pathname);
  return PUBLIC_EXACT_PATHS.has(comparablePath)
    || PUBLIC_PREFIXES.some((prefix) => comparablePath === prefix || comparablePath.startsWith(`${prefix}/`));
}
