import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Clock,
    Cpu,
    Layers,
    Smartphone,
} from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import {
    getDeviceIssueMatrix,
    getDeviceSummary,
    getObservabilityDeepMetrics,
    DeviceIssueMatrix,
    DeviceSummary,
    ObservabilityDeepMetrics,
} from '../../services/api';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';

type DeviceRiskRow = DeviceSummary['devices'][number] & {
    incidentRatePer100: number;
    impactScore: number;
    recommendation: string;
};

type OsRiskRow = DeviceSummary['osVersions'][number] & {
    incidentRatePer100: number;
    impactScore: number;
    recommendation: string;
};

type ReleaseRiskRow = DeviceSummary['appVersions'][number] & {
    failureRate: number;
    deltaVsOverall: number;
    recommendation: string;
};

type MatrixHotspot = DeviceIssueMatrix['matrix'][number] & {
    impactScore: number;
    totalIssues: number;
};

const toApiRange = (value: TimeRange): string | undefined => {
    if (value === 'all') return undefined;
    return value;
};

const formatCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString();
};

const getPlatformBarColor = (platform: string): string => {
    const key = platform.trim().toLowerCase();
    if (key === 'ios') return '#0284c7';
    if (key === 'android') return '#16a34a';
    return '#6366f1';
};

const ratePer100 = (value: number, total: number): number => {
    if (total <= 0) return 0;
    return Number(((value / total) * 100).toFixed(1));
};

const getDeviceRecommendation = (row: DeviceSummary['devices'][number]): string => {
    if (row.crashes + row.anrs >= 10) return 'Prioritize crash/ANR stabilization on this hardware cohort.';
    if (row.errors >= 20) return 'Audit API and validation reliability for this device profile.';
    if (row.rageTaps >= 40) return 'Revisit layout and interaction affordance for this screen density.';
    return 'Monitor in canary and guard against regressions.';
};

const getOsRecommendation = (row: DeviceSummary['osVersions'][number]): string => {
    if (row.crashes + row.anrs >= 10) return 'Run OS-specific stability pass and hotfix compatibility issues.';
    if (row.errors >= 15) return 'Inspect network/client errors tied to this OS release.';
    return 'Keep under watch during next release rollout.';
};

const getReleaseRecommendation = (failureRate: number, deltaVsOverall: number): string => {
    if (failureRate >= 25 || deltaVsOverall >= 5) return 'Gate further rollout and patch reliability before expansion.';
    if (failureRate >= 15 || deltaVsOverall >= 2) return 'Hold rollout pace and monitor fail cohorts closely.';
    return 'Release is healthy for broader rollout.';
};

export const Devices: React.FC = () => {
    const { selectedProject } = useSessionData();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [data, setData] = useState<DeviceSummary | null>(null);
    const [deepMetrics, setDeepMetrics] = useState<ObservabilityDeepMetrics | null>(null);
    const [matrixData, setMatrixData] = useState<DeviceIssueMatrix | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!selectedProject?.id) {
            setData(null);
            setDeepMetrics(null);
            setMatrixData(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);

        const range = toApiRange(timeRange);

        Promise.all([
            getDeviceSummary(selectedProject.id, timeRange === 'all' ? 'max' : timeRange),
            getObservabilityDeepMetrics(selectedProject.id, range),
            getDeviceIssueMatrix(selectedProject.id, timeRange === 'all' ? 'max' : timeRange),
        ])
            .then(([summary, deep, matrix]) => {
                if (cancelled) return;
                setData(summary);
                setDeepMetrics(deep);
                setMatrixData(matrix);
            })
            .catch(() => {
                if (cancelled) return;
                setData(null);
                setDeepMetrics(null);
                setMatrixData(null);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const hasData = Boolean(data && data.totalSessions > 0);

    const deviceRiskRows = useMemo<DeviceRiskRow[]>(() => {
        if (!data?.devices) return [];
        return data.devices
            .map((row) => {
                const weightedIncidents = (row.crashes * 5) + (row.anrs * 4) + (row.errors * 2) + row.rageTaps;
                const incidentRatePer100 = ratePer100(weightedIncidents, row.count);
                const impactScore = Number((incidentRatePer100 * Math.log10(row.count + 9)).toFixed(1));
                return {
                    ...row,
                    incidentRatePer100,
                    impactScore,
                    recommendation: getDeviceRecommendation(row),
                };
            })
            .sort((a, b) => b.impactScore - a.impactScore || b.count - a.count);
    }, [data]);

    const osRiskRows = useMemo<OsRiskRow[]>(() => {
        if (!data?.osVersions) return [];
        return data.osVersions
            .map((row) => {
                const weightedIncidents = (row.crashes * 5) + (row.anrs * 4) + (row.errors * 2) + row.rageTaps;
                const incidentRatePer100 = ratePer100(weightedIncidents, row.count);
                const impactScore = Number((incidentRatePer100 * Math.log10(row.count + 9)).toFixed(1));
                return {
                    ...row,
                    incidentRatePer100,
                    impactScore,
                    recommendation: getOsRecommendation(row),
                };
            })
            .sort((a, b) => b.impactScore - a.impactScore || b.count - a.count)
            .slice(0, 10);
    }, [data]);

    const releaseRiskLookup = useMemo(() => {
        const map = new Map<string, { failureRate: number; deltaVsOverall: number }>();
        for (const risk of deepMetrics?.releaseRisk || []) {
            map.set(risk.version, {
                failureRate: risk.failureRate,
                deltaVsOverall: risk.deltaVsOverall,
            });
        }
        return map;
    }, [deepMetrics]);

    const releaseRiskRows = useMemo<ReleaseRiskRow[]>(() => {
        if (!data?.appVersions) return [];
        return data.appVersions
            .map((row) => {
                const fallbackFailureRate = ratePer100((row.crashes * 5) + (row.anrs * 4) + (row.errors * 2) + row.rageTaps, row.count);
                const fromDeep = releaseRiskLookup.get(row.version);
                const failureRate = fromDeep?.failureRate ?? fallbackFailureRate;
                const deltaVsOverall = fromDeep?.deltaVsOverall ?? 0;
                return {
                    ...row,
                    failureRate,
                    deltaVsOverall,
                    recommendation: getReleaseRecommendation(failureRate, deltaVsOverall),
                };
            })
            .sort((a, b) => b.failureRate - a.failureRate || b.count - a.count)
            .slice(0, 10);
    }, [data, releaseRiskLookup]);

    const matrixHotspots = useMemo<MatrixHotspot[]>(() => {
        if (!matrixData?.matrix?.length) return [];
        return matrixData.matrix
            .filter((cell) => cell.sessions >= 20)
            .map((cell) => {
                const totalIssues = cell.issues.crashes + cell.issues.anrs + cell.issues.errors + cell.issues.rageTaps;
                const weighted = (cell.issues.crashes * 5) + (cell.issues.anrs * 4) + (cell.issues.errors * 2) + cell.issues.rageTaps;
                return {
                    ...cell,
                    totalIssues,
                    impactScore: Number((((weighted / Math.max(cell.sessions, 1)) * 100) * Math.log10(cell.sessions + 9)).toFixed(1)),
                };
            })
            .sort((a, b) => b.impactScore - a.impactScore)
            .slice(0, 8);
    }, [matrixData]);

    const topDevice = deviceRiskRows[0] || null;
    const topRelease = releaseRiskRows[0] || null;
    const topOs = osRiskRows[0] || null;

    const topThreeDeviceShare = useMemo(() => {
        if (!data?.totalSessions || !deviceRiskRows.length) return 0;
        const top3 = deviceRiskRows.slice(0, 3).reduce((acc, row) => acc + row.count, 0);
        return (top3 / data.totalSessions) * 100;
    }, [deviceRiskRows, data]);

    const compatibilityHotspotCount = useMemo(
        () => matrixHotspots.filter((cell) => cell.issueRate >= 0.02).length,
        [matrixHotspots],
    );

    const rolloutGateReleaseCount = useMemo(
        () => releaseRiskRows.filter((row) => row.failureRate >= 15 || row.deltaVsOverall >= 2).length,
        [releaseRiskRows],
    );

    const dominantPlatform = useMemo(() => {
        if (!data?.platforms || !data.totalSessions) return null;
        const entries = Object.entries(data.platforms);
        if (!entries.length) return null;
        const [platform, count] = entries.sort((a, b) => b[1] - a[1])[0];
        return {
            platform,
            count,
            share: (count / data.totalSessions) * 100,
        };
    }, [data]);

    const highRiskDeviceCohorts = useMemo(
        () => deviceRiskRows.filter((row) => row.incidentRatePer100 >= 12).length,
        [deviceRiskRows],
    );

    if (isLoading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                    <div className="flex items-center gap-3">
                        <Activity className="h-4 w-4 animate-pulse text-blue-600" />
                        Building device reliability intelligence...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <div className="sticky top-0 z-30 bg-white">
                <DashboardPageHeader
                    title="Device Reliability Intelligence"
                    subtitle="Identify high-risk device cohorts, releases, and compatibility hotspots"
                    icon={<Smartphone className="w-6 h-6" />}
                    iconColor="bg-indigo-500"
                >
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </DashboardPageHeader>
            </div>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-6 py-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to load device analytics.
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                        No device telemetry available for this range.
                    </div>
                )}

                {hasData && data && (
                    <>
                        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Device Fragmentation
                                    <Layers className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{topThreeDeviceShare.toFixed(1)}%</div>
                                <p className="mt-1 text-sm text-slate-600">
                                    Top 3 devices | {data.devices.length.toLocaleString()} models and {data.osVersions.length.toLocaleString()} OS versions in range.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Platform Concentration
                                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{dominantPlatform ? `${dominantPlatform.share.toFixed(1)}%` : 'N/A'}</div>
                                <p className="mt-1 text-sm text-slate-600">
                                    {dominantPlatform
                                        ? `${dominantPlatform.platform.toUpperCase()} carries ${formatCompact(dominantPlatform.count)} sessions`
                                        : 'No platform distribution data available.'}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Compatibility Hotspots
                                    <Cpu className="h-4 w-4 text-amber-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{compatibilityHotspotCount.toLocaleString()}</div>
                                <p className="mt-1 text-sm text-slate-600">
                                    {matrixHotspots[0]
                                        ? `${matrixHotspots[0].device} x v${matrixHotspots[0].version} leads at ${(matrixHotspots[0].issueRate * 100).toFixed(1)}% issue rate`
                                        : 'No matrix hotspot data available.'}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Release Gate Candidates
                                    <Activity className="h-4 w-4 text-indigo-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{rolloutGateReleaseCount.toLocaleString()}</div>
                                <p className="mt-1 text-sm text-slate-600">
                                    {topRelease ? `Current highest risk: v${topRelease.version} at ${topRelease.failureRate.toFixed(1)}% failures` : 'No release risk data available.'}
                                </p>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Device Risk Leaderboard</h2>
                                    <Smartphone className="h-5 w-5 text-indigo-600" />
                                </div>
                                <p className="mb-4 text-sm text-slate-600">
                                    Ranked by weighted incident intensity and traffic impact. Use this list to prioritize device-specific fixes.
                                </p>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[960px] text-left text-sm">
                                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="pb-2 pr-4">Device Model</th>
                                                <th className="pb-2 pr-4 text-right">Sessions</th>
                                                <th className="pb-2 pr-4 text-right">Crash</th>
                                                <th className="pb-2 pr-4 text-right">ANR</th>
                                                <th className="pb-2 pr-4 text-right">Errors</th>
                                                <th className="pb-2 pr-4 text-right">Rage</th>
                                                <th className="pb-2 pr-4 text-right">Incident /100</th>
                                                <th className="pb-2 pr-4 text-right">Impact</th>
                                                <th className="pb-2 pr-4">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {deviceRiskRows.slice(0, 12).map((row) => (
                                                <tr key={row.model} className="hover:bg-slate-50">
                                                    <td className="py-3 pr-4 font-medium text-slate-900">{row.model}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(row.count)}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{row.crashes}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{row.anrs}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{row.errors}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{row.rageTaps}</td>
                                                    <td className={`py-3 pr-4 text-right font-semibold ${row.incidentRatePer100 >= 18 ? 'text-rose-700' : row.incidentRatePer100 >= 10 ? 'text-amber-700' : 'text-slate-700'}`}>
                                                        {row.incidentRatePer100.toFixed(1)}
                                                    </td>
                                                    <td className="py-3 pr-4 text-right font-semibold text-slate-700">{row.impactScore.toFixed(1)}</td>
                                                    <td className="py-3 pr-4 text-xs text-slate-600">{row.recommendation}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Coverage Snapshot</h2>
                                    <Layers className="h-5 w-5 text-indigo-600" />
                                </div>

                                <div className="rounded-xl border border-slate-200 p-3">
                                    <div className="text-xs uppercase tracking-wide text-slate-500">Coverage profile</div>
                                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                                        <div className="flex items-center justify-between">
                                            <span>Total sessions</span>
                                            <span className="font-semibold">{formatCompact(data.totalSessions)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>Dominant platform</span>
                                            <span className="font-semibold">
                                                {dominantPlatform ? `${dominantPlatform.platform.toUpperCase()} (${dominantPlatform.share.toFixed(1)}%)` : 'N/A'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>High-risk cohorts</span>
                                            <span className="font-semibold">{highRiskDeviceCohorts.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 p-3">
                                    <div className="text-xs uppercase tracking-wide text-slate-500">Most volatile OS cohort</div>
                                    {topOs ? (
                                        <div className="mt-2 space-y-1 text-sm text-slate-700">
                                            <div className="flex items-center justify-between">
                                                <span className="font-medium text-slate-900">{topOs.version}</span>
                                                <span className="font-semibold text-rose-700">{topOs.incidentRatePer100.toFixed(1)} /100</span>
                                            </div>
                                            <p className="text-xs text-slate-600">{topOs.recommendation}</p>
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-sm text-slate-500">No OS-level cohort risk in this range.</p>
                                    )}
                                </div>

                                <div className="rounded-xl border border-slate-200 p-3">
                                    <div className="text-xs uppercase tracking-wide text-slate-500">Highest-risk device model</div>
                                    {topDevice ? (
                                        <div className="mt-2 space-y-1 text-sm text-slate-700">
                                            <div className="font-medium text-slate-900">{topDevice.model}</div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span>{formatCompact(topDevice.count)} sessions</span>
                                                <span className="font-semibold text-amber-700">
                                                    {topDevice.incidentRatePer100.toFixed(1)} incidents /100
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-sm text-slate-500">No device risk data available in this range.</p>
                                    )}
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Release Reliability Ranking</h2>
                                    <Layers className="h-5 w-5 text-indigo-600" />
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[720px] text-left text-sm">
                                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="pb-2 pr-4">Version</th>
                                                <th className="pb-2 pr-4 text-right">Sessions</th>
                                                <th className="pb-2 pr-4 text-right">Failure Rate</th>
                                                <th className="pb-2 pr-4 text-right">Delta vs Overall</th>
                                                <th className="pb-2 pr-4">Rollout Guidance</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {releaseRiskRows.map((row) => (
                                                <tr key={row.version} className="hover:bg-slate-50">
                                                    <td className="py-3 pr-4 font-medium text-slate-900">v{row.version}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(row.count)}</td>
                                                    <td className={`py-3 pr-4 text-right font-semibold ${row.failureRate >= 25 ? 'text-rose-700' : row.failureRate >= 15 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                        {row.failureRate.toFixed(1)}%
                                                    </td>
                                                    <td className={`py-3 pr-4 text-right font-semibold ${row.deltaVsOverall >= 2 ? 'text-rose-700' : row.deltaVsOverall > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                        {row.deltaVsOverall >= 0 ? '+' : ''}{row.deltaVsOverall.toFixed(1)} pts
                                                    </td>
                                                    <td className="py-3 pr-4 text-xs text-slate-600">{row.recommendation}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">OS Cohort Risk</h2>
                                    <Cpu className="h-5 w-5 text-amber-600" />
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[640px] text-left text-sm">
                                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="pb-2 pr-4">OS Version</th>
                                                <th className="pb-2 pr-4 text-right">Sessions</th>
                                                <th className="pb-2 pr-4 text-right">Incident /100</th>
                                                <th className="pb-2 pr-4 text-right">Impact</th>
                                                <th className="pb-2 pr-4">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {osRiskRows.map((row) => (
                                                <tr key={row.version} className="hover:bg-slate-50">
                                                    <td className="py-3 pr-4 font-medium text-slate-900">{row.version}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(row.count)}</td>
                                                    <td className={`py-3 pr-4 text-right font-semibold ${row.incidentRatePer100 >= 18 ? 'text-rose-700' : row.incidentRatePer100 >= 10 ? 'text-amber-700' : 'text-slate-700'}`}>
                                                        {row.incidentRatePer100.toFixed(1)}
                                                    </td>
                                                    <td className="py-3 pr-4 text-right font-semibold text-slate-700">{row.impactScore.toFixed(1)}</td>
                                                    <td className="py-3 pr-4 text-xs text-slate-600">{row.recommendation}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Platform Mix</h2>
                                    <Smartphone className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="space-y-3">
                                    {Object.entries(data.platforms).map(([platform, count]) => (
                                        <div key={platform} className="rounded-xl border border-slate-200 p-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-sm font-medium uppercase text-slate-900">
                                                    <span
                                                        className="h-2.5 w-2.5 rounded-full"
                                                        style={{ backgroundColor: getPlatformBarColor(platform) }}
                                                    />
                                                    {platform}
                                                </div>
                                                <div className="text-sm font-semibold text-slate-900">{formatCompact(count)}</div>
                                            </div>
                                            <div className="mt-2 h-2 rounded-full bg-slate-200">
                                                <div
                                                    className="h-2 rounded-full"
                                                    style={{
                                                        backgroundColor: getPlatformBarColor(platform),
                                                        width: `${Math.min(100, (count / Math.max(data.totalSessions, 1)) * 100)}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Network Reliability by Device Context</h2>
                                    <Clock className="h-5 w-5 text-indigo-600" />
                                </div>
                                {(deepMetrics?.networkBreakdown?.length || 0) > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[760px] text-left text-sm">
                                            <thead className="text-xs uppercase tracking-wide text-slate-500">
                                                <tr>
                                                    <th className="pb-2 pr-4">Network</th>
                                                    <th className="pb-2 pr-4 text-right">Sessions</th>
                                                    <th className="pb-2 pr-4 text-right">API Calls</th>
                                                    <th className="pb-2 pr-4 text-right">Fail Rate</th>
                                                    <th className="pb-2 pr-4 text-right">Latency</th>
                                                    <th className="pb-2 pr-4 text-center">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {deepMetrics?.networkBreakdown?.slice(0, 8).map((network) => {
                                                    const critical = network.apiErrorRate > 3 || network.avgLatencyMs > 800;
                                                    const watch = !critical && (network.apiErrorRate > 1.5 || network.avgLatencyMs > 450);
                                                    return (
                                                        <tr key={network.networkType} className="hover:bg-slate-50">
                                                            <td className="py-3 pr-4 font-medium text-slate-900">{network.networkType.toUpperCase()}</td>
                                                            <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(network.sessions)}</td>
                                                            <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(network.apiCalls)}</td>
                                                            <td className={`py-3 pr-4 text-right font-semibold ${network.apiErrorRate > 3 ? 'text-rose-700' : network.apiErrorRate > 1.5 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                                {network.apiErrorRate.toFixed(2)}%
                                                            </td>
                                                            <td className={`py-3 pr-4 text-right font-semibold ${network.avgLatencyMs > 800 ? 'text-rose-700' : network.avgLatencyMs > 450 ? 'text-amber-700' : 'text-slate-700'}`}>
                                                                {network.avgLatencyMs} ms
                                                            </td>
                                                            <td className="py-3 pr-4 text-center">
                                                                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${critical ? 'bg-rose-100 text-rose-700' : watch ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                                    {critical ? 'critical' : watch ? 'watch' : 'healthy'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">No network quality metrics available in this range.</p>
                                )}
                            </div>
                        </section>

                        {matrixHotspots.length > 0 && (
                            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Device-Version Compatibility Hotspots</h2>
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[860px] text-left text-sm">
                                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="pb-2 pr-4">Device</th>
                                                <th className="pb-2 pr-4">Version</th>
                                                <th className="pb-2 pr-4 text-right">Sessions</th>
                                                <th className="pb-2 pr-4 text-right">Issue Rate</th>
                                                <th className="pb-2 pr-4 text-right">Total Issues</th>
                                                <th className="pb-2 pr-4 text-right">Impact</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {matrixHotspots.map((cell) => (
                                                <tr key={`${cell.device}-${cell.version}`} className="hover:bg-slate-50">
                                                    <td className="py-3 pr-4 font-medium text-slate-900">{cell.device}</td>
                                                    <td className="py-3 pr-4 text-slate-700">v{cell.version}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(cell.sessions)}</td>
                                                    <td className={`py-3 pr-4 text-right font-semibold ${cell.issueRate >= 0.05 ? 'text-rose-700' : cell.issueRate >= 0.02 ? 'text-amber-700' : 'text-slate-700'}`}>
                                                        {(cell.issueRate * 100).toFixed(1)}%
                                                    </td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(cell.totalIssues)}</td>
                                                    <td className="py-3 pr-4 text-right font-semibold text-slate-700">{cell.impactScore.toFixed(1)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default Devices;
