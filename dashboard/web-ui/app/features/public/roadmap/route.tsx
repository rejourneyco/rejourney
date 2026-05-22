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
                <p className="max-w-3xl text-base font-bold leading-relaxed text-slate-600">
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
                    <div className="mt-5 border-2 border-black bg-[#fef08a] px-4 py-3 text-black shadow-neo-sm">
                        <div className="text-[11px] font-black uppercase tracking-widest text-slate-600">{copy.developerComment}</div>
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
                className={`group flex min-h-[112px] w-full flex-col items-center justify-center border-2 border-black px-3 py-4 text-center shadow-neo-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 disabled:cursor-not-allowed sm:w-28 ${
                    hasVoted
                        ? "bg-[#86efac] text-black"
                        : "bg-white text-black hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#fef08a] hover:shadow-neo"
                }`}
            >
                <span className="text-4xl font-black leading-none">{post.votes}</span>
                <span className="mt-1 text-xs font-black uppercase text-slate-600">{formatVotes(post.votes, copy.voteSingular, copy.votePlural)}</span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide">
                    {isVoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" strokeWidth={3} />}
                    {hasVoted ? copy.unvote : copy.vote}
                </span>
            </button>
        );
    };

    const renderRoadmapSection = (title: string, sectionPosts: RoadmapPost[], emptyTitle: string, emptyCopy: string) => (
        <section aria-labelledby="roadmap-section-title" className="relative">
            <div className="mb-7 flex items-end justify-between gap-4">
                <div>
                    <p className="mb-3 inline-flex border-2 border-black bg-[#67e8f9] px-3 py-1 text-[11px] font-black uppercase tracking-widest text-black shadow-neo-sm">
                        {roadmapView === 'open' ? copy.vote : copy.complete}
                    </p>
                    <h2 id="roadmap-section-title" className="text-4xl font-black uppercase leading-none text-black sm:text-6xl">{title}</h2>
                </div>
                <span className={`inline-flex h-14 w-14 shrink-0 items-center justify-center border-2 border-black text-xl font-black text-black shadow-neo-sm ${roadmapView === 'open' ? 'bg-[#fef08a]' : 'bg-[#86efac]'}`}>
                    {sectionPosts.length}
                </span>
            </div>

            {sectionPosts.length === 0 ? (
                <div className="relative overflow-hidden border-2 border-black bg-white px-5 py-14 text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    <div className="absolute left-0 top-0 h-3 w-full bg-[#c4b5fd]" aria-hidden />
                    <h3 className="text-3xl font-black uppercase text-black">{emptyTitle}</h3>
                    <p className="mx-auto mt-3 max-w-xl text-base font-bold text-slate-600">{emptyCopy}</p>
                </div>
            ) : (
                <div className="space-y-5">
                    {sectionPosts.map((post) => (
                        <article
                            key={post.id}
                            className="group border-2 border-black bg-white p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] sm:p-5"
                        >
                            <div className="grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)]">
                                <div aria-label={copy.voteActionAria}>
                                    {renderVoteButton(post)}
                                </div>
                                <div className="min-w-0">
                                    <div className="mb-4 flex flex-wrap items-center gap-3">
                                        <span className={`inline-flex border-2 border-black px-3 py-1 text-[11px] font-black uppercase tracking-widest text-black shadow-neo-sm ${isCompletePost(post) ? 'bg-[#86efac]' : 'bg-[#67e8f9]'}`}>
                                            {post.status}
                                        </span>
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
                                        <h3 className="min-w-0 text-2xl font-black uppercase leading-tight text-black sm:text-3xl">
                                            {post.title}
                                        </h3>
                                        {renderDetails(post)}
                                    </div>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );

    return (
        <div className="public-readable-scope flex min-h-screen w-full flex-col bg-white text-slate-950" lang={locale.languageTag} dir={locale.dir}>
            <Header />
            <main className="w-full flex-1">
                <section className="relative overflow-hidden border-b-2 border-black bg-white px-4 py-14 text-black sm:px-6 sm:py-20 lg:px-8 lg:py-24">
                    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                        <div className="absolute -left-16 top-12 hidden h-28 w-72 -rotate-6 border-2 border-black bg-[#fff08a] shadow-[8px_8px_0_0_rgba(0,0,0,1)] md:block" />
                        <div className="absolute -right-20 top-16 hidden h-24 w-72 rotate-12 border-2 border-black bg-[#f9a8d4] shadow-[8px_8px_0_0_rgba(0,0,0,1)] md:block" />
                        <div className="absolute -left-24 bottom-10 h-20 w-56 rotate-6 border-2 border-black bg-[#bbf7d0] shadow-[7px_7px_0_0_rgba(0,0,0,1)] sm:-left-10 sm:h-24 sm:w-72" />
                        <div className="absolute -right-28 bottom-16 h-20 w-56 -rotate-8 border-2 border-black bg-[#c4b5fd] shadow-[7px_7px_0_0_rgba(0,0,0,1)] sm:-right-12 sm:h-24 sm:w-68" />
                    </div>
                    <div className="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
                        <div className="max-w-4xl">
                            <p className="mb-4 inline-flex border-2 border-black bg-[#67e8f9] px-3 py-1 text-[11px] font-black uppercase tracking-widest text-black shadow-neo-sm">
                                {copy.eyebrow}
                            </p>
                            <h1 className="max-w-4xl text-6xl font-black uppercase leading-[0.9] text-black sm:text-7xl lg:text-8xl">
                                {copy.title}
                            </h1>
                            <p className="mt-6 max-w-3xl text-xl font-extrabold leading-relaxed text-slate-700 sm:text-2xl">
                                {copy.intro}
                            </p>
                            {!isAuthenticated && !authLoading && (
                                <Link
                                    to={loginReturnTo}
                                    className="mt-8 inline-flex w-full items-center justify-center gap-3 border-2 border-black bg-slate-950 px-7 py-4 text-base font-black uppercase text-white shadow-[5px_5px_0px_0px_rgba(93,173,236,1)] transition-all hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-[7px_7px_0px_0px_rgba(93,173,236,1)] sm:w-auto"
                                >
                                    {copy.signInToPost}
                                </Link>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
                            <div className="border-2 border-black bg-[#67e8f9] px-5 py-5 shadow-neo sm:px-6">
                                <div className="text-4xl font-black leading-none sm:text-5xl">{openPosts.length}</div>
                                <div className="mt-2 text-xs font-black uppercase tracking-widest text-slate-800">{copy.open}</div>
                            </div>
                            <div className="border-2 border-black bg-[#86efac] px-5 py-5 shadow-neo sm:px-6">
                                <div className="text-4xl font-black leading-none sm:text-5xl">{completePosts.length}</div>
                                <div className="mt-2 text-xs font-black uppercase tracking-widest text-slate-800">{copy.complete}</div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="border-b-2 border-black bg-[#fff7df] px-4 py-10 text-black sm:px-6 sm:py-12 lg:px-8">
                    <div className="mx-auto max-w-7xl">
                        <div className="overflow-hidden border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                            <div className="flex flex-col gap-4 border-b-2 border-black bg-[#c4b5fd] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                                <div className="flex items-center gap-3">
                                    <div className="grid h-12 w-12 shrink-0 place-items-center border-2 border-black bg-[#67e8f9] shadow-neo-sm">
                                        <Lightbulb className="h-6 w-6" strokeWidth={2.7} />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-2xl font-black uppercase leading-tight text-black sm:text-3xl">{copy.addIdeaTitle}</h2>
                                        {!isAuthenticated && <p className="text-sm font-black text-slate-700">{copy.signInFirst}</p>}
                                    </div>
                                </div>
                                {!isAuthenticated && (
                                    <Link
                                        to={loginReturnTo}
                                        className="inline-flex w-full items-center justify-center border-2 border-black bg-black px-5 py-3 text-sm font-black uppercase text-white shadow-neo-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#5dadec] hover:text-black hover:shadow-neo sm:w-auto"
                                    >
                                        {copy.signInToAddIdea}
                                    </Link>
                                )}
                            </div>

                            {isAuthenticated && (
                                <form onSubmit={handleSubmit} className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.25fr)_auto] lg:items-start">
                                    <input
                                        value={title}
                                        onChange={(event) => setTitle(event.target.value)}
                                        maxLength={160}
                                        placeholder={copy.ideaPlaceholder}
                                        aria-label={copy.ideaPlaceholder}
                                        className="h-14 w-full border-2 border-black bg-[#f8fafc] px-4 text-sm font-black uppercase text-black placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-black"
                                    />
                                    <textarea
                                        value={details}
                                        onChange={(event) => setDetails(event.target.value)}
                                        maxLength={1200}
                                        placeholder={copy.detailsPlaceholder}
                                        rows={3}
                                        aria-label={copy.detailsPlaceholder}
                                        className="min-h-14 w-full resize-y border-2 border-black bg-[#f8fafc] px-4 py-4 text-sm font-bold text-black placeholder:font-black placeholder:uppercase placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-black"
                                    />
                                    <button
                                        type="submit"
                                        disabled={savingPost}
                                        className="inline-flex h-14 items-center justify-center gap-2 border-2 border-black bg-[#86efac] px-6 text-sm font-black uppercase text-black shadow-neo-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#bbf7d0] hover:shadow-neo disabled:cursor-wait disabled:opacity-70"
                                    >
                                        {savingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={3} />}
                                        {copy.postButton}
                                    </button>
                                </form>
                            )}
                        </div>

                        {formError && <p className="mt-5 border-2 border-black bg-[#fecaca] px-4 py-3 text-sm font-black uppercase text-black shadow-neo-sm">{formError}</p>}
                        {error && <p className="mt-5 border-2 border-black bg-[#fecaca] px-4 py-3 text-sm font-black uppercase text-black shadow-neo-sm">{error}</p>}

                        <div className="mt-8 inline-flex max-w-full border-2 border-black bg-white shadow-neo-sm">
                            <button
                                type="button"
                                onClick={() => setRoadmapView('open')}
                                aria-pressed={roadmapView === 'open'}
                                className={`flex min-h-14 items-center justify-center gap-2 border-r-2 border-black px-5 text-sm font-black uppercase tracking-wide transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 sm:min-w-44 ${
                                    roadmapView === 'open'
                                        ? 'bg-[#67e8f9] text-black'
                                        : 'bg-white text-slate-600 hover:bg-[#ecfeff] hover:text-black'
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
                                aria-pressed={roadmapView === 'complete'}
                                className={`flex min-h-14 items-center justify-center gap-2 px-5 text-sm font-black uppercase tracking-wide transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 sm:min-w-44 ${
                                    roadmapView === 'complete'
                                        ? 'bg-[#86efac] text-black'
                                        : 'bg-white text-slate-600 hover:bg-[#f0fdf4] hover:text-black'
                                }`}
                            >
                                {copy.complete}
                                <span className="border-2 border-black bg-white px-2 py-0.5 text-xs font-black leading-none text-black">
                                    {completePosts.length}
                                </span>
                            </button>
                        </div>
                    </div>
                </section>

                <section className="bg-white px-4 py-12 text-black sm:px-6 sm:py-16 lg:px-8">
                    <div className="mx-auto max-w-7xl">
                        {loadingPosts ? (
                            <section className="border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                                <div className="flex min-h-56 items-center justify-center gap-3 text-sm font-black uppercase text-slate-500">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    {copy.loadingRoadmap}
                                </div>
                            </section>
                        ) : (
                            renderRoadmapSection(activeTitle, activePosts, activeEmptyTitle, activeEmptyCopy)
                        )}
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    );
}
