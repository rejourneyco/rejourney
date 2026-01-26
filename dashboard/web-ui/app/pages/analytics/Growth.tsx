import React, { useState, useEffect, useMemo } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { api, InsightsTrends, getGrowthObservability, GrowthObservability } from '../../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { RetentionCohortChart } from '../../components/dashboard/RetentionCohortChart';
import { TouchHeatmapSection } from '../../components/dashboard/TouchHeatmapSection';
import { UserTypeTrends } from '../../components/dashboard/UserTypeTrends';
import { TrendingUp, Zap, Activity, Users, Target, MousePointer2 } from 'lucide-react';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoButton } from '../../components/ui/neo/NeoButton';

export const Growth: React.FC = () => {
    const { selectedProject } = useSessionData();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [isLoading, setIsLoading] = useState(true);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    const [growthObs, setGrowthObs] = useState<GrowthObservability | null>(null);

    useEffect(() => {
        async function loadData() {
            if (!selectedProject?.id) return;
            setIsLoading(true);
            try {
                const tr = timeRange === 'all' ? 'max' : timeRange;
                const [newTrends, newGrowthObs] = await Promise.all([
                    api.getInsightsTrends(selectedProject.id, tr),
                    getGrowthObservability(selectedProject.id, timeRange === 'all' ? undefined : (timeRange === '24h' ? '1d' : timeRange))
                ]);
                setTrends(newTrends);
                setGrowthObs(newGrowthObs);
            } catch (err) {
                console.error('Failed to load analytics', err);
            } finally {
                setIsLoading(false);
            }
        }
        loadData();
    }, [selectedProject?.id, timeRange]);

    const chartData = useMemo(() => {
        if (!trends?.daily) return [];
        return trends.daily.map((d: any) => ({
            date: new Date(d.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
            fullDate: d.date,
            sessions: d.sessions,
            dau: d.dau || 0,
            mau: d.mau || 0
        }));
    }, [trends]);


    if (isLoading && !trends) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] bg-white">
                <div className="relative">
                    <div className="w-24 h-24 border-8 border-black border-t-indigo-500 rounded-full animate-spin shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <TrendingUp className="w-8 h-8 text-black animate-pulse" />
                    </div>
                </div>
                <div className="mt-12 text-4xl font-black uppercase tracking-tighter text-black animate-bounce">
                    Analyzing Growth...
                </div>
                <div className="mt-4 text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
                    Calculating Retention Cohorts & Engagement Trends
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white flex flex-col font-sans text-black">
            {/* Header */}
            <div className="sticky top-0 z-50 bg-white border-b-4 border-black">
                <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-[1800px] mx-auto w-full">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-indigo-500 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg">
                            <TrendingUp className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                                Growth Engines
                            </h1>
                            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                <div className="h-3 w-1 bg-indigo-500"></div>
                                Track acquisition, retention, and product health
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden lg:flex items-center gap-2 mr-4 bg-slate-50 border-2 border-slate-200 px-3 py-1 rounded-md">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                            <span className="text-[10px] font-black uppercase text-slate-400">Observability Online</span>
                        </div>
                        <TimeFilter value={timeRange} onChange={setTimeRange} />
                    </div>
                </div>
            </div>

            <div className="flex-1 p-6 md:p-12 space-y-12 max-w-[1800px] mx-auto w-full">

                {/* Touch Heatmaps - First Section */}
                <TouchHeatmapSection />

                {/* Traffic & Engagement (Sessions / DAU / MAU) */}
                <NeoCard
                    title="Traffic Volume (Sessions / DAU / MAU)"
                    variant="monitor"
                    action={
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-black border border-white"></div>
                                <span className="text-[10px] font-black uppercase">Sessions</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-indigo-500 border border-black"></div>
                                <span className="text-[10px] font-black uppercase">DAU</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-emerald-500 border border-black"></div>
                                <span className="text-[10px] font-black uppercase">MAU</span>
                            </div>
                        </div>
                    }
                >
                    <div className="w-full h-[320px] pt-6">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorSessions" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#000000" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#000000" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorDau" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorMau" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#e2e8f0" />
                                <XAxis
                                    dataKey="date"
                                    axisLine={{ stroke: '#000', strokeWidth: 2 }}
                                    tickLine={{ stroke: '#000', strokeWidth: 2 }}
                                    tick={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 900, fill: '#000' }}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={{ stroke: '#000', strokeWidth: 2 }}
                                    tickLine={{ stroke: '#000', strokeWidth: 2 }}
                                    tick={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 900, fill: '#000' }}
                                />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: '#fff',
                                        border: '4px solid #000',
                                        borderRadius: '0px',
                                        boxShadow: '8px 8px 0px 0px rgba(0,0,0,1)',
                                        fontSize: '12px',
                                        fontWeight: '900',
                                        textTransform: 'uppercase'
                                    }}
                                />
                                <Area type="stepAfter" dataKey="sessions" stroke="#000000" strokeWidth={4} fillOpacity={1} fill="url(#colorSessions)" name="Sessions" />
                                <Area type="stepAfter" dataKey="dau" stroke="#6366f1" strokeWidth={4} fillOpacity={1} fill="url(#colorDau)" name="DAU" />
                                <Area type="stepAfter" dataKey="mau" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorMau)" name="MAU" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </NeoCard>

                {/* Retention Cohort */}
                <NeoCard title="Weekly Retention Cohort" variant="flat" className="border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] bg-white">
                    <RetentionCohortChart dailyData={trends?.daily || []} dailyHealth={growthObs?.dailyHealth} />
                </NeoCard>

                {/* User Type Trends */}
                <div className="space-y-6">
                    <h2 className="text-2xl font-black text-black uppercase tracking-tighter flex items-center gap-3">
                        <Users className="w-8 h-8 text-black" /> Behavioral Segments
                    </h2>
                    <UserTypeTrends />
                </div>
            </div>
        </div>
    );
};

export default Growth;

