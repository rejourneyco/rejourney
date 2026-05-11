import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    Bug,
    Clock,
    Cpu,
    Flame,
    Gauge,
    Layers,
    ListChecks,
    Smartphone,
    Timer,
    TrendingDown,
    TrendingUp,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import {
    getDevicesOverview,
    DeviceIssueMatrix,
    DeviceSummary,
} from '~/shared/api/client';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '~/shared/ui/core/TimeFilter';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { formatDeviceModel } from '~/shared/lib/deviceModelNames';

type DeviceBaseRow = DeviceSummary['devices'][number];
type CohortBaseRow = DeviceSummary['osVersions'][number] | DeviceSummary['appVersions'][number];

type DeviceMetricRow = DeviceBaseRow & {
    displayName: string;
    sessionShare: number;
    avgDurationSeconds: number;
    avgInteractionScore: number;
    avgExplorationScore: number;
    avgUxScore: number;
    engagedSessions: number;
    engagementRate: number;
    engagementScore: number;
    totalEvents: number;
    eventsPerSession: number;
    issueTotal: number;
    criticalTotal: number;
    issueRatePer100: number;
    criticalRatePer100: number;
    frictionScore: number;
};

type CohortMetricRow = CohortBaseRow & {
    issueTotal: number;
    issueRatePer100: number;
    criticalTotal: number;
    criticalRatePer100: number;
    frictionScore: number;
};

type MatrixHotspot = DeviceIssueMatrix['matrix'][number] & {
    displayName: string;
    issueTotal: number;
    criticalTotal: number;
    issueRatePer100: number;
    frictionScore: number;
};

type SummaryCardProps = {
    label: string;
    value: string;
    detail: string;
    icon: LucideIcon;
    accentClassName: string;
};

type RankingCardProps = {
    title: string;
    subtitle: string;
    icon: LucideIcon;
    rows: DeviceMetricRow[];
    emptyText: string;
    metricLabel: string;
    getMetric: (row: DeviceMetricRow) => string;
    getDetail: (row: DeviceMetricRow) => string;
    accentClassName: string;
    tone?: 'good' | 'bad' | 'neutral';
};

const RETRO_CARD_ACCENTS = ['bg-[#67e8f9]', 'bg-[#86efac]', 'bg-[#f9a8d4]', 'bg-[#fef08a]'];

const formatCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return Math.round(value).toLocaleString();
};

const formatPercent = (value: number, digits = 1): string => {
    if (!Number.isFinite(value)) return '0%';
    return `${value.toFixed(digits)}%`;
};

const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
    const rounded = Math.round(seconds);
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    if (minutes <= 0) return `${remainder}s`;
    if (minutes < 60) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const hourMinutes = minutes % 60;
    return hourMinutes > 0 ? `${hours}h ${hourMinutes}m` : `${hours}h`;
};

const ratePer100 = (value: number, total: number): number => {
    if (total <= 0) return 0;
    return Number(((value / total) * 100).toFixed(1));
};

const getPlatformColor = (platform: string): string => {
    const normalized = platform.trim().toLowerCase();
    if (normalized === 'ios') return '#0284c7';
    if (normalized === 'android') return '#16a34a';
    return '#7c3aed';
};

const isValidDeviceLabel = (value: string | null | undefined): boolean => {
    const normalized = (value || '').trim().toLowerCase();
    return Boolean(normalized) && normalized !== 'unknown' && normalized !== 'unknown device' && normalized !== 'n/a';
};

const safeScore = (value: number | undefined): number => {
    return Number.isFinite(value) ? Number(value) : 0;
};

const getIssueToneClass = (value: number): string => {
    if (value >= 10) return 'text-rose-700';
    if (value >= 4) return 'text-amber-700';
    return 'text-slate-700';
};

const getMetricToneClass = (tone: RankingCardProps['tone']): string => {
    if (tone === 'good') return 'text-emerald-700';
    if (tone === 'bad') return 'text-rose-700';
    return 'text-black';
};

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, detail, icon: Icon, accentClassName }) => (
    <div className="dashboard-keep-neo min-w-0 border-2 border-black bg-white p-4 shadow-neo transition-all hover:-translate-y-1 hover:shadow-neo-lg">
        <div className={`mb-3 h-2 border-2 border-black ${accentClassName}`} />
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="break-words text-[10px] font-black uppercase text-slate-700">{label}</div>
                <div className="mt-2 break-words text-2xl font-black leading-none text-black sm:text-3xl">{value}</div>
            </div>
            <div className="shrink-0 border-2 border-black bg-[#f8fafc] p-2 shadow-neo-sm">
                <Icon className="h-5 w-5 text-black" />
            </div>
        </div>
        <div className="mt-3 border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase text-slate-700 shadow-neo-sm">
            {detail}
        </div>
    </div>
);

const Panel: React.FC<{
    title: string;
    subtitle?: string;
    icon: LucideIcon;
    children: React.ReactNode;
    className?: string;
}> = ({ title, subtitle, icon: Icon, children, className = '' }) => (
    <section className={`dashboard-surface overflow-hidden p-0 ${className}`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
            <div className="min-w-0">
                <h2 className="text-sm font-black uppercase tracking-wide text-black">{title}</h2>
                {subtitle && <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{subtitle}</p>}
            </div>
            <Icon className="h-5 w-5 shrink-0 text-slate-700" />
        </div>
        <div className="p-5">{children}</div>
    </section>
);

const RankingCard: React.FC<RankingCardProps> = ({
    title,
    subtitle,
    icon: Icon,
    rows,
    emptyText,
    metricLabel,
    getMetric,
    getDetail,
    accentClassName,
    tone = 'neutral',
}) => (
    <Panel title={title} subtitle={subtitle} icon={Icon}>
        <div className={`mb-4 h-1.5 rounded-full ${accentClassName}`} />
        <div className="space-y-2">
            {rows.length > 0 ? rows.slice(0, 6).map((row, index) => (
                <div key={`${title}-${row.model}`} className="flex items-center gap-3 border border-slate-200 bg-white px-3 py-3 shadow-sm">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-slate-100 text-xs font-black text-slate-600">
                        {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-slate-900" title={row.model}>{row.displayName}</div>
                        <div className="mt-1 text-[11px] font-semibold uppercase text-slate-500">{getDetail(row)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                        <div className={`text-lg font-black ${getMetricToneClass(tone)}`}>{getMetric(row)}</div>
                        <div className="text-[10px] font-black uppercase text-slate-400">{metricLabel}</div>
                    </div>
                </div>
            )) : (
                <div className="border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-semibold text-slate-500">{emptyText}</div>
            )}
        </div>
    </Panel>
);

const TechnicalMetricCard: React.FC<{
    label: string;
    row: DeviceMetricRow | null;
    value: string;
    icon: LucideIcon;
    accentClassName: string;
}> = ({ label, row, value, icon: Icon, accentClassName }) => (
    <div className="border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-2 truncate text-base font-black text-black" title={row?.model || ''}>
                    {row ? row.displayName : 'No data'}
                </div>
            </div>
            <div className={`shrink-0 p-2 ${accentClassName}`}>
                <Icon className="h-4 w-4 text-black" />
            </div>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-2xl font-black text-black">{value}</div>
            <div className="text-right text-[11px] font-semibold uppercase leading-4 text-slate-500">
                {row ? `${formatCompact(row.count)} sessions` : 'No sessions'}
            </div>
        </div>
    </div>
);

const DeviceTable: React.FC<{ rows: DeviceMetricRow[] }> = ({ rows }) => (
    <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                <tr>
                    <th className="pb-3 pr-4">Device</th>
                    <th className="pb-3 pr-4 text-right">Sessions</th>
                    <th className="pb-3 pr-4 text-right">Engaged</th>
                    <th className="pb-3 pr-4 text-right">Avg Duration</th>
                    <th className="pb-3 pr-4 text-right">Events / Session</th>
                    <th className="pb-3 pr-4 text-right">Crashes</th>
                    <th className="pb-3 pr-4 text-right">ANRs</th>
                    <th className="pb-3 pr-4 text-right">Errors</th>
                    <th className="pb-3 pr-4 text-right">Rage Taps</th>
                    <th className="pb-3 pr-4 text-right">Friction /100</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 14).map((row) => (
                    <tr key={row.model} className="hover:bg-[#f8fafc]">
                        <td className="py-3 pr-4 font-black text-slate-900" title={row.model}>{row.displayName}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(row.count)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatPercent(row.engagementRate)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatDuration(row.avgDurationSeconds)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{row.eventsPerSession.toFixed(1)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(row.crashes)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(row.anrs)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(row.errors)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(row.rageTaps)}</td>
                        <td className={`py-3 pr-4 text-right font-black ${getIssueToneClass(row.frictionScore)}`}>{row.frictionScore.toFixed(1)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const CohortTable: React.FC<{
    rows: CohortMetricRow[];
    label: string;
    valuePrefix?: string;
}> = ({ rows, label, valuePrefix = '' }) => (
    <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                <tr>
                    <th className="pb-3 pr-4">{label}</th>
                    <th className="pb-3 pr-4 text-right">Sessions</th>
                    <th className="pb-3 pr-4 text-right">Crash + ANR /100</th>
                    <th className="pb-3 pr-4 text-right">Errors</th>
                    <th className="pb-3 pr-4 text-right">Rage Taps</th>
                    <th className="pb-3 pr-4 text-right">Friction /100</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 8).map((row) => (
                    <tr key={row.version} className="hover:bg-[#f8fafc]">
                        <td className="py-3 pr-4 font-black text-slate-900">{valuePrefix}{row.version}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(row.count)}</td>
                        <td className={`py-3 pr-4 text-right font-black ${getIssueToneClass(row.criticalRatePer100)}`}>{row.criticalRatePer100.toFixed(1)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(row.errors)}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(row.rageTaps)}</td>
                        <td className={`py-3 pr-4 text-right font-black ${getIssueToneClass(row.frictionScore)}`}>{row.frictionScore.toFixed(1)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

export const Devices: React.FC = () => {
    const { selectedProject } = useSessionData();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [data, setData] = useState<DeviceSummary | null>(null);
    const [matrixData, setMatrixData] = useState<DeviceIssueMatrix | null>(null);
    const [partialError, setPartialError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!selectedProject?.id) {
            setData(null);
            setMatrixData(null);
            setPartialError(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setPartialError(null);

        void getDevicesOverview(selectedProject.id, timeRange)
            .then((overview) => {
                if (cancelled) return;
                setData(overview.summary);
                setMatrixData(overview.matrix);
                setPartialError(overview.failedSections.length > 0 ? `${overview.failedSections.join(', ')} unavailable.` : null);
            })
            .catch((err) => {
                console.error('Devices overview failed:', err);
                if (cancelled) return;
                setData(null);
                setMatrixData(null);
                setPartialError('Device analytics unavailable.');
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const hasData = Boolean(data && data.totalSessions > 0);

    const deviceRows = useMemo<DeviceMetricRow[]>(() => {
        if (!data?.devices) return [];
        return data.devices
            .filter((row) => isValidDeviceLabel(row.model))
            .map((row) => {
                const count = Math.max(row.count || 0, 0);
                const avgDurationSeconds = safeScore(row.avgDurationSeconds);
                const avgInteractionScore = safeScore(row.avgInteractionScore);
                const avgExplorationScore = safeScore(row.avgExplorationScore);
                const avgUxScore = safeScore(row.avgUxScore);
                const engagedSessions = Math.max(row.engagedSessions || 0, 0);
                const totalEvents = Math.max(row.totalEvents || 0, 0);
                const issueTotal = row.crashes + row.anrs + row.errors + row.rageTaps;
                const criticalTotal = row.crashes + row.anrs;
                const engagementRate = count > 0 ? (engagedSessions / count) * 100 : 0;
                const scoreFromAverages = (avgInteractionScore * 0.4) + (avgExplorationScore * 0.3) + (avgUxScore * 0.3);
                const engagementScore = scoreFromAverages > 0 ? scoreFromAverages : engagementRate;
                const weightedIssues = (row.crashes * 8) + (row.anrs * 6) + (row.errors * 3) + row.rageTaps;

                return {
                    ...row,
                    displayName: formatDeviceModel(row.model, 'Unknown device'),
                    sessionShare: data.totalSessions > 0 ? (count / data.totalSessions) * 100 : 0,
                    avgDurationSeconds,
                    avgInteractionScore,
                    avgExplorationScore,
                    avgUxScore,
                    engagedSessions,
                    engagementRate,
                    engagementScore,
                    totalEvents,
                    eventsPerSession: count > 0 ? totalEvents / count : 0,
                    issueTotal,
                    criticalTotal,
                    issueRatePer100: ratePer100(issueTotal, count),
                    criticalRatePer100: ratePer100(criticalTotal, count),
                    frictionScore: ratePer100(weightedIssues, count),
                };
            });
    }, [data]);

    const cohortRows = useMemo(() => {
        const build = (rows: CohortBaseRow[] = []): CohortMetricRow[] => rows.map((row) => {
            const issueTotal = row.crashes + row.anrs + row.errors + row.rageTaps;
            const criticalTotal = row.crashes + row.anrs;
            const weightedIssues = (row.crashes * 8) + (row.anrs * 6) + (row.errors * 3) + row.rageTaps;
            return {
                ...row,
                issueTotal,
                issueRatePer100: ratePer100(issueTotal, row.count),
                criticalTotal,
                criticalRatePer100: ratePer100(criticalTotal, row.count),
                frictionScore: ratePer100(weightedIssues, row.count),
            };
        }).sort((a, b) => b.frictionScore - a.frictionScore || b.count - a.count);

        return {
            os: build(data?.osVersions),
            versions: build(data?.appVersions),
        };
    }, [data]);

    const matrixHotspots = useMemo<MatrixHotspot[]>(() => {
        if (!matrixData?.matrix?.length) return [];
        return matrixData.matrix
            .map((cell) => {
                const issueTotal = cell.issues.crashes + cell.issues.anrs + cell.issues.errors + cell.issues.rageTaps;
                const criticalTotal = cell.issues.crashes + cell.issues.anrs;
                const weightedIssues = (cell.issues.crashes * 8) + (cell.issues.anrs * 6) + (cell.issues.errors * 3) + cell.issues.rageTaps;
                return {
                    ...cell,
                    displayName: formatDeviceModel(cell.device, 'Unknown device'),
                    issueTotal,
                    criticalTotal,
                    issueRatePer100: ratePer100(issueTotal, cell.sessions),
                    frictionScore: ratePer100(weightedIssues, cell.sessions),
                };
            })
            .filter((cell) => cell.sessions > 0 && isValidDeviceLabel(cell.device))
            .sort((a, b) => b.frictionScore - a.frictionScore || b.sessions - a.sessions)
            .slice(0, 8);
    }, [matrixData]);

    const sampleFloor = useMemo(() => {
        if (!data?.totalSessions) return 10;
        return Math.max(10, Math.min(100, Math.ceil(data.totalSessions * 0.01)));
    }, [data?.totalSessions]);

    const rankableRows = useMemo(
        () => deviceRows.filter((row) => row.count >= sampleFloor),
        [deviceRows, sampleFloor],
    );

    const rankings = useMemo(() => {
        const sortBy = (fn: (row: DeviceMetricRow) => number, direction: 'asc' | 'desc' = 'desc') => {
            return [...rankableRows].sort((a, b) => {
                const delta = fn(a) - fn(b);
                return direction === 'asc' ? delta || b.count - a.count : -delta || b.count - a.count;
            });
        };

        return {
            mostUsed: [...deviceRows].sort((a, b) => b.count - a.count),
            mostEngaged: sortBy((row) => row.engagementScore),
            longestDuration: sortBy((row) => row.avgDurationSeconds),
            worstEngaged: sortBy((row) => row.engagementScore, 'asc'),
            mostCrashes: sortBy((row) => row.crashes),
            mostAnrs: sortBy((row) => row.anrs),
            mostErrors: sortBy((row) => row.errors),
            mostRageTaps: sortBy((row) => row.rageTaps),
            worstFriction: sortBy((row) => row.frictionScore),
        };
    }, [deviceRows, rankableRows]);

    const topUsed = rankings.mostUsed[0] || null;
    const topEngaged = rankings.mostEngaged[0] || null;
    const topDuration = rankings.longestDuration[0] || null;
    const worstEngaged = rankings.worstEngaged[0] || null;
    const worstFriction = rankings.worstFriction[0] || null;

    const totals = useMemo(() => {
        const totalIssues = deviceRows.reduce((sum, row) => sum + row.issueTotal, 0);
        const totalCritical = deviceRows.reduce((sum, row) => sum + row.criticalTotal, 0);
        const weightedEngagement = deviceRows.reduce((sum, row) => sum + (row.engagementScore * row.count), 0);
        const weightedDuration = deviceRows.reduce((sum, row) => sum + (row.avgDurationSeconds * row.count), 0);
        const totalSessions = deviceRows.reduce((sum, row) => sum + row.count, 0);
        const engagedSessions = deviceRows.reduce((sum, row) => sum + row.engagedSessions, 0);

        return {
            totalIssues,
            totalCritical,
            avgEngagementScore: totalSessions > 0 ? weightedEngagement / totalSessions : 0,
            avgDurationSeconds: totalSessions > 0 ? weightedDuration / totalSessions : 0,
            engagedRate: totalSessions > 0 ? (engagedSessions / totalSessions) * 100 : 0,
        };
    }, [deviceRows]);

    if (isLoading && selectedProject?.id && !data) {
        return <DashboardGhostLoader variant="analytics" />;
    }

    return (
        <div className="min-h-screen bg-transparent pb-12 font-sans text-slate-900">
            <DashboardPageHeader
                title="Devices"
                subtitle="Business behavior and technical friction by device model."
                icon={<Smartphone className="h-6 w-6" />}
                iconColor="bg-[#e0e7ff]"
            >
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </div>
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-6 sm:px-6">
                {!selectedProject?.id && (
                    <div className="border-2 border-black bg-[#f9a8d4] p-5 text-sm font-black uppercase text-black shadow-neo">
                        Select a project to load device analytics.
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="dashboard-surface p-6 text-sm font-semibold text-slate-600">
                        No device telemetry available for this range.
                    </div>
                )}

                {!isLoading && partialError && (
                    <div className="border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
                        {partialError}
                    </div>
                )}

                {hasData && data && (
                    <>
                        <section>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <SummaryCard
                                    label="Most Used Device"
                                    value={topUsed?.displayName || 'N/A'}
                                    detail={topUsed ? `${formatCompact(topUsed.count)} sessions · ${formatPercent(topUsed.sessionShare)} share` : 'No device sample'}
                                    icon={Smartphone}
                                    accentClassName={RETRO_CARD_ACCENTS[0]}
                                />
                                <SummaryCard
                                    label="Most Engaged Device"
                                    value={topEngaged?.displayName || 'N/A'}
                                    detail={topEngaged ? `${topEngaged.engagementScore.toFixed(1)} score · ${formatPercent(topEngaged.engagementRate)} engaged` : 'No engagement sample'}
                                    icon={TrendingUp}
                                    accentClassName={RETRO_CARD_ACCENTS[1]}
                                />
                                <SummaryCard
                                    label="Longest Sessions"
                                    value={topDuration?.displayName || 'N/A'}
                                    detail={topDuration ? `${formatDuration(topDuration.avgDurationSeconds)} average · ${formatCompact(topDuration.count)} sessions` : 'No duration sample'}
                                    icon={Timer}
                                    accentClassName={RETRO_CARD_ACCENTS[2]}
                                />
                                <SummaryCard
                                    label="Worst Engaged Device"
                                    value={worstEngaged?.displayName || 'N/A'}
                                    detail={worstEngaged ? `${worstEngaged.engagementScore.toFixed(1)} score · ${formatDuration(worstEngaged.avgDurationSeconds)} average` : 'No weak cohort'}
                                    icon={TrendingDown}
                                    accentClassName={RETRO_CARD_ACCENTS[3]}
                                />
                            </div>
                        </section>

                        <div className="soft-border-scope space-y-6">
                            <section className="grid grid-cols-1 gap-6 xl:grid-cols-4">
                                <Panel title="Device Portfolio" subtitle={`${formatCompact(data.totalSessions)} sessions across ${deviceRows.length.toLocaleString()} models`} icon={Layers}>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <div className="text-[10px] font-black uppercase text-slate-500">Avg engagement</div>
                                            <div className="mt-1 text-3xl font-black text-black">{totals.avgEngagementScore.toFixed(1)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-black uppercase text-slate-500">Engaged sessions</div>
                                            <div className="mt-1 text-3xl font-black text-black">{formatPercent(totals.engagedRate)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-black uppercase text-slate-500">Avg duration</div>
                                            <div className="mt-1 text-2xl font-black text-slate-700">{formatDuration(totals.avgDurationSeconds)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-black uppercase text-slate-500">Issue events</div>
                                            <div className="mt-1 text-2xl font-black text-slate-700">{formatCompact(totals.totalIssues)}</div>
                                        </div>
                                    </div>
                                    <div className="mt-4 border-t border-slate-100 pt-3 text-[11px] font-semibold uppercase text-slate-500">
                                        Rankings use devices with at least {sampleFloor.toLocaleString()} sessions where possible.
                                    </div>
                                </Panel>

                                <Panel title="Platform Mix" subtitle="Where the device traffic comes from." icon={Smartphone} className="xl:col-span-3">
                                    <div className="grid gap-3 md:grid-cols-3">
                                        {Object.entries(data.platforms).map(([platform, count]) => (
                                            <div key={platform} className="border border-slate-200 bg-white p-4 shadow-sm">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2 text-sm font-black uppercase text-slate-900">
                                                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getPlatformColor(platform) }} />
                                                        {platform}
                                                    </div>
                                                    <div className="text-sm font-black text-black">{formatPercent((count / Math.max(data.totalSessions, 1)) * 100)}</div>
                                                </div>
                                                <div className="mt-3 h-2 bg-slate-100">
                                                    <div
                                                        className="h-2"
                                                        style={{
                                                            backgroundColor: getPlatformColor(platform),
                                                            width: `${Math.min(100, (count / Math.max(data.totalSessions, 1)) * 100)}%`,
                                                        }}
                                                    />
                                                </div>
                                                <div className="mt-2 text-xs font-semibold text-slate-500">{formatCompact(count)} sessions</div>
                                            </div>
                                        ))}
                                    </div>
                                </Panel>
                            </section>

                            <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                                <RankingCard
                                    title="Most Used Devices"
                                    subtitle="Highest session volume by model."
                                    icon={Smartphone}
                                    rows={rankings.mostUsed}
                                    emptyText="No device volume available."
                                    metricLabel="sessions"
                                    getMetric={(row) => formatCompact(row.count)}
                                    getDetail={(row) => `${formatPercent(row.sessionShare)} of sessions · ${formatDuration(row.avgDurationSeconds)} avg`}
                                    accentClassName="bg-[#67e8f9]"
                                />
                                <RankingCard
                                    title="Most Engaged Devices"
                                    subtitle="Best combined interaction, exploration, and UX score."
                                    icon={TrendingUp}
                                    rows={rankings.mostEngaged}
                                    emptyText="No engagement data available."
                                    metricLabel="score"
                                    getMetric={(row) => row.engagementScore.toFixed(1)}
                                    getDetail={(row) => `${formatPercent(row.engagementRate)} engaged · ${row.eventsPerSession.toFixed(1)} events/session`}
                                    accentClassName="bg-[#86efac]"
                                    tone="good"
                                />
                                <RankingCard
                                    title="Longest Duration Devices"
                                    subtitle="Devices with the longest average session length."
                                    icon={Clock}
                                    rows={rankings.longestDuration}
                                    emptyText="No duration data available."
                                    metricLabel="avg"
                                    getMetric={(row) => formatDuration(row.avgDurationSeconds)}
                                    getDetail={(row) => `${formatCompact(row.count)} sessions · ${row.engagementScore.toFixed(1)} engagement score`}
                                    accentClassName="bg-[#f9a8d4]"
                                />
                                <RankingCard
                                    title="Worst Engaged Devices"
                                    subtitle="Lower engagement cohorts worth inspecting."
                                    icon={TrendingDown}
                                    rows={rankings.worstEngaged}
                                    emptyText="No low-engagement device cohort found."
                                    metricLabel="score"
                                    getMetric={(row) => row.engagementScore.toFixed(1)}
                                    getDetail={(row) => `${formatDuration(row.avgDurationSeconds)} avg · ${formatPercent(row.engagementRate)} engaged`}
                                    accentClassName="bg-[#fef08a]"
                                    tone="bad"
                                />
                            </section>

                            <Panel title="Technical Device Pressure" subtitle="Crash, ANR, error, and rage tap leaders by device model." icon={ListChecks}>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    <TechnicalMetricCard
                                        label="Most Crashes"
                                        row={rankings.mostCrashes[0] || null}
                                        value={rankings.mostCrashes[0] ? formatCompact(rankings.mostCrashes[0].crashes) : '0'}
                                        icon={Bug}
                                        accentClassName="bg-[#fecaca]"
                                    />
                                    <TechnicalMetricCard
                                        label="Most ANRs"
                                        row={rankings.mostAnrs[0] || null}
                                        value={rankings.mostAnrs[0] ? formatCompact(rankings.mostAnrs[0].anrs) : '0'}
                                        icon={AlertTriangle}
                                        accentClassName="bg-[#fed7aa]"
                                    />
                                    <TechnicalMetricCard
                                        label="Most Errors"
                                        row={rankings.mostErrors[0] || null}
                                        value={rankings.mostErrors[0] ? formatCompact(rankings.mostErrors[0].errors) : '0'}
                                        icon={Zap}
                                        accentClassName="bg-[#dbeafe]"
                                    />
                                    <TechnicalMetricCard
                                        label="Most Rage Taps"
                                        row={rankings.mostRageTaps[0] || null}
                                        value={rankings.mostRageTaps[0] ? formatCompact(rankings.mostRageTaps[0].rageTaps) : '0'}
                                        icon={Flame}
                                        accentClassName="bg-[#f9a8d4]"
                                    />
                                </div>
                            </Panel>

                            <Panel
                                title="Device Detail"
                                subtitle={worstFriction ? `Highest friction right now: ${worstFriction.displayName} at ${worstFriction.frictionScore.toFixed(1)} weighted events per 100 sessions.` : 'Detailed device rows for the selected range.'}
                                icon={Gauge}
                            >
                                <DeviceTable rows={rankings.worstFriction.length ? rankings.worstFriction : deviceRows} />
                            </Panel>

                            <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                                <Panel title="OS Version Pressure" subtitle="Technical friction grouped by OS version." icon={Cpu}>
                                    <CohortTable rows={cohortRows.os} label="OS Version" />
                                </Panel>
                                <Panel title="App Version Pressure" subtitle="Technical friction grouped by app version." icon={Layers}>
                                    <CohortTable rows={cohortRows.versions} label="App Version" valuePrefix="v" />
                                </Panel>
                            </section>

                            {matrixHotspots.length > 0 && (
                                <Panel title="Device + Version Hotspots" subtitle="Device/version combinations with the most concentrated friction." icon={AlertTriangle}>
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[820px] text-left text-sm">
                                            <thead className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                                                <tr>
                                                    <th className="pb-3 pr-4">Device</th>
                                                    <th className="pb-3 pr-4">App Version</th>
                                                    <th className="pb-3 pr-4 text-right">Sessions</th>
                                                    <th className="pb-3 pr-4 text-right">Crash + ANR</th>
                                                    <th className="pb-3 pr-4 text-right">Errors</th>
                                                    <th className="pb-3 pr-4 text-right">Rage Taps</th>
                                                    <th className="pb-3 pr-4 text-right">Friction /100</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {matrixHotspots.map((cell) => (
                                                    <tr key={`${cell.device}-${cell.version}`} className="hover:bg-[#f8fafc]">
                                                        <td className="py-3 pr-4 font-black text-slate-900" title={cell.device}>{cell.displayName}</td>
                                                        <td className="py-3 pr-4 font-semibold text-slate-700">v{cell.version}</td>
                                                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(cell.sessions)}</td>
                                                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(cell.criticalTotal)}</td>
                                                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(cell.issues.errors)}</td>
                                                        <td className="py-3 pr-4 text-right font-semibold text-slate-700">{formatCompact(cell.issues.rageTaps)}</td>
                                                        <td className={`py-3 pr-4 text-right font-black ${getIssueToneClass(cell.frictionScore)}`}>{cell.frictionScore.toFixed(1)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </Panel>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Devices;
