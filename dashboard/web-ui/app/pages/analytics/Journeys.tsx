import React, { useState, useEffect, useMemo } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { getJourneyObservability, ObservabilityJourneySummary } from '../../services/api';
import { SankeyJourney } from '../../components/analytics/SankeyJourney';
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
    Search,
    Users
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
                                User Flows
                            </h1>
                            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                <div className="h-3 w-1 bg-indigo-500"></div>
                                Tracing Session Paths & Drop-offs
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <TimeFilter value={timeRange} onChange={setTimeRange} />
                    </div>
                </div>
            </div>

            <div className="flex-1 p-6 md:p-8 space-y-12 max-w-[1600px] mx-auto w-full">

                {/* Main Sankey Visualization */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                            <Activity className="w-5 h-5 text-indigo-500" /> Interactive Flow Map
                        </h2>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black uppercase text-slate-400">View:</span>
                                {(['all', 'failed', 'rage'] as ViewMode[]).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setViewMode(mode)}
                                        className={`px-2 py-0.5 text-[9px] font-black uppercase rounded border-2 border-black transition-all ${viewMode === mode
                                            ? 'bg-black text-white shadow-none translate-x-[1px] translate-y-[1px]'
                                            : 'bg-white text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-slate-50'
                                            }`}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <SankeyJourney flows={filteredFlows} width={1500} height={500} />
                </div>

                {/* Insights Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* Problematic Paths */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-red-500" /> High-Failure Paths
                        </h3>
                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                            {data?.problematicJourneys?.slice(0, 5).map((journey, i) => (
                                <NeoCard key={i} className="p-4 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all">
                                    <div className="flex justify-between items-center mb-3">
                                        <NeoBadge variant="danger" size="sm" className="font-mono">SCORE: {journey.failureScore}</NeoBadge>
                                        <Link to={`${pathPrefix}/sessions/${journey.sampleSessionIds[0]}`} className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase flex items-center gap-1">
                                            Watch <Video size={10} />
                                        </Link>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1 mb-3">
                                        {journey.path.map((screen, j) => (
                                            <React.Fragment key={j}>
                                                <span className="text-[9px] font-bold text-black uppercase bg-slate-50 px-1 border border-black/10">{screen}</span>
                                                {j < journey.path.length - 1 && <ChevronRight size={10} className="text-slate-300" />}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                    <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase">
                                        <span>{journey.sessionCount} Sessions</span>
                                        <span className="text-red-500">{journey.crashes} Crashes</span>
                                    </div>
                                </NeoCard>
                            ))}
                        </div>
                    </div>

                    {/* Exit Points */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                            <LogOut className="w-4 h-4 text-orange-500" /> Terminal Failure Exits
                        </h3>
                        <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-xl overflow-hidden">
                            <table className="w-full text-[10px] font-mono">
                                <tbody className="divide-y divide-slate-100">
                                    {data?.exitAfterError?.slice(0, 6).map((exit, i) => (
                                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-3 font-black text-black uppercase truncate max-w-[120px]">{exit.screen}</td>
                                            <td className="p-3 text-right">
                                                <div className="flex justify-end gap-1">
                                                    {exit.errorTypes.crash > 0 && <div className="w-1.5 h-1.5 rounded-full bg-red-500" title="Crashes" />}
                                                    {exit.errorTypes.rage > 0 && <div className="w-1.5 h-1.5 rounded-full bg-rose-500" title="Rage Taps" />}
                                                </div>
                                            </td>
                                            <td className="p-3 text-right font-black text-orange-500 text-sm">
                                                {exit.exitCount}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Interface Health */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                            <Layout className="w-4 h-4 text-emerald-500" /> Interface Fragility
                        </h3>
                        <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-xl overflow-hidden">
                            <table className="w-full text-[10px] font-mono">
                                <tbody className="divide-y divide-slate-100">
                                    {data?.screenHealth?.slice(0, 6).map((screen, i) => (
                                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-3">
                                                <div className="flex items-center gap-2 font-black text-black uppercase truncate max-w-[140px]">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${screen.health === 'problematic' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                                                    {screen.name}
                                                </div>
                                            </td>
                                            <td className="p-3 text-right font-black text-slate-400">
                                                {screen.visits} <Users size={8} className="inline ml-1" />
                                            </td>
                                            <td className="p-3 text-right">
                                                {screen.crashes > 0 ? (
                                                    <span className="text-red-600 font-black">!</span>
                                                ) : (
                                                    <span className="text-emerald-500 font-black">✓</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default Journeys;
