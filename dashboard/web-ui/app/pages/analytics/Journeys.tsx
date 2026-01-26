import React, { useState, useEffect, useMemo } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { getJourneyObservability, ObservabilityJourneySummary } from '../../services/api';
import { Badge } from '../../components/ui/Badge';
import {
    ArrowRight,
    AlertTriangle,
    Zap,
    Activity,
    Video,
    LogOut,
    Eye,
    AlertCircle,
    Clock,
    Bug,
    Map,
    Layout,
    ChevronRight,
    Search
} from 'lucide-react';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { Link, useNavigate } from 'react-router';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';

type ViewMode = 'all' | 'failed' | 'rage' | 'slow';

export const Journeys: React.FC = () => {
    const { selectedProject } = useSessionData();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [viewMode, setViewMode] = useState<ViewMode>('all');
    const [data, setData] = useState<ObservabilityJourneySummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();

    useEffect(() => {
        if (!selectedProject?.id) return;
        let cancelled = false;
        setData(null); // Clear stale data from previous project
        setIsLoading(true);

        getJourneyObservability(selectedProject.id, timeRange === 'all' ? undefined : (timeRange === '24h' ? '1d' : timeRange))
            .then(result => {
                if (!cancelled) {
                    setData(result);
                    setIsLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [timeRange, selectedProject?.id]);

    // Filter flows based on view mode
    const filteredFlows = useMemo(() => {
        if (!data) return [];
        switch (viewMode) {
            case 'failed':
                return data.flows.filter(f => f.crashCount > 0 || f.anrCount > 0);
            case 'rage':
                return data.flows.filter(f => f.rageTapCount >= 2);
            case 'slow':
                return data.flows.filter(f => f.avgApiLatencyMs > 500);
            default:
                return data.flows;
        }
    }, [data, viewMode]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] bg-white">
                <div className="relative">
                    <div className="w-24 h-24 border-8 border-black border-t-indigo-500 rounded-full animate-spin shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Map className="w-8 h-8 text-black animate-pulse" />
                    </div>
                </div>
                <div className="mt-12 text-4xl font-black uppercase tracking-tighter text-black animate-bounce">
                    Mapping Journeys...
                </div>
                <div className="mt-4 text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
                    Tracing User Flows & Failure Paths
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
                            <Map className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                                User Journeys
                            </h1>
                            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                <div className="h-3 w-1 bg-indigo-500"></div>
                                Tracking Session Flows & Exits ({data ? (data.healthSummary.healthy + data.healthSummary.degraded + data.healthSummary.problematic) : 0} total)
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden lg:flex items-center gap-2 mr-4 bg-slate-50 border-2 border-slate-200 px-3 py-1 rounded-md">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                            <span className="text-[10px] font-black uppercase text-slate-400">Analysis Active</span>
                        </div>
                        <TimeFilter value={timeRange} onChange={setTimeRange} />
                    </div>
                </div>
            </div>

            <div className="flex-1 p-6 md:p-8 space-y-12 max-w-[1600px] mx-auto w-full">

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">

                    {/* Left Col: Transitions */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                                <Map className="w-5 h-5 text-indigo-500" /> Transition Health
                            </h2>
                            <div className="flex items-center gap-1.5">
                                {(['all', 'failed', 'rage', 'slow'] as ViewMode[]).map(mode => (
                                    <NeoBadge
                                        key={mode}
                                        variant={viewMode === mode ? 'neutral' : 'info'}
                                        size="sm"
                                        className={`cursor-pointer transition-all ${viewMode === mode ? 'ring-1 ring-black !bg-black !text-white' : 'opacity-60 hover:opacity-100'}`}
                                        onClick={() => setViewMode(mode)}
                                    >
                                        {mode}
                                    </NeoBadge>
                                ))}
                            </div>
                        </div>

                        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                            <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                                {filteredFlows.length > 0 ? (
                                    <table className="w-full text-left font-mono text-xs">
                                        <thead>
                                            <tr className="border-b-4 border-black bg-slate-50 font-black uppercase text-black sticky top-0 z-10">
                                                <th className="p-4 tracking-wider">Path Journey</th>
                                                <th className="p-4 tracking-wider text-right">Volume</th>
                                                <th className="p-4 tracking-wider text-right">Issues</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y-2 divide-slate-100">
                                            {filteredFlows.slice(0, 20).map((flow, i) => (
                                                <tr key={i} className="hover:bg-indigo-50/30 transition-colors group">
                                                    <td className="p-4 align-top">
                                                        <div className="flex items-center gap-3 font-black text-black flex-wrap uppercase tracking-tighter">
                                                            <span className="px-1.5 py-0.5 bg-slate-100 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]" title={flow.from}>{flow.from}</span>
                                                            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                                                            <span className="px-1.5 py-0.5 bg-slate-100 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]" title={flow.to}>{flow.to}</span>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-right align-top font-black text-slate-400">
                                                        {flow.count.toLocaleString()}
                                                    </td>
                                                    <td className="p-4 text-right align-top">
                                                        <div className="flex flex-col items-end gap-1.5">
                                                            {flow.crashCount > 0 && (
                                                                <NeoBadge variant="danger" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                                                                    {flow.crashCount} CRASHES
                                                                </NeoBadge>
                                                            )}
                                                            {flow.anrCount > 0 && (
                                                                <NeoBadge variant="anr" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                                                                    {flow.anrCount} ANRS
                                                                </NeoBadge>
                                                            )}
                                                            {flow.apiErrorRate > 5 && (
                                                                <NeoBadge variant="warning" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                                                                    {flow.apiErrorRate}% API ERR
                                                                </NeoBadge>
                                                            )}
                                                            {flow.rageTapCount > 0 && (
                                                                <NeoBadge variant="rage" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                                                                    {flow.rageTapCount} RAGE
                                                                </NeoBadge>
                                                            )}
                                                            {flow.crashCount === 0 && flow.anrCount === 0 && flow.apiErrorRate <= 5 && flow.rageTapCount === 0 && (
                                                                <NeoBadge variant="success" size="sm" className="border border-black opacity-30 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">HEALTHY</NeoBadge>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="h-64 flex flex-col items-center justify-center gap-4">
                                        <Activity className="w-12 h-12 text-slate-100" />
                                        <div className="text-sm font-black text-slate-300 uppercase tracking-widest">No Transitions Logged</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Col: Problematic Journeys */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-red-500" /> Problematic Journeys
                        </h2>

                        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                            {data?.problematicJourneys && data.problematicJourneys.length > 0 ? (
                                data.problematicJourneys.slice(0, 10).map((journey, i) => (
                                    <NeoCard key={i} className="p-0 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] group/card" disablePadding>
                                        <div className="p-6 bg-white">
                                            {/* Header: Score + Replay */}
                                            <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-slate-50">
                                                <div className="flex items-center gap-3">
                                                    <NeoBadge variant="danger" size="md" className="border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-mono">
                                                        SCORE: {journey.failureScore}
                                                    </NeoBadge>
                                                    <span className="text-[10px] font-bold uppercase text-slate-500 tracking-widest bg-slate-100 px-2 py-1 rounded">
                                                        Failure Intensity
                                                    </span>
                                                </div>
                                                {journey.sampleSessionIds[0] && (
                                                    <Link to={`${pathPrefix}/sessions/${journey.sampleSessionIds[0]}`}>
                                                        <NeoButton size="sm" variant="primary" className="shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" rightIcon={<Video className="w-4 h-4" />}>
                                                            REPLAY
                                                        </NeoButton>
                                                    </Link>
                                                )}
                                            </div>

                                            {/* Path Visualization */}
                                            <div className="flex flex-wrap items-center gap-2 mb-8">
                                                {journey.path.map((screen, j) => (
                                                    <React.Fragment key={j}>
                                                        <span className="text-[11px] font-black font-mono text-black bg-slate-50 px-2.5 py-1.5 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] uppercase tracking-tight">
                                                            {screen}
                                                        </span>
                                                        {j < journey.path.length - 1 && (
                                                            <ArrowRight className="w-5 h-5 text-indigo-500 group-hover/card:scale-125 transition-transform" />
                                                        )}
                                                    </React.Fragment>
                                                ))}
                                            </div>

                                            {/* Metrics Strip */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50 border-2 border-black rounded-xl">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sessions</span>
                                                    <span className="text-sm font-black text-black">{journey.sessionCount}</span>
                                                </div>
                                                {journey.crashes > 0 && (
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">Crashes</span>
                                                        <span className="text-sm font-black text-red-600">{journey.crashes}</span>
                                                    </div>
                                                )}
                                                {journey.anrs > 0 && (
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">ANRs</span>
                                                        <span className="text-sm font-black text-purple-600">{journey.anrs}</span>
                                                    </div>
                                                )}
                                                {journey.apiErrors > 0 && (
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest">API ERRS</span>
                                                        <span className="text-sm font-black text-orange-600">{journey.apiErrors}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </NeoCard>
                                ))
                            ) : (
                                <div className="h-48 flex flex-col items-center justify-center gap-3 bg-white border-4 border-black border-dashed rounded-2xl">
                                    <Zap className="w-12 h-12 text-slate-100" />
                                    <div className="text-xs font-black text-slate-300 uppercase tracking-widest">All Clear Journeys</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Bottom Row: Exits & Screen Health */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* Top Exits */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                            <LogOut className="w-5 h-5 text-orange-500" /> Top Exits After Error
                        </h2>
                        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                            <table className="w-full text-left font-mono text-xs">
                                <thead>
                                    <tr className="border-b-4 border-black bg-slate-50 font-black uppercase text-black sticky top-0 z-10">
                                        <th className="p-4 tracking-wider">Target Screen</th>
                                        <th className="p-4 tracking-wider text-right">Failure Reason</th>
                                        <th className="p-4 tracking-wider text-right">Drop Offs</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y-2 divide-slate-100">
                                    {data?.exitAfterError && data.exitAfterError.length > 0 ? (
                                        data.exitAfterError.slice(0, 5).map((exit, i) => (
                                            <tr key={i} className="hover:bg-orange-50/30 transition-colors group">
                                                <td className="p-4 font-black text-black uppercase tracking-tight">
                                                    <span className="px-1.5 py-0.5 bg-slate-50 border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                                                        {exit.screen}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <div className="flex flex-col items-end gap-1.5">
                                                        {exit.errorTypes.crash > 0 && <NeoBadge variant="danger" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{exit.errorTypes.crash} CRASHES</NeoBadge>}
                                                        {exit.errorTypes.api > 0 && <NeoBadge variant="warning" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{exit.errorTypes.api} API ERRS</NeoBadge>}
                                                        {exit.errorTypes.rage > 0 && <NeoBadge variant="rage" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{exit.errorTypes.rage} RAGE</NeoBadge>}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-right font-black text-orange-500 text-lg">
                                                    {exit.exitCount}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr><td colSpan={3} className="p-20 text-center font-black text-slate-200 uppercase tracking-widest">No Failure Exits</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Screen Health */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                            <Layout className="w-5 h-5 text-emerald-500" /> Screen Health
                        </h2>
                        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                                <table className="w-full text-left font-mono text-xs">
                                    <thead>
                                        <tr className="border-b-4 border-black bg-slate-50 font-black uppercase text-black sticky top-0 z-10">
                                            <th className="p-4 tracking-wider">Interface Node</th>
                                            <th className="p-4 tracking-wider text-right">Issues Log</th>
                                            <th className="p-4 tracking-wider text-right">Traffic</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y-2 divide-slate-100">
                                        {data?.screenHealth && data.screenHealth.length > 0 ? (
                                            data.screenHealth.slice(0, 8).map((screen, i) => (
                                                <tr key={i} className="hover:bg-emerald-50/20 transition-colors group">
                                                    <td className="p-4 text-xs font-black text-black">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-3 h-3 border-2 border-black rounded-full shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${screen.health === 'problematic' ? 'bg-red-500 animate-pulse' : screen.health === 'degraded' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                                            <span className="uppercase tracking-tight bg-slate-50 px-1.5 py-0.5 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] truncate max-w-[180px]">{screen.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        {screen.crashes + screen.anrs + screen.apiErrors + screen.rageTaps > 0 ? (
                                                            <NeoBadge variant="danger" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                                                                {screen.crashes + screen.anrs + screen.apiErrors + screen.rageTaps} CRITICAL
                                                            </NeoBadge>
                                                        ) : (
                                                            <NeoBadge variant="success" size="sm" className="border border-black opacity-30 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">OPTIMIZED</NeoBadge>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-right font-black text-slate-400">
                                                        {screen.visits.toLocaleString()} VISITS
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr><td colSpan={3} className="p-20 text-center font-black text-slate-200 uppercase tracking-widest">No Screen Data</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Journeys;
