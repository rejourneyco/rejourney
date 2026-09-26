import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, redirect, useLocation, useNavigate } from "react-router";
import { Lightbulb, Loader2, Plus, ThumbsUp } from "lucide-react";
import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { useAuth } from "~/shared/providers/AuthContext";
import {
    MARKETING_INDEXABLE_LOCALE_ORDER,
    MARKETING_LOCALE_VARY_HEADER,
    getLocalizedAlternateLinksForPath,
    getLocalizedPublicUrl,
    getMarketingHomeCopy,
    getMarketingLocaleFromPathname,
    getMarketingLocaleRedirectPath,
    isIndexableMarketingLocale,
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
    const alternateLinks = getLocalizedAlternateLinksForPath(location.pathname, MARKETING_INDEXABLE_LOCALE_ORDER).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
    }));
    const alternateOgLocales = getLocalizedAlternateLinksForPath(location.pathname, MARKETING_INDEXABLE_LOCALE_ORDER)
        .filter((alternate) => alternate.hrefLang !== "x-default" && alternate.hrefLang !== locale.languageTag)
        .map((alternate) => ({
            property: "og:locale:alternate",
            content: getMarketingLocaleFromPathname(new URL(alternate.href).pathname).ogLocale,
        }));
    const robots = isIndexableMarketingLocale(locale) ? "index, follow" : "noindex, follow";

    return [
        { title: copy.metaTitle },
        {
            name: "description",
            content: copy.metaDescription,
        },
        { httpEquiv: "Content-Language", content: locale.languageTag },
        { property: "og:locale", content: locale.ogLocale },
        ...alternateOgLocales,
        { name: "robots", content: robots },
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
    const loginPath = "/login";
    const roadmapReturnTo = `${location.pathname}${location.search}`;

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

    const storeRoadmapReturn = useCallback(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('returnUrl', roadmapReturnTo);
    }, [roadmapReturnTo]);

    const requireLogin = () => {
        storeRoadmapReturn();
        navigate(loginPath);
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
                <p className="max-w-3xl text-sm font-normal leading-relaxed text-[#3c4043]">
                    {visibleDetails}
                    {shouldTruncate && (
                        <button
                            type="button"
                            onClick={() => toggleExpanded(post.id)}
                            className="ml-2 font-medium text-[#1a73e8] underline underline-offset-2"
                        >
                            {isExpanded ? copy.showLess : copy.showMore}
                        </button>
                    )}
                </p>
                {post.developerComment && (
                    <div className="mt-4 rounded-none border border-[#dadce0] bg-[#f8fafd] p-3 text-[#202124]">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5f6368]">{copy.developerComment}</div>
                        <p className="mt-1 text-sm font-medium leading-snug">{post.developerComment}</p>
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
                className={`group flex min-h-[96px] w-full flex-col items-center justify-center rounded-none border px-3 py-3 text-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] disabled:cursor-not-allowed sm:w-24 ${
                    hasVoted
                        ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]"
                        : "border-[#dadce0] bg-white text-[#202124] hover:bg-[#f8fafd] hover:border-[#1a73e8]"
                }`}
            >
                <span className="text-3xl font-bold leading-none">{post.votes}</span>
                <span className="mt-1 text-[11px] font-medium uppercase text-[#5f6368]">{formatVotes(post.votes, copy.voteSingular, copy.votePlural)}</span>
                <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                    {isVoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    {hasVoted ? copy.unvote : copy.vote}
                </span>
            </button>
        );
    };

    const renderRoadmapSection = (title: string, sectionPosts: RoadmapPost[], emptyTitle: string, emptyCopy: string) => (
        <section aria-labelledby="roadmap-section-title" className="relative">
            <div className="mb-6 flex items-end justify-between gap-4">
                <div>
                    <h2 id="roadmap-section-title" className="text-2xl font-bold tracking-tight text-[#202124] sm:text-3xl">{title}</h2>
                </div>
                <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-none border border-[#dadce0] bg-white px-2.5 text-sm font-semibold text-[#5f6368] shadow-sm">
                    {sectionPosts.length}
                </span>
            </div>

            {sectionPosts.length === 0 ? (
                <div className="relative overflow-hidden rounded-none border border-[#dadce0] bg-white px-5 py-14 text-center shadow-sm">
                    <h3 className="text-xl font-bold text-[#202124]">{emptyTitle}</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-[#5f6368]">{emptyCopy}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {sectionPosts.map((post) => (
                        <article
                            key={post.id}
                            className="group rounded-none border border-[#dadce0] bg-white p-5 shadow-sm transition-all hover:border-[#1a73e8]"
                        >
                            <div className="grid gap-5 sm:grid-cols-[96px_minmax(0,1fr)]">
                                <div aria-label={copy.voteActionAria}>
                                    {renderVoteButton(post)}
                                </div>
                                <div className="min-w-0">
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <span className={`inline-flex rounded-none border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${isCompletePost(post) ? 'border-[#ceead6] bg-[#e6f4ea] text-[#137333]' : 'border-[#d2e3fc] bg-[#e8f0fe] text-[#1a73e8]'}`}>
                                            {post.status}
                                        </span>
                                    </div>
                                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
                                        <h3 className="min-w-0 text-xl font-bold leading-snug text-[#202124]">
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
        <div className="public-readable-scope flex min-h-screen w-full flex-col bg-[var(--dashboard-canvas,#f8fafd)] text-[#202124]" lang={locale.languageTag} dir={locale.dir}>
            <Header />
            <main className="w-full flex-1">
                <section className="relative overflow-hidden border-b border-[#dadce0] bg-white px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
                    <div className="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
                        <div className="max-w-4xl">
                            <p className="mb-3 inline-flex rounded-none border border-[#d2e3fc] bg-[#e8f0fe] px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-[#1a73e8]">
                                {copy.eyebrow}
                            </p>
                            <h1 className="max-w-4xl font-display text-4xl font-extrabold tracking-normal text-[#202124] sm:text-5xl lg:text-6xl">
                                {copy.title}
                            </h1>
                            <p className="mt-4 max-w-3xl text-lg font-medium leading-relaxed text-[#3c4043]">
                                {copy.intro}
                            </p>
                            {!isAuthenticated && !authLoading && (
                                <Link
                                    to={loginPath}
                                    onClick={storeRoadmapReturn}
                                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-none bg-[#1a73e8] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1765cc] sm:w-auto"
                                >
                                    {copy.signInToPost}
                                </Link>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
                            <div className="rounded-none border border-[#dadce0] bg-white p-5 shadow-sm">
                                <div className="text-3xl font-bold leading-none text-[#1a73e8] sm:text-4xl">{openPosts.length}</div>
                                <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-[#5f6368]">{copy.open}</div>
                            </div>
                            <div className="rounded-none border border-[#dadce0] bg-white p-5 shadow-sm">
                                <div className="text-3xl font-bold leading-none text-[#137333] sm:text-4xl">{completePosts.length}</div>
                                <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-[#5f6368]">{copy.complete}</div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="border-b border-[#dadce0] bg-[var(--dashboard-canvas,#f8fafd)] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
                    <div className="mx-auto max-w-7xl">
                        <div className="overflow-hidden rounded-none border border-[#dadce0] bg-white shadow-sm">
                            <div className="flex flex-col gap-3 border-b border-[#dadce0] bg-[#f8fafd] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                                <div className="flex items-center gap-3">
                                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-none border border-[#dadce0] bg-[#e8f0fe] text-[#1a73e8]">
                                        <Lightbulb className="h-5 w-5" strokeWidth={2.2} />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-lg font-bold text-[#202124]">{copy.addIdeaTitle}</h2>
                                        {!isAuthenticated && <p className="text-xs text-[#5f6368]">{copy.signInFirst}</p>}
                                    </div>
                                </div>
                                {!isAuthenticated && (
                                    <Link
                                        to={loginPath}
                                        onClick={storeRoadmapReturn}
                                        className="inline-flex w-full items-center justify-center rounded-none bg-[#1a73e8] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-sm hover:bg-[#1765cc] sm:w-auto"
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
                                        className="h-11 w-full rounded-none border border-[#dadce0] bg-white px-3 text-sm text-[#202124] placeholder:text-[#80868b] focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
                                    />
                                    <textarea
                                        value={details}
                                        onChange={(event) => setDetails(event.target.value)}
                                        maxLength={1200}
                                        placeholder={copy.detailsPlaceholder}
                                        rows={3}
                                        aria-label={copy.detailsPlaceholder}
                                        className="min-h-11 w-full resize-y rounded-none border border-[#dadce0] bg-white px-3 py-2.5 text-sm text-[#202124] placeholder:text-[#80868b] focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
                                    />
                                    <button
                                        type="submit"
                                        disabled={savingPost}
                                        className="inline-flex h-11 items-center justify-center gap-2 rounded-none bg-[#1a73e8] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1765cc] disabled:cursor-wait disabled:opacity-60"
                                    >
                                        {savingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
                                        {copy.postButton}
                                    </button>
                                </form>
                            )}
                        </div>

                        {formError && <p className="mt-4 rounded-none border border-[#f5c6cb] bg-[#fdf7f7] px-4 py-2.5 text-sm font-medium text-[#721c24]">{formError}</p>}
                        {error && <p className="mt-4 rounded-none border border-[#f5c6cb] bg-[#fdf7f7] px-4 py-2.5 text-sm font-medium text-[#721c24]">{error}</p>}

                        <div className="mt-6 inline-flex max-w-full rounded-none border border-[#dadce0] bg-white p-1 shadow-sm gap-1">
                            <button
                                type="button"
                                onClick={() => setRoadmapView('open')}
                                aria-pressed={roadmapView === 'open'}
                                className={`flex min-h-9 items-center justify-center gap-2 px-4 text-xs font-semibold uppercase tracking-wider transition-all focus:outline-none sm:min-w-36 ${
                                    roadmapView === 'open'
                                        ? 'bg-[#e8f0fe] text-[#1a73e8]'
                                        : 'bg-white text-[#5f6368] hover:bg-[#f8fafd] hover:text-[#202124]'
                                }`}
                            >
                                {copy.open}
                                <span className="rounded-none border border-[#dadce0] bg-white px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[#5f6368]">
                                    {openPosts.length}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setRoadmapView('complete')}
                                aria-pressed={roadmapView === 'complete'}
                                className={`flex min-h-9 items-center justify-center gap-2 px-4 text-xs font-semibold uppercase tracking-wider transition-all focus:outline-none sm:min-w-36 ${
                                    roadmapView === 'complete'
                                        ? 'bg-[#e6f4ea] text-[#137333]'
                                        : 'bg-white text-[#5f6368] hover:bg-[#f8fafd] hover:text-[#202124]'
                                }`}
                            >
                                {copy.complete}
                                <span className="rounded-none border border-[#dadce0] bg-white px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[#5f6368]">
                                    {completePosts.length}
                                </span>
                            </button>
                        </div>
                    </div>
                </section>

                <section className="bg-[var(--dashboard-canvas,#f8fafd)] px-4 py-10 text-[#202124] sm:px-6 sm:py-12 lg:px-8">
                    <div className="mx-auto max-w-7xl">
                        {loadingPosts ? (
                            <section className="rounded-none border border-[#dadce0] bg-white p-12 text-center text-sm font-medium text-[#5f6368] shadow-sm">
                                <div className="flex min-h-36 items-center justify-center gap-3">
                                    <Loader2 className="h-5 w-5 animate-spin text-[#1a73e8]" />
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
