import React, { useState, useEffect, useMemo } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { getDeviceSummary, getObservabilityDeepMetrics, getDeviceIssueMatrix, DeviceSummary, ObservabilityDeepMetrics, DeviceIssueMatrix } from '../../services/api';
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
    Terminal,
    LayoutGrid
} from 'lucide-react';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoButton } from '../../components/ui/neo/NeoButton';

type SortKey = 'count' | 'crashes' | 'anrs' | 'errors' | 'rageTaps';
type SortDirection = 'asc' | 'desc';

export const Devices: React.FC = () => {
    const { selectedProject } = useSessionData();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [data, setData] = useState<DeviceSummary | null>(null);
    const [deepMetrics, setDeepMetrics] = useState<ObservabilityDeepMetrics | null>(null);
    const [matrixData, setMatrixData] = useState<DeviceIssueMatrix | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Sorting state for each section
    const [deviceSort, setDeviceSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'count', dir: 'desc' });
    const [osSort, setOsSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'count', dir: 'desc' });
    const [versionSort, setVersionSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'count', dir: 'desc' });

    const observabilityRange = timeRange === 'all' ? undefined : timeRange;

    useEffect(() => {
        if (!selectedProject?.id) {
            setData(null);
            setDeepMetrics(null);
            setIsLoading(false);
            return;
        }
        let cancelled = false;
        setData(null); // Clear stale data from previous project
        setDeepMetrics(null);
        setIsLoading(true);

        Promise.all([
            getDeviceSummary(selectedProject.id, timeRange === 'all' ? 'max' : timeRange),
            getObservabilityDeepMetrics(selectedProject.id, observabilityRange),
            getDeviceIssueMatrix(selectedProject.id, timeRange === 'all' ? 'max' : timeRange),
        ])
            .then(([result, deep, matrix]) => {
                if (!cancelled) {
                    setData(result);
                    setDeepMetrics(deep);
                    setMatrixData(matrix);
                    setIsLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setData(null);
                    setDeepMetrics(null);
                    setMatrixData(null);
                    setIsLoading(false);
                }
            });

        return () => { cancelled = true; };
    }, [timeRange, selectedProject?.id, observabilityRange]);

    // Sort helper
    const sortItems = <T extends { count: number; crashes: number; anrs: number; errors: number; rageTaps?: number }>(
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
    const networkRows = useMemo(() => deepMetrics?.networkBreakdown?.slice(0, 8) || [], [deepMetrics]);

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
                    <div className="w-20 h-20 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin shadow-sm"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Smartphone className="w-7 h-7 text-indigo-500 animate-pulse" />
                    </div>
                </div>
                <div className="mt-8 text-2xl font-bold tracking-tight text-slate-900 animate-pulse">
                    Scanning Devices...
                </div>
                <div className="mt-2 text-xs font-medium text-slate-500 uppercase tracking-widest">
                    Aggregating Hardware & OS Telemetry
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-black">
            <div className="sticky top-0 z-50 bg-white">
                <DashboardPageHeader
                    title="Device Matrix"
                    subtitle="Track models, versions, and fragmentation"
                    icon={<Smartphone className="w-6 h-6" />}
                    iconColor="bg-indigo-500"
                >
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </DashboardPageHeader>
            </div>

            {/* Tables Content */}
            <div className="flex-1 p-6 md:p-12 space-y-12 max-w-[1800px] mx-auto w-full">
                {/* Device Models Table */}
                <div className="space-y-4">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                        <Smartphone className="w-6 h-6 text-indigo-500" /> Device Inventory
                    </h2>

                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-slate-500 text-[10px] tracking-wider">
                                    <tr>
                                        <SortHead label="Model Identifier" sortKey="count" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} align="left" />
                                        <SortHead label="Sessions" sortKey="count" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                        <SortHead label="Crashes" sortKey="crashes" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                        <SortHead label="ANRs" sortKey="anrs" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                        <SortHead label="Errors" sortKey="errors" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                        <SortHead label="Rage Taps" sortKey="rageTaps" current={deviceSort} onToggle={(k) => toggleSort(deviceSort, k, setDeviceSort)} />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sortedDevices.slice(0, 15).map((device) => {
                                        const crashRate = device.count > 0 ? ((device.crashes / device.count) * 100).toFixed(1) : '0';
                                        return (
                                            <tr key={device.model} className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="p-4 font-bold text-slate-900">
                                                    {device.model}
                                                </td>
                                                <td className="p-4 text-right font-medium text-slate-500">
                                                    {device.count.toLocaleString()}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {device.crashes > 0 ? (
                                                        <div className="flex flex-col items-end gap-0.5">
                                                            <NeoBadge variant="danger" size="sm">
                                                                {device.crashes}
                                                            </NeoBadge>
                                                            <span className="text-[10px] font-bold text-red-500">{crashRate}%</span>
                                                        </div>
                                                    ) : <span className="opacity-20 font-medium">-</span>}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {device.anrs > 0 ? (
                                                        <NeoBadge variant="anr" size="sm">
                                                            {device.anrs}
                                                        </NeoBadge>
                                                    ) : <span className="opacity-20 font-medium">-</span>}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {device.errors > 0 ? (
                                                        <NeoBadge variant="warning" size="sm">
                                                            {device.errors}
                                                        </NeoBadge>
                                                    ) : <span className="opacity-20 font-medium">-</span>}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {device.rageTaps > 0 ? (
                                                        <NeoBadge variant="neutral" size="sm">
                                                            {device.rageTaps}
                                                        </NeoBadge>
                                                    ) : <span className="opacity-20 font-medium">-</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Device Impact Matrix */}
                {matrixData && matrixData.versions.length > 0 && (
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            <LayoutGrid className="w-6 h-6 text-indigo-500" /> Device Impact Matrix
                        </h2>
                        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden p-1">
                            <div className="overflow-x-auto">
                                <table className="w-full text-center text-xs border-collapse">
                                    <thead>
                                        <tr>
                                            <th className="p-3 text-left font-bold text-slate-500 bg-slate-50 sticky left-0 z-10 border-b border-r border-slate-200 min-w-[150px]">
                                                Device \ Version
                                            </th>
                                            {matrixData.versions.map((ver) => (
                                                <th key={ver} className="p-3 font-bold text-slate-700 bg-slate-50 border-b border-slate-200 min-w-[80px]">
                                                    v{ver}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {matrixData.devices.map((deviceModel) => (
                                            <tr key={deviceModel} className="hover:bg-slate-50">
                                                <td className="p-3 text-left font-semibold text-slate-900 bg-slate-50 sticky left-0 z-10 border-r border-slate-200">
                                                    {deviceModel}
                                                </td>
                                                {matrixData.versions.map((ver) => {
                                                    const cell = matrixData.matrix.find(m => m.device === deviceModel && m.version === ver);
                                                    if (!cell) {
                                                        return <td key={ver} className="p-3 text-slate-300">-</td>;
                                                    }

                                                    // Determine color based on issue rate
                                                    let bgColor = 'bg-slate-50 text-slate-400';
                                                    if (cell.issueRate > 0.05) bgColor = 'bg-rose-500 text-white font-bold';
                                                    else if (cell.issueRate > 0.02) bgColor = 'bg-orange-400 text-white font-bold';
                                                    else if (cell.issueRate > 0.01) bgColor = 'bg-amber-300 text-amber-900 font-semibold';
                                                    else if (cell.issueRate > 0) bgColor = 'bg-emerald-100 text-emerald-700';
                                                    else if (cell.sessions > 0) bgColor = 'bg-slate-100 text-slate-500';

                                                    return (
                                                        <td key={ver} className="p-0 border border-slate-100">
                                                            <div className={`w-full h-full p-3 flex flex-col items-center justify-center ${bgColor}`} title={`${cell.sessions} sessions, ${(cell.issueRate * 100).toFixed(1)}% issues`}>
                                                                <span>{(cell.issueRate * 100).toFixed(1)}%</span>
                                                            </div>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}


                {/* OS & App Versions Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* OS Versions */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            <Cpu className="w-6 h-6 text-indigo-500" /> OS Distribution
                        </h2>

                        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-slate-500 text-[10px] tracking-wider">
                                    <tr>
                                        <SortHead label="Release" sortKey="count" current={osSort} onToggle={(k) => toggleSort(osSort, k, setOsSort)} align="left" />
                                        <SortHead label="Sessions" sortKey="count" current={osSort} onToggle={(k) => toggleSort(osSort, k, setOsSort)} />
                                        <SortHead label="Issues" sortKey="crashes" current={osSort} onToggle={(k) => toggleSort(osSort, k, setOsSort)} />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sortedOsVersions.slice(0, 10).map((os) => {
                                        const totalIssues = os.crashes + os.anrs;
                                        return (
                                            <tr key={os.version} className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="p-4 font-bold text-slate-900">
                                                    {os.version === 'Unknown' ? 'Unknown' : `iOS ${os.version}`}
                                                </td>
                                                <td className="p-4 text-right font-medium text-slate-500">
                                                    {os.count.toLocaleString()}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {totalIssues > 0 ? (
                                                        <div className="flex items-center justify-end gap-2">
                                                            {os.crashes > 0 && <NeoBadge variant="danger" size="sm">{os.crashes}</NeoBadge>}
                                                            {os.anrs > 0 && <NeoBadge variant="anr" size="sm">{os.anrs}</NeoBadge>}
                                                        </div>
                                                    ) : <span className="opacity-20 font-medium">-</span>}
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
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            <Layers className="w-6 h-6 text-emerald-500" /> App Releases
                        </h2>

                        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-slate-500 text-[10px] tracking-wider">
                                    <tr>
                                        <SortHead label="Version Tag" sortKey="count" current={versionSort} onToggle={(k) => toggleSort(versionSort, k, setVersionSort)} align="left" />
                                        <SortHead label="Sessions" sortKey="count" current={versionSort} onToggle={(k) => toggleSort(versionSort, k, setVersionSort)} />
                                        <SortHead label="Status" sortKey="crashes" current={versionSort} onToggle={(k) => toggleSort(versionSort, k, setVersionSort)} />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sortedAppVersions.slice(0, 10).map((version) => {
                                        const crashRate = version.count > 0 ? ((version.crashes / version.count) * 100).toFixed(1) : '0.0';
                                        const hasIssues = version.crashes > 0;

                                        return (
                                            <tr key={version.version} className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="p-4 font-bold text-slate-900">
                                                    v{version.version}
                                                </td>
                                                <td className="p-4 text-right font-medium text-slate-500">
                                                    {version.count.toLocaleString()}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {hasIssues ? (
                                                        <NeoBadge variant="danger" size="sm">
                                                            {crashRate}%
                                                        </NeoBadge>
                                                    ) : (
                                                        <NeoBadge variant="success" size="sm" className="opacity-50">
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
                    <div className="pt-12 border-t border-slate-200">
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-8 flex items-center gap-2">
                            <Hash className="w-6 h-6 text-indigo-500" /> Platform Distribution
                            <div className="relative group/tooltip">
                                <div className="w-4 h-4 rounded-full border border-slate-300 bg-white flex items-center justify-center text-[10px] font-bold cursor-help text-slate-400">
                                    ?
                                </div>
                                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-slate-900 text-white text-[10px] font-medium rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                                    Distribution of sessions across iOS and Android platforms
                                </div>
                            </div>
                        </h2>
                        <div className="flex gap-4 flex-wrap">
                            {Object.entries(data.platforms).map(([platform, count]) => (
                                <div key={platform} className="bg-white px-6 py-3 border border-slate-200 rounded-xl shadow-sm flex items-center gap-4">
                                    <span className="font-bold text-slate-500 uppercase tracking-wider text-xs">{platform}</span>
                                    <div className="h-6 w-px bg-slate-200"></div>
                                    <span className="font-bold text-indigo-600 text-lg">{count.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Network Quality moved from Growth */}
                {networkRows.length > 0 && (
                    <div className="pt-12 border-t border-slate-200 space-y-4">
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            <Activity className="w-6 h-6 text-indigo-500" /> Network Quality
                        </h2>

                        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 border-b border-slate-200 font-bold uppercase text-slate-500 text-[10px] tracking-wider">
                                        <tr>
                                            <th className="p-4 tracking-wider">Network</th>
                                            <th className="p-4 tracking-wider text-right">Sessions</th>
                                            <th className="p-4 tracking-wider text-right">API Calls</th>
                                            <th className="p-4 tracking-wider text-right">Fail Rate</th>
                                            <th className="p-4 tracking-wider text-right">Latency</th>
                                            <th className="p-4 tracking-wider text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {networkRows.map((network) => {
                                            const isCritical = network.apiErrorRate > 3 || network.avgLatencyMs > 800;
                                            const isWarning = !isCritical && (network.apiErrorRate > 1.5 || network.avgLatencyMs > 450);
                                            return (
                                                <tr key={network.networkType} className="hover:bg-slate-50/50 transition-colors group">
                                                    <td className="p-4 font-bold text-slate-900">
                                                        {network.networkType}
                                                    </td>
                                                    <td className="p-4 text-right font-medium text-slate-500">
                                                        {network.sessions.toLocaleString()}
                                                    </td>
                                                    <td className="p-4 text-right font-medium text-slate-500">
                                                        {network.apiCalls.toLocaleString()}
                                                    </td>
                                                    <td className="p-4 text-right font-medium text-slate-500">
                                                        {network.apiErrorRate.toFixed(1)}%
                                                    </td>
                                                    <td className="p-4 text-right font-medium text-slate-500">
                                                        {network.avgLatencyMs}ms
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        {isCritical ? (
                                                            <NeoBadge variant="danger" size="sm">CRITICAL</NeoBadge>
                                                        ) : isWarning ? (
                                                            <NeoBadge variant="warning" size="sm">WATCH</NeoBadge>
                                                        ) : (
                                                            <NeoBadge variant="success" size="sm">HEALTHY</NeoBadge>
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
                )}

            </div>
        </div>
    );
};

export default Devices;
