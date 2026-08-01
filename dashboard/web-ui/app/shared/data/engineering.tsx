import { architectureDeepDiveArticle } from "./engineeringArticles/architectureDeepDive";
import { flutterSdkOpenBetaArticle } from "./engineeringArticles/flutterSdkOpenBeta";
import { mapsPerformanceArticle } from "./engineeringArticles/mapsPerformance";
import { mobileSessionReplayCostArticle } from "./engineeringArticles/mobileSessionReplayCost";
import { rejourney13MillionSessionReplaysArticle } from "./engineeringArticles/rejourney13MillionSessionReplays";
import { swiftPackageOpenBetaArticle } from "./engineeringArticles/swiftPackageOpenBeta";
import { markdownEngineeringArticles } from "./engineeringMarkdown";
import type { Article } from "./engineeringTypes";

export type { Article } from "./engineeringTypes";

const SITE_URL = "https://rejourney.co";

export function getArticlePath(article: Pick<Article, "collection" | "id" | "urlDate">): string {
    const collectionPath = article.collection === "engineering" ? "engineering" : "guides";
    return `/${collectionPath}/${article.urlDate}/${article.id}`;
}

export function getAbsoluteArticleImage(article: Pick<Article, "image">): string {
    return article.image.startsWith("/") ? `${SITE_URL}${article.image}` : article.image;
}

export const ENGINEERING_ARTICLES: Article[] = [
    flutterSdkOpenBetaArticle,
    mobileSessionReplayCostArticle,
    swiftPackageOpenBetaArticle,
    rejourney13MillionSessionReplaysArticle,
    mapsPerformanceArticle,
    architectureDeepDiveArticle,
].sort((a, b) => (
    b.urlDate.localeCompare(a.urlDate)
    || b.id.localeCompare(a.id)
));

export const GUIDE_ARTICLES: Article[] = markdownEngineeringArticles
    .filter((article) => article.collection === "guide")
    .sort((a, b) => b.urlDate.localeCompare(a.urlDate) || b.id.localeCompare(a.id));

export const ALL_ARTICLES: Article[] = [
    ...ENGINEERING_ARTICLES,
    ...GUIDE_ARTICLES,
].sort((a, b) => b.urlDate.localeCompare(a.urlDate) || b.id.localeCompare(a.id));

/** @deprecated Prefer the collection-specific registries. */
export const ARTICLES = ALL_ARTICLES;
