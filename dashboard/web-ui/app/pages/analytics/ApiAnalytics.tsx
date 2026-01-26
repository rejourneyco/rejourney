import React, { useEffect, useState } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { Terminal, Server, Search, Globe, Map, Activity, Zap, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getRegionPerformance, getApiEndpointStats, RegionPerformance, ApiEndpointStats } from '../../services/api';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';

export const ApiAnalytics: React.FC = () => {
    const { selectedProject, isLoading: isContextLoading } = useSessionData();
    const [stats, setStats] = useState<ApiEndpointStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [regionData, setRegionData] = useState<RegionPerformance | null>(null);
    const [regionLoading, setRegionLoading] = useState(false);
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);

    // Use selectedProject from context (synced with sidebar selection)
    const currentProject = selectedProject;

    useEffect(() => {
        const fetchStats = async () => {
            if (!currentProject) {
                setIsLoading(false);
                return;
            }

            try {
                setIsLoading(true);
                setError(null);
                const data = await getApiEndpointStats(currentProject.id, timeRange === 'all' ? 'max' : timeRange);
                setStats(data);
            } catch (err) {
                console.error('[ApiPerformance] Error:', err);
                setError(err instanceof Error ? err.message : 'Failed to load data');
            } finally {
                setIsLoading(false);
            }
        };

        if (!isContextLoading) {
            fetchStats();
        }
    }, [currentProject, isContextLoading, timeRange]);

    // Fetch region performance data
    useEffect(() => {
        const fetchRegionData = async () => {
            if (!currentProject) return;
            try {
                setRegionLoading(true);
                const data = await getRegionPerformance(currentProject.id, timeRange === 'all' ? 'max' : timeRange);
                setRegionData(data);
            } catch (err) {
                console.error('[ApiPerformance] Region data fetch failed:', err);
            } finally {
                setRegionLoading(false);
            }
        };

        if (!isContextLoading && currentProject) {
            fetchRegionData();
        }
    }, [currentProject, isContextLoading, timeRange]);

    // Show loading while context is loading
    if (isContextLoading || isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] bg-white">
                <div className="relative">
                    <div className="w-24 h-24 border-8 border-black border-t-indigo-500 rounded-full animate-spin shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Activity className="w-8 h-8 text-black animate-pulse" />
                    </div>
                </div>
                <div className="mt-12 text-4xl font-black uppercase tracking-tighter text-black animate-bounce">
                    Analyzing Latency...
                </div>
                <div className="mt-4 text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
                    Crunching Global API Performance Data
                </div>
            </div>
        );
    }

    // Show message if no project
    if (!currentProject) {
        return (
            <div className="p-12 flex justify-center bg-white min-h-screen">
                <NeoCard className="max-w-2xl text-center border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] bg-yellow-400">
                    <div className="p-12">
                        <Terminal className="w-20 h-20 text-black mx-auto mb-6" />
                        <h3 className="text-4xl font-black uppercase tracking-tighter mb-4">No Project Selected</h3>
                        <p className="font-bold text-black uppercase text-sm tracking-widest">Select a project to view API performance metrics.</p>
                        <NeoButton className="mt-8 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" variant="primary">SELECT PROJECT</NeoButton>
                    </div>
                </NeoCard>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-12 flex justify-center bg-white min-h-screen">
                <NeoCard className="max-w-2xl text-center border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] bg-red-400">
                    <div className="p-12">
                        <Terminal className="w-20 h-20 text-black mx-auto mb-6" />
                        <h3 className="text-4xl font-black uppercase tracking-tighter mb-4">Critical Error</h3>
                        <p className="font-black font-mono text-black text-lg mb-6">{error}</p>
                        <NeoButton onClick={() => window.location.reload()} className="shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" variant="primary">RETRY CONNECTION</NeoButton>
                    </div>
                </NeoCard>
            </div>
        );
    }

    const hasData = stats && stats.allEndpoints.length > 0;

    return (
        <div className="min-h-screen bg-white p-6 md:p-12 font-sans text-black">
            <div className="max-w-[1800px] mx-auto space-y-12">

                {/* Header */}
                <div className="sticky top-0 z-50 bg-white border-b-4 border-black">
                    <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-[1800px] mx-auto w-full">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-indigo-500 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg">
                                <Activity className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                                    API Analytics
                                </h1>
                                <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                    <div className="h-3 w-1 bg-indigo-500"></div>
                                    Monitoring {stats?.allEndpoints.length || 0} endpoints
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="hidden lg:flex items-center gap-2 mr-4 bg-slate-50 border-2 border-slate-200 px-3 py-1 rounded-md">
                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                                <span className="text-[10px] font-black uppercase text-slate-400">System Healthy</span>
                            </div>
                            <TimeFilter value={timeRange} onChange={setTimeRange} />
                        </div>
                    </div>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Top 3 Slowest Endpoints */}
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-black text-black uppercase tracking-tight flex items-center gap-3">
                                <Activity className="w-6 h-6 text-indigo-500" /> Slowest Endpoints
                            </h2>
                            <NeoBadge variant="info" size="sm" className="shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] border border-black transform rotate-1">LATENCY (MS)</NeoBadge>
                        </div>
                        <NeoCard variant="monitor" className="h-[340px] border-2 border-black p-0" disablePadding>
                            <div className="h-full bg-white p-6">
                                {hasData && stats.slowestEndpoints.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart layout="vertical" data={stats.slowestEndpoints} margin={{ left: 0, right: 30, bottom: 0, top: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                            <XAxis type="number" hide />
                                            <YAxis
                                                dataKey="endpoint"
                                                type="category"
                                                tick={{ fill: '#000', fontSize: 10, fontFamily: 'monospace', fontWeight: '900' }}
                                                width={180}
                                                tickFormatter={(val) => val.length > 25 ? val.slice(0, 22) + '...' : val}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                                contentStyle={{
                                                    backgroundColor: '#fff',
                                                    border: '4px solid #000',
                                                    borderRadius: '0px',
                                                    boxShadow: '4px 4px 0px 0px rgba(0,0,0,1)',
                                                    fontFamily: 'monospace',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold',
                                                    padding: '8px 12px'
                                                }}
                                                formatter={(value) => [`${value}ms`, 'Latency']}
                                            />
                                            <Bar dataKey="avgLatencyMs" name="Latency (ms)" radius={[0, 0, 0, 0]} barSize={24} stroke="#000" strokeWidth={2}>
                                                {stats.slowestEndpoints.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.avgLatencyMs > 1000 ? '#ef4444' : entry.avgLatencyMs > 500 ? '#f59e0b' : '#6366f1'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center gap-4">
                                        <Zap className="w-12 h-12 text-slate-100" />
                                        <div className="text-sm font-black text-slate-300 uppercase tracking-widest">No Telemetry Detected</div>
                                    </div>
                                )}
                            </div>
                        </NeoCard>
                    </div>

                    {/* Top 3 Most Erroring Endpoints */}
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-black text-black uppercase tracking-tight flex items-center gap-3">
                                <Terminal className="w-6 h-6 text-red-500" /> Critical Errors
                            </h2>
                            <NeoBadge variant="danger" size="sm" className="shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] border border-black transform -rotate-1">ERROR COUNT</NeoBadge>
                        </div>
                        <NeoCard variant="monitor" className="h-[340px] border-2 border-black p-0" disablePadding>
                            <div className="h-full bg-white p-6">
                                {hasData && stats.erroringEndpoints.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart layout="vertical" data={stats.erroringEndpoints} margin={{ left: 0, right: 30, bottom: 0, top: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                            <XAxis type="number" hide />
                                            <YAxis
                                                dataKey="endpoint"
                                                type="category"
                                                tick={{ fill: '#000', fontSize: 10, fontFamily: 'monospace', fontWeight: '900' }}
                                                width={180}
                                                tickFormatter={(val) => val.length > 25 ? val.slice(0, 22) + '...' : val}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(254,242,242,1)' }}
                                                contentStyle={{
                                                    backgroundColor: '#fff',
                                                    border: '4px solid #000',
                                                    borderRadius: '0px',
                                                    boxShadow: '4px 4px 0px 0px rgba(0,0,0,1)',
                                                    fontFamily: 'monospace',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold',
                                                    padding: '8px 12px'
                                                }}
                                                formatter={(value) => [value, 'Errors']}
                                            />
                                            <Bar dataKey="totalErrors" name="Errors" radius={[0, 0, 0, 0]} barSize={24} fill="#ef4444" stroke="#000" strokeWidth={2} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center gap-4">
                                        <Terminal className="w-12 h-12 text-slate-100" />
                                        <div className="text-sm font-black text-slate-300 uppercase tracking-widest">No Errors Logged</div>
                                    </div>
                                )}
                            </div>
                        </NeoCard>
                    </div>
                </div>

                {/* Region Performance Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Fastest Regions */}
                    <div className="flex flex-col">
                        <h2 className="text-xl font-black text-black uppercase tracking-tight mb-4 flex items-center gap-3">
                            <Zap className="w-6 h-6 text-emerald-500" /> Optimal Regions
                        </h2>
                        <div className="flex-1 bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                            {regionLoading ? (
                                <div className="h-64 flex flex-col items-center justify-center gap-4 bg-slate-50">
                                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                                    <div className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Poking Nodes...</div>
                                </div>
                            ) : regionData?.fastestRegions && regionData.fastestRegions.length > 0 ? (
                                <table className="w-full text-left font-mono text-xs">
                                    <thead>
                                        <tr className="border-b-4 border-black bg-slate-50 font-black uppercase text-black">
                                            <th className="p-4 tracking-wider">Region Node</th>
                                            <th className="p-4 tracking-wider text-right">Avg Latency</th>
                                            <th className="p-4 tracking-wider text-right">Throughput</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y-2 divide-slate-100">
                                        {regionData.fastestRegions.map((region, idx) => (
                                            <tr key={region.code} className="hover:bg-emerald-50 transition-colors group">
                                                <td className="p-4 flex items-center gap-3 font-black text-black">
                                                    <Globe className="w-4 h-4 text-emerald-600 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]" />
                                                    {region.name.toUpperCase()}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <NeoBadge variant="success" size="sm" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">{region.avgLatencyMs}MS</NeoBadge>
                                                </td>
                                                <td className="p-4 text-right text-slate-500 font-bold">
                                                    {region.totalCalls.toLocaleString()} REQS
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="h-64 flex flex-col items-center justify-center gap-4">
                                    <Globe className="w-12 h-12 text-slate-100" />
                                    <div className="text-sm font-black text-slate-300 uppercase tracking-widest">No Geo Data</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Slowest Regions */}
                    <div className="flex flex-col">
                        <h2 className="text-xl font-black text-black uppercase tracking-tight mb-4 flex items-center gap-3">
                            <Map className="w-6 h-6 text-red-500" /> Bottleneck Regions
                        </h2>
                        <div className="flex-1 bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                            {regionLoading ? (
                                <div className="h-64 flex flex-col items-center justify-center gap-4 bg-slate-50">
                                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                                    <div className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Poking Nodes...</div>
                                </div>
                            ) : regionData?.slowestRegions && regionData.slowestRegions.length > 0 ? (
                                <table className="w-full text-left font-mono text-xs">
                                    <thead>
                                        <tr className="border-b-4 border-black bg-slate-50 font-black uppercase text-black">
                                            <th className="p-4 tracking-wider">Region Node</th>
                                            <th className="p-4 tracking-wider text-right">Avg Latency</th>
                                            <th className="p-4 tracking-wider text-right">Throughput</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y-2 divide-slate-100">
                                        {regionData.slowestRegions.map((region, idx) => (
                                            <tr key={region.code} className="hover:bg-red-50 transition-colors group">
                                                <td className="p-4 flex items-center gap-3 font-black text-black">
                                                    <Terminal className="w-4 h-4 text-red-600 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]" />
                                                    {region.name.toUpperCase()}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <NeoBadge variant="danger" size="sm" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">{region.avgLatencyMs}MS</NeoBadge>
                                                </td>
                                                <td className="p-4 text-right text-slate-500 font-bold">
                                                    {region.totalCalls.toLocaleString()} REQS
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="h-64 flex flex-col items-center justify-center gap-4">
                                    <Map className="w-12 h-12 text-slate-100" />
                                    <div className="text-sm font-black text-slate-300 uppercase tracking-widest">No Geo Data</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* All Endpoints Table */}
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <h2 className="text-2xl font-black text-black uppercase tracking-tighter flex items-center gap-3">
                            <Server className="w-8 h-8 text-indigo-500" /> Endpoint Inventory
                        </h2>
                        <div className="relative group w-full max-w-md">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-black z-10" />
                            <input
                                type="text"
                                placeholder="FILTER BY ENDPOINT..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-12 pr-4 py-3 bg-white border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] focus:shadow-none focus:translate-x-[4px] focus:translate-y-[4px] outline-none font-black uppercase placeholder:text-slate-300 w-full transition-all"
                            />
                        </div>
                    </div>

                    <div className="bg-white border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-slate-50 border-b-4 border-black">
                                    <tr className="font-black uppercase text-black">
                                        <th className="p-4 tracking-wider">Endpoint Path</th>
                                        <th className="p-4 tracking-wider text-right">Reqs</th>
                                        <th className="p-4 tracking-wider text-right">Latency</th>
                                        <th className="p-4 tracking-wider text-right">Errors</th>
                                        <th className="p-4 tracking-wider text-right">Fail Rate</th>
                                        <th className="p-4 tracking-wider text-right">State</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y-4 divide-slate-50">
                                    {hasData ? (
                                        stats.allEndpoints
                                            .filter(e => e.endpoint.toLowerCase().includes(searchQuery.toLowerCase()))
                                            .map((endpoint) => (
                                                <tr key={endpoint.endpoint} className="hover:bg-indigo-50/30 transition-colors group">
                                                    <td className="p-4 font-black text-black break-all uppercase tracking-tight flex items-center gap-3">
                                                        <div className="w-2 h-2 bg-indigo-500 rounded-full group-hover:scale-150 transition-transform"></div>
                                                        {endpoint.endpoint}
                                                    </td>
                                                    <td className="p-4 text-right font-black text-slate-500">
                                                        {endpoint.totalCalls.toLocaleString()}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <NeoBadge
                                                            variant={endpoint.avgLatencyMs > 1000 ? 'danger' : endpoint.avgLatencyMs > 500 ? 'warning' : 'neutral'}
                                                            className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                                        >
                                                            {endpoint.avgLatencyMs}MS
                                                        </NeoBadge>
                                                    </td>
                                                    <td className="p-4 text-right font-black text-red-500">
                                                        {endpoint.totalErrors.toLocaleString()}
                                                    </td>
                                                    <td className="p-4 text-right font-black text-slate-500">
                                                        {endpoint.errorRate}%
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        {endpoint.avgLatencyMs < 500 && endpoint.errorRate < 1 ? (
                                                            <NeoBadge variant="success" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">HEALTHY</NeoBadge>
                                                        ) : endpoint.avgLatencyMs > 1000 || endpoint.errorRate > 5 ? (
                                                            <NeoBadge variant="danger" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] animate-pulse">CRITICAL</NeoBadge>
                                                        ) : (
                                                            <NeoBadge variant="warning" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">WARNING</NeoBadge>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                    ) : (
                                        <tr>
                                            <td colSpan={6} className="p-20 text-center">
                                                <div className="flex flex-col items-center gap-4">
                                                    <Server className="w-16 h-16 text-slate-100" />
                                                    <div className="text-xl font-black text-slate-300 uppercase tracking-widest">No API Inventory Found</div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default ApiAnalytics;
