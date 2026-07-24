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
        <section ref={sectionRef} dir={dir} className="relative w-full overflow-visible border-t border-transparent bg-gradient-to-b from-transparent via-slate-50/30 to-transparent px-5 py-20 sm:px-8 sm:py-24 lg:px-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(37,99,235,0.06),transparent_40%),radial-gradient(circle_at_10%_80%,rgba(125,211,252,0.08),transparent_45%),radial-gradient(circle_at_90%_70%,rgba(14,165,233,0.06),transparent_42%)]" aria-hidden="true" />
            
            <div className="max-w-7xl mx-auto relative z-10 text-left">

                {/* Header Section */}
                <div className="mb-10 flex flex-col items-start justify-between gap-6 lg:mb-16 lg:flex-row lg:items-end lg:gap-8">
                    <div className="min-w-0">
                        <h2 className="mb-4 text-3xl font-extrabold tracking-tight bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 bg-clip-text text-transparent sm:text-5xl leading-tight pb-1">
                            <span className="text-blue-600">{copy.headingPrimary}</span><br className="sm:hidden" /> {copy.headingSecondary}
                        </h2>
                        <p className="max-w-2xl text-slate-500 font-medium leading-relaxed text-sm sm:text-base">
                            {activeSummary}
                        </p>
                    </div>

                    {/* Floating Badge in Light Modern Style */}
                    <div className="hidden lg:block bg-white/60 border border-blue-200/50 text-blue-700 p-6 rounded-2xl shadow-md rotate-2 shrink-0 backdrop-blur-md">
                        <p className="text-4xl font-extrabold font-mono leading-none">{activeBadgeValue}</p>
                        <p className="text-[10px] uppercase font-bold tracking-wider mt-2">{activeBadgeLabel}</p>
                    </div>
                </div>

                {/* Main Content Box */}
                <div id="benchmark-gallery" className="max-w-full scroll-mt-24 border border-slate-200/50 bg-white/40 backdrop-blur-lg p-5 sm:p-8 rounded-3xl shadow-xl shadow-blue-500/5 ring-1 ring-slate-100/5">
                    <div className="mb-8 flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Benchmark gallery
                                <a
                                    href="#benchmark-gallery"
                                    aria-label="Link to benchmark gallery"
                                    className="ml-2 text-slate-400 hover:text-slate-900"
                                >
                                    #
                                </a>
                            </p>
                            <h3 className="mt-1 text-lg font-bold text-slate-900">Performance Comparison</h3>
                        </div>
                        
                        {/* Selector Tabs matching SDK Selector style */}
                        <div className="inline-flex gap-1 rounded-full border border-slate-200/80 bg-white/60 backdrop-blur-md p-1 shadow-sm self-start sm:self-center">
                            <button
                                type="button"
                                aria-pressed={activeGalleryPanel === 'web'}
                                onClick={() => setActiveGalleryPanel('web')}
                                className={`rounded-full px-4 py-2 font-sans text-xs font-bold transition-all duration-200 ${
                                    activeGalleryPanel === 'web' 
                                        ? 'bg-gradient-to-r from-blue-600 to-sky-700 text-white shadow-md border-blue-600/30' 
                                        : 'text-slate-500 hover:text-slate-950 hover:bg-white/45'
                                }`}
                            >
                                Web vs PostHog
                            </button>
                            <button
                                type="button"
                                aria-pressed={activeGalleryPanel === 'mobile'}
                                onClick={() => setActiveGalleryPanel('mobile')}
                                className={`rounded-full px-4 py-2 font-sans text-xs font-bold transition-all duration-200 ${
                                    activeGalleryPanel === 'mobile' 
                                        ? 'bg-gradient-to-r from-blue-600 to-sky-700 text-white shadow-md border-blue-600/30' 
                                        : 'text-slate-500 hover:text-slate-950 hover:bg-white/45'
                                }`}
                            >
                                Mobile vs Sentry
                            </button>
                        </div>
                    </div>

                    {activeGalleryPanel === 'web' ? (
                        <>
                            <div className="mb-10 grid grid-cols-1 gap-8 border-b border-slate-100 border-dashed pb-8 lg:mb-12 lg:grid-cols-[1.45fr_1fr] lg:gap-12 lg:pb-12">
                                <div className="flex min-w-0 flex-col">
                                    <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:pb-2">
                                        <h3 className="text-sm font-bold text-slate-800">Bundlephobia package size</h3>
                                        <div className="flex flex-wrap gap-4">
                                            <div className="flex items-center gap-2">
                                                <div className="h-3 w-3 rounded bg-blue-600" aria-hidden />
                                                <span className="text-[10px] font-semibold text-slate-500 uppercase">Gzip</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="h-3 w-3 rounded bg-sky-300" aria-hidden />
                                                <span className="text-[10px] font-semibold text-slate-500 uppercase">Minified - gzip</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Chart Wrapper in Light Theme */}
                                    <div className="relative h-[260px] border border-slate-200/40 bg-white/50 backdrop-blur-md rounded-2xl p-2 sm:h-[300px] sm:p-4 lg:h-[330px]">
                                        {isVisible && (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart
                                                    data={webPackageChartData}
                                                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                                                    barCategoryGap="28%"
                                                >
                                                    <defs>
                                                        <linearGradient id="rejourneyGzip" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.9} />
                                                            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.7} />
                                                        </linearGradient>
                                                        <linearGradient id="rejourneyMin" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.7} />
                                                            <stop offset="100%" stopColor="#bae6fd" stopOpacity={0.4} />
                                                        </linearGradient>
                                                        <linearGradient id="competitorGzip" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#64748b" stopOpacity={0.8} />
                                                            <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.6} />
                                                        </linearGradient>
                                                        <linearGradient id="competitorMin" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#cbd5e1" stopOpacity={0.5} />
                                                            <stop offset="100%" stopColor="#f1f5f9" stopOpacity={0.3} />
                                                        </linearGradient>
                                                    </defs>
                                                    <XAxis
                                                        dataKey="name"
                                                        axisLine={{ stroke: '#cbd5e1' }}
                                                        tickLine={{ stroke: '#cbd5e1' }}
                                                        tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'var(--font-sans)', fontWeight: 500 }}
                                                    />
                                                    <YAxis
                                                        axisLine={false}
                                                        tickLine={{ stroke: '#cbd5e1' }}
                                                        tick={{ fill: '#64748b', fontSize: 9, fontFamily: 'var(--font-sans)', fontWeight: 500 }}
                                                        tickFormatter={(v) => formatBundlephobiaSize(Number(v))}
                                                        domain={[0, Math.ceil(webPackageCompareRows[1].minifiedKb * 1.08)]}
                                                        width={58}
                                                    />
                                                    <Tooltip
                                                        cursor={{ fill: 'rgba(37,99,235,0.03)' }}
                                                        contentStyle={{
                                                            backgroundColor: '#fff',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '8px',
                                                            boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                                                            color: '#334155',
                                                            fontSize: '11px',
                                                            fontFamily: 'var(--font-sans)',
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
                                                            <Cell key={`wg-${row.key}`} fill={row.key === 'rejourney' ? 'url(#rejourneyGzip)' : 'url(#competitorGzip)'} />
                                                        ))}
                                                    </Bar>
                                                    <Bar dataKey="minifiedAboveGzipKb" stackId="bp-web" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                                        {webPackageCompareRows.map((row) => (
                                                            <Cell key={`wd-${row.key}`} fill={row.key === 'rejourney' ? 'url(#rejourneyMin)' : 'url(#competitorMin)'} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>

                                    <p className="mt-3 text-[10px] font-medium leading-relaxed text-slate-400">
                                        Bundlephobia package size metric. Inner segment represents minified + gzipped; total bar is minified.
                                    </p>
                                </div>

                                {/* Side Panel metrics */}
                                <div className="flex flex-col justify-center space-y-6 lg:border-l lg:border-slate-100 lg:pl-10">
                                    {webPackageCompareRows.map((row) => (
                                        <div key={row.key} className="p-5 rounded-2xl border border-slate-150/50 bg-white/60 backdrop-blur-md shadow-sm transition-all duration-300 hover:shadow-md hover:border-slate-200/80 hover:scale-[1.01] hover:bg-white/80">
                                            <p className={`text-xs font-bold uppercase tracking-wider ${row.colorClassName}`}>
                                                {row.label}
                                            </p>
                                            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-2">
                                                <span className="text-4xl font-extrabold tracking-tight text-slate-900">
                                                    {row.minifiedKb}
                                                </span>
                                                <span className="text-base font-bold uppercase text-slate-500">kB</span>
                                                <span className="text-[10px] font-semibold uppercase text-slate-400">
                                                    {copy.minified}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-xs font-medium text-slate-500">
                                                {row.gzipKb} {copy.gzipped}
                                            </p>
                                            <a
                                                href={row.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-slate-450 hover:text-blue-600 transition-colors"
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
                                <div className="mb-6 border-b border-slate-100 pb-3">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                        <div>
                                            <h3 className="text-base font-bold text-slate-800">Web benchmark graphs</h3>
                                            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                                                Next.js, SvelteKit, and Nuxt examples from 18 live Chromium runs. Lower bars represent better performance.
                                            </p>
                                        </div>
                                        <a
                                            href={WEB_BENCHMARK_REPORT_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs font-bold text-blue-600 hover:text-sky-600"
                                        >
                                            Open evidence report
                                        </a>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                                    {webComparisonCharts.map((chart) => (
                                        <div key={chart.key} className="border border-slate-200/50 bg-white/50 backdrop-blur-md p-4 sm:p-5 rounded-2xl shadow-sm transition-all duration-300 hover:shadow-md hover:border-slate-300">
                                            <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-3 min-[520px]:flex-row min-[520px]:items-start min-[520px]:justify-between">
                                                <div>
                                                    <h4 className="text-sm font-bold text-slate-900">{chart.title}</h4>
                                                    <p className="mt-1 text-[10px] font-medium text-slate-450">{chart.detail}</p>
                                                </div>
                                                <div className="shrink-0 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase text-blue-700">
                                                    {chart.winner}
                                                </div>
                                            </div>

                                            <div className="h-[220px] border border-slate-200/40 bg-white/50 backdrop-blur-md rounded-xl p-2 sm:h-[240px]">
                                                {isVisible && (
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart
                                                            data={webBenchmarkRows}
                                                            margin={{ top: 8, right: 10, left: 0, bottom: 8 }}
                                                            barCategoryGap="20%"
                                                        >
                                                            <defs>
                                                                <linearGradient id={`chartRejourney-${chart.key}`} x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.9} />
                                                                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.7} />
                                                                </linearGradient>
                                                                <linearGradient id={`chartCompetitor-${chart.key}`} x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.8} />
                                                                    <stop offset="100%" stopColor="#cbd5e1" stopOpacity={0.6} />
                                                                </linearGradient>
                                                            </defs>
                                                            <XAxis
                                                                dataKey="app"
                                                                axisLine={{ stroke: '#cbd5e1' }}
                                                                tickLine={{ stroke: '#cbd5e1' }}
                                                                tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'var(--font-sans)', fontWeight: 500 }}
                                                            />
                                                            <YAxis
                                                                axisLine={false}
                                                                tickLine={{ stroke: '#cbd5e1' }}
                                                                tick={{ fill: '#64748b', fontSize: 9, fontFamily: 'var(--font-sans)', fontWeight: 500 }}
                                                                tickFormatter={(v) => `${v} ${chart.unit}`}
                                                                domain={[chart.domain[0], chart.domain[1]]}
                                                                width={44}
                                                            />
                                                            <Tooltip
                                                                cursor={{ fill: 'rgba(37,99,235,0.03)' }}
                                                                contentStyle={{
                                                                    backgroundColor: '#fff',
                                                                    border: '1px solid #e2e8f0',
                                                                    borderRadius: '8px',
                                                                    boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                                                                    color: '#334155',
                                                                    fontSize: '11px',
                                                                    fontFamily: 'var(--font-sans)',
                                                                }}
                                                                formatter={(value: number | undefined, name: string | undefined) => {
                                                                    const v = value ?? 0;
                                                                    const decimals = (chart.unit as string) === 'KiB' || (chart.unit as string) === 'MiB' ? 2 : 1;
                                                                    const label = name === chart.posthogKey ? 'PostHog' : 'Rejourney';
                                                                    return [`${v.toFixed(decimals)} ${chart.unit}`, label];
                                                                }}
                                                            />
                                                            <Bar dataKey={chart.rejourneyKey} fill={`url(#chartRejourney-${chart.key})`} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                                                            <Bar dataKey={chart.posthogKey} fill={`url(#chartCompetitor-${chart.key})`} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                )}
                                            </div>

                                            <div className="mt-4 flex flex-wrap gap-4 font-mono text-[10px] font-semibold text-slate-500">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden />
                                                    Rejourney
                                                </span>
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-2.5 w-2.5 rounded-full bg-slate-400" aria-hidden />
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
                            <div className="mb-12 grid grid-cols-1 gap-10 border-b border-slate-100 border-dashed pb-10 lg:mb-12 lg:grid-cols-[1.5fr_1fr] lg:gap-12 lg:pb-12">
                                <div className="flex flex-col h-full">
                                    <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:pb-2">
                                        <h3 className="text-sm font-bold text-slate-800">{copy.chartTitle}</h3>
                                        <div className="flex flex-wrap gap-4">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 bg-blue-600 rounded" aria-hidden />
                                                <span className="text-[10px] font-semibold text-slate-500 uppercase">{copy.gzip}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 bg-sky-300 rounded" aria-hidden />
                                                <span className="text-[10px] font-semibold text-slate-500 uppercase">{copy.minifiedMinusGzip}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative min-h-[240px] flex-grow border border-slate-200/40 bg-white/50 backdrop-blur-md rounded-2xl p-2 sm:min-h-[280px] sm:p-4">
                                        {isVisible && (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart
                                                    data={bundleChartData}
                                                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                                                    barCategoryGap="28%"
                                                >
                                                    <defs>
                                                        <linearGradient id="mobRejourneyGzip" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.9} />
                                                            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.7} />
                                                        </linearGradient>
                                                        <linearGradient id="mobRejourneyMin" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.7} />
                                                            <stop offset="100%" stopColor="#bae6fd" stopOpacity={0.4} />
                                                        </linearGradient>
                                                        <linearGradient id="mobCompetitorGzip" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#64748b" stopOpacity={0.8} />
                                                            <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.6} />
                                                        </linearGradient>
                                                        <linearGradient id="mobCompetitorMin" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#cbd5e1" stopOpacity={0.5} />
                                                            <stop offset="100%" stopColor="#f1f5f9" stopOpacity={0.3} />
                                                        </linearGradient>
                                                    </defs>
                                                    <XAxis
                                                        dataKey="name"
                                                        axisLine={{ stroke: '#cbd5e1' }}
                                                        tickLine={{ stroke: '#cbd5e1' }}
                                                        tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'var(--font-sans)', fontWeight: 500 }}
                                                    />
                                                    <YAxis
                                                        axisLine={false}
                                                        tickLine={{ stroke: '#cbd5e1' }}
                                                        tick={{ fill: '#64748b', fontSize: 9, fontFamily: 'var(--font-sans)', fontWeight: 500 }}
                                                        tickFormatter={(v) => `${v} kB`}
                                                        domain={[0, Math.ceil(sentryRow.minifiedKb * 1.08)]}
                                                        width={44}
                                                    />
                                                    <Tooltip
                                                        cursor={{ fill: 'rgba(37,99,235,0.03)' }}
                                                        contentStyle={{
                                                            backgroundColor: '#fff',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '8px',
                                                            boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                                                            color: '#334155',
                                                            fontSize: '11px',
                                                            fontFamily: 'var(--font-sans)',
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
                                                            <Cell key={`g-${row.key}`} fill={row.key === 'rejourney' ? 'url(#mobRejourneyGzip)' : 'url(#mobCompetitorGzip)'} />
                                                        ))}
                                                    </Bar>
                                                    <Bar dataKey="minifiedAboveGzipKb" stackId="bp" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                                        {bundleCompareRows.map((row) => (
                                                            <Cell key={`m-${row.key}`} fill={row.key === 'rejourney' ? 'url(#mobRejourneyMin)' : 'url(#mobCompetitorMin)'} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                    <ul className="mt-4 flex flex-col gap-1.5 font-mono text-[10px] font-semibold text-slate-400">
                                        {bundleCompareRows.map((row) => (
                                            <li key={row.key}>
                                                <a
                                                    href={row.href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="underline hover:text-slate-705"
                                                >
                                                    {row.shortLabel}@{row.version} — BundlePhobia
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
                                        {copy.chartNote}
                                    </p>
                                </div>

                                {/* Comparative stats mobile list panel */}
                                <div className="flex flex-col justify-center space-y-6 lg:border-l lg:border-slate-100 lg:pl-10">
                                    <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50/30">
                                        <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                                            {rejourneyRow.shortLabel}
                                        </p>
                                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-2">
                                            <span className="text-4xl font-extrabold tracking-tight text-slate-900">
                                                {rejourneyRow.minifiedKb}
                                            </span>
                                            <span className="text-base font-bold uppercase text-slate-500">kB</span>
                                            <span className="text-[10px] font-semibold uppercase text-slate-400">
                                                {copy.minified}
                                            </span>
                                        </div>
                                        <p className="text-xs font-medium text-slate-500 mt-1">
                                            {rejourneyRow.gzipKb} {copy.gzipped}
                                        </p>
                                        <a
                                            href={rejourneyRow.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400 hover:text-blue-600"
                                        >
                                            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" aria-hidden />
                                            {copy.bundlePhobiaVersion(rejourneyRow.version)}
                                        </a>
                                    </div>

                                    <div className="w-full h-px bg-slate-100"></div>

                                    <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50/30">
                                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                            {sentryRow.shortLabel}
                                        </p>
                                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-2">
                                            <span className="text-4xl font-extrabold tracking-tight text-slate-900">
                                                {sentryRow.minifiedKb}
                                            </span>
                                            <span className="text-base font-bold uppercase text-slate-500">kB</span>
                                            <span className="text-[10px] font-semibold uppercase text-slate-400">
                                                {copy.minified}
                                            </span>
                                        </div>
                                        <p className="text-xs font-medium text-slate-500 mt-1">
                                            {sentryRow.gzipKb} {copy.gzipped}
                                        </p>
                                        <a
                                            href={sentryRow.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400 hover:text-slate-700"
                                        >
                                            <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" aria-hidden />
                                            {copy.bundlePhobiaVersion(sentryRow.version)}
                                        </a>
                                        <p className="text-[10px] text-slate-450 uppercase mt-3 max-w-[240px] leading-tight font-medium">
                                            {copy.transitiveNote}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Performance Metrics Table */}
                    <div className="mt-10 sm:mt-12 border-t border-slate-100 pt-8">
                        <div className="mb-5 pb-3">
                            <h3 className="text-base font-bold text-slate-800">{copy.metricsTitle}</h3>
                            <p className="mt-1 text-xs text-slate-400 leading-relaxed">{copy.metricsNotePrefix} <a href="https://merchcampus.com" target="_blank" rel="noopener noreferrer" className="underline">{copy.metricsNoteApp}</a>. {copy.metricsNoteSuffix}</p>
                        </div>

                        <div className="md:hidden border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                            {renderedMetricRows.map((row, index) => (
                                <div
                                    key={row.metric}
                                    className={`flex items-center justify-between gap-3 px-4 py-3 ${index < renderedMetricRows.length - 1 ? 'border-b border-slate-100' : ''} ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold text-slate-900 leading-tight truncate">{row.metric}</p>
                                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${row.threadClassName}`}>{row.thread}</span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-0 font-mono text-[10px] font-bold uppercase">
                                        <div className="flex flex-col items-center border-l border-slate-100 pl-3 pr-3">
                                            <span className="text-slate-400">{copy.tableAvgShort}</span>
                                            <span className="text-xs font-bold text-slate-800">{row.average}</span>
                                        </div>
                                        <div className="flex flex-col items-center border-l border-slate-100 pl-3 pr-3">
                                            <span className="text-slate-400">{copy.tableMaxShort}</span>
                                            <span className="text-xs font-bold text-slate-800">{row.max}</span>
                                        </div>
                                        <div className="flex flex-col items-center border-l border-slate-100 pl-3">
                                            <span className="text-slate-400">{copy.tableMinShort}</span>
                                            <span className="text-xs font-bold text-slate-800">{row.min}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="hidden overflow-x-auto overflow-y-hidden border border-slate-200 rounded-2xl bg-white md:block shadow-sm">
                            <table className="w-full min-w-[620px] lg:min-w-[720px] border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                                        <th className="text-left py-3.5 px-4 text-xs font-bold uppercase tracking-wider">{copy.tableMetric}</th>
                                        <th className="text-right py-3.5 px-4 text-xs font-bold uppercase tracking-wider">{copy.tableAverage}</th>
                                        <th className="text-right py-3.5 px-4 text-xs font-bold uppercase tracking-wider">{copy.tableMax}</th>
                                        <th className="text-right py-3.5 px-4 text-xs font-bold uppercase tracking-wider">{copy.tableMin}</th>
                                        <th className="text-right py-3.5 px-4 text-xs font-bold uppercase tracking-wider">{copy.tableThread}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {renderedMetricRows.map((row, index) => (
                                        <tr key={row.metric} className={`${index < performanceMetricRows.length - 1 ? 'border-b border-slate-100' : ''} transition-colors hover:bg-slate-50/50`}>
                                            <td className="px-4 py-3 text-xs font-semibold text-slate-800">{row.metric}</td>
                                            <td className="px-4 py-3 text-right font-mono text-xs font-medium text-slate-600">{row.average}</td>
                                            <td className="px-4 py-3 text-right font-mono text-xs font-medium text-slate-600">{row.max}</td>
                                            <td className="px-4 py-3 text-right font-mono text-xs font-medium text-slate-600">{row.min}</td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${row.threadClassName}`}>{row.thread}</span>
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
