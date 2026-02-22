import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    Clock3,
    Globe,
    ShieldAlert,
    Sparkles,
} from 'lucide-react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useSessionData } from '../../context/SessionContext';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import {
    ApiLatencyByLocationResponse,
    GeoIssueCountry,
    GeoIssueLocation,
    GeoIssuesSummary,
    GeoRegionalValue,
    getApiLatencyByLocation,
    getGeoIssues,
    getGeoValueByRegion,
} from '../../services/api';
import { GeoIssueMapRegion, IssuesWorldMap } from '../../components/ui/IssuesWorldMap';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';

type IssueType = 'all' | 'crashes' | 'anrs' | 'errors' | 'rageTaps' | 'apiErrors';

type RegionalValueRow = {
    country: string;
    sessions: number;
    valueSessions: number;
    valueShare: number;
    avgUxScore: number;
    avgDurationSeconds: number;
    avgLatencyMs?: number;
    issueCount: number;
    issueRate: number;
    engagementSegments: {
        bouncers: number;
        casuals: number;
        explorers: number;
        loyalists: number;
    };
};

const ISSUE_TYPES: Array<{ value: IssueType; label: string }> = [
    { value: 'all', label: 'All Issues' },
    { value: 'apiErrors', label: 'API Errors' },
    { value: 'crashes', label: 'Crashes' },
    { value: 'anrs', label: 'ANRs' },
    { value: 'errors', label: 'Errors' },
    { value: 'rageTaps', label: 'Rage Taps' },
];

const SEGMENT_ORDER: Array<{
    key: keyof GeoRegionalValue['regions'][number]['engagementSegments'];
    label: string;
    color: string;
}> = [
    { key: 'loyalists', label: 'Loyalists', color: 'bg-emerald-500' },
    { key: 'explorers', label: 'Explorers', color: 'bg-blue-500' },
    { key: 'casuals', label: 'Casuals', color: 'bg-amber-500' },
    { key: 'bouncers', label: 'Bouncers', color: 'bg-rose-500' },
];

const MIN_SAMPLE_SESSIONS = 50;

const EMPTY_GEO_ISSUES_SUMMARY: GeoIssuesSummary = {
    locations: [],
    countries: [],
    summary: {
        totalIssues: 0,
        byType: {
            crashes: 0,
            anrs: 0,
            errors: 0,
            rageTaps: 0,
            apiErrors: 0,
        },
    },
};

const EMPTY_GEO_REGIONAL_VALUE: GeoRegionalValue = {
    regions: [],
    summary: {
        totalSessions: 0,
        totalValueSessions: 0,
        valueShare: 0,
        avgUxScore: 0,
        avgDurationSeconds: 0,
        regionCount: 0,
    },
};

const EMPTY_LATENCY_BY_LOCATION: ApiLatencyByLocationResponse = {
    regions: [],
    summary: {
        avgLatency: 0,
        totalRequests: 0,
    },
};

const toApiRange = (value: TimeRange): string | undefined => {
    if (value === 'all') return undefined;
    return value;
};

const getIssueCount = (item: GeoIssueCountry | GeoIssueLocation, type: IssueType): number => {
    if (type === 'all') return 'issues' in item ? item.issues.total : item.totalIssues;
    if ('issues' in item) return item.issues[type];
    return item[type] as number;
};

const formatCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString();
};

const formatRate = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;

export const Geo: React.FC = () => {
    const { selectedProject } = useSessionData();

    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [selectedIssueType, setSelectedIssueType] = useState<IssueType>('all');
    const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

    const [issues, setIssues] = useState<GeoIssuesSummary | null>(null);
    const [regionalValue, setRegionalValue] = useState<GeoRegionalValue | null>(null);
    const [latencyByLocation, setLatencyByLocation] = useState<ApiLatencyByLocationResponse | null>(null);
    const [partialError, setPartialError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIssues(null);
            setRegionalValue(null);
            setLatencyByLocation(null);
            setPartialError(null);
            setIsLoading(false);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);
        setPartialError(null);

        const range = toApiRange(timeRange);

        Promise.allSettled([
            getGeoIssues(selectedProject.id, range),
            getGeoValueByRegion(selectedProject.id, range),
            getApiLatencyByLocation(selectedProject.id, range),
        ])
            .then(([issueData, valueData, latencyData]) => {
                if (isCancelled) return;

                const failedSections: string[] = [];

                if (issueData.status === 'fulfilled') {
                    setIssues(issueData.value);
                } else {
                    failedSections.push('issue map');
                    setIssues(EMPTY_GEO_ISSUES_SUMMARY);
                }

                if (valueData.status === 'fulfilled') {
                    setRegionalValue(valueData.value);
                } else {
                    failedSections.push('regional value');
                    setRegionalValue(EMPTY_GEO_REGIONAL_VALUE);
                }

                if (latencyData.status === 'fulfilled') {
                    setLatencyByLocation(latencyData.value);
                } else {
                    failedSections.push('latency');
                    setLatencyByLocation(EMPTY_LATENCY_BY_LOCATION);
                }

                if (failedSections.length > 0) {
                    setPartialError(`Some geographic widgets are unavailable (${failedSections.join(', ')}).`);
                }
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const selectedIssueLabel = useMemo(
        () => ISSUE_TYPES.find((item) => item.value === selectedIssueType)?.label ?? 'All Issues',
        [selectedIssueType]
    );

    const hasData = (
        (issues?.locations.length ?? 0) > 0
        || (issues?.countries.length ?? 0) > 0
        || (regionalValue?.regions.length ?? 0) > 0
        || (latencyByLocation?.regions.length ?? 0) > 0
    );

    const issueByCountry = useMemo(() => {
        const map = new Map<string, GeoIssueCountry>();
        for (const country of issues?.countries ?? []) {
            map.set(country.country, country);
        }
        return map;
    }, [issues]);

    const latencyByCountry = useMemo(() => {
        const map = new Map<string, number>();
        for (const region of latencyByLocation?.regions ?? []) {
            map.set(region.country, region.avgLatencyMs);
        }
        return map;
    }, [latencyByLocation]);

    const regionalRows = useMemo<RegionalValueRow[]>(() => {
        if (!regionalValue) return [];

        return regionalValue.regions
            .map((region) => {
                const countryIssue = issueByCountry.get(region.country);
                const issueCount = countryIssue ? getIssueCount(countryIssue, selectedIssueType) : 0;
                const issueRate = region.sessions > 0 ? issueCount / region.sessions : 0;

                return {
                    country: region.country,
                    sessions: region.sessions,
                    valueSessions: region.valueSessions,
                    valueShare: region.valueShare / 100,
                    avgUxScore: region.avgUxScore,
                    avgDurationSeconds: region.avgDurationSeconds,
                    avgLatencyMs: latencyByCountry.get(region.country),
                    issueCount,
                    issueRate,
                    engagementSegments: region.engagementSegments,
                };
            })
            .sort((a, b) => b.valueSessions - a.valueSessions || b.sessions - a.sessions);
    }, [regionalValue, issueByCountry, selectedIssueType, latencyByCountry]);

    const topIssueRows = useMemo(() => {
        return [...regionalRows]
            .filter((row) => row.issueCount > 0)
            .sort((a, b) => b.issueCount - a.issueCount || b.issueRate - a.issueRate)
            .slice(0, 10);
    }, [regionalRows]);

    const mapRegions = useMemo<GeoIssueMapRegion[]>(() => {
        if (!issues?.locations?.length) return [];
        const regionByCountry = new Map(regionalRows.map((row) => [row.country, row] as const));

        const rows = issues.locations
            .map((location) => {
                if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;

                const issueCount = getIssueCount(location, selectedIssueType);
                const issueRate = location.sessions > 0 ? issueCount / location.sessions : 0;
                const valueRow = regionByCountry.get(location.country);

                const dominantIssue = [
                    { label: 'Crash', value: location.issues.crashes },
                    { label: 'ANR', value: location.issues.anrs },
                    { label: 'Error', value: location.issues.errors },
                    { label: 'Rage Tap', value: location.issues.rageTaps },
                    { label: 'API Error', value: location.issues.apiErrors },
                ].sort((a, b) => b.value - a.value)[0]?.label ?? 'None';

                return {
                    id: `${location.country}-${location.city || 'unknown'}-${location.lat}-${location.lng}`,
                    city: location.city,
                    country: location.country,
                    lat: location.lat,
                    lng: location.lng,
                    sessions: location.sessions,
                    issueCount,
                    issueRate,
                    dominantIssue,
                    sampleQualified: location.sessions >= MIN_SAMPLE_SESSIONS,
                    avgLatencyMs: latencyByCountry.get(location.country),
                    engagementSegments: valueRow?.engagementSegments,
                };
            })
            .filter((row): row is NonNullable<typeof row> => row !== null);

        return rows.map((row) => ({
            id: row.id,
            city: row.city,
            country: row.country,
            lat: row.lat,
            lng: row.lng,
            activeUsers: row.sessions,
            issueCount: row.issueCount,
            issueRate: row.issueRate,
            dominantIssue: row.dominantIssue,
            confidence: row.sampleQualified ? 'high' : 'low',
            avgLatencyMs: row.avgLatencyMs,
            engagementSegments: row.engagementSegments,
        }));
    }, [issues, selectedIssueType, latencyByCountry, regionalRows]);

    useEffect(() => {
        if (!selectedCountry) return;
        const exists = regionalRows.some((row) => row.country === selectedCountry)
            || mapRegions.some((region) => region.country === selectedCountry);
        if (!exists) setSelectedCountry(null);
    }, [selectedCountry, regionalRows, mapRegions]);

    useEffect(() => {
        if (selectedCountry || regionalRows.length === 0) return;
        setSelectedCountry(regionalRows[0].country);
    }, [selectedCountry, regionalRows]);

    const selectedMarket = useMemo(() => {
        if (!selectedCountry) return null;
        const valueRow = regionalRows.find((row) => row.country === selectedCountry) || null;
        const countryIssue = issueByCountry.get(selectedCountry);
        const issueCount = countryIssue ? getIssueCount(countryIssue, selectedIssueType) : 0;
        const sessions = valueRow?.sessions ?? countryIssue?.sessions ?? 0;

        return {
            country: selectedCountry,
            valueRow,
            issueCount,
            issueRate: sessions > 0 ? issueCount / sessions : 0,
        };
    }, [selectedCountry, regionalRows, issueByCountry, selectedIssueType]);

    const selectedCountryCities = useMemo(() => {
        if (!selectedCountry || !issues) return [];

        return issues.locations
            .filter((location) => location.country === selectedCountry)
            .map((location) => {
                const issueCount = getIssueCount(location, selectedIssueType);
                const issueRate = location.sessions > 0 ? issueCount / location.sessions : 0;
                return {
                    city: location.city,
                    sessions: location.sessions,
                    issueCount,
                    issueRate,
                };
            })
            .sort((a, b) => b.issueCount - a.issueCount)
            .slice(0, 5);
    }, [selectedCountry, issues, selectedIssueType]);

    const issueTotals = useMemo(() => {
        if (!issues) return { total: 0, affectedRegions: 0 };
        const total = selectedIssueType === 'all'
            ? issues.summary.totalIssues
            : issues.summary.byType[selectedIssueType];

        const affectedRegions = issues.countries.filter((country) => getIssueCount(country, selectedIssueType) > 0).length;
        return { total, affectedRegions };
    }, [issues, selectedIssueType]);

    const topValueMarkets = useMemo(() => regionalRows.slice(0, 8), [regionalRows]);

    const slowestLatencyMarkets = useMemo(() => (
        [...regionalRows]
            .filter((row) => row.avgLatencyMs !== undefined)
            .sort((a, b) => (b.avgLatencyMs || 0) - (a.avgLatencyMs || 0))
            .slice(0, 8)
    ), [regionalRows]);

    const topIssueChartData = useMemo(() => (
        topIssueRows.slice(0, 7).map((row) => ({
            country: row.country,
            issueCount: row.issueCount,
            sessions: row.sessions,
        }))
    ), [topIssueRows]);

    const latencyChartData = useMemo(() => (
        slowestLatencyMarkets.slice(0, 6).map((row) => ({
            country: row.country,
            avgLatencyMs: row.avgLatencyMs ?? 0,
            sessions: row.sessions,
        }))
    ), [slowestLatencyMarkets]);

    const cityIssueChartData = useMemo(() => (
        selectedCountryCities.map((city) => ({
            city: city.city || 'Unknown',
            issues: city.issueCount,
            sessions: city.sessions,
            issueRatePct: Number((city.issueRate * 100).toFixed(1)),
        }))
    ), [selectedCountryCities]);

    const segmentTotals = useMemo(() => {
        return regionalRows.reduce(
            (totals, row) => ({
                loyalists: totals.loyalists + row.engagementSegments.loyalists,
                explorers: totals.explorers + row.engagementSegments.explorers,
                casuals: totals.casuals + row.engagementSegments.casuals,
                bouncers: totals.bouncers + row.engagementSegments.bouncers,
            }),
            { loyalists: 0, explorers: 0, casuals: 0, bouncers: 0 }
        );
    }, [regionalRows]);

    const totalSegmentUsers = useMemo(
        () => Object.values(segmentTotals).reduce((total, value) => total + value, 0),
        [segmentTotals]
    );

    const avgLatencyMs = latencyByLocation?.summary?.avgLatency;
    const valueSharePct = regionalValue?.summary
        ? (regionalValue.summary.valueShare > 1
            ? regionalValue.summary.valueShare
            : regionalValue.summary.valueShare * 100)
        : 0;
    const loyalistSharePct = totalSegmentUsers > 0
        ? (segmentTotals.loyalists / totalSegmentUsers) * 100
        : 0;
    const slowestMarketLatencyMs = slowestLatencyMarkets[0]?.avgLatencyMs;
    const latencySpreadMs = avgLatencyMs !== undefined && slowestMarketLatencyMs !== undefined
        ? Math.max(0, slowestMarketLatencyMs - avgLatencyMs)
        : undefined;

    return (
        <div className="min-h-screen font-sans text-slate-900 bg-transparent">
            <div className="sticky top-0 z-30 bg-white">
                <DashboardPageHeader
                    title="Regional Value & Reliability"
                    icon={<Globe className="w-6 h-6" />}
                    iconColor="bg-blue-600"
                >
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </DashboardPageHeader>
            </div>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-6 py-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to load geographic insights.
                    </div>
                )}

                {isLoading && (
                    <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-6 shadow-sm">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                            <Activity className="h-4 w-4 animate-pulse text-blue-600" />
                            Loading regional analytics...
                        </div>
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-6 text-sm text-slate-600 shadow-sm">
                        No geographic analytics available for this filter.
                    </div>
                )}

                {!isLoading && partialError && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        {partialError}
                    </div>
                )}

                {!isLoading && hasData && issues && regionalValue && (
                    <>
                        <section className="overflow-hidden rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
                                <h2 className="text-lg font-semibold text-slate-900">Global Issue Map</h2>

                                <div className="flex flex-wrap gap-2">
                                    {ISSUE_TYPES.map((item) => (
                                        <button
                                            key={item.value}
                                            onClick={() => setSelectedIssueType(item.value)}
                                            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${selectedIssueType === item.value
                                                ? 'border-slate-900 bg-slate-900 text-white'
                                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                                }`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                                <div>
                                    <IssuesWorldMap
                                        regions={mapRegions}
                                        issueLabel={selectedIssueLabel}
                                        minSampleSize={MIN_SAMPLE_SESSIONS}
                                        onRegionClick={(region) => setSelectedCountry(region.country)}
                                        className="h-[580px] max-h-[72vh] min-h-[420px]"
                                    />
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-xl border border-slate-200 p-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-base font-semibold text-slate-900">{selectedMarket?.country || 'Selected market'}</h3>
                                            <Globe className="h-4 w-4 text-blue-600" />
                                        </div>
                                        {selectedMarket?.valueRow ? (
                                            <>
                                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                                    <div className="rounded-xl border border-slate-100/80 bg-slate-50/50 p-2">Sessions: {formatCompact(selectedMarket.valueRow.sessions)}</div>
                                                    <div className="rounded-xl border border-slate-100/80 bg-slate-50/50 p-2">Value share: {formatRate(selectedMarket.valueRow.valueShare)}</div>
                                                    <div className="rounded-xl border border-slate-100/80 bg-slate-50/50 p-2">Issue rate: {formatRate(selectedMarket.issueRate)}</div>
                                                    <div className="rounded-xl border border-slate-100/80 bg-slate-50/50 p-2">API latency: {selectedMarket.valueRow.avgLatencyMs !== undefined ? `${selectedMarket.valueRow.avgLatencyMs} ms` : 'N/A'}</div>
                                                </div>

                                                <div className="mt-4">
                                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">User Types</div>
                                                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                                        {SEGMENT_ORDER.map((segment) => {
                                                            const count = selectedMarket.valueRow!.engagementSegments[segment.key];
                                                            const width = (count / Math.max(selectedMarket.valueRow!.sessions, 1)) * 100;
                                                            return (
                                                                <div
                                                                    key={segment.key}
                                                                    className={`inline-block h-full ${segment.color}`}
                                                                    style={{ width: `${width}%` }}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="mt-2 space-y-1.5">
                                                        {SEGMENT_ORDER.map((segment) => {
                                                            const count = selectedMarket.valueRow!.engagementSegments[segment.key];
                                                            const rate = count / Math.max(selectedMarket.valueRow!.sessions, 1);
                                                            return (
                                                                <div key={segment.key} className="flex items-center justify-between text-xs text-slate-600">
                                                                    <span>{segment.label}</span>
                                                                    <span className="font-medium text-slate-900">{formatCompact(count)} ({formatRate(rate)})</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <p className="mt-3 text-sm text-slate-500">Select a map bubble to inspect region details.</p>
                                        )}
                                    </div>

                                    <div className="rounded-2xl border border-slate-100/80 bg-slate-50/50 p-4">
                                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Geo Snapshot</div>
                                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
                                            <div className="rounded-lg border border-slate-200 bg-white p-2">
                                                Value session share: <span className="font-semibold text-slate-900">{valueSharePct.toFixed(1)}%</span>
                                            </div>
                                            <div className="rounded-lg border border-slate-200 bg-white p-2">
                                                Loyal user share: <span className="font-semibold text-emerald-700">{loyalistSharePct.toFixed(1)}%</span>
                                            </div>
                                            <div className="rounded-lg border border-slate-200 bg-white p-2">
                                                Affected regions: <span className="font-semibold text-rose-700">{issueTotals.affectedRegions.toLocaleString()}</span>
                                            </div>
                                            <div className="rounded-lg border border-slate-200 bg-white p-2">
                                                Latency spread: <span className="font-semibold text-blue-700">{latencySpreadMs !== undefined ? `${Math.round(latencySpreadMs)} ms` : 'N/A'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-slate-200 p-4">
                                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            Top Regions by {selectedIssueLabel}
                                        </div>
                                        {topIssueChartData.length > 0 ? (
                                            <div className="h-[220px]">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <BarChart data={topIssueChartData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                        <XAxis type="number" hide />
                                                        <YAxis dataKey="country" type="category" width={110} tick={{ fontSize: 11 }} />
                                                        <Tooltip formatter={(value: number | string | undefined) => [formatCompact(Number(value || 0)), selectedIssueLabel]} />
                                                        <Bar dataKey="issueCount" fill="#ef4444" radius={[4, 4, 4, 4]} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-slate-500">No issues recorded for this filter.</p>
                                        )}
                                    </div>

                                    <div className="rounded-xl border border-slate-200 p-4">
                                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            <Clock3 className="h-3.5 w-3.5 text-sky-600" />
                                            API Latency Hotspots
                                        </div>
                                        {latencyChartData.length > 0 ? (
                                            <div className="h-[220px]">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <BarChart data={latencyChartData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                        <XAxis type="number" hide />
                                                        <YAxis dataKey="country" type="category" width={110} tick={{ fontSize: 11 }} />
                                                        <Tooltip formatter={(value: number | string | undefined) => [`${Math.round(Number(value || 0))} ms`, 'Latency']} />
                                                        <Bar dataKey="avgLatencyMs" fill="#2563eb" radius={[4, 4, 4, 4]} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-slate-500">No latency data available for this filter.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">User Type Mix by Top Markets</h2>
                                    <Sparkles className="h-5 w-5 text-emerald-600" />
                                </div>

                                <div className="rounded-2xl border border-slate-100/80 bg-slate-50/50 p-3">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Global User-Type Mix</div>
                                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                                        {SEGMENT_ORDER.map((segment) => {
                                            const count = segmentTotals[segment.key];
                                            const width = totalSegmentUsers > 0 ? (count / totalSegmentUsers) * 100 : 0;
                                            return (
                                                <div
                                                    key={`overall-${segment.key}`}
                                                    className={`inline-block h-full ${segment.color}`}
                                                    style={{ width: `${width}%` }}
                                                />
                                            );
                                        })}
                                    </div>
                                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                        {SEGMENT_ORDER.map((segment) => {
                                            const count = segmentTotals[segment.key];
                                            const rate = totalSegmentUsers > 0 ? count / totalSegmentUsers : 0;
                                            return (
                                                <div key={`overall-text-${segment.key}`}>
                                                    <span className="text-slate-500">{segment.label}:</span>{' '}
                                                    <span className="font-semibold text-slate-900">{formatCompact(count)} ({formatRate(rate)})</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="mt-4 space-y-3">
                                    {topValueMarkets.map((row) => (
                                        <button
                                            key={`segments-${row.country}`}
                                            onClick={() => setSelectedCountry(row.country)}
                                            className={`w-full rounded-xl border p-3 text-left hover:bg-slate-50 ${selectedCountry === row.country ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200'}`}
                                        >
                                            <div className="mb-2 flex items-center justify-between">
                                                <span className="font-medium text-slate-900">{row.country}</span>
                                                <span className="text-xs text-slate-600">{formatCompact(row.valueSessions)} value sessions</span>
                                            </div>
                                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                                {SEGMENT_ORDER.map((segment) => {
                                                    const count = row.engagementSegments[segment.key];
                                                    const width = (count / Math.max(row.sessions, 1)) * 100;
                                                    return (
                                                        <div
                                                            key={`${row.country}-${segment.key}`}
                                                            className={`inline-block h-full ${segment.color}`}
                                                            style={{ width: `${width}%` }}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Top Cities in {selectedCountry || 'Selected Region'}</h2>
                                    <ShieldAlert className="h-5 w-5 text-rose-600" />
                                </div>

                                {cityIssueChartData.length > 0 ? (
                                    <div className="h-[280px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={cityIssueChartData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="city" type="category" width={120} tick={{ fontSize: 11 }} />
                                                <Tooltip formatter={(value: number | string | undefined) => [formatCompact(Number(value || 0)), selectedIssueLabel]} />
                                                <Bar dataKey="issues" fill="#f43f5e" radius={[4, 4, 4, 4]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">Select a region on the map to inspect city-level distribution.</p>
                                )}

                                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-xl border border-slate-100/80 bg-slate-50/50 px-3 py-2 text-slate-600">
                                        Total {selectedIssueLabel.toLowerCase()}: <span className="font-semibold text-slate-900">{formatCompact(issueTotals.total)}</span>
                                    </div>
                                    <div className="rounded-xl border border-slate-100/80 bg-slate-50/50 px-3 py-2 text-slate-600">
                                        Affected regions: <span className="font-semibold text-slate-900">{issueTotals.affectedRegions.toLocaleString()}</span>
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

export default Geo;
