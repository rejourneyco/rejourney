import { architectureDeepDiveArticle } from "./engineeringArticles/architectureDeepDive";
import { mapsPerformanceArticle } from "./engineeringArticles/mapsPerformance";
import { mobileSessionReplayCostArticle } from "./engineeringArticles/mobileSessionReplayCost";
import { rejourney13MillionSessionReplaysArticle } from "./engineeringArticles/rejourney13MillionSessionReplays";
import { swiftPackageOpenBetaArticle } from "./engineeringArticles/swiftPackageOpenBeta";
import { markdownEngineeringArticles } from "./engineeringMarkdown";
import type { Article } from "./engineeringTypes";

export type { Article } from "./engineeringTypes";

const SITE_URL = "https://rejourney.co";

export function getArticlePath(article: Pick<Article, "id" | "urlDate">): string {
    return `/engineering/${article.urlDate}/${article.id}`;
}

export function getAbsoluteArticleImage(article: Pick<Article, "image">): string {
    return article.image.startsWith("/") ? `${SITE_URL}${article.image}` : article.image;
}

export const ARTICLES: Article[] = [
    ...markdownEngineeringArticles,
    mobileSessionReplayCostArticle,
    swiftPackageOpenBetaArticle,
    rejourney13MillionSessionReplaysArticle,
    mapsPerformanceArticle,
    architectureDeepDiveArticle,
].sort((a, b) => (
    b.urlDate.localeCompare(a.urlDate)
    || b.id.localeCompare(a.id)
));
