import type { MetaFunction } from "react-router";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { Footer } from "~/shell/components/layout/Footer";
import { Header } from "~/shell/components/layout/Header";
import {
    GUIDE_ARTICLES,
    getArticlePath,
} from "~/shared/data/engineering";

const SITE_URL = "https://rejourney.co";

export const meta: MetaFunction = () => [
    { title: "Product Analytics & Session Replay Guides | Rejourney" },
    {
        name: "description",
        content: "Practical guides to product analytics, session replay, funnels, onboarding, retention, revenue leaks, and mobile app growth.",
    },
    { name: "robots", content: "index, follow, max-image-preview:large" },
    { property: "og:site_name", content: "Rejourney" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: "Rejourney Guides" },
    {
        property: "og:description",
        content: "Practical product analytics and session replay guides for product, growth, support, and engineering teams.",
    },
    { property: "og:url", content: `${SITE_URL}/guides` },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/guides` },
];

export default function GuidesIndexPage() {
    const itemList = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/guides#webpage`,
        url: `${SITE_URL}/guides`,
        name: "Rejourney Guides",
        description: "Product analytics, session replay, conversion, onboarding, retention, and revenue guides.",
        mainEntity: {
            "@type": "ItemList",
            numberOfItems: GUIDE_ARTICLES.length,
            itemListElement: GUIDE_ARTICLES.map((article, index) => ({
                "@type": "ListItem",
                position: index + 1,
                url: `${SITE_URL}${getArticlePath(article)}`,
                name: article.title,
            })),
        },
    };

    return (
        <div className="public-readable-scope flex min-h-screen flex-col bg-[#fdfbf7] text-slate-950">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
            />
            <Header />
            <main className="flex-grow">
                <section className="border-b border-black/10 px-5 pb-16 pt-24 sm:px-6 sm:pb-20 sm:pt-28 lg:px-8">
                    <div className="mx-auto max-w-6xl">
                        <div className="max-w-3xl">
                            <p className="mb-5 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                                Rejourney guides
                            </p>
                            <h1 className="text-balance font-display text-5xl font-black leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
                                Clear answers for better product decisions.
                            </h1>
                            <p className="mt-7 max-w-2xl text-lg font-medium leading-8 text-slate-600 sm:text-xl">
                                Practical playbooks for understanding behavior, diagnosing conversion friction, and connecting product metrics to the sessions behind them.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="px-5 py-16 sm:px-6 sm:py-20 lg:px-8">
                    <div className="mx-auto grid max-w-6xl gap-x-9 gap-y-14 md:grid-cols-2 lg:grid-cols-3">
                        {GUIDE_ARTICLES.map((article, index) => (
                            <Link
                                key={article.id}
                                to={getArticlePath(article)}
                                className="group flex min-w-0 flex-col"
                            >
                                <div className="aspect-[1.55/1] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.06)]">
                                    <img
                                        src={article.image}
                                        alt={article.imageAlt ?? article.title}
                                        width={1200}
                                        height={774}
                                        loading={index < 3 ? "eager" : "lazy"}
                                        decoding="async"
                                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.015]"
                                    />
                                </div>
                                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                                    <span className="rounded-full border border-emerald-900/10 bg-emerald-50 px-3 py-1 text-emerald-800">
                                        Guide
                                    </span>
                                    <span>{article.date}</span>
                                    <span aria-hidden>·</span>
                                    <span>{article.readTime}</span>
                                </div>
                                <h2 className="mt-4 text-balance text-2xl font-black leading-tight tracking-[-0.025em] text-slate-950 group-hover:underline group-hover:decoration-emerald-300 group-hover:underline-offset-4">
                                    {article.title}
                                </h2>
                                <p className="mt-3 line-clamp-3 text-base font-medium leading-7 text-slate-600">
                                    {article.subtitle}
                                </p>
                                <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-slate-950">
                                    Read guide
                                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden />
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    );
}
