import React, { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import {
    Bar,
    BarChart,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

const BUNDLEPHOBIA_REJOURNEY =
    'https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17';
const BUNDLEPHOBIA_SENTRY =
    'https://bundlephobia.com/package/@sentry/react-native@8.7.0';

/** BundlePhobia npm entry-point sizes (minified + gzipped), fixed versions. */
const bundleCompareRows = [
    {
        key: 'rejourney',
        label: 'Rejourney',
        shortLabel: '@rejourneyco/react-native',
        version: '1.0.17',
        minifiedKb: 39.7,
        gzipKb: 13.2,
        href: BUNDLEPHOBIA_REJOURNEY,
        gzipFill: '#3b82c4',
        minExtraFill: '#93c5fd',
    },
    {
        key: 'sentry',
        label: 'Sentry',
        shortLabel: '@sentry/react-native',
        version: '8.7.0',
        minifiedKb: 403,
        gzipKb: 135.3,
        href: BUNDLEPHOBIA_SENTRY,
        gzipFill: '#b91c1c',
        minExtraFill: '#f87171',
    },
] as const;

const bundleChartData = bundleCompareRows.map((row) => ({
    name: row.label,
    gzipKb: row.gzipKb,
    minifiedAboveGzipKb: Math.max(0, row.minifiedKb - row.gzipKb),
    minifiedKb: row.minifiedKb,
    href: row.href,
}));

export const PerformanceMetrics: React.FC = () => {
    const sectionRef = useRef<HTMLElement>(null);
    const [isVisible, setIsVisible] = useState(false);

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

    return (
        <section ref={sectionRef} className="w-full px-4 sm:px-6 lg:px-8 py-24 border-t-2 border-black bg-slate-50 relative overflow-hidden">
            {/* Background Grid Pattern */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>

            <div className="max-w-7xl mx-auto relative z-10">

                {/* Header Section */}
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-16 gap-8">
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <Activity className="w-4 h-4 text-[#5dadec]" />
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#5dadec]">Efficiency Audit</span>
                        </div>
                        <h2 className="text-5xl sm:text-7xl font-black uppercase tracking-tighter leading-[0.85] mb-4">
                            Tiny Footprint.<br />
                            <span className="text-gray-400">Extreme Impact.</span>
                        </h2>
                        <p className="font-mono text-sm text-gray-500 uppercase tracking-widest">
                            {rejourneyEfficiencyX}× smaller minified JS bundle vs {sentryRow.shortLabel}@{sentryRow.version} (BundlePhobia)
                        </p>
                    </div>

                    {/* Floating Badge */}
                    <div className="hidden lg:block bg-black text-white p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(93,173,236,1)] rotate-2">
                        <p className="text-4xl font-black font-mono">{rejourneyEfficiencyX}X</p>
                        <p className="text-[10px] uppercase font-bold tracking-widest mt-1">Smaller JS bundle</p>
                    </div>
                </div>

                {/* Main Content Box */}
                <div className="border-2 border-black bg-white p-6 sm:p-10 shadow-[16px_16px_0px_0px_rgba(0,0,0,1)]">

                    {/* Top Row: SDK Size Comparison */}
                    <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-12 mb-16 border-b-2 border-black border-dashed pb-12">

                        {/* Chart Area */}
                        <div className="flex flex-col h-full">
                            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center mb-6 border-b-2 border-black pb-2">
                                <h3 className="text-lg font-black uppercase tracking-tight">Npm bundle size (BundlePhobia)</h3>
                                <div className="flex flex-wrap gap-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-[#1e3a5f] border-2 border-black" aria-hidden />
                                        <span className="text-[10px] font-bold uppercase">Gzip</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-[#bfdbfe] border-2 border-black" aria-hidden />
                                        <span className="text-[10px] font-bold uppercase">Minified − gzip</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-grow min-h-[280px] relative border-2 border-black bg-slate-50 p-4">
                                {isVisible && (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={bundleChartData}
                                            margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                                            barCategoryGap="28%"
                                        >
                                            <XAxis
                                                dataKey="name"
                                                axisLine={{ stroke: '#000' }}
                                                tickLine={{ stroke: '#000' }}
                                                tick={{ fill: '#000', fontSize: 11, fontFamily: 'monospace', fontWeight: 800 }}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={{ stroke: '#000' }}
                                                tick={{ fill: '#000', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold' }}
                                                tickFormatter={(v) => `${v} kB`}
                                                domain={[0, Math.ceil(sentryRow.minifiedKb * 1.08)]}
                                                width={44}
                                            />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                                                contentStyle={{
                                                    backgroundColor: '#000',
                                                    border: 'none',
                                                    color: '#fff',
                                                    fontSize: '12px',
                                                    fontFamily: 'monospace',
                                                    textTransform: 'uppercase',
                                                }}
                                                itemStyle={{ color: '#fff' }}
                                                formatter={(value: number | undefined, name: string | undefined) => {
                                                    const v = value ?? 0;
                                                    const n = name ?? '';
                                                    if (n === 'minifiedAboveGzipKb') return [`${v.toFixed(1)} kB`, 'Minified − gzip'];
                                                    if (n === 'gzipKb') return [`${v.toFixed(1)} kB`, 'Gzipped'];
                                                    return [`${v} kB`, n];
                                                }}
                                                labelFormatter={(_, payload) => {
                                                    const p = payload?.[0]?.payload as { minifiedKb?: number; href?: string } | undefined;
                                                    const total = p?.minifiedKb;
                                                    return total != null ? `Total minified: ${total} kB` : '';
                                                }}
                                            />
                                            <Bar dataKey="gzipKb" stackId="bp" radius={[0, 0, 0, 0]}>
                                                {bundleCompareRows.map((row) => (
                                                    <Cell key={`g-${row.key}`} fill={row.gzipFill} />
                                                ))}
                                            </Bar>
                                            <Bar dataKey="minifiedAboveGzipKb" stackId="bp" radius={[2, 2, 0, 0]}>
                                                {bundleCompareRows.map((row) => (
                                                    <Cell key={`m-${row.key}`} fill={row.minExtraFill} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                            <ul className="mt-4 flex flex-col gap-2 font-mono text-[10px] font-bold uppercase text-gray-600">
                                {bundleCompareRows.map((row) => (
                                    <li key={row.key}>
                                        <a
                                            href={row.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="underline decoration-2 underline-offset-2 hover:text-black"
                                        >
                                            {row.shortLabel}@{row.version} — BundlePhobia
                                        </a>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-2 text-[10px] font-mono text-gray-500 uppercase leading-relaxed">
                                Bar height = minified size; darker segment = gzipped transfer size (same layout as BundlePhobia).
                            </p>
                        </div>

                        {/* Comparative Stats (Side Panel) — Rejourney first (smaller), Sentry second */}
                        <div className="lg:border-l-2 lg:border-black lg:border-dashed lg:pl-12 flex flex-col justify-center space-y-10">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-[#5dadec] mb-2">
                                    {rejourneyRow.shortLabel}
                                </p>
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span className="text-5xl sm:text-6xl font-black font-mono tracking-tighter text-[#5dadec]">
                                        {rejourneyRow.minifiedKb}
                                    </span>
                                    <span className="text-xl font-bold uppercase text-[#5dadec]">kB</span>
                                    <span className="text-[10px] font-bold font-mono uppercase text-gray-500">
                                        minified
                                    </span>
                                </div>
                                <p className="text-sm font-mono font-bold text-gray-700 mt-1">
                                    {rejourneyRow.gzipKb} kB gzipped
                                </p>
                                <a
                                    href={rejourneyRow.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold font-mono uppercase text-gray-500 underline decoration-2 underline-offset-2 hover:text-black"
                                >
                                    <ArrowDownRight className="w-3.5 h-3.5 text-[#008000]" aria-hidden />
                                    BundlePhobia @{rejourneyRow.version}
                                </a>
                            </div>

                            <div className="w-full h-px bg-black border-t border-dashed"></div>

                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-[#ef4444] mb-2">
                                    {sentryRow.shortLabel}
                                </p>
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span className="text-5xl sm:text-6xl font-black font-mono tracking-tighter">
                                        {sentryRow.minifiedKb}
                                    </span>
                                    <span className="text-xl font-bold uppercase">kB</span>
                                    <span className="text-[10px] font-bold font-mono uppercase text-gray-500">
                                        minified
                                    </span>
                                </div>
                                <p className="text-sm font-mono font-bold text-gray-700 mt-1">
                                    {sentryRow.gzipKb} kB gzipped
                                </p>
                                <a
                                    href={sentryRow.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold font-mono uppercase text-gray-500 underline decoration-2 underline-offset-2 hover:text-black"
                                >
                                    <ArrowUpRight className="w-3.5 h-3.5 text-[#ef4444]" aria-hidden />
                                    BundlePhobia @{sentryRow.version}
                                </a>
                                <p className="text-[10px] font-mono text-gray-500 uppercase mt-3 max-w-[240px] leading-tight">
                                    Includes transitive npm dependencies in BundlePhobia&apos;s model.
                                </p>
                            </div>
                        </div>
                    </div>


                    {/* Performance Metrics Table */}
                    <div className="mt-12">
                        <div className="border-b-2 border-black pb-2 mb-6">
                            <h3 className="text-lg font-black uppercase tracking-tight">Performance Metrics</h3>
                            <p className="text-[10px] font-mono text-gray-500 uppercase">iPhone 15 Pro; iOS 18; Expo SDK 54; RN New Architecture. Running on <a href="https://merchcampus.com" target="_blank" rel="noopener noreferrer" className="underline">Merch App</a>. Production build.</p>
                        </div>

                        <div className="border-2 border-black bg-white overflow-x-auto">
                            <table className="w-full min-w-[720px] border-collapse">
                                <thead>
                                    <tr className="bg-black text-white">
                                        <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Metric</th>
                                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Average (ms)</th>
                                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Max (ms)</th>
                                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Min (ms)</th>
                                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest">Thread</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black font-bold">Main: UIKit + Metal Capture</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">12.4</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">28.2</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">8.1</td>
                                        <td className="py-3 px-4 text-xs font-bold text-center text-red-600">Main</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">BG: Async Image Processing</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">42.5</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">88.0</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">32.4</td>
                                        <td className="py-3 px-4 text-xs font-bold text-center text-green-600">Background</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">BG: Tar+Gzip Compression</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">14.2</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">32.5</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">9.6</td>
                                        <td className="py-3 px-4 text-xs font-bold text-center text-green-600">Background</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">BG: Upload Handshake</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">0.8</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">2.4</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">0.3</td>
                                        <td className="py-3 px-4 text-xs font-bold text-center text-green-600">Background</td>
                                    </tr>
                                    <tr className="hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black font-bold">Total Main Thread Impact</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">12.4</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">28.2</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">8.1</td>
                                        <td className="py-3 px-4 text-xs font-bold text-center text-red-600">Main</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </div>
        </section>
    );
};
