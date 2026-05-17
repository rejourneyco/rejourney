import React, { useState } from 'react';
import { Link } from 'react-router';
import {
    ArrowRight,
    Bug,
    CheckCircle2,
    ClipboardList,
    Code2,
    Eye,
    Globe2,
    MousePointerClick,
    Palette,
    TrendingUp,
    Plus,
    Minus,
} from 'lucide-react';
import type { MarketingHomeCopy } from '~/shared/lib/internationalMarketing';

const productStories = [
    {
        copyIndex: 0,
        eyebrow: 'Session recordings',
        title: 'Watch real users move through your app.',
        copy: 'Replay web and mobile sessions with enough context to answer the question everyone asks first: what actually happened?',
        bullets: ['Pixel-perfect replay', 'Click, tap, and screen changes', 'Network, logs, and device context'],
        image: '/images/session-replay-preview.png',
        alt: 'Rejourney session replay preview',
        icon: Eye,
        accent: 'bg-[#e8f4ff]',
    },
    {
        copyIndex: 1,
        eyebrow: 'Heatmaps and journeys',
        title: 'See what grabs attention and where people drop.',
        copy: 'Turn scattered taps, swipes, scrolls, and exits into a map of the screens that help or hurt conversion.',
        bullets: ['Tap and rage-tap clusters', 'Journey maps across screens', 'Drop-off points by flow'],
        image: '/images/heatmaps.png',
        alt: 'Rejourney touch heatmaps preview',
        icon: MousePointerClick,
        accent: 'bg-[#ffe4e6]',
    },
    {
        copyIndex: 3,
        eyebrow: 'Growth loops',
        title: 'Connect product quality to retention.',
        copy: 'Measure whether releases are creating better sessions, calmer funnels, and more users who come back.',
        bullets: ['Retention and loyalty segments', 'Release impact signals', 'Funnel recovery opportunities'],
        image: '/images/growth-engines.png',
        alt: 'Rejourney growth analytics preview',
        icon: TrendingUp,
        accent: 'bg-[#dcfce7]',
    },
    {
        copyIndex: 4,
        eyebrow: 'Geographic analytics',
        title: 'See API response and sentiment by region.',
        copy: 'Spot where latency, errors, and user sentiment change across countries before regional issues turn into churn.',
        bullets: ['API response times by city', 'Regional sentiment signals', 'Geo health and session context'],
        image: '/images/geo-analytics.png',
        alt: 'Rejourney geographic analytics globe preview',
        icon: Globe2,
        accent: 'bg-[#ccfbf1]',
    },
    {
        copyIndex: 2,
        eyebrow: 'Crashes and ANRs',
        title: 'Tie broken experiences to the session that caused them.',
        copy: 'Crash reporting is more useful when it sits beside replay, thread analysis, device details, and the user path.',
        bullets: ['Crash and ANR detection', 'Main-thread performance clues', 'Incident stream for triage'],
        image: '/images/anr-issues.png',
        alt: 'Rejourney ANR and crash detection preview',
        icon: Bug,
        accent: 'bg-[#fef9c3]',
        imagePanelClassName: 'bg-white p-2 sm:p-3 lg:self-center',
        imageFrameClassName: 'flex border-2 border-black bg-[#fef9c3] p-3 sm:p-4',
        imageClassName: 'h-auto w-full object-contain object-left-top',
        technicalLast: true,
    },
];

const workspaceRoles = [
    {
        label: 'PM',
        icon: ClipboardList,
        className: 'text-[#f97316]',
    },
    {
        label: 'UX',
        icon: Palette,
        className: 'text-[#ec4899]',
    },
    {
        label: 'DEV',
        icon: Code2,
        className: 'text-[#2563eb]',
    },
];

const workspaceCursors = [
    {
        label: 'PM',
        color: '#f97316',
        softColor: 'rgba(249, 115, 22, 0.16)',
        left: '24%',
        top: '27%',
    },
    {
        label: 'UX',
        color: '#ec4899',
        softColor: 'rgba(236, 72, 153, 0.15)',
        left: '67%',
        top: '56%',
    },
    {
        label: 'DEV',
        color: '#2563eb',
        softColor: 'rgba(93, 173, 236, 0.2)',
        left: '88%',
        top: '31%',
    },
];

const LandingFaq: React.FC<{ copy: MarketingHomeCopy['narrative']['faq']; dir?: 'ltr' | 'rtl' }> = ({ copy, dir = 'ltr' }) => {
    const [open, setOpen] = useState<number | null>(null);
    const alignClass = dir === 'rtl' ? 'text-right' : 'text-left';

    return (
        <section dir={dir} className={`relative w-full overflow-hidden border-t-2 border-b-2 border-black bg-[#fff7df] px-4 py-14 text-slate-950 sm:px-6 sm:py-20 lg:px-8 ${alignClass}`}>
            <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(#0f172a_1px,transparent_1px)] [background-size:16px_16px]" aria-hidden />
            <div className="mx-auto max-w-4xl">
                <p className="mb-4 inline-flex border-2 border-black bg-[#67e8f9] px-3 py-1 text-[11px] font-black uppercase tracking-widest text-black shadow-neo-sm">{copy.eyebrow}</p>
                <h2 className="mb-10 text-4xl font-black uppercase leading-[0.96] tracking-tight sm:text-5xl">
                    {copy.heading}
                </h2>
                <div className="relative divide-y-2 divide-black border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    {copy.items.map((item, i) => (
                        <div key={i}>
                            <button
                                type="button"
                                onClick={() => setOpen(open === i ? null : i)}
                                className={`flex w-full items-center justify-between gap-6 px-6 py-5 transition-colors hover:bg-[#fef3c7] ${alignClass}`}
                                aria-expanded={open === i}
                            >
                                <span className="text-base font-black uppercase leading-snug tracking-tight sm:text-lg">
                                    {item.q}
                                </span>
                                <span className="shrink-0 border-2 border-black p-1">
                                    {open === i
                                        ? <Minus size={16} strokeWidth={3} />
                                        : <Plus size={16} strokeWidth={3} />
                                    }
                                </span>
                            </button>
                            {open === i && (
                                <div className="border-t-2 border-black bg-[#ecfeff] px-6 py-5">
                                    <p className="max-w-3xl text-base font-bold leading-relaxed text-slate-600">
                                        {item.a}
                                    </p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export const LandingNarrative: React.FC<{ copy: MarketingHomeCopy['narrative']; dir?: 'ltr' | 'rtl' }> = ({ copy, dir = 'ltr' }) => {
    const renderedStories = productStories.map((story) => {
        const localizedStory = typeof story.copyIndex === 'number' ? copy.productStories[story.copyIndex] : undefined;
        return {
            ...story,
            ...(localizedStory ?? {}),
        };
    });
    const orderedStories = [
        ...renderedStories.filter((story) => !story.technicalLast),
        ...renderedStories.filter((story) => story.technicalLast),
    ];
    const alignClass = dir === 'rtl' ? 'text-right' : 'text-left';

    return (
        <div dir={dir} className={alignClass}>
            <section className="w-full bg-[#fff7df] px-4 py-14 text-slate-950 sm:px-6 sm:py-24 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <div className="mb-10 flex flex-col gap-5 lg:mb-14 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0">
                            <p className="mb-4 inline-flex border-2 border-black bg-[#67e8f9] px-3 py-1 text-[11px] font-black uppercase text-black shadow-neo-sm">{copy.signalsEyebrow}</p>
                            <h2 className="max-w-4xl break-words text-3xl font-black uppercase leading-tight tracking-tight sm:text-6xl">
                                {copy.signalsHeading}
                            </h2>
                        </div>
                        <Link
                            to="/demo"
                            className="inline-flex w-full items-center justify-center gap-2 border-2 border-black bg-[#fef08a] px-5 py-3 text-sm font-black uppercase text-black shadow-neo transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#67e8f9] hover:shadow-neo-lg active:translate-x-0 active:translate-y-0 active:shadow-none sm:w-auto sm:px-6 sm:py-4"
                        >
                            {copy.demoCta}
                            <ArrowRight size={17} strokeWidth={3} />
                        </Link>
                    </div>

                    <div className="space-y-5 lg:space-y-7">
                        {orderedStories.map((story, index) => {
                            const Icon = story.icon;
                            const imageOrder = index % 2 === 1 ? 'lg:order-last' : '';

                            return (
                                <article
                                    key={story.title}
                                    className="grid overflow-hidden border-2 border-black bg-white shadow-[7px_7px_0px_0px_rgba(0,0,0,1)] lg:grid-cols-2"
                                >
                                    <div className={`${story.imagePanelClassName ?? 'min-h-[220px] bg-white p-2 sm:min-h-[260px] sm:p-3 lg:min-h-[420px]'} ${imageOrder}`}>
                                        <div className={story.imageFrameClassName ?? `flex h-full items-center border-2 border-black ${story.accent} p-3`}>
                                            <img
                                                src={story.image}
                                                alt={story.alt}
                                                className={story.imageClassName ?? 'h-full max-h-[390px] w-full object-cover object-left-top'}
                                                loading="lazy"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex min-w-0 flex-col justify-center p-5 sm:p-8 lg:p-12">
                                        <div className={`mb-6 grid h-12 w-12 shrink-0 place-items-center border-2 border-black ${story.accent} shadow-neo-sm`}>
                                            <Icon size={22} strokeWidth={2.7} />
                                        </div>
                                        <p className="mb-3 text-[11px] font-black uppercase text-slate-400">{story.eyebrow}</p>
                                        <h3 className="max-w-xl break-words text-2xl font-black uppercase leading-tight tracking-tight sm:text-4xl">
                                            {story.title}
                                        </h3>
                                        <p className="mt-5 max-w-xl text-base font-bold leading-relaxed text-slate-600">{story.copy}</p>
                                        <div className="mt-6 grid gap-3">
                                            {story.bullets.map((bullet) => (
                                                <div key={bullet} className="flex items-center gap-3 text-sm font-black text-slate-800">
                                                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" strokeWidth={3} />
                                                    {bullet}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </section>

            <LandingFaq copy={copy.faq} dir={dir} />

            <section className="w-full bg-[#c4b5fd] px-4 py-10 text-slate-950 sm:px-6 lg:px-8">
                <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
                    <div className="border-2 border-black bg-[#fef08a] px-6 py-5 shadow-neo">
                        <div className="text-3xl font-black leading-none sm:text-5xl">{copy.stats.cheaper}</div>
                        <div className="mt-3 max-w-xl text-[12px] font-black uppercase leading-relaxed text-slate-500">
                            {copy.stats.cheaperCopy}
                        </div>
                    </div>
                    <div className="border-2 border-black bg-white px-6 py-5 shadow-neo">
                        <div className="text-3xl font-black leading-none sm:text-4xl">{copy.stats.freeSessions}</div>
                        <div className="mt-3 text-[11px] font-black uppercase text-slate-500">{copy.stats.everyMonth}</div>
                    </div>
                    <div className="border-2 border-black bg-[#86efac] px-6 py-5 shadow-neo">
                        <div className="text-3xl font-black leading-none">{copy.stats.allFeatures}</div>
                        <div className="mt-3 text-[11px] font-black uppercase text-slate-500">{copy.stats.allFeaturesCopy}</div>
                    </div>
                </div>
            </section>
        </div>
    );
};
