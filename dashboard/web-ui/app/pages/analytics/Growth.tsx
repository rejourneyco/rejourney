import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Gauge,
    LineChart as LineChartIcon,
    Rocket,
    ShieldCheck,
    Target,
    TrendingUp,
    Users,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { Link } from 'react-router';
import { useSessionData } from '../../context/SessionContext';
import {
    api,
    getGrowthObservability,
    getObservabilityDeepMetrics,
    getUserEngagementTrends,
    GrowthObservability,
    InsightsTrends,
    ObservabilityDeepMetrics,
    UserEngagementTrends,
} from '../../services/api';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { TouchHeatmapSection } from '../../components/dashboard/TouchHeatmapSection';

type ActionItem = {
    title: string;
    impact: string;
    recommendation: string;
    sessionId?: string;
};

type ReleaseMarker = {
    version: string;
    sessions: number;
    dateKey: string;
    timestamp: number;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RELEASE_MARKERS = 10;

const toObservabilityRange = (value: TimeRange): string | undefined => {
    if (value === 'all') return undefined;
    return value;
};

const toTrendsRange = (value: TimeRange): string => {
    if (value === '24h') return '7d';
    if (value === 'all') return '90d';
    return value;
};

const toUtcDateKey = (value: string): string | null => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
};

const toDayIndex = (dateKey: string): number | null => {
    const date = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return Math.floor(date.getTime() / ONE_DAY_MS);
};

const formatDateLabel = (dateKey: string): string => {
    const date = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const isKnownVersion = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return Boolean(normalized) && normalized !== 'unknown' && normalized !== 'n/a' && normalized !== 'na';
};

const alignReleaseMarkersToChart = (
    markers: ReleaseMarker[],
    chartDateKeys: string[],
): ReleaseMarker[] => {
    if (!markers.length || !chartDateKeys.length) return [];

    const axisPoints = chartDateKeys
        .map((dateKey) => ({ dateKey, day: toDayIndex(dateKey) }))
        .filter((point): point is { dateKey: string; day: number } => point.day !== null);

    if (!axisPoints.length) return [];

    const exactKeySet = new Set(axisPoints.map((point) => point.dateKey));
    const aligned = markers
        .map((marker) => {
            if (exactKeySet.has(marker.dateKey)) return marker;
            const markerDay = toDayIndex(marker.dateKey);
            if (markerDay === null) return null;

            let nearest = axisPoints[0];
            let minDiff = Math.abs(markerDay - nearest.day);
            for (let i = 1; i < axisPoints.length; i++) {
                const candidate = axisPoints[i];
                const diff = Math.abs(markerDay - candidate.day);
                if (diff < minDiff) {
                    minDiff = diff;
                    nearest = candidate;
                }
            }

            return {
                ...marker,
                dateKey: nearest.dateKey,
            };
        })
        .filter((marker): marker is ReleaseMarker => Boolean(marker));

    const deduped = new Map<string, ReleaseMarker>();
    for (const marker of aligned) {
        const existing = deduped.get(marker.dateKey);
        if (!existing || marker.sessions > existing.sessions) {
            deduped.set(marker.dateKey, marker);
        }
    }

    return Array.from(deduped.values())
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-MAX_RELEASE_MARKERS);
};

const pct = (value: number | null | undefined, digits: number = 1): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
    return `${value.toFixed(digits)}%`;
};

const formatCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString();
};

const buildActionQueue = (
    growth: GrowthObservability | null,
    deep: ObservabilityDeepMetrics | null,
): ActionItem[] => {
    if (!growth || !deep) return [];

    const actions: ActionItem[] = [];

    if (growth.firstSessionSuccessRate < 80) {
        const topFirstSessionKiller = growth.growthKillers[0];
        actions.push({
            title: 'First-session quality is suppressing conversion',
            impact: `${growth.firstSessionSuccessRate}% first-session success (${growth.firstSessionStats.clean.toLocaleString()} / ${growth.firstSessionStats.total.toLocaleString()}).`,
            recommendation: topFirstSessionKiller
                ? `Start with "${topFirstSessionKiller.reason}" affecting ${topFirstSessionKiller.affectedSessions.toLocaleString()} sessions.`
                : 'Audit onboarding friction and startup reliability.',
            sessionId: topFirstSessionKiller?.sampleSessionIds?.[0],
        });
    }

    const topReleaseRisk = deep.releaseRisk.find((release) => release.deltaVsOverall > 0);
    if (topReleaseRisk) {
        actions.push({
            title: 'Release-specific instability is dragging retention',
            impact: `v${topReleaseRisk.version} is +${topReleaseRisk.deltaVsOverall.toFixed(2)} pts above overall degraded rate.`,
            recommendation: 'Gate rollout and isolate high-risk code paths in this version.',
        });
    }

    if (deep.ingestHealth.sessionsWithUploadFailures > 0) {
        actions.push({
            title: 'Ingest reliability is reducing observability coverage',
            impact: `${deep.ingestHealth.sessionsWithUploadFailures.toLocaleString()} sessions had upload failures.`,
            recommendation: 'Prioritize SDK upload pipeline stability before adding new analytics features.',
            sessionId: deep.evidenceSessions.find((item) => item.metric === 'ingest')?.sessionIds?.[0],
        });
    }

    return actions.slice(0, 4);
};

export const Growth: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();

    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [isLoading, setIsLoading] = useState(true);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    const [growthObs, setGrowthObs] = useState<GrowthObservability | null>(null);
    const [deepMetrics, setDeepMetrics] = useState<ObservabilityDeepMetrics | null>(null);
    const [engagementTrends, setEngagementTrends] = useState<UserEngagementTrends | null>(null);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIsLoading(false);
            setTrends(null);
            setGrowthObs(null);
            setDeepMetrics(null);
            setEngagementTrends(null);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);

        const trendRange = toTrendsRange(timeRange);
        const obsRange = toObservabilityRange(timeRange);

        Promise.all([
            api.getInsightsTrends(selectedProject.id, trendRange),
            getGrowthObservability(selectedProject.id, obsRange),
            getObservabilityDeepMetrics(selectedProject.id, obsRange),
            getUserEngagementTrends(selectedProject.id, obsRange),
        ])
            .then(([trendData, growthData, deepData, engagementData]) => {
                if (isCancelled) return;
                setTrends(trendData);
                setGrowthObs(growthData);
                setDeepMetrics(deepData);
                setEngagementTrends(engagementData);
            })
            .catch(() => {
                if (isCancelled) return;
                setTrends(null);
                setGrowthObs(null);
                setDeepMetrics(null);
                setEngagementTrends(null);
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const hasData = Boolean(growthObs && deepMetrics);

    const trendChartData = useMemo(() => {
        if (!trends?.daily) return [];
        return trends.daily
            .map((entry) => {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) return null;
                return {
                    dateKey,
                    sessions: entry.sessions,
                    errorCount: entry.errorCount,
                    avgApiResponseMs: entry.avgApiResponseMs,
                    dau: entry.dau,
                    mau: entry.mau,
                };
            })
            .filter((entry): entry is {
                dateKey: string;
                sessions: number;
                errorCount: number;
                avgApiResponseMs: number;
                dau: number;
                mau: number;
            } => Boolean(entry));
    }, [trends]);

    const healthChartData = useMemo(() => {
        if (!growthObs?.dailyHealth) return [];
        return growthObs.dailyHealth
            .map((entry) => {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) return null;
                return {
                    dateKey,
                    clean: entry.clean,
                    error: entry.error,
                    rage: entry.rage,
                    slow: entry.slow,
                    crash: entry.crash,
                };
            })
            .filter((entry): entry is {
                dateKey: string;
                clean: number;
                error: number;
                rage: number;
                slow: number;
                crash: number;
            } => Boolean(entry));
    }, [growthObs]);

    const engagementChartData = useMemo(() => {
        if (!engagementTrends?.daily) return [];
        return engagementTrends.daily
            .map((entry) => {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) return null;
                return {
                    dateKey,
                    loyalists: entry.loyalists,
                    explorers: entry.explorers,
                    casuals: entry.casuals,
                    bouncers: entry.bouncers,
                };
            })
            .filter((entry): entry is {
                dateKey: string;
                loyalists: number;
                explorers: number;
                casuals: number;
                bouncers: number;
            } => Boolean(entry));
    }, [engagementTrends]);

    const riskReleaseMarkers = useMemo<ReleaseMarker[]>(() => {
        if (!deepMetrics?.releaseRisk?.length) return [];

        const candidates = deepMetrics.releaseRisk
            .map((release) => {
                const markerIso = release.firstSeen || release.latestSeen;
                if (!markerIso) return null;
                if (!isKnownVersion(release.version)) return null;
                const dateKey = toUtcDateKey(markerIso);
                if (!dateKey) return null;
                const timestamp = new Date(markerIso).getTime();
                if (!Number.isFinite(timestamp)) return null;
                return {
                    version: release.version,
                    sessions: release.sessions,
                    dateKey,
                    timestamp,
                };
            })
            .filter((marker): marker is ReleaseMarker => Boolean(marker))
            .sort((a, b) => a.timestamp - b.timestamp);

        const byDate = new Map<string, ReleaseMarker>();
        for (const marker of candidates) {
            const existing = byDate.get(marker.dateKey);
            if (!existing || marker.sessions > existing.sessions) {
                byDate.set(marker.dateKey, marker);
            }
        }
        return Array.from(byDate.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-MAX_RELEASE_MARKERS);
    }, [deepMetrics]);

    const trendReleaseMarkersFromBreakdown = useMemo<ReleaseMarker[]>(() => {
        if (!trends?.daily?.length) return [];

        const byVersion = new Map<string, ReleaseMarker>();
        for (const day of trends.daily) {
            const dateKey = toUtcDateKey(day.date);
            if (!dateKey) continue;
            const timestamp = new Date(`${dateKey}T00:00:00Z`).getTime();
            if (!Number.isFinite(timestamp)) continue;

            for (const [version, rawCount] of Object.entries(day.appVersionBreakdown || {})) {
                if (!isKnownVersion(version)) continue;
                const count = Number(rawCount || 0);
                if (!Number.isFinite(count) || count <= 0) continue;

                const existing = byVersion.get(version);
                if (!existing) {
                    byVersion.set(version, {
                        version,
                        sessions: count,
                        dateKey,
                        timestamp,
                    });
                    continue;
                }

                existing.sessions += count;
                if (timestamp < existing.timestamp) {
                    existing.timestamp = timestamp;
                    existing.dateKey = dateKey;
                }
            }
        }

        return Array.from(byVersion.values())
            .sort((a, b) => (b.sessions - a.sessions) || (a.timestamp - b.timestamp))
            .slice(0, MAX_RELEASE_MARKERS)
            .sort((a, b) => a.timestamp - b.timestamp);
    }, [trends]);

    const mergedReleaseMarkers = useMemo<ReleaseMarker[]>(() => {
        const byVersion = new Map<string, ReleaseMarker>();
        for (const marker of [...trendReleaseMarkersFromBreakdown, ...riskReleaseMarkers]) {
            const existing = byVersion.get(marker.version);
            if (!existing) {
                byVersion.set(marker.version, { ...marker });
                continue;
            }

            existing.sessions = Math.max(existing.sessions, marker.sessions);
            if (marker.timestamp < existing.timestamp) {
                existing.timestamp = marker.timestamp;
                existing.dateKey = marker.dateKey;
            }
        }

        return Array.from(byVersion.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-MAX_RELEASE_MARKERS);
    }, [trendReleaseMarkersFromBreakdown, riskReleaseMarkers]);

    const trendReleaseMarkers = useMemo(() => {
        return alignReleaseMarkersToChart(
            mergedReleaseMarkers,
            trendChartData.map((entry) => entry.dateKey),
        );
    }, [mergedReleaseMarkers, trendChartData]);

    const healthReleaseMarkers = useMemo(() => {
        return alignReleaseMarkersToChart(
            mergedReleaseMarkers,
            healthChartData.map((entry) => entry.dateKey),
        );
    }, [mergedReleaseMarkers, healthChartData]);

    const engagementReleaseMarkers = useMemo(() => {
        return alignReleaseMarkersToChart(
            mergedReleaseMarkers,
            engagementChartData.map((entry) => entry.dateKey),
        );
    }, [mergedReleaseMarkers, engagementChartData]);

    const mauDomain = useMemo<[number, number]>(() => {
        const values = trendChartData
            .map((entry) => entry.mau)
            .filter((value) => Number.isFinite(value));
        if (!values.length) return [0, 100];

        const min = Math.min(...values);
        const max = Math.max(...values);
        const spread = Math.max(1, max - min);
        const pad = Math.max(8, Math.round(spread * 0.12));

        if (min === max) {
            return [Math.max(0, min - pad), max + pad];
        }
        return [Math.max(0, min - pad), max + pad];
    }, [trendChartData]);

    const actionQueue = useMemo(() => buildActionQueue(growthObs, deepMetrics), [growthObs, deepMetrics]);

    const killerRows = useMemo(() => growthObs?.growthKillers?.slice(0, 6) || [], [growthObs]);
    const releaseRows = useMemo(() => deepMetrics?.releaseRisk?.slice(0, 5) || [], [deepMetrics]);

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100/70">
            <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Growth</div>
                        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Growth Intelligence Control Room</h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Connect acquisition and retention metrics to reliability signals so teams can prioritize fixes with revenue impact.
                        </p>
                    </div>
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </div>
            </div>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-6 py-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to view growth diagnostics.
                    </div>
                )}

                {isLoading && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                            <Activity className="h-4 w-4 animate-pulse text-blue-600" />
                            Correlating session growth, reliability, and engagement segments...
                        </div>
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                        No growth analytics available for this filter yet.
                    </div>
                )}

                {!isLoading && hasData && growthObs && deepMetrics && (
                    <>
                        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    First Session Success
                                    <Rocket className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{pct(growthObs.firstSessionSuccessRate, 0)}</div>
                                <p className="mt-1 text-sm text-slate-600">Healthy first sessions: {growthObs.firstSessionStats.clean.toLocaleString()} / {growthObs.firstSessionStats.total.toLocaleString()}.</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Crash-Free Sessions
                                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{pct(deepMetrics.reliability.crashFreeSessionRate, 1)}</div>
                                <p className="mt-1 text-sm text-slate-600">ANR-free rate is {pct(deepMetrics.reliability.anrFreeSessionRate, 1)}.</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Affected Users
                                    <Users className="h-4 w-4 text-rose-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{pct(deepMetrics.impact.affectedUserRate, 1)}</div>
                                <p className="mt-1 text-sm text-slate-600">{formatCompact(deepMetrics.impact.affectedUsers)} of {formatCompact(deepMetrics.impact.uniqueUsers)} active users were impacted.</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    API Reliability
                                    <Gauge className="h-4 w-4 text-amber-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{pct(deepMetrics.reliability.apiFailureRate, 2)}</div>
                                <p className="mt-1 text-sm text-slate-600">p95 API latency is {deepMetrics.performance.p95ApiResponseMs ?? 'N/A'} ms.</p>
                            </div>
                        </section>

                        <TouchHeatmapSection timeRange={timeRange} />

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">DAU vs MAU vs Sessions</h2>
                                    <LineChartIcon className="h-5 w-5 text-blue-600" />
                                </div>
                                {trendReleaseMarkers.length > 0 && (
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {trendReleaseMarkers.map((marker) => (
                                            <span key={`trend-marker-chip-${marker.version}-${marker.dateKey}`} className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                                                v{marker.version} • {formatDateLabel(marker.dateKey)}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="h-[310px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={trendChartData} margin={{ top: 26, right: 8, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 11 }} tickFormatter={formatDateLabel} minTickGap={24} />
                                            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={mauDomain} />
                                            <Tooltip labelFormatter={(value) => formatDateLabel(String(value))} />
                                            <Legend />
                                            {trendReleaseMarkers.map((marker) => (
                                                <ReferenceLine
                                                    key={`trend-release-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#0f172a"
                                                    strokeDasharray="5 3"
                                                    strokeWidth={1.9}
                                                    ifOverflow="extendDomain"
                                                    label={{ value: `v${marker.version}`, fill: '#0f172a', fontSize: 11, fontWeight: 700, position: 'top' }}
                                                />
                                            ))}
                                            <Area yAxisId="left" type="monotone" dataKey="sessions" name="Sessions" stroke="#2563eb" fill="#bfdbfe" fillOpacity={0.45} />
                                            <Line yAxisId="left" type="monotone" dataKey="dau" name="DAU" stroke="#0f766e" strokeWidth={2} dot={false} />
                                            <Line yAxisId="right" type="monotone" dataKey="mau" name="MAU" stroke="#7c3aed" strokeWidth={2.4} dot={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Priority Action Queue</h2>
                                    <Target className="h-5 w-5 text-rose-600" />
                                </div>
                                {actionQueue.length === 0 && (
                                    <p className="text-sm text-slate-500">No urgent growth blockers detected.</p>
                                )}
                                {actionQueue.map((item, index) => (
                                    <div key={`${item.title}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                                        <p className="mt-1 text-sm text-slate-600">{item.impact}</p>
                                        <p className="mt-2 text-xs text-slate-500">{item.recommendation}</p>
                                        {item.sessionId && (
                                            <Link
                                                to={`${pathPrefix}/sessions/${item.sessionId}`}
                                                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                                            >
                                                Open evidence replay <ArrowRight className="h-3.5 w-3.5" />
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Daily Session Health Mix</h2>
                                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                                </div>
                                <div className="h-[280px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={healthChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 11 }} tickFormatter={formatDateLabel} minTickGap={24} />
                                            <YAxis tick={{ fontSize: 11 }} />
                                            <Tooltip labelFormatter={(value) => formatDateLabel(String(value))} />
                                            <Legend />
                                            {healthReleaseMarkers.map((marker) => (
                                                <ReferenceLine
                                                    key={`health-release-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#0f172a"
                                                    strokeDasharray="4 3"
                                                    strokeWidth={1.4}
                                                    ifOverflow="extendDomain"
                                                    label={{ value: `v${marker.version}`, fill: '#0f172a', fontSize: 10, position: 'top' }}
                                                />
                                            ))}
                                            <Area type="monotone" dataKey="clean" stackId="a" stroke="#059669" fill="#6ee7b7" />
                                            <Area type="monotone" dataKey="error" stackId="a" stroke="#f97316" fill="#fdba74" />
                                            <Area type="monotone" dataKey="rage" stackId="a" stroke="#be185d" fill="#f9a8d4" />
                                            <Area type="monotone" dataKey="slow" stackId="a" stroke="#0369a1" fill="#7dd3fc" />
                                            <Area type="monotone" dataKey="crash" stackId="a" stroke="#b91c1c" fill="#fca5a5" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">User Engagement Segments</h2>
                                    <TrendingUp className="h-5 w-5 text-indigo-600" />
                                </div>
                                <div className="h-[280px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={engagementChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 11 }} tickFormatter={formatDateLabel} minTickGap={24} />
                                            <YAxis tick={{ fontSize: 11 }} />
                                            <Tooltip labelFormatter={(value) => formatDateLabel(String(value))} />
                                            <Legend />
                                            {engagementReleaseMarkers.map((marker) => (
                                                <ReferenceLine
                                                    key={`engagement-release-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#0f172a"
                                                    strokeDasharray="4 3"
                                                    strokeWidth={1.4}
                                                    ifOverflow="extendDomain"
                                                    label={{ value: `v${marker.version}`, fill: '#0f172a', fontSize: 10, position: 'top' }}
                                                />
                                            ))}
                                            <Bar dataKey="loyalists" stackId="eng" fill="#10b981" />
                                            <Bar dataKey="explorers" stackId="eng" fill="#3b82f6" />
                                            <Bar dataKey="casuals" stackId="eng" fill="#f59e0b" />
                                            <Bar dataKey="bouncers" stackId="eng" fill="#ef4444" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Top Growth Killers</h2>
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[680px] text-left text-sm">
                                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="pb-2 pr-4">Reason</th>
                                                <th className="pb-2 pr-4 text-right">Affected</th>
                                                <th className="pb-2 pr-4 text-right">% Total</th>
                                                <th className="pb-2 pr-4 text-right">Delta</th>
                                                <th className="pb-2 pr-4">Replay</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {killerRows.map((killer) => (
                                                <tr key={killer.reason}>
                                                    <td className="py-3 pr-4">
                                                        <div className="font-medium text-slate-900">{killer.reason}</div>
                                                        {killer.relatedScreen && <div className="text-xs text-slate-500">Screen: {killer.relatedScreen}</div>}
                                                    </td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{killer.affectedSessions.toLocaleString()}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{killer.percentOfTotal.toFixed(1)}%</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{killer.deltaVsPrevious > 0 ? `+${killer.deltaVsPrevious}` : killer.deltaVsPrevious}%</td>
                                                    <td className="py-3 pr-4">
                                                        {killer.sampleSessionIds[0] ? (
                                                            <Link
                                                                to={`${pathPrefix}/sessions/${killer.sampleSessionIds[0]}`}
                                                                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                                                            >
                                                                Open
                                                            </Link>
                                                        ) : (
                                                            <span className="text-xs text-slate-400">N/A</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="text-sm font-semibold text-slate-900">Evidence Sessions</div>
                                {deepMetrics.evidenceSessions.length === 0 && (
                                    <p className="text-sm text-slate-500">No evidence sessions found in this window.</p>
                                )}
                                {deepMetrics.evidenceSessions.slice(0, 5).map((evidence) => (
                                    <div key={evidence.metric} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="text-sm font-medium text-slate-900">{evidence.title}</div>
                                        <p className="mt-1 text-xs text-slate-600">{evidence.value}</p>
                                        {evidence.sessionIds[0] && (
                                            <Link
                                                to={`${pathPrefix}/sessions/${evidence.sessionIds[0]}`}
                                                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                                            >
                                                Watch replay <ArrowRight className="h-3.5 w-3.5" />
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Release Risk</h2>
                                <div className="space-y-3">
                                    {releaseRows.map((release) => (
                                        <div key={release.version} className="rounded-xl border border-slate-200 p-3">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="text-sm font-medium text-slate-900">v{release.version}</div>
                                                    <div className="text-xs text-slate-500">{release.sessions.toLocaleString()} sessions</div>
                                                </div>
                                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${release.deltaVsOverall > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                    {release.deltaVsOverall > 0 ? '+' : ''}{release.deltaVsOverall.toFixed(2)} pts
                                                </span>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                                                <span>Failure {release.failureRate.toFixed(2)}%</span>
                                                <span>Crash {release.crashCount}</span>
                                                <span>ANR {release.anrCount}</span>
                                                <span>Error {release.errorCount}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Ingest Reliability</h2>
                                <div className="space-y-3 text-sm">
                                    <div className="rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                                        <span className="text-slate-600">SDK upload success rate</span>
                                        <span className="font-semibold text-slate-900">{deepMetrics.ingestHealth.sdkUploadSuccessRate?.toFixed(2) ?? 'N/A'}%</span>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                                        <span className="text-slate-600">Sessions with upload failures</span>
                                        <span className="font-semibold text-rose-700">{deepMetrics.ingestHealth.sessionsWithUploadFailures.toLocaleString()}</span>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                                        <span className="text-slate-600">Offline persisted sessions</span>
                                        <span className="font-semibold text-slate-900">{deepMetrics.ingestHealth.sessionsWithOfflinePersist.toLocaleString()}</span>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                                        <span className="text-slate-600">Memory eviction sessions</span>
                                        <span className="font-semibold text-slate-900">{deepMetrics.ingestHealth.sessionsWithMemoryEvictions.toLocaleString()}</span>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                                        <span className="text-slate-600">Circuit breaker opens</span>
                                        <span className="font-semibold text-slate-900">{deepMetrics.ingestHealth.sessionsWithCircuitBreakerOpen.toLocaleString()}</span>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                                        <span className="text-slate-600">Heavy retries (3+)</span>
                                        <span className="font-semibold text-slate-900">{deepMetrics.ingestHealth.sessionsWithHeavyRetries.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
};

export default Growth;
