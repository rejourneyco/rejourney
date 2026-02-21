import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    LineChart as LineChartIcon,
    ShieldCheck,
    TrendingUp,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    Pie,
    PieChart,
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
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { TouchHeatmapSection } from '../../components/dashboard/TouchHeatmapSection';

type ReleaseMarker = {
    version: string;
    sessions: number;
    dateKey: string;
    timestamp: number;
};

type HealthMixEntry = {
    key: 'clean' | 'error' | 'rage' | 'slow' | 'crash';
    label: string;
    value: number;
    color: string;
};

type MetricDelta = {
    value: number;
    unit: '%' | 'pts';
    positiveIsGood: boolean;
    digits?: number;
};

type CoreGrowthMetric = {
    key: string;
    label: string;
    value: string;
    detail: string;
    delta?: MetricDelta;
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

type ReleaseLabelViewBox = {
    x?: number;
    y?: number;
    width?: number;
};

const buildReleaseLineLabel = (version: string, index: number) => ({ viewBox }: { viewBox?: ReleaseLabelViewBox }) => {
    const x = typeof viewBox?.x === 'number' ? viewBox.x : NaN;
    const y = typeof viewBox?.y === 'number' ? viewBox.y : NaN;
    const width = typeof viewBox?.width === 'number' ? viewBox.width : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const text = `v${version}`;
    const rowOffset = (index % 3) * 12;
    const textWidth = text.length * 6.2;
    const placeLabelOnRight = Number.isFinite(width) ? x + textWidth + 12 <= width : true;
    const textY = y + 10 + rowOffset;
    const rectX = placeLabelOnRight ? x + 2 : x - textWidth - 8;
    const textX = placeLabelOnRight ? x + 5 : x - textWidth - 5;

    return (
        <g>
            <rect
                x={rectX}
                y={textY - 8.5}
                width={textWidth + 6}
                height={11}
                rx={2}
                fill="#ffffff"
                fillOpacity={0.9}
                stroke="#0f172a"
                strokeWidth={0.85}
            />
            <text x={textX} y={textY} fill="#0f172a" fontSize={9.5} fontWeight={700}>
                {text}
            </text>
        </g>
    );
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

const average = (values: number[]): number | null => {
    const valid = values.filter((value) => Number.isFinite(value));
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
};

const percentChange = (current: number | null, previous: number | null): number | null => {
    if (current === null || previous === null || previous <= 0) return null;
    return ((current - previous) / previous) * 100;
};

const pointChange = (current: number | null, previous: number | null): number | null => {
    if (current === null || previous === null) return null;
    return current - previous;
};

const formatSigned = (value: number, digits: number = 1): string => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const getRangeLabel = (range: TimeRange): string => {
    if (range === '24h') return 'Last 24 hours';
    if (range === '7d') return 'Last 7 days';
    if (range === '30d') return 'Last 30 days';
    if (range === '90d') return 'Last 90 days';
    return 'All available data';
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

    const trendWindowMetrics = useMemo(() => {
        const sorted = [...trendChartData].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
        if (!sorted.length) {
            return {
                windowSize: 0,
                currentSessionsAvg: null as number | null,
                previousSessionsAvg: null as number | null,
                sessionsDeltaPct: null as number | null,
                currentStickiness: null as number | null,
                previousStickiness: null as number | null,
                stickinessDeltaPts: null as number | null,
            };
        }

        const windowSize = Math.max(1, Math.min(7, Math.floor(sorted.length / 2)));
        const currentWindow = sorted.slice(-windowSize);
        const previousWindow = sorted.length >= windowSize * 2
            ? sorted.slice(-(windowSize * 2), -windowSize)
            : sorted.slice(0, Math.max(0, sorted.length - windowSize));

        const currentSessionsAvg = average(currentWindow.map((entry) => entry.sessions));
        const previousSessionsAvg = average(previousWindow.map((entry) => entry.sessions));

        const currentStickiness = average(
            currentWindow
                .filter((entry) => entry.mau > 0)
                .map((entry) => (entry.dau / entry.mau) * 100),
        );
        const previousStickiness = average(
            previousWindow
                .filter((entry) => entry.mau > 0)
                .map((entry) => (entry.dau / entry.mau) * 100),
        );

        return {
            windowSize,
            currentSessionsAvg,
            previousSessionsAvg,
            sessionsDeltaPct: percentChange(currentSessionsAvg, previousSessionsAvg),
            currentStickiness,
            previousStickiness,
            stickinessDeltaPts: pointChange(currentStickiness, previousStickiness),
        };
    }, [trendChartData]);

    const killerRows = useMemo(() => growthObs?.growthKillers?.slice(0, 6) || [], [growthObs]);
    const releaseRows = useMemo(() => deepMetrics?.releaseRisk?.slice(0, 5) || [], [deepMetrics]);

    const releaseRiskChartData = useMemo(() => {
        if (!deepMetrics?.releaseRisk?.length) return [];
        return deepMetrics.releaseRisk
            .map((release) => {
                const anchorDate = release.firstSeen || release.latestSeen;
                const timestamp = anchorDate ? new Date(anchorDate).getTime() : NaN;
                const generalIssueRate = release.sessions > 0
                    ? ((release.errorCount + release.crashCount + release.anrCount) / release.sessions) * 100
                    : 0;
                return {
                    version: `v${release.version}`,
                    sessions: release.sessions,
                    generalIssueRate: Number(generalIssueRate.toFixed(2)),
                    deltaVsOverall: Number(release.deltaVsOverall.toFixed(2)),
                    timestamp,
                };
            })
            .filter((release) => Number.isFinite(release.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-6);
    }, [deepMetrics]);

    const healthMixData = useMemo<HealthMixEntry[]>(() => {
        if (!growthObs) return [];
        return [
            { key: 'clean', label: 'Clean', value: growthObs.sessionHealth.clean, color: '#10b981' },
            { key: 'error', label: 'Error', value: growthObs.sessionHealth.error, color: '#fb923c' },
            { key: 'rage', label: 'Rage', value: growthObs.sessionHealth.rage, color: '#ec4899' },
            { key: 'slow', label: 'Slow', value: growthObs.sessionHealth.slow, color: '#0ea5e9' },
            { key: 'crash', label: 'Crash', value: growthObs.sessionHealth.crash, color: '#ef4444' },
        ];
    }, [growthObs]);

    const totalHealthSessions = useMemo(
        () => healthMixData.reduce((total, item) => total + item.value, 0),
        [healthMixData],
    );

    const engagementTotals = engagementTrends?.totals;
    const engagementShare = useMemo(() => {
        if (!engagementTotals) {
            return {
                totalUsers: 0,
                loyalists: 0,
                loyalistShare: null as number | null,
            };
        }

        const totalUsers = engagementTotals.bouncers + engagementTotals.casuals + engagementTotals.explorers + engagementTotals.loyalists;
        if (totalUsers <= 0) {
            return {
                totalUsers: 0,
                loyalists: 0,
                loyalistShare: null as number | null,
            };
        }

        return {
            totalUsers,
            loyalists: engagementTotals.loyalists,
            loyalistShare: (engagementTotals.loyalists / totalUsers) * 100,
        };
    }, [engagementTotals]);

    const newUserGrowth = useMemo(() => {
        const acquiredUsers = growthObs?.newUserGrowth?.acquiredUsers ?? growthObs?.firstSessionStats.total ?? 0;
        const activeUsers = growthObs?.newUserGrowth?.activeUsers ?? deepMetrics?.impact.uniqueUsers ?? 0;
        const acquisitionRate = growthObs?.newUserGrowth?.acquisitionRate
            ?? (activeUsers > 0 ? (acquiredUsers / activeUsers) * 100 : null);
        const returnedUsers = growthObs?.newUserGrowth?.returnedUsers ?? null;
        const returnRate = growthObs?.newUserGrowth?.returnRate ?? null;

        return {
            acquiredUsers,
            activeUsers,
            acquisitionRate,
            returnedUsers,
            returnRate,
        };
    }, [growthObs, deepMetrics]);

    const coreGrowthMetrics = useMemo<CoreGrowthMetric[]>(() => {
        if (!growthObs || !deepMetrics) return [];

        return [
            {
                key: 'sessions',
                label: 'Avg Daily Sessions',
                value: trendWindowMetrics.currentSessionsAvg !== null
                    ? formatCompact(Math.round(trendWindowMetrics.currentSessionsAvg))
                    : 'N/A',
                detail: trendWindowMetrics.previousSessionsAvg !== null
                    ? `vs ${formatCompact(Math.round(trendWindowMetrics.previousSessionsAvg))} in prior ${trendWindowMetrics.windowSize}-day window`
                    : 'No prior window available for comparison yet',
                delta: trendWindowMetrics.sessionsDeltaPct !== null
                    ? { value: trendWindowMetrics.sessionsDeltaPct, unit: '%', positiveIsGood: true, digits: 1 }
                    : undefined,
            },
            {
                key: 'stickiness',
                label: 'DAU/MAU Stickiness',
                value: trendWindowMetrics.currentStickiness !== null ? `${trendWindowMetrics.currentStickiness.toFixed(1)}%` : 'N/A',
                detail: trendWindowMetrics.previousStickiness !== null
                    ? `was ${trendWindowMetrics.previousStickiness.toFixed(1)}% in the previous window`
                    : 'No prior stickiness baseline in this range',
                delta: trendWindowMetrics.stickinessDeltaPts !== null
                    ? { value: trendWindowMetrics.stickinessDeltaPts, unit: 'pts', positiveIsGood: true, digits: 1 }
                    : undefined,
            },
            {
                key: 'new-user-acquisition',
                label: 'New User Acquisition',
                value: formatCompact(newUserGrowth.acquiredUsers),
                detail: newUserGrowth.activeUsers > 0 && newUserGrowth.acquisitionRate !== null
                    ? `${newUserGrowth.acquisitionRate.toFixed(1)}% of ${formatCompact(newUserGrowth.activeUsers)} active users were newly acquired`
                    : 'No active-user baseline available yet for acquisition rate',
            },
            {
                key: 'first-session-success',
                label: 'First Session Success',
                value: pct(growthObs.firstSessionSuccessRate, 1),
                detail: growthObs.firstSessionStats.total > 0
                    ? `${formatCompact(
                        growthObs.firstSessionStats.withCrash
                        + growthObs.firstSessionStats.withAnr
                        + growthObs.firstSessionStats.withRageTaps
                        + growthObs.firstSessionStats.withSlowApi
                    )} first sessions had friction signals`
                    : 'No first-session telemetry available for this window',
            },
            {
                key: 'loyal-user-share',
                label: 'Loyal User Share',
                value: engagementShare.loyalistShare !== null ? `${engagementShare.loyalistShare.toFixed(1)}%` : 'N/A',
                detail: engagementShare.totalUsers > 0
                    ? `${formatCompact(engagementShare.loyalists)} loyal users out of ${formatCompact(engagementShare.totalUsers)} tracked users`
                    : 'No engagement segment data available for this filter',
            },
            {
                key: 'new-user-return-rate',
                label: 'New User Return Rate',
                value: newUserGrowth.returnRate !== null ? `${newUserGrowth.returnRate.toFixed(1)}%` : 'N/A',
                detail: newUserGrowth.returnedUsers !== null
                    ? `${formatCompact(newUserGrowth.returnedUsers)} of ${formatCompact(newUserGrowth.acquiredUsers)} new users came back for another session`
                    : 'Return-rate telemetry not available for this window yet',
            },
        ];
    }, [growthObs, deepMetrics, trendWindowMetrics, newUserGrowth, engagementShare]);

    const kpiRangeLabel = useMemo(() => getRangeLabel(timeRange), [timeRange]);
    const kpiComparisonLabel = trendWindowMetrics.windowSize > 0
        ? `${trendWindowMetrics.windowSize}-day rolling comparison`
        : 'Comparison becomes available as more data accumulates';

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <div className="sticky top-0 z-30 bg-white">
                <DashboardPageHeader
                    title="Growth Intelligence"
                    subtitle="Acquisition, reliability, and retention in one operating view"
                    icon={<TrendingUp className="w-6 h-6" />}
                    iconColor="bg-lime-500"
                >
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </DashboardPageHeader>
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
                        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Core Growth Metrics</p>
                                        <h2 className="mt-1 text-2xl font-semibold leading-tight text-slate-900">KPIs for growth and retention</h2>
                                        <p className="mt-2 text-sm text-slate-600">
                                            Time frame: <span className="font-semibold text-slate-900">{kpiRangeLabel}</span> | {kpiComparisonLabel}.
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                                        <TrendingUp className="h-6 w-6 text-emerald-600" />
                                    </div>
                                </div>

                                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                                    {coreGrowthMetrics.map((metric) => {
                                        const deltaDigits = metric.delta?.digits ?? 1;
                                        const deltaIsNeutral = metric.delta ? Math.abs(metric.delta.value) < 0.05 : false;
                                        const isImproving = metric.delta
                                            ? (metric.delta.positiveIsGood ? metric.delta.value > 0 : metric.delta.value < 0)
                                            : false;
                                        const deltaClass = !metric.delta || deltaIsNeutral
                                            ? 'bg-slate-100 text-slate-700'
                                            : isImproving
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-rose-100 text-rose-700';

                                        return (
                                            <article key={metric.key} className="rounded-xl border border-slate-200 bg-white p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{metric.label}</p>
                                                    {metric.delta && (
                                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${deltaClass}`}>
                                                            {formatSigned(metric.delta.value, deltaDigits)}
                                                            {metric.delta.unit}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{kpiRangeLabel}</p>
                                                <div className="mt-2 text-2xl font-semibold leading-none text-slate-900">{metric.value}</div>
                                                <p className="mt-2 text-xs text-slate-600">{metric.detail}</p>
                                            </article>
                                        );
                                    })}
                                </div>
                            </div>
                        </section>

                        <TouchHeatmapSection timeRange={timeRange} />

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">DAU vs MAU vs Sessions</h2>
                                    <LineChartIcon className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="h-[320px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={trendChartData} margin={{ top: 26, right: 8, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 11 }} tickFormatter={formatDateLabel} minTickGap={24} />
                                            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={mauDomain} />
                                            <Tooltip labelFormatter={(value) => formatDateLabel(String(value))} />
                                            <Legend />
                                            {trendReleaseMarkers.map((marker, index) => (
                                                <ReferenceLine
                                                    key={`trend-release-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#0f172a"
                                                    strokeDasharray="4 3"
                                                    strokeWidth={1.9}
                                                    ifOverflow="extendDomain"
                                                    label={buildReleaseLineLabel(marker.version, index)}
                                                />
                                            ))}
                                            <Area yAxisId="left" type="monotone" dataKey="sessions" name="Sessions" stroke="#2563eb" fill="#bfdbfe" fillOpacity={0.45} />
                                            <Line yAxisId="left" type="monotone" dataKey="dau" name="DAU" stroke="#0f766e" strokeWidth={2} dot={false} />
                                            <Line yAxisId="right" type="monotone" dataKey="mau" name="MAU" stroke="#7c3aed" strokeWidth={2.4} dot={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Session Health Mix</h2>
                                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                                </div>
                                <div className="h-[220px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={healthMixData}
                                                dataKey="value"
                                                nameKey="label"
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={56}
                                                outerRadius={82}
                                                paddingAngle={2}
                                            >
                                                {healthMixData.map((entry) => (
                                                    <Cell key={entry.key} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip formatter={(value: number | string | undefined) => [formatCompact(Number(value || 0)), 'Sessions']} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="space-y-2">
                                    {healthMixData.map((item) => {
                                        const share = totalHealthSessions > 0 ? (item.value / totalHealthSessions) * 100 : 0;
                                        return (
                                            <div key={item.key} className="flex items-center justify-between text-sm">
                                                <div className="flex items-center gap-2 text-slate-700">
                                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                                                    <span>{item.label}</span>
                                                </div>
                                                <span className="font-semibold text-slate-900">{share.toFixed(1)}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Daily Session Health Trend</h2>
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
                                            {healthReleaseMarkers.map((marker, index) => (
                                                <ReferenceLine
                                                    key={`health-release-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#0f172a"
                                                    strokeDasharray="4 3"
                                                    strokeWidth={1.4}
                                                    ifOverflow="extendDomain"
                                                    label={buildReleaseLineLabel(marker.version, index)}
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
                                    <h2 className="text-lg font-semibold text-slate-900">Engagement Segment Trend</h2>
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
                                            {engagementReleaseMarkers.map((marker, index) => (
                                                <ReferenceLine
                                                    key={`engagement-release-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#0f172a"
                                                    strokeDasharray="4 3"
                                                    strokeWidth={1.4}
                                                    ifOverflow="extendDomain"
                                                    label={buildReleaseLineLabel(marker.version, index)}
                                                />
                                            ))}
                                            <Bar dataKey="loyalists" stackId="eng" fill="#10b981" />
                                            <Bar dataKey="explorers" stackId="eng" fill="#3b82f6" />
                                            <Bar dataKey="casuals" stackId="eng" fill="#f59e0b" />
                                            <Bar dataKey="bouncers" stackId="eng" fill="#ef4444" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                {engagementTotals && (
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">Loyalists: <span className="font-semibold text-slate-900">{formatCompact(engagementTotals.loyalists)}</span></div>
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">Explorers: <span className="font-semibold text-slate-900">{formatCompact(engagementTotals.explorers)}</span></div>
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">Casuals: <span className="font-semibold text-slate-900">{formatCompact(engagementTotals.casuals)}</span></div>
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">Bouncers: <span className="font-semibold text-slate-900">{formatCompact(engagementTotals.bouncers)}</span></div>
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Growth Blockers</h2>
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    {killerRows.map((killer) => (
                                        <div key={killer.reason} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-semibold text-slate-900">{killer.reason}</div>
                                                    {killer.relatedScreen && <div className="mt-1 text-xs text-slate-500">Screen: {killer.relatedScreen}</div>}
                                                </div>
                                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${killer.deltaVsPrevious > 0 ? 'bg-rose-100 text-rose-700' : killer.deltaVsPrevious < 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                                                    {killer.deltaVsPrevious > 0 ? '+' : ''}{killer.deltaVsPrevious}%
                                                </span>
                                            </div>

                                            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
                                                <div>
                                                    <div className="uppercase tracking-wide text-slate-500">Affected</div>
                                                    <div className="mt-0.5 text-sm font-semibold text-slate-900">{formatCompact(killer.affectedSessions)}</div>
                                                </div>
                                                <div>
                                                    <div className="uppercase tracking-wide text-slate-500">Share</div>
                                                    <div className="mt-0.5 text-sm font-semibold text-slate-900">{killer.percentOfTotal.toFixed(1)}%</div>
                                                </div>
                                            </div>

                                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                                                <div className="h-full bg-rose-500" style={{ width: `${clampPercent(killer.percentOfTotal)}%` }} />
                                            </div>

                                            {killer.sampleSessionIds[0] && (
                                                <Link
                                                    to={`${pathPrefix}/sessions/${killer.sampleSessionIds[0]}`}
                                                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                                                >
                                                    Open replay <ArrowRight className="h-3.5 w-3.5" />
                                                </Link>
                                            )}
                                        </div>
                                    ))}
                                    {killerRows.length === 0 && (
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                                            No growth blockers identified for this range.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-3 text-sm font-semibold text-slate-900">Evidence Sessions</div>
                                <div className="space-y-3">
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
                                    {deepMetrics.evidenceSessions.length === 0 && (
                                        <p className="text-sm text-slate-500">No evidence sessions found in this window.</p>
                                    )}
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Release Risk by Version</h2>
                                {releaseRiskChartData.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={releaseRiskChartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis dataKey="version" tick={{ fontSize: 11 }} />
                                                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                                                <Tooltip
                                                    formatter={(value: number | string | undefined, name?: string) => {
                                                        const metricName = name || 'Metric';
                                                        if (metricName === 'General Issue Rate %' || metricName === 'Delta vs Overall (pts)') {
                                                            return [`${Number(value || 0).toFixed(2)}%`, metricName];
                                                        }
                                                        return [formatCompact(Number(value || 0)), metricName];
                                                    }}
                                                />
                                                <Legend />
                                                <Bar yAxisId="left" dataKey="sessions" name="Sessions" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                                                <Line yAxisId="right" type="monotone" dataKey="generalIssueRate" name="General Issue Rate %" stroke="#dc2626" strokeWidth={2} />
                                                <Line yAxisId="right" type="monotone" dataKey="deltaVsOverall" name="Delta vs Overall (pts)" stroke="#7c3aed" strokeWidth={2} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">No release-risk trend data available.</p>
                                )}
                                <div className="mt-4 space-y-2">
                                    {releaseRows.map((release) => (
                                        <div key={release.version} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs">
                                            <span className="font-semibold text-slate-700">v{release.version}</span>
                                            <span className="text-slate-500">{formatCompact(release.sessions)} sessions</span>
                                            <span className={release.deltaVsOverall > 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>
                                                {release.deltaVsOverall > 0 ? '+' : ''}
                                                {release.deltaVsOverall.toFixed(2)} pts
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Ingest Reliability</h2>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                                    <div className="rounded-xl border border-slate-200 p-3">
                                        <div className="text-xs uppercase tracking-wide text-slate-500">SDK upload success</div>
                                        <div className="mt-1 text-lg font-semibold text-slate-900">{deepMetrics.ingestHealth.sdkUploadSuccessRate?.toFixed(2) ?? 'N/A'}%</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3">
                                        <div className="text-xs uppercase tracking-wide text-slate-500">Upload failures</div>
                                        <div className="mt-1 text-lg font-semibold text-rose-700">{deepMetrics.ingestHealth.sessionsWithUploadFailures.toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3">
                                        <div className="text-xs uppercase tracking-wide text-slate-500">Offline persisted</div>
                                        <div className="mt-1 text-lg font-semibold text-slate-900">{deepMetrics.ingestHealth.sessionsWithOfflinePersist.toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3">
                                        <div className="text-xs uppercase tracking-wide text-slate-500">Memory evictions</div>
                                        <div className="mt-1 text-lg font-semibold text-slate-900">{deepMetrics.ingestHealth.sessionsWithMemoryEvictions.toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3">
                                        <div className="text-xs uppercase tracking-wide text-slate-500">Circuit breaker opens</div>
                                        <div className="mt-1 text-lg font-semibold text-slate-900">{deepMetrics.ingestHealth.sessionsWithCircuitBreakerOpen.toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 p-3">
                                        <div className="text-xs uppercase tracking-wide text-slate-500">Heavy retries (3+)</div>
                                        <div className="mt-1 text-lg font-semibold text-slate-900">{deepMetrics.ingestHealth.sessionsWithHeavyRetries.toLocaleString()}</div>
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
