import React from 'react';
import type { MarketingFeatureCopy } from '~/shared/lib/internationalMarketing';

const features = [
    {
        title: 'Session',
        highlight: 'Replay',
        highlightColor: 'text-[#5dadec]',
        image: '/images/session-replay-preview.png',
        badge: 'Replay',
        badgeColor: 'bg-[#5dadec]',
    },
    {
        title: 'Incident',
        highlight: 'Stream',
        highlightColor: 'text-[#ef4444]',
        image: '/images/issues-feed.png',
        badge: 'Live',
        badgeColor: 'bg-[#ef4444]',
    },
    {
        title: 'Crash',
        highlight: 'Detection',
        highlightColor: 'text-orange-500',
        image: '/images/anr-issues.png',
        badge: 'ANR',
        badgeColor: 'bg-orange-400',
    },
    {
        title: 'Journey',
        highlight: 'Maps',
        highlightColor: 'text-[#5dadec]',
        image: '/images/user-journeys.png',
        badge: 'Flows',
        badgeColor: 'bg-[#5dadec]',
    },
    {
        title: 'Touch',
        highlight: 'Heatmaps',
        highlightColor: 'text-rose-500',
        image: '/images/heatmaps.png',
        badge: 'Taps',
        badgeColor: 'bg-rose-400',
    },
    {
        title: 'Global',
        highlight: 'Stability',
        highlightColor: 'text-purple-500',
        image: '/images/geo-intelligence.png',
        badge: 'Geo',
        badgeColor: 'bg-purple-400',
    },
    {
        title: 'Growth',
        highlight: 'Loops',
        highlightColor: 'text-[#34d399]',
        image: '/images/growth-engines.png',
        badge: 'Retention',
        badgeColor: 'bg-[#34d399]',
    },
];

export const Features: React.FC<{
    heading: string;
    eyebrow: string;
    copy: MarketingFeatureCopy[];
    dir?: 'ltr' | 'rtl';
}> = ({ heading, eyebrow, copy, dir = 'ltr' }) => {
    const renderedFeatures = features.map((feature, index) => ({
        ...feature,
        ...(copy[index] ?? {}),
    }));
    const alignClass = dir === 'rtl' ? 'text-right' : 'text-left';

    return (
        <section className="w-full border-t-2 border-black bg-white px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <div className={`mx-auto max-w-7xl ${alignClass}`} dir={dir}>
                <div className="mb-8 flex flex-row items-end justify-between gap-3 border-b-2 border-black pb-5 sm:mb-10 sm:gap-4 sm:pb-6">
                    <h2 className="text-3xl font-black uppercase leading-none tracking-tight sm:text-5xl lg:text-6xl">
                        {heading}
                    </h2>
                    <span className="shrink-0 border-2 border-black bg-[#fef08a] px-2 py-1 font-mono text-[9px] font-black uppercase tracking-wider shadow-neo-sm sm:px-3 sm:text-[10px] sm:tracking-widest">
                        {eyebrow}
                    </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
                    {renderedFeatures.map((feature, idx) => (
                        <article
                            key={feature.badge}
                            className="group border-2 border-black bg-[#f8fafc] p-2.5 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo sm:p-3"
                        >
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    0{idx + 1}
                                </span>
                                <span className={`${feature.badgeColor} border-2 border-black px-2 py-1 text-[10px] font-black uppercase tracking-wider text-black`}>
                                    {feature.badge}
                                </span>
                            </div>
                            <div className="mb-3 overflow-hidden border-2 border-black bg-white sm:mb-4">
                                <img
                                    src={feature.image}
                                    alt={`${feature.title} ${feature.highlight}`}
                                    className="aspect-[4/3] w-full object-cover object-left-top transition-transform duration-300 group-hover:scale-[1.03]"
                                    loading="lazy"
                                />
                            </div>
                            <h3 className="text-xl font-black uppercase leading-[0.92] tracking-tight sm:text-2xl">
                                {feature.title} <span className={feature.highlightColor}>{feature.highlight}</span>
                            </h3>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
};
