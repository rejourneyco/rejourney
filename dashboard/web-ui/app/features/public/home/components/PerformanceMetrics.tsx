import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import {
    Bar,
    BarChart,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { MarketingHomeCopy } from '~/shared/lib/internationalMarketing';

const BUNDLEPHOBIA_REJOURNEY =
    'https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17';
const BUNDLEPHOBIA_SENTRY =
    'https://bundlephobia.com/package/@sentry/react-native@8.7.0';
const BUNDLEPHOBIA_WEB_REJOURNEY =
    'https://bundlephobia.com/package/@rejourneyco/browser@0.1.0';
const BUNDLEPHOBIA_POSTHOG =
    'https://bundlephobia.com/package/posthog-js@1.374.2';
const GITHUB_REPO_URL = 'https://github.com/rejourneyco/rejourney';
const WEB_BENCHMARK_RESULT_PATH =
    'benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md';
const WEB_BENCHMARK_REPORT_URL = `${GITHUB_REPO_URL}/blob/main/${WEB_BENCHMARK_RESULT_PATH}`;

/** BundlePhobia npm entry-point sizes (minified + gzipped), fixed versions. */
const bundleCompareRows = [
    {
        key: 'rejourney',
        label: 'Rejourney SDK',
        shortLabel: '@rejourneyco/react-native',
        version: '1.0.17',
        minifiedKb: 39.7,
        gzipKb: 13.2,
        href: BUNDLEPHOBIA_REJOURNEY,
        gzipFill: '#4f46e5', // Indigo-600
        minExtraFill: '#a5b4fc', // Indigo-300
    },
    {
        key: 'sentry',
        label: 'Sentry Core',
        shortLabel: '@sentry/react-native',
        version: '8.7.0',
        minifiedKb: 403,
        gzipKb: 135.3,
        href: BUNDLEPHOBIA_SENTRY,
        gzipFill: '#64748b', // Slate-500
        minExtraFill: '#cbd5e1', // Slate-300
    },
] as const;

const bundleChartData = bundleCompareRows.map((row) => ({
    name: row.label,
    gzipKb: row.gzipKb,
    minifiedAboveGzipKb: Math.max(0, row.minifiedKb - row.gzipKb),
    minifiedKb: row.minifiedKb,
    href: row.href,
}));

const webBenchmarkRows = [
    {
        app: 'Next.js',
        rejourneyUploadKb: 21.29,
        posthogUploadKb: 45.35,
        rejourneyTaskMs: 417.96,
        posthogTaskMs: 449.91,
        rejourneyScriptMs: 160.46,
        posthogScriptMs: 185.06,
        rejourneyHeapMb: 15.81,
        posthogHeapMb: 16.19,
        uploadWin: '2.1x',
    },
    {
        app: 'SvelteKit',
        rejourneyUploadKb: 8.38,
        posthogUploadKb: 24.99,
        rejourneyTaskMs: 268.72,
        posthogTaskMs: 304.03,
        rejourneyScriptMs: 19.35,
        posthogScriptMs: 42.02,
        rejourneyHeapMb: 6.63,
        posthogHeapMb: 9.17,
        uploadWin: '3.0x',
    },
    {
        app: 'Nuxt',
        rejourneyUploadKb: 8.4,
        posthogUploadKb: 26.57,
        rejourneyTaskMs: 305.51,
        posthogTaskMs: 322.24,
        rejourneyScriptMs: 21.12,
        posthogScriptMs: 41.17,
        rejourneyHeapMb: 11.33,
        posthogHeapMb: 15.44,
        uploadWin: '3.2x',
    },
];

const webPackageCompareRows = [
    {
        key: 'rejourney',
        label: 'Rejourney SDK',
        shortLabel: '@rejourneyco/browser',
        version: '0.1.0',
        minifiedKb: 37.12,
        gzipKb: 12.87,
        href: BUNDLEPHOBIA_WEB_REJOURNEY,
        gzipFill: '#4f46e5',
        distExtraFill: '#a5b4fc',
        arrow: 'down',
        colorClassName: 'text-blue-600',
    },
    {
        key: 'posthog',
        label: 'PostHog Core',
        shortLabel: 'posthog-js',
        version: '1.137.2',
        minifiedKb: 144.23,
        gzipKb: 45.18,
        href: BUNDLEPHOBIA_POSTHOG,
        gzipFill: '#64748b',
        distExtraFill: '#cbd5e1',
        arrow: 'up',
        colorClassName: 'text-slate-500',
    },
] as const;

const webPackageChartData = webPackageCompareRows.map((row) => ({
    name: row.label,
    gzipKb: row.gzipKb,
    minifiedAboveGzipKb: Math.max(0, row.minifiedKb - row.gzipKb),
    minifiedKb: row.minifiedKb,
    gzip: `${row.gzipKb} kB`,
    minified: `${row.minifiedKb} kB`,
    href: row.href,
}));

const formatBundlephobiaSize = (kb: number) => `${kb.toFixed(1)} kB`;

const webComparisonCharts = [
    {
        key: 'uploadSize',
        title: 'Median Client Upload Size',
        detail: 'Total JavaScript payload compiled/uploaded. Lower is better.',
        rejourneyKey: 'rejourneyUploadKb',
        posthogKey: 'posthogUploadKb',
        unit: 'kB',
        domain: [0, 50],
        winner: 'Rejourney is 3.0x smaller',
    },
    {
        key: 'scriptTime',
        title: 'CPU Execution Time',
        detail: 'Time spent executing initial tracking scripts. Lower is better.',
        rejourneyKey: 'rejourneyScriptMs',
        posthogKey: 'posthogScriptMs',
        unit: 'ms',
        domain: [0, 200],
        winner: 'Rejourney is 2.1x faster',
    },
] as const;

const performanceMetricRows = [
    {
        metric: 'Frame Rate Impact (fps drop)',
        average: '0.2',
        max: '1.1',
        min: '0.0',
        thread: 'Main Thread',
        threadClassName: 'text-blue-600 bg-blue-50 border-blue-100',
    },
    {
        metric: 'SDK Heap Allocations',
        average: '0.8 MB',
        max: '2.4 MB',
        min: '0.4 MB',
        thread: 'Background Task',
        threadClassName: 'text-slate-600 bg-slate-50 border-slate-200/60',
    },
    {
        metric: 'Total Main Thread Impact',
        average: '12.4 ms',
        max: '28.2 ms',
        min: '8.1 ms',
        thread: 'Main Thread',
        threadClassName: 'text-blue-600 bg-blue-50 border-blue-100',
    },
];

export const PerformanceMetrics: React.FC<{ copy: MarketingHomeCopy['performance']; dir?: 'ltr' | 'rtl' }> = ({ copy, dir = 'ltr' }) => {
    const sectionRef = useRef<HTMLElement>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [activeGalleryPanel, setActiveGalleryPanel] = useState<'web' | 'mobile'>('web');

    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });

        if (sectionRef.current) {
            observer.observe(sectionRef.current);
        }

        return () => observer.disconnect();
    }, []);

    const rejourneyRow = bundleCompareRows[0];
    const sentryRow = bundleCompareRows[1];
    const rejourneyEfficiencyX = (sentryRow.minifiedKb / rejourneyRow.minifiedKb).toFixed(1);
    const webUploadEfficiencyX = '3.0';
    const webPackageEfficiencyX = '3.9';
    const activeSummary = activeGalleryPanel === 'web'
        ? `${webPackageEfficiencyX}X smaller package size vs posthog-js. ${webUploadEfficiencyX}X smaller median client upload across Next.js, SvelteKit, and Nuxt.`
        : copy.bundleSummary(rejourneyEfficiencyX, sentryRow.shortLabel, sentryRow.version);
    const activeBadgeValue = activeGalleryPanel === 'web' ? `${webPackageEfficiencyX}X` : `${rejourneyEfficiencyX}X`;
    const activeBadgeLabel = activeGalleryPanel === 'web' ? 'smaller gzip payload' : copy.smallerBundle;
    
    const renderedMetricRows = performanceMetricRows.map((row, index) => ({
        ...row,
        ...(copy.metricRows[index] ?? {}),
    }));

    return (
        <section ref={sectionRef} dir={dir} className="relative w-full overflow-visible border-t-2 border-black bg-white px-5 py-16 text-black sm:px-8 sm:py-24 lg:px-10">
            <div className="max-w-7xl mx-auto relative z-10 text-left">

                {/* Header Section */}
                <div className="mb-10 flex flex-col items-start justify-between gap-6 lg:mb-16 lg:flex-row lg:items-end lg:gap-8">
                    <div className="min-w-0">
                        <h2 className="mb-4 font-display text-3xl font-black uppercase tracking-tight text-black sm:text-5xl leading-tight pb-1">
                            <span className="text-[#5dadec]">{copy.headingPrimary}</span><br className="sm:hidden" /> {copy.headingSecondary}
                        </h2>
                        <p className="max-w-2xl text-slate-700 font-bold leading-relaxed text-sm sm:text-base">
                            {activeSummary}
                        </p>
                    </div>

                    {/* Floating Badge in Refined Style */}
                    <div className="hidden lg:block border-2 border-black bg-[#5dadec] text-black p-4 shadow-neo-sm shrink-0">
                        <p className="text-4xl font-black font-mono leading-none text-black">{activeBadgeValue}</p>
                        <p className="text-[10px] font-mono font-bold uppercase tracking-wider mt-2 text-black/80">{activeBadgeLabel}</p>
                    </div>
                </div>

                {/* Main Content Box */}
                <div id="benchmark-gallery" className="max-w-full scroll-mt-24 border-2 border-black bg-white p-5 sm:p-8 shadow-neo-lg">
                    <div className="mb-8 flex flex-col gap-4 border-b-2 border-black pb-5 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <span className="inline-block border-2 border-black bg-[#fef08a] px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-black shadow-neo-sm">
                                Benchmark gallery
                                <a
                                    href="#benchmark-gallery"
                                    aria-label="Link to benchmark gallery"
                                    className="ml-2 text-black hover:underline"
                                >
                                    #
                                </a>
                            </span>
                            <h3 className="mt-2 text-xl font-black uppercase tracking-tight text-black">Performance Comparison</h3>
                        </div>
                        
                        {/* Selector Tabs matching Refined Neo-Brutalist style */}
                        <div className="inline-flex gap-2 border border-black bg-slate-100 p-1 shadow-neo-sm self-start sm:self-center">
                            <button
                                type="button"
                                aria-pressed={activeGalleryPanel === 'web'}
                                onClick={() => setActiveGalleryPanel('web')}
                                className={`border px-3.5 py-1.5 font-sans text-xs font-bold uppercase transition-all duration-150 ${
                                    activeGalleryPanel === 'web' 
                                        ? 'border-black bg-[#5dadec] text-black shadow-neo-sm' 
                                        : 'border-transparent text-slate-700 hover:border-black/30 hover:bg-white'
                                }`}
                            >
                                Web vs PostHog
                            </button>
                            <button
                                type="button"
                                aria-pressed={activeGalleryPanel === 'mobile'}
                                onClick={() => setActiveGalleryPanel('mobile')}
                                className={`border px-3.5 py-1.5 font-sans text-xs font-bold uppercase transition-all duration-150 ${
                                    activeGalleryPanel === 'mobile' 
                                        ? 'border-black bg-[#5dadec] text-black shadow-neo-sm' 
                                        : 'border-transparent text-slate-700 hover:border-black/30 hover:bg-white'
                                }`}
                            >
                                Mobile vs Sentry
                            </button>
                        </div>
                    </div>

                    {activeGalleryPanel === 'web' ? (
                        <>
                            <div className="mb-10 grid grid-cols-1 gap-8 border-b-2 border-black border-dashed pb-8 lg:mb-12 lg:grid-cols-[1.45fr_1fr] lg:gap-12 lg:pb-12">
                                <div className="flex min-w-0 flex-col">
                                    <div className="mb-5 flex flex-col gap-3 border-b border-black/30 pb-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:pb-2">
                                        <h3 className="text-sm font-extrabold uppercase tracking-wider text-black">Bundlephobia package size</h3>
                                        <div className="flex flex-wrap gap-4 font-mono text-[10px] font-bold uppercase text-black">
                                            <div className="flex items-center gap-2">
                                                <div className="h-3 w-3 border border-black bg-[#5dadec]" aria-hidden />
                                                <span>Gzip</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="h-3 w-3 border border-black bg-[#93c5fd]" aria-hidden />
                                                <span>Minified - gzip</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Chart Wrapper in Refined Style */}
                                    <div className="relative h-[260px] border-2 border-black bg-slate-50 p-2 sm:h-[300px] sm:p-4 lg:h-[330px] shadow-neo-sm">
                                        {isVisible && (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart
                                                    data={webPackageChartData}
                                                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                                                    barCategoryGap="28%"
                                                >
                                                    <XAxis
                                                        dataKey="name"
                                                        axisLine={{ stroke: '#0f172a', strokeWidth: 1.5 }}
                                                        tickLine={{ stroke: '#0f172a' }}
                                                        tick={{ fill: '#0f172a', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                                                    />
                                                    <YAxis
                                                        axisLine={false}
                                                        tickLine={{ stroke: '#0f172a' }}
                                                        tick={{ fill: '#0f172a', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                                                        tickFormatter={(v) => formatBundlephobiaSize(Number(v))}
                                                        domain={[0, Math.ceil(webPackageCompareRows[1].minifiedKb * 1.08)]}
                                                        width={58}
                                                    />
                                                    <Tooltip
                                                        cursor={{ fill: 'rgba(93,173,236,0.1)' }}
                                                        contentStyle={{
                                                            backgroundColor: '#ffffff',
                                                            border: '2px solid #000000',
                                                            boxShadow: '3px 3px 0px 0px rgba(0,0,0,1)',
                                                            color: '#000000',
                                                            fontSize: '11px',
                                                            fontFamily: 'var(--font-mono)',
                                                            fontWeight: 'bold',
                                                        }}
                                                        formatter={(value: number | undefined, name: string | undefined) => {
                                                            const v = value ?? 0;
                                                            const label = name === 'minifiedAboveGzipKb' ? 'Minified minus gzip' : 'Gzip';
                                                            return [formatBundlephobiaSize(v), label];
                                                        }}
                                                        labelFormatter={(_, payload) => {
                                                            const p = payload?.[0]?.payload as { minified?: string; gzip?: string } | undefined;
                                                            return p ? `Minified: ${p.minified} / gzip: ${p.gzip}` : '';
                                                        }}
                                                    />
                                                    <Bar dataKey="gzipKb" stackId="bp-web" radius={[0, 0, 0, 0]} isAnimationActive={false}>
                                                        {webPackageCompareRows.map((row) => (
                                                            <Cell key={`wg-${row.key}`} fill={row.key === 'rejourney' ? '#5dadec' : '#64748b'} stroke="#000000" strokeWidth={1.5} />
                                                        ))}
                                                    </Bar>
                                                    <Bar dataKey="minifiedAboveGzipKb" stackId="bp-web" radius={[0, 0, 0, 0]} isAnimationActive={false}>
                                                        {webPackageCompareRows.map((row) => (
                                                            <Cell key={`wd-${row.key}`} fill={row.key === 'rejourney' ? '#93c5fd' : '#cbd5e1'} stroke="#000000" strokeWidth={1.5} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>

                                    <p className="mt-3 font-mono text-[10px] font-bold leading-relaxed text-slate-600">
                                        Bundlephobia package size metric. Inner segment represents minified + gzipped; total bar is minified.
                                    </p>
                                </div>

                                {/* Side Panel metrics */}
                                <div className="flex flex-col justify-center space-y-5 lg:border-l lg:border-slate-300 lg:pl-10">
                                    {webPackageCompareRows.map((row) => (
                                        <div key={row.key} className={`p-5 border-2 border-black transition-all duration-200 hover:-translate-y-0.5 ${row.key === 'rejourney' ? 'bg-[#e8f4ff] shadow-neo-sm hover:shadow-neo' : 'bg-white shadow-neo-sm hover:shadow-neo'}`}>
                                            <p className="text-xs font-black uppercase tracking-wider text-black">
                                                {row.label}
                                            </p>
                                            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-2">
                                                <span className="text-4xl font-black font-mono tracking-tight text-black">
                                                    {row.minifiedKb}
                                                </span>
                                                <span className="text-base font-black font-mono uppercase text-black">kB</span>
                                                <span className="text-[10px] font-mono font-bold uppercase text-slate-600">
                                                    {copy.minified}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-xs font-mono font-bold text-slate-700">
                                                {row.gzipKb} {copy.gzipped}
                                            </p>
                                            <a
                                                href={row.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-3 inline-flex items-center gap-1 border border-black bg-white px-2 py-1 text-[10px] font-mono font-bold uppercase text-black shadow-neo-sm hover:bg-[#5dadec] transition-colors"
                                            >
                                                {row.arrow === 'down' ? (
                                                    <ArrowDownRight className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                                                ) : (
                                                    <ArrowUpRight className="h-3.5 w-3.5 text-rose-500" aria-hidden />
                                                )}
                                                {copy.bundlePhobiaVersion(row.version)}
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="mb-6 border-b border-black/30 pb-3">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                        <div>
                                            <h3 className="text-base font-black uppercase tracking-tight text-black">Web benchmark graphs</h3>
                                            <p className="mt-1 text-xs font-medium text-slate-600 leading-relaxed">
                                                Next.js, SvelteKit, and Nuxt examples from 18 live Chromium runs. Lower bars represent better performance.
                                            </p>
                                        </div>
                                        <a
                                            href={WEB_BENCHMARK_REPORT_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 border border-black bg-[#fef08a] px-2.5 py-1 text-xs font-mono font-bold uppercase text-black shadow-neo-sm hover:bg-[#5dadec] transition-colors"
                                        >
                                            Open evidence report
                                        </a>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                                    {webComparisonCharts.map((chart) => (
                                        <div key={chart.key} className="border-2 border-black bg-white p-4 sm:p-5 shadow-neo-sm transition-all">
                                            <div className="mb-4 flex flex-col gap-3 border-b border-black/20 pb-3 min-[520px]:flex-row min-[520px]:items-start min-[520px]:justify-between">
                                                <div>
                                                    <h4 className="text-sm font-extrabold uppercase tracking-wider text-black">{chart.title}</h4>
                                                    <p className="mt-1 text-[10px] font-medium text-slate-600">{chart.detail}</p>
                                                </div>
                                                <div className="shrink-0 border border-black bg-[#86efac] px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-black shadow-neo-sm">
                                                    {chart.winner}
                                                </div>
                                            </div>

                                            <div className="h-[220px] border-2 border-black bg-slate-50 p-2 sm:h-[240px]">
                                                {isVisible && (
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart
                                                            data={webBenchmarkRows}
                                                            margin={{ top: 8, right: 10, left: 0, bottom: 8 }}
                                                            barCategoryGap="20%"
                                                        >
                                                            <XAxis
                                                                dataKey="app"
                                                                axisLine={{ stroke: '#0f172a', strokeWidth: 1.5 }}
                                                                tickLine={{ stroke: '#0f172a' }}
                                                                tick={{ fill: '#0f172a', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                                                            />
                                                            <YAxis
                                                                axisLine={false}
                                                                tickLine={{ stroke: '#0f172a' }}
                                                                tick={{ fill: '#0f172a', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                                                                tickFormatter={(v) => `${v} ${chart.unit}`}
                                                                domain={[chart.domain[0], chart.domain[1]]}
                                                                width={44}
                                                            />
                                                            <Tooltip
                                                                cursor={{ fill: 'rgba(93,173,236,0.1)' }}
                                                                contentStyle={{
                                                                    backgroundColor: '#ffffff',
                                                                    border: '2px solid #000000',
                                                                    boxShadow: '3px 3px 0px 0px rgba(0,0,0,1)',
                                                                    color: '#000000',
                                                                    fontSize: '11px',
                                                                    fontFamily: 'var(--font-mono)',
                                                                    fontWeight: 'bold',
                                                                }}
                                                                formatter={(value: number | undefined, name: string | undefined) => {
                                                                    const v = value ?? 0;
                                                                    const decimals = (chart.unit as string) === 'KiB' || (chart.unit as string) === 'MiB' ? 2 : 1;
                                                                    const label = name === chart.posthogKey ? 'PostHog' : 'Rejourney';
                                                                    return [`${v.toFixed(decimals)} ${chart.unit}`, label];
                                                                }}
                                                            />
                                                            <Bar dataKey={chart.rejourneyKey} fill="#5dadec" stroke="#000000" strokeWidth={1.5} radius={[0, 0, 0, 0]} isAnimationActive={false} />
                                                            <Bar dataKey={chart.posthogKey} fill="#94a3b8" stroke="#000000" strokeWidth={1.5} radius={[0, 0, 0, 0]} isAnimationActive={false} />
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                )}
                                            </div>

                                            <div className="mt-4 flex flex-wrap gap-4 font-mono text-[10px] font-bold uppercase text-black">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-3 w-3 border border-black bg-[#5dadec]" aria-hidden />
                                                    Rejourney
                                                </span>
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-3 w-3 border border-black bg-[#94a3b8]" aria-hidden />
                                                    PostHog
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Mobile row: SDK size comparison */}
                            <div className="mb-12 grid grid-cols-1 gap-10 border-b-2 border-black border-dashed pb-10 lg:mb-12 lg:grid-cols-[1.5fr_1fr] lg:gap-12 lg:pb-12">
                                <div className="flex flex-col h-full">
                                    <div className="mb-5 flex flex-col gap-3 border-b border-black/30 pb-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:pb-2">
                                        <h3 className="text-sm font-extrabold uppercase tracking-wider text-black">{copy.chartTitle}</h3>
                                        <div className="flex flex-wrap gap-4 font-mono text-[10px] font-bold uppercase text-black">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 border border-black bg-[#5dadec]" aria-hidden />
                                                <span>{copy.gzip}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 border border-black bg-[#93c5fd]" aria-hidden />
                                                <span>{copy.minifiedMinusGzip}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative min-h-[240px] flex-grow border-2 border-black bg-slate-50 p-2 sm:min-h-[280px] sm:p-4 shadow-neo-sm">
                                        {isVisible && (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart
                                                    data={bundleChartData}
                                                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                                                    barCategoryGap="28%"
                                                >
                                                    <XAxis
                                                        dataKey="name"
                                                        axisLine={{ stroke: '#0f172a', strokeWidth: 1.5 }}
                                                        tickLine={{ stroke: '#0f172a' }}
                                                        tick={{ fill: '#0f172a', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                                                    />
                                                    <YAxis
                                                        axisLine={false}
                                                        tickLine={{ stroke: '#0f172a' }}
                                                        tick={{ fill: '#0f172a', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                                                        tickFormatter={(v) => `${v} kB`}
                                                        domain={[0, Math.ceil(sentryRow.minifiedKb * 1.08)]}
                                                        width={44}
                                                    />
                                                    <Tooltip
                                                        cursor={{ fill: 'rgba(93,173,236,0.1)' }}
                                                        contentStyle={{
                                                            backgroundColor: '#ffffff',
                                                            border: '2px solid #000000',
                                                            boxShadow: '3px 3px 0px 0px rgba(0,0,0,1)',
                                                            color: '#000000',
                                                            fontSize: '11px',
                                                            fontFamily: 'var(--font-mono)',
                                                            fontWeight: 'bold',
                                                        }}
                                                        formatter={(value: number | undefined, name: string | undefined) => {
                                                            const v = value ?? 0;
                                                            const n = name ?? '';
                                                            if (n === 'minifiedAboveGzipKb') return [`${v.toFixed(1)} kB`, copy.minifiedMinusGzip];
                                                            if (n === 'gzipKb') return [`${v.toFixed(1)} kB`, copy.gzip];
                                                            return [`${v} kB`, n];
                                                        }}
                                                        labelFormatter={(_, payload) => {
                                                            const p = payload?.[0]?.payload as { minifiedKb?: number; href?: string } | undefined;
                                                            const total = p?.minifiedKb;
                                                            return total != null ? `Total minified: ${total} kB` : '';
                                                        }}
                                                    />
                                                    <Bar dataKey="gzipKb" stackId="bp" radius={[0, 0, 0, 0]} isAnimationActive={false}>
                                                        {bundleCompareRows.map((row) => (
                                                            <Cell key={`g-${row.key}`} fill={row.key === 'rejourney' ? '#5dadec' : '#64748b'} stroke="#000000" strokeWidth={1.5} />
                                                        ))}
                                                    </Bar>
                                                    <Bar dataKey="minifiedAboveGzipKb" stackId="bp" radius={[0, 0, 0, 0]} isAnimationActive={false}>
                                                        {bundleCompareRows.map((row) => (
                                                            <Cell key={`m-${row.key}`} fill={row.key === 'rejourney' ? '#93c5fd' : '#cbd5e1'} stroke="#000000" strokeWidth={1.5} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                    <ul className="mt-4 flex flex-col gap-1.5 font-mono text-[10px] font-bold text-slate-700">
                                        {bundleCompareRows.map((row) => (
                                            <li key={row.key}>
                                                <a
                                                    href={row.href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="underline hover:text-black"
                                                >
                                                    {row.shortLabel}@{row.version} — BundlePhobia
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="mt-2 font-mono text-[10px] text-slate-600 leading-relaxed">
                                        {copy.chartNote}
                                    </p>
                                </div>

                                {/* Comparative stats mobile list panel */}
                                <div className="flex flex-col justify-center space-y-5 lg:border-l lg:border-slate-300 lg:pl-10">
                                    <div className="p-5 border-2 border-black bg-[#e8f4ff] shadow-neo-sm hover:shadow-neo transition-all">
                                        <p className="text-xs font-black uppercase tracking-wider text-black">
                                            {rejourneyRow.shortLabel}
                                        </p>
                                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-2">
                                            <span className="text-4xl font-black font-mono tracking-tight text-black">
                                                {rejourneyRow.minifiedKb}
                                            </span>
                                            <span className="text-base font-black font-mono uppercase text-black">kB</span>
                                            <span className="text-[10px] font-mono font-bold uppercase text-slate-600">
                                                {copy.minified}
                                            </span>
                                        </div>
                                        <p className="text-xs font-mono font-bold text-slate-700 mt-1">
                                            {rejourneyRow.gzipKb} {copy.gzipped}
                                        </p>
                                        <a
                                            href={rejourneyRow.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-3 inline-flex items-center gap-1 border border-black bg-white px-2 py-1 text-[10px] font-mono font-bold uppercase text-black shadow-neo-sm hover:bg-[#5dadec] transition-colors"
                                        >
                                            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" aria-hidden />
                                            {copy.bundlePhobiaVersion(rejourneyRow.version)}
                                        </a>
                                    </div>

                                    <div className="w-full h-px bg-slate-300"></div>

                                    <div className="p-5 border-2 border-black bg-white shadow-neo-sm hover:shadow-neo transition-all">
                                        <p className="text-xs font-black uppercase tracking-wider text-black">
                                            {sentryRow.shortLabel}
                                        </p>
                                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-2">
                                            <span className="text-4xl font-black font-mono tracking-tight text-black">
                                                {sentryRow.minifiedKb}
                                            </span>
                                            <span className="text-base font-black font-mono uppercase text-black">kB</span>
                                            <span className="text-[10px] font-mono font-bold uppercase text-slate-600">
                                                {copy.minified}
                                            </span>
                                        </div>
                                        <p className="text-xs font-mono font-bold text-slate-700 mt-1">
                                            {sentryRow.gzipKb} {copy.gzipped}
                                        </p>
                                        <a
                                            href={sentryRow.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-3 inline-flex items-center gap-1 border border-black bg-white px-2 py-1 text-[10px] font-mono font-bold uppercase text-black shadow-neo-sm hover:bg-slate-200 transition-colors"
                                        >
                                            <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" aria-hidden />
                                            {copy.bundlePhobiaVersion(sentryRow.version)}
                                        </a>
                                        <p className="text-[10px] text-slate-600 uppercase mt-3 max-w-[240px] leading-tight font-mono font-bold">
                                            {copy.transitiveNote}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Performance Metrics Table */}
                    <div className="mt-10 sm:mt-12 border-t-2 border-black pt-8">
                        <div className="mb-5 pb-3">
                            <h3 className="text-base font-black uppercase tracking-tight text-black">{copy.metricsTitle}</h3>
                            <p className="mt-1 text-xs font-medium text-slate-600 leading-relaxed">{copy.metricsNotePrefix} <a href="https://merchcampus.com" target="_blank" rel="noopener noreferrer" className="underline font-bold text-black">{copy.metricsNoteApp}</a>. {copy.metricsNoteSuffix}</p>
                        </div>

                        <div className="md:hidden space-y-3">
                            {renderedMetricRows.map((row) => (
                                <div
                                    key={row.metric}
                                    className="border-2 border-black bg-white p-4 shadow-neo-sm"
                                >
                                    <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-black/20">
                                        <p className="text-xs font-black uppercase text-black leading-tight truncate">{row.metric}</p>
                                        <span className={`shrink-0 text-[9px] font-mono font-bold uppercase px-2 py-0.5 border border-black ${row.thread === 'Main Thread' ? 'bg-[#5dadec] text-black' : 'bg-[#fef08a] text-black'}`}>{row.thread}</span>
                                    </div>
                                    <div className="flex justify-between items-center font-mono text-[10px] font-bold">
                                        <div className="flex flex-col items-center">
                                            <span className="text-slate-500 uppercase">{copy.tableAvgShort}</span>
                                            <span className="text-xs font-black text-black">{row.average}</span>
                                        </div>
                                        <div className="flex flex-col items-center border-x border-black/20 px-4">
                                            <span className="text-slate-500 uppercase">{copy.tableMaxShort}</span>
                                            <span className="text-xs font-black text-black">{row.max}</span>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-slate-500 uppercase">{copy.tableMinShort}</span>
                                            <span className="text-xs font-black text-black">{row.min}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="hidden overflow-x-auto overflow-y-hidden border-2 border-black bg-white md:block shadow-neo-sm">
                            <table className="w-full min-w-[620px] lg:min-w-[720px] border-collapse">
                                <thead>
                                    <tr className="bg-[#e8f4ff] border-b-2 border-black text-black">
                                        <th className="text-left py-3 px-4 font-sans text-xs font-extrabold uppercase tracking-wider">{copy.tableMetric}</th>
                                        <th className="text-right py-3 px-4 font-sans text-xs font-extrabold uppercase tracking-wider">{copy.tableAverage}</th>
                                        <th className="text-right py-3 px-4 font-sans text-xs font-extrabold uppercase tracking-wider">{copy.tableMax}</th>
                                        <th className="text-right py-3 px-4 font-sans text-xs font-extrabold uppercase tracking-wider">{copy.tableMin}</th>
                                        <th className="text-right py-3 px-4 font-sans text-xs font-extrabold uppercase tracking-wider">{copy.tableThread}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {renderedMetricRows.map((row, index) => (
                                        <tr key={row.metric} className={`${index < performanceMetricRows.length - 1 ? 'border-b border-black/15' : ''} transition-colors hover:bg-slate-50`}>
                                            <td className="px-4 py-3 text-xs font-bold text-black">{row.metric}</td>
                                            <td className="px-4 py-3 text-right font-mono text-xs font-bold text-black">{row.average}</td>
                                            <td className="px-4 py-3 text-right font-mono text-xs font-bold text-black">{row.max}</td>
                                            <td className="px-4 py-3 text-right font-mono text-xs font-bold text-black">{row.min}</td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 border border-black ${row.thread === 'Main Thread' ? 'bg-[#5dadec] text-black' : 'bg-[#fef08a] text-black'}`}>{row.thread}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </div>
        </section>
    );
};
