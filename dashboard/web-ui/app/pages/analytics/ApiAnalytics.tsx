import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ChevronDown,
    ChevronUp,
    Globe,
    Search,
    Server,
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
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from 'recharts';
import { useSessionData } from '../../context/SessionContext';
import {
    getApiEndpointStats,
    getApiLatencyByLocation,
    getInsightsTrends,
    getObservabilityDeepMetrics,
    getRegionPerformance,
    ApiEndpointStats,
    ApiLatencyByLocationResponse,
    InsightsTrends,
    ObservabilityDeepMetrics,
    RegionPerformance,
} from '../../services/api';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { KpiCardItem, KpiCardsGrid, computePeriodDeltaFromSeries } from '../../components/dashboard/KpiCardsGrid';

type EndpointRisk = ApiEndpointStats['allEndpoints'][number] & {
    riskScore: number;
};

type ReleaseMarker = {
    version: string;
    sessions: number;
    dateKey: string;
    timestamp: number;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RELEASE_MARKERS = 10;

const toApiRange = (value: TimeRange): string | undefined => {
    if (value === 'all') return undefined;
    return value;
};

const toTrendsRange = (value: TimeRange): string => {
    if (value === '24h') return '7d';
    if (value === 'all') return '90d';
    return value;
};

const toRegionRange = (value: TimeRange): string => {
    if (value === '24h') return '7d';
    if (value === 'all') return 'all';
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

const pct = (value: number | null | undefined, digits: number = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
    return `${value.toFixed(digits)}%`;
};

const formatMs = (value: number | null | undefined): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
    return `${Math.round(value)} ms`;
};

const formatCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString();
};

const getSlowLatencyFill = (latencyMs: number): string => {
    if (latencyMs > 1000) return '#ca8a04';
    if (latencyMs > 700) return '#eab308';
    if (latencyMs > 400) return '#facc15';
    return '#fde047';
};

const getFailRateToneClass = (failRate: number): string => {
    if (failRate >= 5) return 'text-rose-700';
    if (failRate >= 2) return 'text-amber-700';
    return 'text-emerald-700';
};

const getLatencyToneClass = (latencyMs: number): string => {
    if (latencyMs >= 1000) return 'text-amber-800';
    if (latencyMs >= 500) return 'text-amber-700';
    return 'text-slate-700';
};

const getRiskBadgeClass = (riskScore: number): string => {
    if (riskScore >= 80) return 'border-rose-300 bg-rose-50 text-rose-700';
    if (riskScore >= 50) return 'border-amber-300 bg-amber-50 text-amber-700';
    return 'border-emerald-300 bg-emerald-50 text-emerald-700';
};

export const ApiAnalytics: React.FC = () => {
    const { selectedProject } = useSessionData();

    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortKey, setSortKey] = useState<keyof EndpointRisk>('riskScore');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    const [endpointStats, setEndpointStats] = useState<ApiEndpointStats | null>(null);
    const [regionStats, setRegionStats] = useState<RegionPerformance | null>(null);
    const [deepMetrics, setDeepMetrics] = useState<ObservabilityDeepMetrics | null>(null);
    const [latencyByLocation, setLatencyByLocation] = useState<ApiLatencyByLocationResponse | null>(null);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIsLoading(false);
            setEndpointStats(null);
            setRegionStats(null);
            setDeepMetrics(null);
            setLatencyByLocation(null);
            setTrends(null);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);

        const range = toApiRange(timeRange);

        Promise.allSettled([
            getApiEndpointStats(selectedProject.id, range),
            getRegionPerformance(selectedProject.id, toRegionRange(timeRange)),
            getObservabilityDeepMetrics(selectedProject.id, range),
            getApiLatencyByLocation(selectedProject.id, range),
            getInsightsTrends(selectedProject.id, toTrendsRange(timeRange)),
        ])
            .then(([endpointData, regionData, deepData, geoLatencyData, trendData]) => {
                if (isCancelled) return;

                const failedSections: string[] = [];

                if (endpointData.status === 'fulfilled') {
                    setEndpointStats(endpointData.value);
                } else {
                    failedSections.push('endpointStats');
                    setEndpointStats(null);
                }

                if (regionData.status === 'fulfilled') {
                    setRegionStats(regionData.value);
                } else {
                    failedSections.push('regionPerformance');
                    setRegionStats(null);
                }

                if (deepData.status === 'fulfilled') {
                    setDeepMetrics(deepData.value);
                } else {
                    failedSections.push('deepMetrics');
                    setDeepMetrics(null);
                }

                if (geoLatencyData.status === 'fulfilled') {
                    setLatencyByLocation(geoLatencyData.value);
                } else {
                    failedSections.push('geoLatency');
                    setLatencyByLocation(null);
                }

                if (trendData.status === 'fulfilled') {
                    setTrends(trendData.value);
                } else {
                    failedSections.push('trends');
                    setTrends(null);
                }

                if (failedSections.length > 0) {
                    console.error('ApiAnalytics partial data fetch failures:', failedSections);
                }
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const hasData = Boolean(endpointStats && deepMetrics);

    const endpointRisks = useMemo<EndpointRisk[]>(() => {
        if (!endpointStats?.allEndpoints) return [];
        const base = endpointStats.allEndpoints
            .map((endpoint) => {
                const riskScore =
                    endpoint.errorRate * 10 +
                    Math.max(0, endpoint.avgLatencyMs - 300) / 40 +
                    Math.log10(endpoint.totalCalls + 1);

                return {
                    ...endpoint,
                    riskScore,
                };
            });

        return [...base].sort((a, b) => {
            const aVal = a[sortKey];
            const bVal = b[sortKey];

            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }

            const aNum = Number(aVal) || 0;
            const bNum = Number(bVal) || 0;

            return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
        });
    }, [endpointStats, sortKey, sortOrder]);

    const filteredEndpoints = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return endpointRisks;
        return endpointRisks.filter((endpoint) => endpoint.endpoint.toLowerCase().includes(q));
    }, [endpointRisks, searchQuery]);

    const slowEndpointChart = useMemo(() => endpointStats?.slowestEndpoints?.slice(0, 6) || [], [endpointStats]);
    const errorEndpointChart = useMemo(() => endpointStats?.erroringEndpoints?.slice(0, 6) || [], [endpointStats]);
    const releaseRiskRows = useMemo(() => deepMetrics?.releaseRisk?.slice(0, 5) || [], [deepMetrics]);

    const geoLatencyRows = useMemo(() => latencyByLocation?.regions?.slice(0, 8) || [], [latencyByLocation]);
    const networkRows = useMemo(() => deepMetrics?.networkBreakdown?.slice(0, 6) || [], [deepMetrics]);
    const regionalLatencyChartData = useMemo(() => (
        regionStats?.slowestRegions?.slice(0, 8).map((region) => ({
            region: region.name,
            latencyMs: region.avgLatencyMs,
            calls: region.totalCalls,
        })) || []
    ), [regionStats]);
    const countryLatencyChartData = useMemo(() => (
        geoLatencyRows.map((region) => ({
            country: region.country,
            latencyMs: region.avgLatencyMs,
            successRate: Number(region.successRate.toFixed(2)),
            requests: region.totalRequests,
        }))
    ), [geoLatencyRows]);
    const networkReliabilityChartData = useMemo(() => (
        networkRows.map((network) => ({
            network: network.networkType.toUpperCase(),
            latencyMs: network.avgLatencyMs,
            failRate: Number(network.apiErrorRate.toFixed(2)),
            sessions: network.sessions,
        }))
    ), [networkRows]);
    const networkCorrelationData = useMemo(() => {
        if (!deepMetrics?.networkBreakdown?.length) return [];
        return deepMetrics.networkBreakdown.slice(0, 8).map((network) => ({
            network: network.networkType.toUpperCase(),
            sessions: network.sessions,
            avgLatencyMs: network.avgLatencyMs,
            apiErrorRate: Number(network.apiErrorRate.toFixed(2)),
        }));
    }, [deepMetrics]);

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
                };
            })
            .filter((entry): entry is {
                dateKey: string;
                sessions: number;
                errorCount: number;
                avgApiResponseMs: number;
            } => Boolean(entry));
    }, [trends]);

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

    const apiCallsChartData = useMemo(() => {
        if (!trends?.daily) return [];
        return trends.daily.map((day) => ({
            date: formatDateLabel(day.date),
            callsPerSession: day.sessions > 0 ? Number((day.totalApiCalls / day.sessions).toFixed(2)) : 0,
            totalApiCalls: day.totalApiCalls,
        }));
    }, [trends]);

    const p95ApiMs = deepMetrics?.performance.p95ApiResponseMs ?? null;
    const p99ApiMs = deepMetrics?.performance.p99ApiResponseMs ?? null;
    const tailLatencySpreadMs = p99ApiMs !== null && p95ApiMs !== null
        ? Math.max(0, p99ApiMs - p95ApiMs)
        : null;

    const kpiCards = useMemo<KpiCardItem[]>(() => {
        const callsDelta = computePeriodDeltaFromSeries(
            (trends?.daily || []).map((day) => day.totalApiCalls),
            timeRange,
            'sum',
        );
        const latencyDelta = computePeriodDeltaFromSeries(
            (trends?.daily || []).map((day) => day.avgApiResponseMs),
            timeRange,
            'avg',
        );
        const errorRateDelta = computePeriodDeltaFromSeries(
            (trends?.daily || []).map((day) => day.apiErrorRate),
            timeRange,
            'avg',
        );

        return [
            {
                id: 'total-api-calls',
                label: 'API Calls',
                value: formatCompact(endpointStats?.summary.totalCalls || 0),
                sortValue: endpointStats?.summary.totalCalls || 0,
                info: 'Total API requests captured for the active project and filter.',
                detail: `${endpointStats?.allEndpoints.length.toLocaleString() || 0} endpoints tracked`,
                delta: callsDelta
                    ? {
                        value: callsDelta.deltaPct,
                        label: callsDelta.comparisonLabel,
                        betterDirection: 'up',
                        precision: 1,
                    }
                    : undefined,
            },
            {
                id: 'p95-response',
                label: 'p95 Response',
                value: formatMs(p95ApiMs),
                sortValue: p95ApiMs ?? null,
                info: '95th percentile API response time across captured traffic.',
                detail: `p50 ${formatMs(deepMetrics?.performance.p50ApiResponseMs)} · fail ${pct(endpointStats?.summary.errorRate, 2)}`,
                delta: latencyDelta
                    ? {
                        value: latencyDelta.deltaPct,
                        label: latencyDelta.comparisonLabel,
                        betterDirection: 'down',
                        precision: 1,
                    }
                    : undefined,
            },
            {
                id: 'p99-tail-latency',
                label: 'p99 Tail',
                value: formatMs(p99ApiMs),
                sortValue: p99ApiMs ?? null,
                info: '99th percentile tail latency; highlights severe slow requests.',
                detail: `Tail spread ${tailLatencySpreadMs !== null ? `${tailLatencySpreadMs} ms` : 'N/A'}`,
                delta: latencyDelta
                    ? {
                        value: latencyDelta.deltaPct,
                        label: latencyDelta.comparisonLabel,
                        betterDirection: 'down',
                        precision: 1,
                    }
                    : undefined,
            },
            {
                id: 'api-apdex',
                label: 'API Apdex',
                value: deepMetrics?.performance.apiApdex !== null && deepMetrics?.performance.apiApdex !== undefined
                    ? deepMetrics.performance.apiApdex.toFixed(2)
                    : 'N/A',
                sortValue: deepMetrics?.performance.apiApdex ?? null,
                info: 'Service satisfaction score combining latency and failure distribution.',
                detail: `Failure ${pct(deepMetrics?.reliability.apiFailureRate, 2)}`,
                delta: errorRateDelta
                    ? {
                        value: errorRateDelta.deltaPct,
                        label: errorRateDelta.comparisonLabel,
                        betterDirection: 'down',
                        precision: 1,
                    }
                    : undefined,
            },
        ];
    }, [trends, timeRange, endpointStats, p95ApiMs, deepMetrics, p99ApiMs, tailLatencySpreadMs]);

    return (
        <div className="min-h-screen font-sans text-slate-900 bg-transparent">
            <div className="sticky top-0 z-30 bg-white">
                <DashboardPageHeader
                    title="API Reliability & Performance"
                    icon={<Activity className="w-6 h-6" />}
                    iconColor="bg-emerald-500"
                >
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </DashboardPageHeader>
            </div>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-6 py-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to load API insights.
                    </div>
                )}

                {isLoading && (
                    <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-6 shadow-sm">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                            <Activity className="h-4 w-4 animate-pulse text-blue-600" />
                            Loading API analytics...
                        </div>
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-6 text-sm text-slate-600 shadow-sm">
                        No API telemetry available for this window.
                    </div>
                )}

                {!isLoading && hasData && endpointStats && deepMetrics && (
                    <>
                        <KpiCardsGrid
                            cards={kpiCards}
                            timeRange={timeRange}
                            storageKey="analytics-api"
                        />

                        <section className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-slate-900">Traffic vs Errors vs Latency</h2>
                                <Activity className="h-5 w-5 text-blue-600" />
                            </div>
                            {trendChartData.length > 0 ? (
                                <div className="h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={trendChartData} margin={{ top: 26, right: 8, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 11 }} tickFormatter={formatDateLabel} minTickGap={24} />
                                            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                                            <Tooltip labelFormatter={(value) => formatDateLabel(String(value))} />
                                            <Legend />
                                            {trendReleaseMarkers.map((marker, index) => (
                                                <ReferenceLine
                                                    key={`api-trend-release-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#0f172a"
                                                    strokeDasharray="4 3"
                                                    strokeWidth={1.9}
                                                    ifOverflow="extendDomain"
                                                    label={buildReleaseLineLabel(marker.version, index)}
                                                />
                                            ))}
                                            <Area yAxisId="left" type="monotone" dataKey="sessions" name="Sessions" stroke="#2563eb" fill="#bfdbfe" fillOpacity={0.45} />
                                            <Line yAxisId="left" type="monotone" dataKey="errorCount" name="Errors" stroke="#dc2626" strokeWidth={2} dot={false} />
                                            <Line yAxisId="right" type="monotone" dataKey="avgApiResponseMs" name="Avg API ms" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500">No traffic/error/latency trend data available for this range.</p>
                            )}
                        </section>

                        <section className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-slate-900">Endpoint Hotspots</h2>
                                <Server className="h-5 w-5 text-blue-600" />
                            </div>
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                                <div className="rounded-xl border border-amber-100/80 bg-amber-50/30 ring-1 ring-amber-900/5 p-3">
                                    <div className="mb-2 flex items-center justify-between">
                                        <h3 className="text-base font-semibold text-amber-900">Slowest Endpoints</h3>
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Latency severity</span>
                                    </div>
                                    <div className="h-[250px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={slowEndpointChart} layout="vertical" margin={{ left: 0, right: 16 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal vertical={false} />
                                                <XAxis type="number" hide />
                                                <YAxis
                                                    dataKey="endpoint"
                                                    type="category"
                                                    width={170}
                                                    tick={{ fontSize: 11 }}
                                                    tickFormatter={(value: string) => (value.length > 28 ? `${value.slice(0, 26)}…` : value)}
                                                />
                                                <Tooltip formatter={(value: number | string | undefined) => [`${Number(value || 0)} ms`, 'Latency']} />
                                                <Bar dataKey="avgLatencyMs" radius={[4, 4, 4, 4]}>
                                                    {slowEndpointChart.map((endpoint) => (
                                                        <Cell
                                                            key={endpoint.endpoint}
                                                            fill={getSlowLatencyFill(endpoint.avgLatencyMs)}
                                                        />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-rose-100/80 bg-rose-50/20 ring-1 ring-rose-900/5 p-3">
                                    <div className="mb-2 flex items-center justify-between">
                                        <h3 className="text-base font-semibold text-rose-900">Most Erroring Endpoints</h3>
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">Failure hotspots</span>
                                    </div>
                                    <div className="h-[250px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={errorEndpointChart} layout="vertical" margin={{ left: 0, right: 16 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal vertical={false} />
                                                <XAxis type="number" hide />
                                                <YAxis
                                                    dataKey="endpoint"
                                                    type="category"
                                                    width={170}
                                                    tick={{ fontSize: 11 }}
                                                    tickFormatter={(value: string) => (value.length > 28 ? `${value.slice(0, 26)}…` : value)}
                                                />
                                                <Tooltip formatter={(value: number | string | undefined) => [`${Number(value || 0)}`, 'Errors']} />
                                                <Bar dataKey="totalErrors" radius={[4, 4, 4, 4]} fill="#dc2626" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">API Usage Intensity</h2>
                                {apiCallsChartData.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={apiCallsChartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                                                <Tooltip />
                                                <Legend />
                                                <Bar yAxisId="right" dataKey="totalApiCalls" name="Total Calls" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                                                <Line yAxisId="left" type="monotone" dataKey="callsPerSession" name="Calls / Session" stroke="#2563eb" strokeWidth={2} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">No API usage trend data available.</p>
                                )}
                            </div>

                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <h2 className="mb-2 text-lg font-semibold text-slate-900">Network Correlation</h2>
                                {networkCorrelationData.length > 0 ? (
                                    <div className="h-[300px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ScatterChart margin={{ top: 12, right: 18, bottom: 10, left: 2 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis type="number" dataKey="avgLatencyMs" name="Latency" unit=" ms" tick={{ fontSize: 11 }} />
                                                <YAxis type="number" dataKey="apiErrorRate" name="Fail rate" unit="%" tick={{ fontSize: 11 }} />
                                                <ZAxis type="number" dataKey="sessions" range={[70, 420]} />
                                                <Tooltip
                                                    cursor={{ strokeDasharray: '4 4' }}
                                                    content={({ active, payload }: any) => {
                                                        if (!active || !payload?.length) return null;
                                                        const point = payload[0].payload;
                                                        return (
                                                            <div className="rounded-xl border border-slate-100/80 bg-white px-3 py-2 text-xs shadow-sm ring-1 ring-slate-900/5">
                                                                <div className="font-semibold text-slate-900">{point.network}</div>
                                                                <div className="mt-1 text-slate-600">Latency: {point.avgLatencyMs} ms</div>
                                                                <div className="text-slate-600">Fail rate: {point.apiErrorRate.toFixed(2)}%</div>
                                                                <div className="text-slate-600">Sessions: {formatCompact(point.sessions)}</div>
                                                            </div>
                                                        );
                                                    }}
                                                />
                                                <Scatter data={networkCorrelationData} fill="#2563eb" />
                                            </ScatterChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">No network-level metrics available.</p>
                                )}
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Regional API Latency</h2>
                                    <Globe className="h-5 w-5 text-blue-600" />
                                </div>
                                {regionalLatencyChartData.length > 0 ? (
                                    <div className="h-[280px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={regionalLatencyChartData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="region" type="category" width={120} tick={{ fontSize: 11 }} />
                                                <Tooltip formatter={(value: number | string | undefined) => [`${Math.round(Number(value || 0))} ms`, 'Latency']} />
                                                <Bar dataKey="latencyMs" fill="#ef4444" radius={[4, 4, 4, 4]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">No regional latency data available.</p>
                                )}
                            </div>

                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Latency by Country</h2>
                                {countryLatencyChartData.length > 0 ? (
                                    <div className="h-[280px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={countryLatencyChartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis dataKey="country" tick={{ fontSize: 11 }} interval={0} angle={-20} height={56} textAnchor="end" />
                                                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[80, 100]} />
                                                <Tooltip />
                                                <Bar yAxisId="left" dataKey="latencyMs" name="Latency (ms)" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                                                <Line yAxisId="right" type="monotone" dataKey="successRate" name="Success %" stroke="#16a34a" strokeWidth={2} dot={false} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">No geo-latency data available.</p>
                                )}
                            </div>

                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Network Reliability Snapshot</h2>
                                {networkReliabilityChartData.length > 0 ? (
                                    <div className="h-[280px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={networkReliabilityChartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis dataKey="network" tick={{ fontSize: 11 }} />
                                                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                                                <Tooltip />
                                                <Bar yAxisId="left" dataKey="latencyMs" name="Latency (ms)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                                                <Line yAxisId="right" type="monotone" dataKey="failRate" name="Fail %" stroke="#dc2626" strokeWidth={2} dot={false} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">No network-level metrics available.</p>
                                )}
                            </div>
                        </section>

                        <section className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <h2 className="text-lg font-semibold text-slate-900">Endpoint Activity Database</h2>
                                <div className="relative w-full md:w-[360px]">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <input
                                        value={searchQuery}
                                        onChange={(event) => setSearchQuery(event.target.value)}
                                        placeholder="Filter by endpoint path"
                                        className="w-full rounded-2xl border border-slate-100/80 bg-slate-50/50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white"
                                    />
                                </div>
                            </div>

                            <div className="overflow-x-auto rounded-2xl border border-slate-100/80 ring-1 ring-slate-900/5 shadow-sm">
                                <table className="w-full min-w-[980px] text-left text-sm">
                                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                        <tr>
                                            <th
                                                className="cursor-pointer px-4 py-3 pr-4 hover:text-slate-900"
                                                onClick={() => {
                                                    if (sortKey === 'endpoint') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('endpoint'); setSortOrder('asc'); }
                                                }}
                                            >
                                                <div className="flex items-center gap-1">
                                                    Endpoint
                                                    {sortKey === 'endpoint' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                            <th
                                                className="cursor-pointer px-4 py-3 pr-4 text-right hover:text-slate-900"
                                                onClick={() => {
                                                    if (sortKey === 'totalCalls') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('totalCalls'); setSortOrder('desc'); }
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Calls
                                                    {sortKey === 'totalCalls' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                            <th
                                                className="cursor-pointer px-4 py-3 pr-4 text-right hover:text-slate-900"
                                                onClick={() => {
                                                    if (sortKey === 'totalErrors') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('totalErrors'); setSortOrder('desc'); }
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Errors
                                                    {sortKey === 'totalErrors' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                            <th
                                                className="cursor-pointer px-4 py-3 pr-4 text-right hover:text-slate-900"
                                                onClick={() => {
                                                    if (sortKey === 'errorRate') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('errorRate'); setSortOrder('desc'); }
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Fail Rate
                                                    {sortKey === 'errorRate' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                            <th
                                                className="cursor-pointer px-4 py-3 pr-4 text-right hover:text-slate-900"
                                                onClick={() => {
                                                    if (sortKey === 'avgLatencyMs') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('avgLatencyMs'); setSortOrder('desc'); }
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Latency
                                                    {sortKey === 'avgLatencyMs' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                            <th
                                                className="cursor-pointer px-4 py-3 pr-4 text-right hover:text-slate-900"
                                                onClick={() => {
                                                    if (sortKey === 'riskScore') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('riskScore'); setSortOrder('desc'); }
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Risk Index
                                                    {sortKey === 'riskScore' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredEndpoints.slice(0, 40).map((endpoint) => (
                                            <tr key={endpoint.endpoint} className="transition-colors hover:bg-slate-50">
                                                <td className="px-4 py-3 pr-4 font-mono text-[12px] font-semibold text-slate-900">{endpoint.endpoint}</td>
                                                <td className="px-4 py-3 pr-4 text-right text-slate-700">{formatCompact(endpoint.totalCalls)}</td>
                                                <td className="px-4 py-3 pr-4 text-right text-slate-700">{formatCompact(endpoint.totalErrors)}</td>
                                                <td className={`px-4 py-3 pr-4 text-right font-semibold ${getFailRateToneClass(endpoint.errorRate)}`}>{endpoint.errorRate.toFixed(2)}%</td>
                                                <td className={`px-4 py-3 pr-4 text-right font-semibold ${getLatencyToneClass(endpoint.avgLatencyMs)}`}>{endpoint.avgLatencyMs} ms</td>
                                                <td className="px-4 py-3 pr-4 text-right">
                                                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${getRiskBadgeClass(endpoint.riskScore)}`}>
                                                        {endpoint.riskScore.toFixed(1)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
};

export default ApiAnalytics;
