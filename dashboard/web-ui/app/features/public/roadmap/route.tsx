import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, redirect, useLocation, useNavigate } from "react-router";
import { Lightbulb, Loader2, Plus, ThumbsUp } from "lucide-react";
import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { useAuth } from "~/shared/providers/AuthContext";
import {
    MARKETING_LOCALE_VARY_HEADER,
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicUrl,
    getMarketingHomeCopy,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
} from "~/shared/lib/internationalMarketing";
import {
    createRoadmapPost,
    getRoadmapPosts,
    getRoadmapVotePostIds,
    setRoadmapVote,
    type RoadmapPost,
} from "~/shared/api/client";

const DETAIL_PREVIEW_LENGTH = 180;
type RoadmapView = 'open' | 'complete';

export function loader({ request }: Route.LoaderArgs) {
    const redirectPath = getMarketingLocaleRedirectPath(request);
    if (redirectPath) {
        throw redirect(redirectPath, {
            status: 302,
            headers: {
                Vary: MARKETING_LOCALE_VARY_HEADER,
            },
        });
    }

    return null;
}

export const meta: Route.MetaFunction = ({ location }) => {
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getMarketingHomeCopy(locale).roadmap;
    const canonicalUrl = getLocalizedPublicUrl(locale, "/roadmap");
    const alternateLinks = getLocalizedAlternateLinksForPath(location.pathname).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath(location.pathname)
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));

    return [
        { title: copy.metaTitle },
        {
            name: "description",
            content: copy.metaDescription,
        },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { name: "robots", content: "index, follow" },
        { property: "og:title", content: copy.metaTitle },
        { property: "og:description", content: copy.ogDescription },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonicalUrl },
        { tagName: "link", rel: "canonical", href: canonicalUrl },
        ...alternateLinks,
    ];
};

function formatVotes(votes: number, singular: string, plural: string): string {
    return votes === 1 ? singular : plural;
}

function sortPosts(posts: RoadmapPost[]): RoadmapPost[] {
    return [...posts].sort((a, b) => {
        if (b.votes !== a.votes) return b.votes - a.votes;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function isCompletePost(post: RoadmapPost): boolean {
    return ['complete', 'completed', 'done', 'shipped'].includes(post.status.toLowerCase());
}

export default function RoadmapPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getMarketingHomeCopy(locale).roadmap;
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const [posts, setPosts] = useState<RoadmapPost[]>([]);
    const [votedPostIds, setVotedPostIds] = useState<Set<string>>(() => new Set());
    const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(() => new Set());
    const [loadingPosts, setLoadingPosts] = useState(true);
    const [loadingVotes, setLoadingVotes] = useState(false);
    const [savingPost, setSavingPost] = useState(false);
    const [votingPostId, setVotingPostId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [title, setTitle] = useState("");
    const [details, setDetails] = useState("");
    const [roadmapView, setRoadmapView] = useState<RoadmapView>('open');
    const inFlightVotePostIdsRef = useRef<Set<string>>(new Set());
    const loginReturnTo = `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`;

    const sortedPosts = useMemo(() => sortPosts(posts), [posts]);
    const openPosts = useMemo(() => sortedPosts.filter((post) => !isCompletePost(post)), [sortedPosts]);
    const completePosts = useMemo(() => sortedPosts.filter(isCompletePost), [sortedPosts]);
    const activePosts = roadmapView === 'open' ? openPosts : completePosts;
    const activeTitle = roadmapView === 'open' ? copy.open : copy.complete;
    const activeEmptyTitle = roadmapView === 'open' ? copy.noOpenIdeas : copy.nothingComplete;
    const activeEmptyCopy = roadmapView === 'open'
        ? copy.noOpenIdeasCopy
        : copy.nothingCompleteCopy;

    const loadPosts = useCallback(async () => {
        setLoadingPosts(true);
        setError(null);
        try {
            const nextPosts = await getRoadmapPosts();
            setPosts(sortPosts(nextPosts));
        } catch (err) {
            setError(err instanceof Error ? err.message : copy.unableToLoad);
        } finally {
            setLoadingPosts(false);
        }
    }, [copy.unableToLoad]);

    useEffect(() => {
        void loadPosts();
    }, [loadPosts]);

    useEffect(() => {
        let cancelled = false;

        if (authLoading) return;
        if (!isAuthenticated) {
            setVotedPostIds(new Set());
            return;
        }

        setLoadingVotes(true);
        getRoadmapVotePostIds()
            .then((postIds) => {
                if (!cancelled) setVotedPostIds(new Set(postIds));
            })
            .catch(() => {
                if (!cancelled) setVotedPostIds(new Set());
            })
            .finally(() => {
                if (!cancelled) setLoadingVotes(false);
            });

        return () => {
            cancelled = true;
        };
    }, [authLoading, isAuthenticated]);

    const toggleExpanded = (postId: string) => {
        setExpandedPostIds((current) => {
            const next = new Set(current);
            if (next.has(postId)) {
                next.delete(postId);
            } else {
                next.add(postId);
            }
            return next;
        });
    };

    const requireLogin = () => {
        navigate(loginReturnTo);
    };

    const handleVote = async (postId: string) => {
        if (authLoading || loadingVotes) return;
        if (!isAuthenticated) {
            requireLogin();
            return;
        }
        if (inFlightVotePostIdsRef.current.has(postId)) return;

        const hasVoted = votedPostIds.has(postId);
        const nextVoted = !hasVoted;
        const previousPosts = posts;
        const previousVotedPostIds = votedPostIds;

        inFlightVotePostIdsRef.current.add(postId);
        setVotingPostId(postId);
        setError(null);
        setVotedPostIds((current) => {
            const next = new Set(current);
            if (nextVoted) {
                next.add(postId);
            } else {
                next.delete(postId);
            }
            return next;
        });
        setPosts((current) => current.map((post) => {
            if (post.id !== postId) return post;
            const voteDelta = nextVoted ? 1 : -1;
            return {
                ...post,
                votes: Math.max(0, post.votes + voteDelta),
            };
        }));

        try {
            const result = await setRoadmapVote(postId, nextVoted);
            setPosts((current) => current.map((post) => post.id === postId ? result.post : post));
            setVotedPostIds((current) => {
                const next = new Set(current);
                if (nextVoted) {
                    next.add(postId);
                } else {
                    next.delete(postId);
                }
                return next;
            });
        } catch (err) {
            setPosts(previousPosts);
            setVotedPostIds(previousVotedPostIds);
            setError(err instanceof Error ? err.message : copy.unableToUpdateVote);
        } finally {
            inFlightVotePostIdsRef.current.delete(postId);
            setVotingPostId(null);
        }
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!isAuthenticated) {
            requireLogin();
            return;
        }

        const trimmedTitle = title.trim();
        const trimmedDetails = details.trim();
        if (trimmedTitle.length < 3) {
            setFormError(copy.ideaMinError);
            return;
        }
        if (trimmedDetails.length < 10) {
            setFormError(copy.detailsMinError);
            return;
        }

        setSavingPost(true);
        setFormError(null);
        setError(null);
        try {
            const createdPost = await createRoadmapPost({
                title: trimmedTitle,
                details: trimmedDetails,
            });
            setPosts((current) => sortPosts([createdPost, ...current]));
            setTitle("");
            setDetails("");
        } catch (err) {
            setFormError(err instanceof Error ? err.message : copy.unableToAddIdea);
        } finally {
            setSavingPost(false);
        }
    };

    const renderDetails = (post: RoadmapPost) => {
        const isExpanded = expandedPostIds.has(post.id);
        const shouldTruncate = post.details.length > DETAIL_PREVIEW_LENGTH;
        const visibleDetails = shouldTruncate && !isExpanded
            ? `${post.details.slice(0, DETAIL_PREVIEW_LENGTH).trim()}...`
            : post.details;

        return (
            <div>
                <p className="text-base font-semibold leading-relaxed text-slate-600">
                    {visibleDetails}
                    {shouldTruncate && (
                        <button
                            type="button"
                            onClick={() => toggleExpanded(post.id)}
                            className="ml-2 font-black uppercase text-[#ea580c] underline decoration-2 underline-offset-4"
                        >
                            {isExpanded ? copy.showLess : copy.showMore}
                        </button>
                    )}
                </p>
                {post.developerComment && (
                    <div className="mt-4 border-2 border-black bg-[#fef08a] px-3 py-2 text-black shadow-neo-sm">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-700">{copy.developerComment}</div>
                        <p className="mt-1 text-sm font-black uppercase leading-snug">{post.developerComment}</p>
                    </div>
                )}
            </div>
        );
    };

    const renderVoteButton = (post: RoadmapPost) => {
        const hasVoted = votedPostIds.has(post.id);
        const isVoting = votingPostId === post.id;
        return (
            <button
                type="button"
                onClick={() => handleVote(post.id)}
                disabled={authLoading || loadingVotes || isVoting}
                className={`inline-flex h-12 min-w-[104px] items-center justify-center gap-2 border-2 border-black px-4 text-sm font-black uppercase shadow-neo-sm transition-all disabled:cursor-not-allowed ${
                    hasVoted
                        ? "bg-[#86efac] text-black"
                        : "bg-[#f54e00] text-black hover:-translate-y-0.5 hover:bg-[#ff6b2a] hover:shadow-neo"
                }`}
            >
                {isVoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                {hasVoted ? copy.unvote : copy.vote}
            </button>
        );
    };

    const renderRoadmapSection = (title: string, sectionPosts: RoadmapPost[], emptyTitle: string, emptyCopy: string) => (
        <section className="overflow-hidden border-2 border-black bg-white shadow-neo">
            <div className="flex items-center justify-between border-b-2 border-black bg-[#eef2f7] px-4 py-4">
                <h2 className="text-3xl font-black uppercase tracking-tight text-black">{title}</h2>
                <span className="border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase text-black shadow-neo-sm">
                    {sectionPosts.length}
                </span>
            </div>
            <div className="hidden grid-cols-[150px_150px_minmax(220px,0.9fr)_minmax(320px,1.6fr)] border-b-2 border-black bg-white text-left text-lg font-black text-slate-700 md:grid">
                <div className="border-r-2 border-black px-4 py-4" aria-label={copy.voteActionAria} />
                <div className="border-r-2 border-black px-4 py-4">{copy.votesHeader}</div>
                <div className="border-r-2 border-black px-4 py-4">{copy.ideaHeader}</div>
                <div className="px-4 py-4">{copy.detailsHeader}</div>
            </div>

            {sectionPosts.length === 0 ? (
                <div className="min-h-40 px-5 py-10 text-center">
                    <h3 className="text-2xl font-black uppercase text-black">{emptyTitle}</h3>
                    <p className="mx-auto mt-3 max-w-xl text-base font-bold text-slate-500">{emptyCopy}</p>
                </div>
            ) : (
                <div>
                    {sectionPosts.map((post) => (
                        <article
                            key={post.id}
                            className="grid gap-4 border-b-2 border-black p-4 last:border-b-0 md:grid-cols-[150px_150px_minmax(220px,0.9fr)_minmax(320px,1.6fr)] md:gap-0 md:p-0"
                        >
                            <div className="flex items-center md:border-r-2 md:border-black md:px-4 md:py-5">
                                {renderVoteButton(post)}
                            </div>
                            <div className="flex items-center justify-between gap-3 md:block md:border-r-2 md:border-black md:px-4 md:py-5">
                                <span className="text-xs font-black uppercase text-slate-500 md:hidden">{copy.votesHeader}</span>
                                <div>
                                    <div className="text-3xl font-black leading-none text-slate-950">{post.votes}</div>
                                    <div className="mt-1 text-base font-bold leading-none text-slate-500">{formatVotes(post.votes, copy.voteSingular, copy.votePlural)}</div>
                                </div>
                            </div>
                            <div className="md:border-r-2 md:border-black md:px-4 md:py-5">
                                <h3 className="text-2xl font-bold leading-tight text-slate-950 md:text-xl">
                                    {post.title}
                                </h3>
                                <div className={`mt-3 inline-flex border-2 border-black px-2 py-1 text-[10px] font-black uppercase text-black shadow-neo-sm ${isCompletePost(post) ? 'bg-[#86efac]' : 'bg-[#ecfeff]'}`}>
                                    {post.status}
                                </div>
                            </div>
                            <div className="md:px-4 md:py-5">
                                {renderDetails(post)}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );

    return (
        <div className="public-readable-scope flex min-h-screen w-full flex-col bg-[#f8fafc] text-slate-950" lang={locale.languageTag} dir={locale.dir}>
            <Header />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
                <section className="mb-10 border-b-8 border-black pb-8">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <p className="mb-3 inline-flex border-2 border-black bg-[#f9a8d4] px-3 py-1 text-[11px] font-black uppercase tracking-widest text-black shadow-neo-sm">
                                {copy.eyebrow}
                            </p>
                            <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tight text-black sm:text-7xl lg:text-8xl">
                                {copy.title}
                            </h1>
                            <p className="mt-5 max-w-3xl text-xl font-bold leading-relaxed text-slate-600 sm:text-2xl">
                                {copy.intro}
                            </p>
                        </div>
                        {!isAuthenticated && !authLoading && (
                            <Link
                                to={loginReturnTo}
                                className="inline-flex items-center justify-center gap-2 border-2 border-black bg-black px-5 py-3 text-sm font-black uppercase text-white shadow-neo transition-all hover:-translate-y-0.5 hover:bg-[#5dadec] hover:text-black hover:shadow-neo-lg"
                            >
                                {copy.signInToPost}
                            </Link>
                        )}
                    </div>
                </section>

                <section className="mb-10 border-2 border-black bg-white p-4 shadow-neo sm:p-6">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="grid h-11 w-11 place-items-center border-2 border-black bg-[#67e8f9] shadow-neo-sm">
                            <Lightbulb className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black uppercase tracking-tight">{copy.addIdeaTitle}</h2>
                            <p className="text-sm font-bold text-slate-500">
                                {isAuthenticated ? "" : copy.signInFirst}
                            </p>
                        </div>
                    </div>

                    {isAuthenticated ? (
                        <form onSubmit={handleSubmit} className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto] lg:items-start">
                            <input
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                                maxLength={160}
                                placeholder={copy.ideaPlaceholder}
                                className="h-12 w-full border-2 border-black bg-[#f8fafc] px-3 text-sm font-black uppercase text-black placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black"
                            />
                            <textarea
                                value={details}
                                onChange={(event) => setDetails(event.target.value)}
                                maxLength={1200}
                                placeholder={copy.detailsPlaceholder}
                                rows={3}
                                className="min-h-12 w-full resize-y border-2 border-black bg-[#f8fafc] px-3 py-3 text-sm font-bold text-black placeholder:font-black placeholder:uppercase placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black"
                            />
                            <button
                                type="submit"
                                disabled={savingPost}
                                className="inline-flex h-12 items-center justify-center gap-2 border-2 border-black bg-[#86efac] px-5 text-sm font-black uppercase text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#bbf7d0] hover:shadow-neo disabled:cursor-wait disabled:opacity-70"
                            >
                                {savingPost && <Loader2 className="h-4 w-4 animate-spin" />}
                                {copy.postButton}
                            </button>
                        </form>
                    ) : (
                        <Link
                            to={loginReturnTo}
                            className="inline-flex items-center justify-center border-2 border-black bg-[#fef08a] px-5 py-3 text-sm font-black uppercase text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#67e8f9] hover:shadow-neo"
                        >
                            {copy.signInToAddIdea}
                        </Link>
                    )}
                    {formError && <p className="mt-3 text-sm font-black uppercase text-red-600">{formError}</p>}
                </section>

                {error && (
                    <div className="mb-6 border-2 border-black bg-[#fecaca] px-4 py-3 text-sm font-black uppercase text-black shadow-neo-sm">
                        {error}
                    </div>
                )}

                <div className="mb-6 grid grid-cols-2 border-2 border-black bg-white shadow-neo-sm">
                    <button
                        type="button"
                        onClick={() => setRoadmapView('open')}
                        className={`flex min-h-14 items-center justify-center gap-2 border-r-2 border-black px-4 text-sm font-black uppercase tracking-wide transition-all sm:text-base ${
                            roadmapView === 'open'
                                ? 'bg-[#67e8f9] text-black'
                                : 'bg-white text-slate-500 hover:bg-[#ecfeff] hover:text-black'
                        }`}
                    >
                        {copy.open}
                        <span className="border-2 border-black bg-white px-2 py-0.5 text-xs font-black leading-none text-black">
                            {openPosts.length}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setRoadmapView('complete')}
                        className={`flex min-h-14 items-center justify-center gap-2 px-4 text-sm font-black uppercase tracking-wide transition-all sm:text-base ${
                            roadmapView === 'complete'
                                ? 'bg-[#86efac] text-black'
                                : 'bg-white text-slate-500 hover:bg-[#f0fdf4] hover:text-black'
                        }`}
                    >
                        {copy.complete}
                        <span className="border-2 border-black bg-white px-2 py-0.5 text-xs font-black leading-none text-black">
                            {completePosts.length}
                        </span>
                    </button>
                </div>

                {loadingPosts ? (
                    <section className="overflow-hidden border-2 border-black bg-white shadow-neo">
                        <div className="flex min-h-56 items-center justify-center gap-3 text-sm font-black uppercase text-slate-500">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            {copy.loadingRoadmap}
                        </div>
                    </section>
                ) : (
                    renderRoadmapSection(activeTitle, activePosts, activeEmptyTitle, activeEmptyCopy)
                )}
            </main>
            <Footer />
        </div>
    );
}
