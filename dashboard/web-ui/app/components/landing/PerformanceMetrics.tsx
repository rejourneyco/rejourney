import React, { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

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

    // Comparison Data (Flat line visual)
    const comparisonData = [
        { version: 'v1.0', Rejourney: 1.6, Sentry: 7.1 },
        { version: 'v1.1', Rejourney: 1.6, Sentry: 7.1 },
        { version: 'v1.2', Rejourney: 1.6, Sentry: 7.1 },
        { version: 'v1.3', Rejourney: 1.6, Sentry: 7.1 },
        { version: 'v1.4', Rejourney: 1.6, Sentry: 7.1 },
        { version: 'v1.5', Rejourney: 1.6, Sentry: 7.1 },
    ];

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
                            4.4x Efficiency Advantage over industry standards
                        </p>
                    </div>

                    {/* Floating Badge */}
                    <div className="hidden lg:block bg-black text-white p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(93,173,236,1)] rotate-2">
                        <p className="text-4xl font-black font-mono">4.4X</p>
                        <p className="text-[10px] uppercase font-bold tracking-widest mt-1">Smaller SDK Size</p>
                    </div>
                </div>

                {/* Main Content Box */}
                <div className="border-2 border-black bg-white p-6 sm:p-10 shadow-[16px_16px_0px_0px_rgba(0,0,0,1)]">

                    {/* Top Row: SDK Size Comparison */}
                    <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-12 mb-16 border-b-2 border-black border-dashed pb-12">

                        {/* Chart Area */}
                        <div className="flex flex-col h-full">
                            <div className="flex justify-between items-center mb-6 border-b-2 border-black pb-2">
                                <h3 className="text-lg font-black uppercase tracking-tight">SDK Size Comparison</h3>
                                <div className="flex gap-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-[#ef4444] border-2 border-black"></div>
                                        <span className="text-[10px] font-bold uppercase">Sentry</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-[#5dadec] border-2 border-black"></div>
                                        <span className="text-[10px] font-bold uppercase">Rejourney</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-grow min-h-[250px] relative border-2 border-black bg-slate-50 p-4">
                                {isVisible && (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={comparisonData}>
                                            <YAxis
                                                hide={false}
                                                axisLine={false}
                                                tickLine={true}
                                                tick={{ fill: '#000', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold' }}
                                                tickFormatter={(value) => `${value}MB`}
                                                interval={0}
                                                width={40}
                                            />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#000',
                                                    border: 'none',
                                                    color: '#fff',
                                                    fontSize: '12px',
                                                    fontFamily: 'monospace',
                                                    textTransform: 'uppercase'
                                                }}
                                                itemStyle={{ color: '#fff' }}
                                            />
                                            <Area type="step" dataKey="Sentry" stroke="#ef4444" strokeWidth={3} fill="#ef4444" fillOpacity={0.1} isAnimationActive={true} />
                                            <Area type="step" dataKey="Rejourney" stroke="#5dadec" strokeWidth={3} fill="#5dadec" fillOpacity={0.1} isAnimationActive={true} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>

                        {/* Comparative Stats (Side Panel) */}
                        <div className="lg:border-l-2 lg:border-black lg:border-dashed lg:pl-12 flex flex-col justify-center space-y-10">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-[#ef4444] mb-2">Sentry RN SDK</p>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-6xl font-black font-mono tracking-tighter">7.1</span>
                                    <span className="text-xl font-bold uppercase">MB</span>
                                </div>
                                <p className="text-[10px] font-mono text-gray-500 uppercase mt-2 max-w-[200px] leading-tight">
                                    Heavy dependencies impact cold starts & binary size.
                                </p>
                            </div>

                            <div className="w-full h-px bg-black border-t border-dashed"></div>

                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-[#5dadec] mb-2">Rejourney SDK</p>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-6xl font-black font-mono tracking-tighter text-[#5dadec]">1.6</span>
                                    <span className="text-xl font-bold uppercase text-[#5dadec]">MB</span>
                                </div>
                            </div>
                        </div>
                    </div>


                    {/* Performance Metrics Table */}
                    <div className="mt-12">
                        <div className="border-b-2 border-black pb-2 mb-6">
                            <h3 className="text-lg font-black uppercase tracking-tight">Performance Metrics</h3>
                            <p className="text-[10px] font-mono text-gray-500 uppercase">iPhone 15 Pro; iOS 26; Expo SDK 54; RN New Arch. Running on <a href="https://merchcampus.com" target="_blank" rel="noopener noreferrer" className="underline">Merch App</a>. Steady-state, first 3 frames excluded.</p>
                        </div>

                        <div className="border-2 border-black bg-white overflow-hidden">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="bg-black text-white">
                                        <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Metric</th>
                                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Average (ms)</th>
                                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Max (ms)</th>
                                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest">Min (ms)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">frame_total</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">17.5</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">66.0</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">0.01</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">screenshot_ui</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">22.8</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">65.8</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">8.4</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">render_draw</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">12.8</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">25.2</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">7.2</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">view_scan</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">5.1</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">28.3</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">0.69</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">view_serialize</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">1.5</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">3.6</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">0.16</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">downscale</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">58.6</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">400.7</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">9.4</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">encode_append</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">0.20</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">0.80</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">0.07</td>
                                    </tr>
                                    <tr className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">encode_h264</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">85.5</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">1989.1</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">0.34</td>
                                    </tr>
                                    <tr className="hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">buffer_alloc</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">0.40</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">1.30</td>
                                        <td className="py-3 px-4 text-xs font-mono font-bold text-right">0.22</td>
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
