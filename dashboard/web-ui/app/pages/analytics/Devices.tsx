import React, { useState, useEffect, useMemo } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { getDeviceSummary, DeviceSummary } from '../../services/api';
import {
    Smartphone,
    Layers,
    Bug,
    Clock,
    ChevronUp,
    ChevronDown,
    Cpu,
    Hash,
    RefreshCw,
    Activity,
    Terminal
} from 'lucide-react';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoButton } from '../../components/ui/neo/NeoButton';

type SortKey = 'count' | 'crashes' | 'anrs' | 'errors';
type SortDirection = 'asc' | 'desc';

export const Devices: React.FC = () => {
    const { selectedProject } = useSessionData();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [data, setData] = useState<DeviceSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Sorting state for each section
    const [deviceSort, setDeviceSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'count', dir: 'desc' });
    const [osSort, setOsSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'count', dir: 'desc' });
    const [versionSort, setVersionSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'count', dir: 'desc' });

    useEffect(() => {
        if (!selectedProject?.id) return;
        let cancelled = false;
        setData(null); // Clear stale data from previous project
        setIsLoading(true);

        getDeviceSummary(selectedProject.id, timeRange === 'all' ? 'max' : timeRange)
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

    // Sort helper
    const sortItems = <T extends { count: number; crashes: number; anrs: number; errors: number }>(
        items: T[],
        { key, dir }: { key: SortKey; dir: SortDirection }
    ): T[] => {
        return [...items].sort((a, b) => {
            const aVal = a[key] || 0;
            const bVal = b[key] || 0;
            return dir === 'desc' ? bVal - aVal : aVal - bVal;
        });
    };

    // Sorted data
    const sortedDevices = useMemo(() => data ? sortItems(data.devices, deviceSort) : [], [data, deviceSort]);
    const sortedOsVersions = useMemo(() => data ? sortItems(data.osVersions, osSort) : [], [data, osSort]);
    const sortedAppVersions = useMemo(() => data ? sortItems(data.appVersions, versionSort) : [], [data, versionSort]);

    // Sort toggle helper
    const toggleSort = (
        current: { key: SortKey; dir: SortDirection },
        newKey: SortKey,
        setter: (s: { key: SortKey; dir: SortDirection }) => void
    ) => {
        if (current.key === newKey) {
            setter({ key: newKey, dir: current.dir === 'desc' ? 'asc' : 'desc' });
        } else {
            setter({ key: newKey, dir: 'desc' });
        }
    };

    const SortHead: React.FC<{
        label: string;
        sortKey: SortKey;
        current: { key: SortKey; dir: SortDirection };
        onToggle: (key: SortKey) => void;
        align?: 'left' | 'right' | 'center';
    }> = ({ label, sortKey, current, onToggle, align = 'right' }) => (
        <th
            className={`p-4 tracking-wider cursor-pointer hover:bg-indigo-50/50 transition-colors select-none group text-${align}`}
            onClick={() => onToggle(sortKey)}
        >
            <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
                {label}
                {current.key === sortKey ? (
                    current.dir === 'desc' ? <ChevronDown className="w-4 h-4 text-indigo-500" /> : <ChevronUp className="w-4 h-4 text-indigo-500" />
                ) : (
                    <ChevronDown className="w-4 h-4 text-slate-100 group-hover:text-slate-200 transition-colors" />
                )}
            </div>
        </th>
    );

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] bg-white">
                <div className="relative">
                    <div className="w-24 h-24 border-8 border-black border-t-indigo-500 rounded-full animate-spin shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Smartphone className="w-8 h-8 text-black animate-pulse" />
                    </div>
                </div>
                <div className="mt-12 text-4xl font-black uppercase tracking-tighter text-black animate-bounce">
                    Scanning Devices...
                </div>
                <div className="mt-4 text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
                    Aggregating Hardware & OS Telemetry
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
                            <Smartphone className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                                Device Matrix
                            </h1>
                            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                <div className="h-3 w-1 bg-indigo-500"></div>
                                Track models, OS versions, and fragmentation
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden lg:flex items-center gap-2 mr-4 bg-slate-50 border-2 border-slate-200 px-3 py-1 rounded-md">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                            <span className="text-[10px] font-black uppercase text-slate-400">Telemetry Active</span>
                        </div>
                        <TimeFilter value={timeRange} onChange={setTimeRange} />
                    </div>
                </div>
            </div>

            {/* Tables Content */}
            <div className="flex-1 p-6 md:p-12 space-y-12 max-w-[1800px] mx-auto w-full">
                {/* Device Models Table */}
                <div className="space-y-6">
                    <h2 className="text-2xl font-black text-black uppercase tracking-tighter flex items-center gap-3">
                        <Smartphone className="w-8 h-8 text-black" /> Device Inventory
                    </h2>

                    <div className="bg-white border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-slate-50 border-b-4 border-black font-black uppercase text-black">
                                    <tr>
                                        <SortHead label="Model Identifier" sortKey="count" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} align="left" />
                                        <SortHead label="Sessions" sortKey="count" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                        <SortHead label="Crashes" sortKey="crashes" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                        <SortHead label="ANRs" sortKey="anrs" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                        <SortHead label="Errors" sortKey="errors" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                    </tr>
                                </thead>
                                <tbody className="divide-y-2 divide-slate-100">
                                    {sortedDevices.slice(0, 15).map((device) => {
                                        const crashRate = device.count > 0 ? ((device.crashes / device.count) * 100).toFixed(1) : '0';
                                        return (
                                            <tr key={device.model} className="hover:bg-indigo-50/30 transition-colors group">
                                                <td className="p-4 font-black text-black uppercase tracking-tight">
                                                    {device.model}
                                                </td>
                                                <td className="p-4 text-right font-black text-slate-400">
                                                    {device.count.toLocaleString()} SESS
                                                </td>
                                                <td className="p-4 text-right">
                                                    {device.crashes > 0 ? (
                                                        <div className="flex flex-col items-end gap-1">
                                                            <NeoBadge variant="danger" size="sm" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                                {device.crashes} CRASHED
                                                            </NeoBadge>
                                                            <span className="text-[10px] font-black text-red-500">{crashRate}% IMPACT</span>
                                                        </div>
                                                    ) : <span className="opacity-20 font-black">-</span>}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {device.anrs > 0 ? (
                                                        <NeoBadge variant="anr" size="sm" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                            {device.anrs} ANRS
                                                        </NeoBadge>
                                                    ) : <span className="opacity-20 font-black">-</span>}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {device.errors > 0 ? (
                                                        <NeoBadge variant="warning" size="sm" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                            {device.errors} ERRORS
                                                        </NeoBadge>
                                                    ) : <span className="opacity-20 font-black">-</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* OS & App Versions Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* OS Versions */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-black text-black uppercase tracking-tight flex items-center gap-3">
                            <Cpu className="w-6 h-6 text-indigo-500" /> OS Distribution
                        </h2>

                        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-slate-50 border-b-4 border-black font-black uppercase text-black">
                                    <tr>
                                        <SortHead label="Release" sortKey="count" current={osSort} onToggle={(k) => toggleSort(osSort, k, setOsSort)} align="left" />
                                        <SortHead label="Sessions" sortKey="count" current={osSort} onToggle={(k) => toggleSort(osSort, k, setOsSort)} />
                                        <SortHead label="Issues" sortKey="crashes" current={osSort} onToggle={(k) => toggleSort(osSort, k, setOsSort)} />
                                    </tr>
                                </thead>
                                <tbody className="divide-y-2 divide-slate-100">
                                    {sortedOsVersions.slice(0, 10).map((os) => {
                                        const totalIssues = os.crashes + os.anrs;
                                        return (
                                            <tr key={os.version} className="hover:bg-slate-50 transition-colors group">
                                                <td className="p-4 font-black text-black uppercase">
                                                    {os.version === 'Unknown' ? 'Unknown' : `iOS ${os.version}`}
                                                </td>
                                                <td className="p-4 text-right font-black text-slate-400">
                                                    {os.count.toLocaleString()}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {totalIssues > 0 ? (
                                                        <div className="flex items-center justify-end gap-2 font-black">
                                                            {os.crashes > 0 && <NeoBadge variant="danger" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{os.crashes}</NeoBadge>}
                                                            {os.anrs > 0 && <NeoBadge variant="anr" size="sm" className="border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{os.anrs}</NeoBadge>}
                                                        </div>
                                                    ) : <span className="opacity-20 font-black">-</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* App Versions */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-black text-black uppercase tracking-tight flex items-center gap-3">
                            <Layers className="w-6 h-6 text-emerald-500" /> App Releases
                        </h2>

                        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-slate-50 border-b-4 border-black font-black uppercase text-black">
                                    <tr>
                                        <SortHead label="Version Tag" sortKey="count" current={versionSort} onToggle={(k) => toggleSort(versionSort, k, setVersionSort)} align="left" />
                                        <SortHead label="Sessions" sortKey="count" current={versionSort} onToggle={(k) => toggleSort(versionSort, k, setVersionSort)} />
                                        <SortHead label="Status" sortKey="crashes" current={versionSort} onToggle={(k) => toggleSort(versionSort, k, setVersionSort)} />
                                    </tr>
                                </thead>
                                <tbody className="divide-y-2 divide-slate-100">
                                    {sortedAppVersions.slice(0, 10).map((version) => {
                                        const crashRate = version.count > 0 ? ((version.crashes / version.count) * 100).toFixed(1) : '0.0';
                                        const hasIssues = version.crashes > 0;

                                        return (
                                            <tr key={version.version} className="hover:bg-slate-50 transition-colors group">
                                                <td className="p-4 font-black text-black uppercase">
                                                    v{version.version}
                                                </td>
                                                <td className="p-4 text-right font-black text-slate-400">
                                                    {version.count.toLocaleString()}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {hasIssues ? (
                                                        <NeoBadge variant="danger" size="sm" className="border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                            {crashRate}% IMPACT
                                                        </NeoBadge>
                                                    ) : (
                                                        <NeoBadge variant="success" size="sm" className="border border-black opacity-30 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                            STABLE
                                                        </NeoBadge>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Platform Distribution */}
                {data && Object.keys(data.platforms).length > 0 && (
                    <div className="pt-12 border-t-4 border-black">
                        <h2 className="text-2xl font-black text-black uppercase tracking-tighter mb-8 flex items-center gap-3">
                            <Hash className="w-8 h-8 text-indigo-500" /> Platform Active Node Registry
                            <div className="relative group/tooltip">
                                <div className="w-5 h-5 rounded-full border-2 border-black bg-slate-100 flex items-center justify-center text-xs font-black cursor-help">
                                    ?
                                </div>
                                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-black text-white text-xs font-bold rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                    Distribution of sessions across iOS and Android platforms
                                </div>
                            </div>
                        </h2>
                        <div className="flex gap-6 flex-wrap">
                            {Object.entries(data.platforms).map(([platform, count]) => (
                                <div key={platform} className="bg-white px-8 py-5 border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center gap-6">
                                    <span className="font-black text-black uppercase tracking-widest text-sm">{platform}</span>
                                    <div className="h-8 w-1 bg-black"></div>
                                    <span className="font-mono font-black text-indigo-500 text-xl">{count.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default Devices;
