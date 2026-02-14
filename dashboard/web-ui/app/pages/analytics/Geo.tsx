import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Clock,
    Globe,
    Radar,
    ShieldAlert,
    Zap,
} from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import {
    getApiLatencyByLocation,
    getGeoIssues,
    getGeoSummary,
    ApiLatencyByLocationResponse,
    GeoIssueCountry,
    GeoIssueLocation,
    GeoIssuesSummary,
    GeoSummary,
} from '../../services/api';
import { GeoIssueMapRegion, IssuesWorldMap } from '../../components/ui/IssuesWorldMap';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';

type IssueType = 'all' | 'crashes' | 'anrs' | 'errors' | 'rageTaps' | 'apiErrors';

type ActionItem = {
    title: string;
    impact: string;
    recommendation: string;
};

type CountryInsight = {
    country: string;
    sessions: number;
    issueCount: number;
    selectedIssueRate: number;
    dominantIssue: string;
    impactScore: number;
    sampleQualified: boolean;
    lat: number;
    lng: number;
    avgLatencyMs?: number;
};

const ISSUE_TYPES: Array<{ value: IssueType; label: string }> = [
    { value: 'all', label: 'All Issues' },
    { value: 'crashes', label: 'Crashes' },
    { value: 'anrs', label: 'ANRs' },
    { value: 'errors', label: 'Errors' },
    { value: 'rageTaps', label: 'Rage Taps' },
    { value: 'apiErrors', label: 'API Errors' },
];

const MIN_SAMPLE_SESSIONS = 50;
const IMPACT_RATE_WEIGHT = 0.65;
const IMPACT_SCALE_WEIGHT = 0.35;

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

const formatRate = (value: number): string => `${(value * 100).toFixed(1)}%`;

const pickDominantIssue = (country: GeoIssueCountry): string => {
    const issueTypes: Array<{ label: string; value: number }> = [
        { label: 'Crash', value: country.crashes },
        { label: 'ANR', value: country.anrs },
        { label: 'Error', value: country.errors },
        { label: 'Rage Tap', value: country.rageTaps },
        { label: 'API Error', value: country.apiErrors },
    ];
    issueTypes.sort((a, b) => b.value - a.value);
    return issueTypes[0]?.label || 'None';
};

const buildActionQueue = (
    issues: GeoIssuesSummary | null,
    latency: ApiLatencyByLocationResponse | null,
    geoSummary: GeoSummary | null,
): ActionItem[] => {
    if (!issues) return [];

    const actions: ActionItem[] = [];

    const topIssueRate = [...issues.countries]
        .filter((country) => country.sessions >= MIN_SAMPLE_SESSIONS)
        .sort((a, b) => b.issueRate - a.issueRate)[0];

    if (topIssueRate && topIssueRate.issueRate > 0.12) {
        actions.push({
            title: 'Country-level issue concentration is elevated',
            impact: `${topIssueRate.country} has ${(topIssueRate.issueRate * 100).toFixed(1)}% issue density over ${topIssueRate.sessions.toLocaleString()} sessions.`,
            recommendation: `Create targeted QA and support workflow for ${topIssueRate.country}.`,
        });
    }

    const apiHeavyLocation = [...issues.locations]
        .sort((a, b) => b.issues.apiErrors - a.issues.apiErrors)[0];

    if (apiHeavyLocation && apiHeavyLocation.issues.apiErrors > 0) {
        actions.push({
            title: 'City hotspot indicates backend/API instability',
            impact: `${apiHeavyLocation.city}, ${apiHeavyLocation.country} recorded ${apiHeavyLocation.issues.apiErrors.toLocaleString()} API errors.`,
            recommendation: 'Correlate with regional backend logs and edge routing.',
        });
    }

    const slowRegion = latency?.regions
        ? [...latency.regions].sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)[0]
        : null;

    if (slowRegion && slowRegion.avgLatencyMs > 450) {
        actions.push({
            title: 'Regional latency likely contributes to UX friction',
            impact: `${slowRegion.country} averages ${slowRegion.avgLatencyMs}ms API latency.`,
            recommendation: 'Shift traffic closer to users or enable regional caching.',
        });
    }

    if (geoSummary && geoSummary.totalWithGeo > 0) {
        const densityPerThousand = (issues.summary.totalIssues / geoSummary.totalWithGeo) * 1000;
        if (densityPerThousand > 80) {
            actions.push({
                title: 'Global issue density is high relative to geo traffic',
                impact: `${densityPerThousand.toFixed(1)} issues per 1k geo-tagged sessions.`,
                recommendation: 'Run focused reliability sprint before broad rollout expansion.',
            });
        }
    }

    return actions.slice(0, 4);
};

export const Geo: React.FC = () => {
    const { selectedProject } = useSessionData();

    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [selectedIssueType, setSelectedIssueType] = useState<IssueType>('all');
    const [selectedRegion, setSelectedRegion] = useState<GeoIssueMapRegion | null>(null);

    const [issues, setIssues] = useState<GeoIssuesSummary | null>(null);
    const [geoSummary, setGeoSummary] = useState<GeoSummary | null>(null);
    const [latencyByLocation, setLatencyByLocation] = useState<ApiLatencyByLocationResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIsLoading(false);
            setIssues(null);
            setGeoSummary(null);
            setLatencyByLocation(null);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);

        const range = toApiRange(timeRange);

        Promise.all([
            getGeoIssues(selectedProject.id, range),
            getGeoSummary(selectedProject.id, range),
            getApiLatencyByLocation(selectedProject.id, range),
        ])
            .then(([issuesData, summaryData, latencyData]) => {
                if (isCancelled) return;
                setIssues(issuesData);
                setGeoSummary(summaryData);
                setLatencyByLocation(latencyData);
            })
            .catch(() => {
                if (isCancelled) return;
                setIssues(null);
                setGeoSummary(null);
                setLatencyByLocation(null);
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const hasData = Boolean(issues && geoSummary);

    const selectedIssueLabel = useMemo(
        () => ISSUE_TYPES.find((item) => item.value === selectedIssueType)?.label ?? 'All Issues',
        [selectedIssueType]
    );

    const topLatencyRegions = useMemo(() => {
        if (!latencyByLocation?.regions) return [];
        return [...latencyByLocation.regions]
            .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
            .slice(0, 8);
    }, [latencyByLocation]);

    const latencyByCountry = useMemo(() => {
        const map = new Map<string, number>();
        for (const region of latencyByLocation?.regions ?? []) {
            map.set(region.country, region.avgLatencyMs);
        }
        return map;
    }, [latencyByLocation]);

    const countryCoordinateIndex = useMemo(() => {
        type WeightedCoord = {
            latSum: number;
            lngSum: number;
            weight: number;
            fallbackLat?: number;
            fallbackLng?: number;
        };

        const weighted = new Map<string, WeightedCoord>();

        for (const country of geoSummary?.countries ?? []) {
            if (!Number.isFinite(country.latitude) || !Number.isFinite(country.longitude)) continue;
            weighted.set(country.country, {
                latSum: 0,
                lngSum: 0,
                weight: 0,
                fallbackLat: country.latitude,
                fallbackLng: country.longitude,
            });
        }

        for (const location of issues?.locations ?? []) {
            if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) continue;

            const current = weighted.get(location.country) ?? {
                latSum: 0,
                lngSum: 0,
                weight: 0,
            };
            const pointWeight = Math.max(location.sessions, 1);

            current.latSum += location.lat * pointWeight;
            current.lngSum += location.lng * pointWeight;
            current.weight += pointWeight;
            weighted.set(location.country, current);
        }

        const coordinates = new Map<string, { lat: number; lng: number }>();
        for (const [country, value] of weighted.entries()) {
            if (value.weight > 0) {
                coordinates.set(country, {
                    lat: value.latSum / value.weight,
                    lng: value.lngSum / value.weight,
                });
                continue;
            }

            if (
                Number.isFinite(value.fallbackLat) &&
                Number.isFinite(value.fallbackLng)
            ) {
                coordinates.set(country, {
                    lat: value.fallbackLat!,
                    lng: value.fallbackLng!,
                });
            }
        }

        return coordinates;
    }, [geoSummary, issues]);

    const countryInsights = useMemo<CountryInsight[]>(() => {
        if (!issues?.countries.length) return [];

        const maxSessions = Math.max(...issues.countries.map((country) => country.sessions), 1);
        const rows = issues.countries
            .map((country) => {
                const issueCount = getIssueCount(country, selectedIssueType);
                const selectedIssueRate = country.sessions > 0 ? issueCount / country.sessions : 0;
                const coordinates = countryCoordinateIndex.get(country.country);
                if (!coordinates) return null;

                return {
                    country: country.country,
                    sessions: country.sessions,
                    issueCount,
                    selectedIssueRate,
                    dominantIssue: pickDominantIssue(country),
                    sampleQualified: country.sessions >= MIN_SAMPLE_SESSIONS,
                    lat: coordinates.lat,
                    lng: coordinates.lng,
                    avgLatencyMs: latencyByCountry.get(country.country),
                };
            })
            .filter((row): row is NonNullable<typeof row> => row !== null);

        const maxQualifiedRate = Math.max(
            ...rows
                .filter((row) => row.sampleQualified)
                .map((row) => row.selectedIssueRate),
            0
        );
        const maxObservedRate = Math.max(...rows.map((row) => row.selectedIssueRate), 0.0001);
        const rateDenominator = maxQualifiedRate > 0 ? maxQualifiedRate : maxObservedRate;

        return rows
            .map((row) => {
                const sessionScale = Math.sqrt(row.sessions / maxSessions);
                const rateScale = Math.min(row.selectedIssueRate / rateDenominator, 1);
                const impactScore = Math.round(
                    (rateScale * IMPACT_RATE_WEIGHT + sessionScale * IMPACT_SCALE_WEIGHT) * 100
                );

                return {
                    ...row,
                    impactScore,
                };
            })
            .sort(
                (a, b) =>
                    b.impactScore - a.impactScore ||
                    b.selectedIssueRate - a.selectedIssueRate ||
                    b.sessions - a.sessions
            );
    }, [issues, selectedIssueType, countryCoordinateIndex, latencyByCountry]);

    const mapRegions = useMemo<GeoIssueMapRegion[]>(
        () =>
            countryInsights.map((country) => ({
                id: country.country,
                country: country.country,
                lat: country.lat,
                lng: country.lng,
                activeUsers: country.sessions,
                issueCount: country.issueCount,
                issueRate: country.selectedIssueRate,
                impactScore: country.impactScore,
                dominantIssue: country.dominantIssue,
                confidence: country.sampleQualified ? 'high' : 'low',
                avgLatencyMs: country.avgLatencyMs,
            })),
        [countryInsights]
    );

    useEffect(() => {
        if (!selectedRegion) return;
        const refreshedSelection = mapRegions.find((region) => region.id === selectedRegion.id);
        if (!refreshedSelection) {
            setSelectedRegion(null);
            return;
        }
        if (refreshedSelection !== selectedRegion) {
            setSelectedRegion(refreshedSelection);
        }
    }, [mapRegions, selectedRegion]);

    const issueTotals = useMemo(() => {
        if (!issues) return { total: 0, affectedRegions: 0 };
        const total =
            selectedIssueType === 'all'
                ? issues.summary.totalIssues
                : issues.summary.byType[selectedIssueType];
        const affectedRegions = countryInsights.filter((country) => country.issueCount > 0).length;
        return { total, affectedRegions };
    }, [issues, selectedIssueType, countryInsights]);

    const selectedIssueDensityPerThousand = useMemo(() => {
        if (!issues || !geoSummary || geoSummary.totalWithGeo <= 0) return 0;
        const total =
            selectedIssueType === 'all'
                ? issues.summary.totalIssues
                : issues.summary.byType[selectedIssueType];
        return (total / geoSummary.totalWithGeo) * 1000;
    }, [issues, geoSummary, selectedIssueType]);

    const topImpactCountries = useMemo(() => countryInsights.slice(0, 8), [countryInsights]);

    const actionQueue = useMemo(
        () => buildActionQueue(issues, latencyByLocation, geoSummary),
        [issues, latencyByLocation, geoSummary],
    );

    const selectedCountryCities = useMemo(() => {
        if (!issues || !selectedRegion) return [];

        return issues.locations
            .filter((location) => location.country === selectedRegion.country)
            .map((location) => {
                const issueCount = getIssueCount(location, selectedIssueType);
                const issueRate = location.sessions > 0 ? issueCount / location.sessions : 0;
                return {
                    ...location,
                    issueCount,
                    issueRate,
                };
            })
            .sort((a, b) => b.issueCount - a.issueCount)
            .slice(0, 5);
    }, [issues, selectedRegion, selectedIssueType]);

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100/70">
            <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Geographic</div>
                        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Geographic Reliability Intelligence</h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Color shows issue rate, bubble size shows active users, and the impact list ranks where fixes matter most.
                        </p>
                    </div>
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </div>
            </div>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-6 py-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to load geographic insights.
                    </div>
                )}

                {isLoading && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                            <Activity className="h-4 w-4 animate-pulse text-blue-600" />
                            Correlating geo traffic, issue density, and regional API behavior...
                        </div>
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                        No geographic analytics available for this filter.
                    </div>
                )}

                {!isLoading && hasData && issues && geoSummary && (
                    <>
                        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Geo-tagged Sessions
                                    <Globe className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{formatCompact(geoSummary.totalWithGeo)}</div>
                                <p className="mt-1 text-sm text-slate-600">Across {geoSummary.countries.length.toLocaleString()} countries.</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Issues In View
                                    <ShieldAlert className="h-4 w-4 text-rose-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{formatCompact(issueTotals.total)}</div>
                                <p className="mt-1 text-sm text-slate-600">{issueTotals.affectedRegions.toLocaleString()} affected regions.</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Issue Density
                                    <Radar className="h-4 w-4 text-amber-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{selectedIssueDensityPerThousand.toFixed(1)}</div>
                                <p className="mt-1 text-sm text-slate-600">{selectedIssueLabel} per 1k geo-tagged sessions.</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Highest Latency Region
                                    <Clock className="h-4 w-4 text-indigo-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{topLatencyRegions[0]?.avgLatencyMs ?? 'N/A'} ms</div>
                                <p className="mt-1 text-sm text-slate-600">{topLatencyRegions[0]?.country || 'No latency data'}.</p>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="mb-4 flex flex-wrap gap-2">
                                    {ISSUE_TYPES.map((item) => (
                                        <button
                                            key={item.value}
                                            onClick={() => setSelectedIssueType(item.value)}
                                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${selectedIssueType === item.value
                                                ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                                }`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>

                                <IssuesWorldMap
                                    regions={mapRegions}
                                    issueLabel={selectedIssueLabel}
                                    minSampleSize={MIN_SAMPLE_SESSIONS}
                                    onRegionClick={setSelectedRegion}
                                />

                                <p className="mt-3 text-xs text-slate-500">
                                    Color is {selectedIssueLabel.toLowerCase()} rate. Bubble size is active users. Regions with fewer than {MIN_SAMPLE_SESSIONS} users are muted for reliability.
                                </p>
                            </div>

                            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Top Impact Regions</h2>
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                {topImpactCountries.length === 0 && (
                                    <p className="text-sm text-slate-500">No impact data available.</p>
                                )}
                                {topImpactCountries.map((country) => (
                                    <button
                                        key={country.country}
                                        type="button"
                                        className="w-full rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
                                        onClick={() => {
                                            const region = mapRegions.find((entry) => entry.country === country.country);
                                            if (region) setSelectedRegion(region);
                                        }}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="text-sm font-semibold text-slate-900">{country.country}</div>
                                                <div className="text-xs text-slate-500">
                                                    {formatCompact(country.sessions)} users • {country.issueCount.toLocaleString()} {selectedIssueLabel.toLowerCase()}
                                                </div>
                                            </div>
                                            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                                                {country.impactScore}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-xs text-slate-600">
                                            {formatRate(country.selectedIssueRate)} issue rate
                                            {country.sampleQualified ? '' : ` • low sample (<${MIN_SAMPLE_SESSIONS})`}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Country Diagnostics</h2>
                                    <Radar className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[860px] text-left text-sm">
                                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="pb-2 pr-4">Country</th>
                                                <th className="pb-2 pr-4 text-right">Impact</th>
                                                <th className="pb-2 pr-4 text-right">Active Users</th>
                                                <th className="pb-2 pr-4 text-right">{selectedIssueLabel}</th>
                                                <th className="pb-2 pr-4 text-right">Issue Rate</th>
                                                <th className="pb-2 pr-4 text-right">Avg API Latency</th>
                                                <th className="pb-2 pr-4">Dominant Issue</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {countryInsights.slice(0, 12).map((country) => (
                                                <tr
                                                    key={country.country}
                                                    className="cursor-pointer hover:bg-slate-50"
                                                    onClick={() => {
                                                        const region = mapRegions.find((entry) => entry.country === country.country);
                                                        if (region) setSelectedRegion(region);
                                                    }}
                                                >
                                                    <td className="py-3 pr-4 font-medium text-slate-900">{country.country}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{country.impactScore}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(country.sessions)}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(country.issueCount)}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">
                                                        {country.sampleQualified ? formatRate(country.selectedIssueRate) : `Low sample (<${MIN_SAMPLE_SESSIONS})`}
                                                    </td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">
                                                        {country.avgLatencyMs !== undefined ? `${country.avgLatencyMs} ms` : 'N/A'}
                                                    </td>
                                                    <td className="py-3 pr-4 text-xs text-slate-600">{country.dominantIssue}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Priority Actions</h2>
                                    <Zap className="h-5 w-5 text-rose-600" />
                                </div>
                                {actionQueue.length === 0 && (
                                    <p className="text-sm text-slate-500">No urgent geo actions identified.</p>
                                )}
                                {actionQueue.map((action, index) => (
                                    <div key={`${action.title}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="text-sm font-semibold text-slate-900">{action.title}</div>
                                        <p className="mt-1 text-sm text-slate-600">{action.impact}</p>
                                        <p className="mt-2 text-xs text-slate-500">{action.recommendation}</p>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Regional API Latency Ranking</h2>
                                <div className="space-y-3">
                                    {topLatencyRegions.length > 0 ? topLatencyRegions.map((region) => (
                                        <div key={region.country} className="rounded-xl border border-slate-200 p-3">
                                            <div className="flex items-center justify-between">
                                                <div className="text-sm font-medium text-slate-900">{region.country}</div>
                                                <span className="text-sm font-semibold text-slate-700">{region.avgLatencyMs} ms</span>
                                            </div>
                                            <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                                                <span>{formatCompact(region.totalRequests)} requests</span>
                                                <span>{region.successRate}% success</span>
                                            </div>
                                        </div>
                                    )) : (
                                        <p className="text-sm text-slate-500">No regional API latency data available.</p>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Selected Region Snapshot</h2>
                                {selectedRegion ? (
                                    <div className="space-y-3">
                                        <div className="rounded-xl border border-slate-200 p-3">
                                            <div className="text-base font-semibold text-slate-900">{selectedRegion.country}</div>
                                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                                <div className="rounded-lg border border-slate-200 p-2">Active Users: {formatCompact(selectedRegion.activeUsers)}</div>
                                                <div className="rounded-lg border border-slate-200 p-2">{selectedIssueLabel}: {formatCompact(selectedRegion.issueCount)}</div>
                                                <div className="rounded-lg border border-slate-200 p-2">Issue Rate: {formatRate(selectedRegion.issueRate)}</div>
                                                <div className="rounded-lg border border-slate-200 p-2">Impact Score: {selectedRegion.impactScore}/100</div>
                                                <div className="rounded-lg border border-slate-200 p-2">Dominant Issue: {selectedRegion.dominantIssue}</div>
                                                <div className="rounded-lg border border-slate-200 p-2">
                                                    Avg API Latency: {selectedRegion.avgLatencyMs !== undefined ? `${selectedRegion.avgLatencyMs} ms` : 'N/A'}
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                Top Cities ({selectedIssueLabel})
                                            </div>
                                            <div className="space-y-2">
                                                {selectedCountryCities.length > 0 ? selectedCountryCities.map((city) => (
                                                    <div key={`${city.country}-${city.city}`} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                                                        <div className="flex items-center justify-between text-slate-900">
                                                            <span className="font-medium">{city.city}</span>
                                                            <span>{formatCompact(city.issueCount)} issues</span>
                                                        </div>
                                                        <div className="mt-1 flex items-center justify-between text-slate-500">
                                                            <span>{formatCompact(city.sessions)} users</span>
                                                            <span>{formatRate(city.issueRate)} rate</span>
                                                        </div>
                                                    </div>
                                                )) : (
                                                    <p className="text-sm text-slate-500">No city-level data for this region.</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500">Click a country bubble or impact row to inspect a region snapshot.</p>
                                )}
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
};

export default Geo;
