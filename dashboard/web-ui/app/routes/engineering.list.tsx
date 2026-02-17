/**
 * Rejourney Dashboard - Engineering Page Index
 * Displays the list of available engineering articles.
 */

import type { MetaFunction } from "react-router";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";
import { Activity } from "lucide-react";
import { ARTICLES } from "~/data/engineering";
import { Link } from "react-router";

export const meta: MetaFunction = () => [
    { title: "Engineering - Rejourney" },
    {
        name: "description",
        content: "Deep dives into Rejourney's engineering challenges: Map performance, async capture, and privacy.",
    },
    { property: "og:title", content: "Engineering - Rejourney" },
    { property: "og:type", content: "website" },
    { tagName: "link", rel: "canonical", href: "https://rejourney.co/engineering" },
];

export default function EngineeringIndexPage() {
    return (
        <div className="min-h-screen w-full bg-white text-slate-900 font-sans selection:bg-yellow-200 flex flex-col">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "ItemList",
                        itemListElement: ARTICLES.map((article, index) => ({
                            "@type": "ListItem",
                            position: index + 1,
                            url: `https://rejourney.co/engineering/${article.urlDate}/${article.id}`,
                            name: article.title,
                        })),
                    }),
                }}
            />
            <Header />
            <main className="flex-grow w-full">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">

                    {/* Page Header */}
                    <div className="mb-20 border-b-8 border-black pb-12">
                        <h1 className="text-6xl sm:text-7xl lg:text-9xl font-black uppercase tracking-tighter mb-8 leading-[0.85]">
                            Engineering <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-700 to-gray-400">Log</span>
                        </h1>
                    </div>

                    {/* Articles List */}
                    <div className="space-y-12">
                        {ARTICLES.map((article, index) => (
                            <Link
                                to={`/engineering/${article.urlDate}/${article.id}`}
                                key={article.id}
                                className="group block relative cursor-pointer"
                            >
                                {/* Connector Line */}
                                {index !== ARTICLES.length - 1 && (
                                    <div className="absolute left-4 top-full h-12 w-1 bg-gray-200 -ml-[2px] hidden sm:block" />
                                )}

                                <div className="border-l-4 border-black pl-6 sm:pl-10 relative transition-all duration-300 group-hover:border-blue-600 group-hover:pl-12">
                                    {/* Hover Indicator */}
                                    <div className="absolute -left-[5px] top-0 w-2 h-0 bg-blue-600 transition-all duration-300 group-hover:h-full" />

                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                                        <div>
                                            <div className="flex items-center gap-3 text-xs font-mono font-black uppercase tracking-widest text-gray-400 mb-3 group-hover:text-blue-600 transition-colors">
                                                <span>{article.date}</span>
                                                <span className="w-1 h-1 bg-gray-400 rounded-full group-hover:bg-blue-600" />
                                                <span>{article.readTime}</span>
                                                <span className="ml-auto sm:ml-0 inline-block px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] group-hover:bg-blue-100 group-hover:text-blue-700">
                                                    READ ARTICLE
                                                </span>
                                            </div>
                                            <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-gray-900 group-hover:text-blue-800 transition-colors mb-4">
                                                {article.title}
                                            </h2>
                                            <p className="text-lg sm:text-xl font-medium text-gray-500 max-w-3xl group-hover:text-gray-700 transition-colors">
                                                {article.subtitle}
                                            </p>

                                            <div className="flex items-center gap-2 mt-6 text-sm font-bold text-gray-900 opacity-60 group-hover:opacity-100 transition-opacity">
                                                <span className="text-gray-400 font-normal">By</span>
                                                <span>{article.author.name}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>

                </div>
            </main>
            <Footer />
        </div>
    );
}
