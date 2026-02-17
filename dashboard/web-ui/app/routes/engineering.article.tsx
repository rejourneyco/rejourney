/**
 * Rejourney Dashboard - Engineering Article Page
 * Renders a specific engineering article based on the route slug.
 */

import type { MetaFunction, LoaderFunctionArgs } from "react-router";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";
import { ARTICLES } from "~/data/engineering";
import { ArrowLeft } from "lucide-react";
import { Link, redirect, useParams } from "react-router";

// Loader to validate slug
export function loader({ params }: LoaderFunctionArgs) {
    // We look up by slug (id) and ignore the date param for now, 
    // though we could strictly validate it matches article.urlDate if desired.
    const article = ARTICLES.find((a) => a.id === params.slug);
    if (!article) {
        throw new Response("Article not found", { status: 404 });
    }
    return null;
}

export const meta: MetaFunction = ({ params }) => {
    const article = ARTICLES.find((a) => a.id === params.slug);
    if (!article) {
        return [{ title: "Article Not Found - Rejourney" }];
    }
    return [
        { title: `${article.title} - Rejourney Engineering` },
        { name: "description", content: article.subtitle },
        { property: "og:title", content: article.title },
        { property: "og:description", content: article.subtitle },
        { property: "og:type", content: "article" },
        { property: "og:image", content: article.image },
        { property: "article:published_time", content: article.date },
        { property: "article:author", content: article.author.name },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: article.title },
        { name: "twitter:description", content: article.subtitle },
        { name: "twitter:image", content: article.image },
        { tagName: "link", rel: "canonical", href: `https://rejourney.co/engineering/${article.urlDate}/${article.id}` },
    ];
};

export default function EngineeringArticlePage() {
    const { slug } = useParams();
    const article = ARTICLES.find((a) => a.id === slug);

    if (!article) {
        return <div>Article not found</div>;
    }

    return (
        <div className="min-h-screen w-full bg-white text-slate-900 font-sans selection:bg-yellow-200 flex flex-col">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        ...article.schema,
                        image: [article.image],
                        publisher: {
                            "@type": "Organization",
                            name: "Rejourney",
                            logo: {
                                "@type": "ImageObject",
                                url: "https://rejourney.co/rejourneyIcon-removebg-preview.png",
                            },
                        },
                    }),
                }}
            />
            <Header />

            <main className="flex-grow w-full">
                {/* Progress Bar (Conceptual - sticky top) */}
                <div className="sticky top-0 left-0 w-full h-1 bg-gray-100 z-50">
                    <div className="h-full bg-black w-full origin-left scale-x-0 animate-scroll-progress" />
                </div>

                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">

                    <Link to="/engineering" className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-gray-500 hover:text-black mb-12 transition-colors">
                        <ArrowLeft size={16} /> Back to Engineering Log
                    </Link>

                    <article>
                        <header className="mb-16 border-b-4 border-black pb-12">
                            <div className="flex flex-wrap items-center gap-4 text-xs font-mono font-black uppercase tracking-widest text-blue-600 mb-6">
                                <span>{article.date}</span>
                                <span className="w-1 h-1 bg-gray-300 rounded-full" />
                                <span>{article.readTime}</span>
                            </div>

                            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black uppercase tracking-tighter mb-8 leading-[0.9]">
                                {article.title}
                            </h1>

                            <p className="text-xl sm:text-2xl font-medium text-gray-600 max-w-3xl leading-relaxed">
                                {article.subtitle}
                            </p>

                            <div className="flex items-center gap-3 mt-8">
                                <div className="w-10 h-10 bg-gray-200 rounded-full overflow-hidden flex items-center justify-center font-bold text-gray-500">
                                    {article.author.name.charAt(0)}
                                </div>
                                <div className="text-sm">
                                    <div className="font-bold text-gray-900">{article.author.name}</div>
                                    <a href={article.author.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                        View Profile
                                    </a>
                                </div>
                            </div>
                        </header>

                        <div className="prose prose-xl prose-slate max-w-none prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter prose-img:rounded-none prose-img:border-2 prose-img:border-black">
                            {article.content}
                        </div>

                        <div className="mt-20 pt-12 border-t-2 border-gray-100">
                            <h3 className="text-2xl font-black uppercase tracking-tighter mb-8">Author</h3>
                            <div className="flex items-start gap-4">
                                <div className="w-16 h-16 bg-gray-200 rounded-full overflow-hidden flex items-center justify-center font-bold text-2xl text-gray-500">
                                    {article.author.name.charAt(0)}
                                </div>
                                <div>
                                    <div className="font-bold text-xl text-gray-900 mb-1">{article.author.name}</div>
                                    <p className="text-gray-500 text-sm mb-2">Rejourney Engineering Team</p>
                                    <div className="flex gap-4">
                                        <a href={article.author.url} className="text-blue-600 font-bold hover:underline">
                                            Follow on LinkedIn
                                        </a>
                                        {article.author.github && (
                                            <a href={article.author.github} className="text-gray-900 font-bold hover:underline">
                                                GitHub
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </article>

                </div>
            </main>
            <Footer />
        </div>
    );
}
