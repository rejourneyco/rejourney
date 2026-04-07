import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
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
import { useSessionData } from '~/shared/providers/SessionContext';
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
} from '~/shared/api/client';
import { DataWatermarkBanner } from '~/features/app/shared/dashboard/DataWatermarkBanner';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '~/shared/ui/core/TimeFilter';
import { KpiCardItem, KpiCardsGrid, computePeriodDeltaFromSeries } from '~/features/app/shared/dashboard/KpiCardsGrid';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';

type EndpointSortKey =
    | 'endpoint'
    | 'totalCalls'
    | 'filteredErrorCount'
    | 'filteredErrorRate'
    | 'avgLatencyMs'
    | 'riskScore';

type FailureCodeOption = {
    code: string;
    total: number;
};

type EndpointRisk = ApiEndpointStats['allEndpoints'][number] & {
    filteredErrorCount: number;
    filteredErrorRate: number;
    riskScore: number;
};

type ErrorHotspotRow = EndpointRisk & {
    displayErrorCount: number;
    displayErrorRate: number;
    usesTotalErrorFallback: boolean;
};

type ReleaseMarker = {
    version: string;
    sessions: number;
    dateKey: string;
    timestamp: number;
};

type ApiEndpointFilterPreferences = {
    excludedEndpointQuery?: string;
    selectedFailureCodes?: string[];
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RELEASE_MARKERS = 10;
const HOTSPOT_PAGE_SIZE = 8;
const UNKNOWN_STATUS_CODE_KEY = 'unknown';
const API_ENDPOINT_FILTER_PREFERENCES_PREFIX = 'rejourney.analytics.api.endpointFilters.';

const ENDPOINT_TABLE_PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_ENDPOINT_TABLE_PAGE_SIZE = 100;

const toApiRange = (value: TimeRange): string | undefined => {
    if (value === 'all') return undefined;
    return value;
};

const toTrendsRange = (value: TimeRange): string => {
    if (value === '24h') return '7d';
    if (value === 'all') return 'all';
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

const parseStatusCode = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const compareStatusCodes = (a: string, b: string): number => {
    if (a === UNKNOWN_STATUS_CODE_KEY) return b === UNKNOWN_STATUS_CODE_KEY ? 0 : 1;
    if (b === UNKNOWN_STATUS_CODE_KEY) return -1;

    const aNum = parseStatusCode(a);
    const bNum = parseStatusCode(b);
    if (aNum !== null && bNum !== null) return aNum - bNum;
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
};

const formatStatusCodeLabel = (value: string | null | undefined): string => {
    if (!value) return 'None';
    return value === UNKNOWN_STATUS_CODE_KEY ? 'Unknown' : value;
};

const isVisibleStatusCode = (value: string | null | undefined): value is string =>
    Boolean(value) && value !== UNKNOWN_STATUS_CODE_KEY;

const getStatusCodeBadgeClass = (value: string | null | undefined): string => {
    if (!value) return 'border-slate-200 bg-slate-50 text-slate-500';
    if (value === UNKNOWN_STATUS_CODE_KEY) return 'border-slate-300 bg-slate-100 text-slate-700';

    const statusCode = parseStatusCode(value);
    if (statusCode !== null && statusCode >= 500) return 'border-rose-200 bg-rose-50 text-rose-700';
    if (statusCode !== null && statusCode >= 400) return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-slate-200 bg-slate-50 text-slate-600';
};

const getSelectedErrorCount = (
    breakdown: Record<string, number> | null | undefined,
    selectedCodes: Set<string>,
): number => {
    if (!breakdown || !selectedCodes.size) return 0;

    let total = 0;
    for (const code of selectedCodes) {
        total += Number(breakdown[code] || 0);
    }

    return total;
};

const getCapturedErrorCount = (breakdown: Record<string, number> | null | undefined): number => {
    if (!breakdown) return 0;

    let total = 0;
    for (const [code, count] of Object.entries(breakdown)) {
        if (code === UNKNOWN_STATUS_CODE_KEY) continue;
        const numericCount = Number(count || 0);
        if (!Number.isFinite(numericCount) || numericCount <= 0) continue;
        total += numericCount;
    }

    return total;
};

const splitEndpointLabel = (endpoint: string): { method: string | null; path: string } => {
    const match = endpoint.match(/^([A-Z]+)\s+(.+)$/);
    if (!match) return { method: null, path: endpoint };
    return { method: match[1], path: match[2] };
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
    const [sortKey, setSortKey] = useState<EndpointSortKey>('totalCalls');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [endpointTablePage, setEndpointTablePage] = useState(1);
    const [endpointPageSize, setEndpointPageSize] = useState<number>(DEFAULT_ENDPOINT_TABLE_PAGE_SIZE);
    const [selectedFailureCodes, setSelectedFailureCodes] = useState<string[]>([]);
    const [excludedEndpointQuery, setExcludedEndpointQuery] = useState('');
    const [hydratedFilterPreferenceKey, setHydratedFilterPreferenceKey] = useState<string | null>(null);
    const [slowEndpointPage, setSlowEndpointPage] = useState(1);
    const [errorEndpointPage, setErrorEndpointPage] = useState(1);

    const [endpointStats, setEndpointStats] = useState<ApiEndpointStats | null>(null);
    const [regionStats, setRegionStats] = useState<RegionPerformance | null>(null);
    const [deepMetrics, setDeepMetrics] = useState<ObservabilityDeepMetrics | null>(null);
    const [latencyByLocation, setLatencyByLocation] = useState<ApiLatencyByLocationResponse | null>(null);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    // Persist per project only. A `global` key was used when project id was still loading, so filters
    // were saved there and then wiped when the real project key loaded empty — see load fallback below.
    const endpointFilterPersistenceKey = selectedProject?.id
        ? `${API_ENDPOINT_FILTER_PREFERENCES_PREFIX}${selectedProject.id}`
        : null;

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
        const projectId = selectedProject.id;

        // Endpoint stats + full deep metrics (summary omits latency/Apdex used in KPIs). Region/latency/trends load separately.
        void Promise.allSettled([
            getApiEndpointStats(projectId, range),
            getObservabilityDeepMetrics(projectId, range, 'full'),
        ]).then(([endpointData, deepData]) => {
            if (isCancelled) return;

            if (endpointData.status === 'fulfilled') {
                setEndpointStats(endpointData.value);
            } else {
                console.error('ApiAnalytics endpointStats failed:', endpointData.reason);
                setEndpointStats(null);
            }

            if (deepData.status === 'fulfilled') {
                setDeepMetrics(deepData.value);
            } else {
                console.error('ApiAnalytics deepMetrics failed:', deepData.reason);
                setDeepMetrics(null);
            }

            if (!isCancelled) setIsLoading(false);
        });

        void getRegionPerformance(projectId, toRegionRange(timeRange))
            .then((v) => {
                if (!isCancelled) setRegionStats(v);
            })
            .catch((err) => {
                console.error('ApiAnalytics regionPerformance failed:', err);
                if (!isCancelled) setRegionStats(null);
            });

        void getApiLatencyByLocation(projectId, range)
            .then((v) => {
                if (!isCancelled) setLatencyByLocation(v);
            })
            .catch((err) => {
                console.error('ApiAnalytics geoLatency failed:', err);
                if (!isCancelled) setLatencyByLocation(null);
            });

        void getInsightsTrends(projectId, toTrendsRange(timeRange))
            .then((v) => {
                if (!isCancelled) setTrends(v);
            })
            .catch((err) => {
                console.error('ApiAnalytics trends failed:', err);
                if (!isCancelled) setTrends(null);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!endpointFilterPersistenceKey) {
            setHydratedFilterPreferenceKey(null);
            return;
        }

        try {
            let raw = window.localStorage.getItem(endpointFilterPersistenceKey);
            if (!raw) {
                raw = window.localStorage.getItem(`${API_ENDPOINT_FILTER_PREFERENCES_PREFIX}global`);
            }
            if (!raw) {
                setExcludedEndpointQuery('');
                setSelectedFailureCodes([]);
            } else {
                const parsed = JSON.parse(raw) as ApiEndpointFilterPreferences;
                setExcludedEndpointQuery(typeof parsed.excludedEndpointQuery === 'string' ? parsed.excludedEndpointQuery : '');
                setSelectedFailureCodes(
                    Array.isArray(parsed.selectedFailureCodes)
                        ? parsed.selectedFailureCodes.filter((value): value is string => typeof value === 'string')
                        : [],
                );
            }
        } catch {
            setExcludedEndpointQuery('');
            setSelectedFailureCodes([]);
        } finally {
            setHydratedFilterPreferenceKey(endpointFilterPersistenceKey);
        }
    }, [endpointFilterPersistenceKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!endpointFilterPersistenceKey) return;
        if (hydratedFilterPreferenceKey !== endpointFilterPersistenceKey) return;

        const payload: ApiEndpointFilterPreferences = {
            excludedEndpointQuery,
            selectedFailureCodes,
        };
        window.localStorage.setItem(endpointFilterPersistenceKey, JSON.stringify(payload));
    }, [endpointFilterPersistenceKey, excludedEndpointQuery, hydratedFilterPreferenceKey, selectedFailureCodes]);

    const hasData = Boolean(endpointStats && deepMetrics);
    const selectedFailureCodeKey = selectedFailureCodes.join('|');
    const excludedEndpointTerms = useMemo(
        () => excludedEndpointQuery
            .split(/[,\n]+/)
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        [excludedEndpointQuery],
    );
    const excludedEndpointKey = excludedEndpointTerms.join('|');

    const includedEndpoints = useMemo(() => {
        if (!endpointStats?.allEndpoints) return [];
        if (!excludedEndpointTerms.length) return endpointStats.allEndpoints;

        return endpointStats.allEndpoints.filter((endpoint) => {
            const haystack = endpoint.endpoint.toLowerCase();
            return !excludedEndpointTerms.some((term) => haystack.includes(term));
        });
    }, [endpointStats, excludedEndpointTerms]);

    const excludedEndpointCount = endpointStats?.allEndpoints.length
        ? Math.max(0, endpointStats.allEndpoints.length - includedEndpoints.length)
        : 0;

    const availableFailureCodes = useMemo<FailureCodeOption[]>(() => {
        if (!includedEndpoints.length) return [];

        const totals = new Map<string, number>();
        for (const endpoint of includedEndpoints) {
            for (const [code, count] of Object.entries(endpoint.statusCodeBreakdown || {})) {
                const numericCount = Number(count || 0);
                if (code === UNKNOWN_STATUS_CODE_KEY || !Number.isFinite(numericCount) || numericCount <= 0) continue;
                totals.set(code, (totals.get(code) || 0) + numericCount);
            }
        }

        return Array.from(totals.entries())
            .map(([code, total]) => ({ code, total }))
            .sort((a, b) => compareStatusCodes(a.code, b.code));
    }, [includedEndpoints]);

    const serverFailureCodes = useMemo(
        () => availableFailureCodes
            .filter(({ code }) => {
                const parsed = parseStatusCode(code);
                return parsed !== null && parsed >= 500;
            })
            .map(({ code }) => code),
        [availableFailureCodes],
    );

    const non400FailureCodes = useMemo(
        () => availableFailureCodes
            .filter(({ code }) => code !== '400')
            .map(({ code }) => code),
        [availableFailureCodes],
    );

    // Without the endpointStats guard, the first runs happen while stats are still loading
    // (availableFailureCodes is []). That path returned [] and wiped localStorage-hydrated codes
    // before the fetch completed — breaking Endpoint Hotspots, Slowest, and Highest-error tables together.
    useEffect(() => {
        if (!endpointStats) return;

        const nextAvailable = availableFailureCodes.map(({ code }) => code);
        setSelectedFailureCodes((current) => {
            if (!nextAvailable.length) return [];
            if (!current.length) return nextAvailable;

            const preserved = current.filter((code) => nextAvailable.includes(code));
            return preserved.length ? preserved : nextAvailable;
        });
    }, [availableFailureCodes, endpointStats]);

    const selectedFailureCodeSet = useMemo(() => new Set(selectedFailureCodes), [selectedFailureCodes]);
    const isFailureSelectionActive = selectedFailureCodes.length > 0;
    const has400FailureCode = availableFailureCodes.some(({ code }) => code === '400');
    const matchesSelectedFailureCodes = (codes: string[]) =>
        selectedFailureCodes.length === codes.length && codes.every((code) => selectedFailureCodeSet.has(code));

    const failureCodeSummary = useMemo(() => {
        if (!availableFailureCodes.length) return 'No captured codes';
        if (!selectedFailureCodes.length) return 'Nothing selected';
        if (matchesSelectedFailureCodes(availableFailureCodes.map(({ code }) => code))) return 'All captured codes';
        if (matchesSelectedFailureCodes(serverFailureCodes)) return '5xx only';
        if (has400FailureCode && matchesSelectedFailureCodes(non400FailureCodes)) return 'Ignoring 400';

        const labels = selectedFailureCodes.map((code) => formatStatusCodeLabel(code));
        if (labels.length <= 3) return labels.join(' · ');
        return `${selectedFailureCodes.length} active`;
    }, [
        availableFailureCodes,
        has400FailureCode,
        non400FailureCodes,
        selectedFailureCodes,
        serverFailureCodes,
    ]);

    const endpointRisks = useMemo<EndpointRisk[]>(() => {
        if (!includedEndpoints.length) return [];
        const getSortMetric = (endpoint: EndpointRisk): number => {
            switch (sortKey) {
                case 'totalCalls':
                    return endpoint.totalCalls;
                case 'filteredErrorCount':
                    return endpoint.filteredErrorCount;
                case 'filteredErrorRate':
                    return endpoint.filteredErrorRate;
                case 'avgLatencyMs':
                    return endpoint.avgLatencyMs;
                case 'riskScore':
                    return endpoint.riskScore;
                default:
                    return 0;
            }
        };

        const base = includedEndpoints.map((endpoint) => {
            const filteredErrorCount = getSelectedErrorCount(endpoint.statusCodeBreakdown, selectedFailureCodeSet);
            const filteredErrorRate = endpoint.totalCalls > 0
                ? Number(((filteredErrorCount / endpoint.totalCalls) * 100).toFixed(2))
                : 0;
            const riskScore =
                filteredErrorRate * 10 +
                Math.max(0, endpoint.avgLatencyMs - 300) / 40 +
                Math.log10(endpoint.totalCalls + 1);

            return {
                ...endpoint,
                filteredErrorCount,
                filteredErrorRate,
                riskScore,
            };
        });

        return [...base].sort((a, b) => {
            if (sortKey === 'endpoint') {
                return sortOrder === 'asc'
                    ? a.endpoint.localeCompare(b.endpoint)
                    : b.endpoint.localeCompare(a.endpoint);
            }

            const aNum = getSortMetric(a);
            const bNum = getSortMetric(b);
            return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
        });
    }, [includedEndpoints, selectedFailureCodeSet, sortKey, sortOrder]);

    const filteredEndpoints = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return endpointRisks;
        return endpointRisks.filter((endpoint) => endpoint.endpoint.toLowerCase().includes(q));
    }, [endpointRisks, searchQuery]);

    const endpointTableTotalPages = Math.max(1, Math.ceil(filteredEndpoints.length / endpointPageSize));
    const endpointTablePageClamped = Math.min(endpointTablePage, endpointTableTotalPages);

    const paginatedEndpoints = useMemo(() => {
        const start = (endpointTablePageClamped - 1) * endpointPageSize;
        return filteredEndpoints.slice(start, start + endpointPageSize);
    }, [filteredEndpoints, endpointTablePageClamped, endpointPageSize]);

    useEffect(() => {
        setEndpointTablePage(1);
    }, [searchQuery, excludedEndpointKey, selectedFailureCodeKey, sortKey, sortOrder, timeRange, selectedProject?.id]);

    useEffect(() => {
        if (endpointTablePage > endpointTableTotalPages) {
            setEndpointTablePage(endpointTableTotalPages);
        }
    }, [endpointTablePage, endpointTableTotalPages]);

    const slowEndpointRows = useMemo(
        () => [...endpointRisks].sort((a, b) => (
            b.avgLatencyMs - a.avgLatencyMs ||
            b.filteredErrorRate - a.filteredErrorRate ||
            b.totalCalls - a.totalCalls
        )),
        [endpointRisks],
    );
    const errorEndpointRows = useMemo<ErrorHotspotRow[]>(
        () => endpointRisks
            .map((endpoint) => {
                const usesTotalErrorFallback = getCapturedErrorCount(endpoint.statusCodeBreakdown) <= 0 && endpoint.totalErrors > 0;
                const displayErrorCount = usesTotalErrorFallback ? endpoint.totalErrors : endpoint.filteredErrorCount;
                const displayErrorRate = usesTotalErrorFallback ? endpoint.errorRate : endpoint.filteredErrorRate;

                return {
                    ...endpoint,
                    displayErrorCount,
                    displayErrorRate,
                    usesTotalErrorFallback,
                };
            })
            .filter((endpoint) => endpoint.displayErrorCount > 0)
            .sort((a, b) => (
                b.displayErrorCount - a.displayErrorCount ||
                b.displayErrorRate - a.displayErrorRate ||
                b.totalCalls - a.totalCalls
            )),
        [endpointRisks],
    );

    const slowEndpointTotalPages = Math.max(1, Math.ceil(slowEndpointRows.length / HOTSPOT_PAGE_SIZE));
    const errorEndpointTotalPages = Math.max(1, Math.ceil(errorEndpointRows.length / HOTSPOT_PAGE_SIZE));
    const slowEndpointPageClamped = Math.min(slowEndpointPage, slowEndpointTotalPages);
    const errorEndpointPageClamped = Math.min(errorEndpointPage, errorEndpointTotalPages);

    const paginatedSlowEndpoints = useMemo(() => {
        const start = (slowEndpointPageClamped - 1) * HOTSPOT_PAGE_SIZE;
        return slowEndpointRows.slice(start, start + HOTSPOT_PAGE_SIZE);
    }, [slowEndpointPageClamped, slowEndpointRows]);
    const paginatedErrorEndpoints = useMemo(() => {
        const start = (errorEndpointPageClamped - 1) * HOTSPOT_PAGE_SIZE;
        return errorEndpointRows.slice(start, start + HOTSPOT_PAGE_SIZE);
    }, [errorEndpointPageClamped, errorEndpointRows]);

    useEffect(() => {
        setSlowEndpointPage(1);
        setErrorEndpointPage(1);
    }, [excludedEndpointKey, selectedFailureCodeKey, timeRange, selectedProject?.id]);

    useEffect(() => {
        if (slowEndpointPage > slowEndpointTotalPages) {
            setSlowEndpointPage(slowEndpointTotalPages);
        }
    }, [slowEndpointPage, slowEndpointTotalPages]);

    useEffect(() => {
        if (errorEndpointPage > errorEndpointTotalPages) {
            setErrorEndpointPage(errorEndpointTotalPages);
        }
    }, [errorEndpointPage, errorEndpointTotalPages]);

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

    if (isLoading && selectedProject?.id) {
        return <DashboardGhostLoader variant="analytics" />;
    }

    return (
        <div className="min-h-screen font-sans text-slate-900 bg-transparent">
            <div className="sticky top-0 z-30 bg-white">
                <DashboardPageHeader
                    title="API Reliability & Performance"
                    icon={<Activity className="w-6 h-6" />}
                    iconColor="bg-emerald-500"
                >
                    <div className="flex items-center gap-3">
                        <DataWatermarkBanner dataCompleteThrough={trends?.dataCompleteThrough} />
                        <TimeFilter value={timeRange} onChange={setTimeRange} />
                    </div>
                </DashboardPageHeader>
            </div>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-6 py-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to load API insights.
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="border border-gray-200 bg-white p-6 text-sm text-slate-600" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
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

                        <section className="border border-gray-200 bg-white p-5" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="text-lg font-black font-mono uppercase tracking-wide text-black">Traffic vs Errors vs Latency</h2>
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

                        <section className="border border-gray-200 bg-white p-5" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="inline-flex h-10 w-10 items-center justify-center border-2 border-black bg-[#f4f4f5] text-slate-600">
                                            <Server className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-black font-mono uppercase tracking-wide text-black">Endpoint Hotspots</h2>
                                            <p className="text-xs text-slate-500">
                                                {formatCompact(includedEndpoints.length)} shown
                                                {excludedEndpointCount > 0 ? ` · ${formatCompact(excludedEndpointCount)} excluded` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="hidden border-2 border-black bg-[#f4f4f5] text-black font-mono px-3 py-1.5 text-xs font-medium sm:inline-flex">
                                        {failureCodeSummary}
                                    </span>
                                </div>

                                <div className="bg-[#f4f4f5] border border-gray-200 p-3">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Failure codes</span>
                                            <span className="border-2 border-black bg-[#f4f4f5] text-black font-mono px-2.5 py-1 text-xs font-medium sm:hidden">
                                                {failureCodeSummary}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedFailureCodes(availableFailureCodes.map(({ code }) => code))}
                                                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                                    matchesSelectedFailureCodes(availableFailureCodes.map(({ code }) => code)) && availableFailureCodes.length > 0
                                                        ? 'border-emerald-900 bg-emerald-900 text-white'
                                                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                                                }`}
                                            >
                                                All
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedFailureCodes(serverFailureCodes)}
                                                disabled={serverFailureCodes.length === 0}
                                                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                                    matchesSelectedFailureCodes(serverFailureCodes) && serverFailureCodes.length > 0
                                                        ? 'border-emerald-900 bg-emerald-900 text-white'
                                                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                                                } disabled:pointer-events-none disabled:opacity-40`}
                                            >
                                                5xx
                                            </button>
                                            {has400FailureCode && (
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedFailureCodes(non400FailureCodes)}
                                                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                                        matchesSelectedFailureCodes(non400FailureCodes)
                                                            ? 'border-emerald-900 bg-emerald-900 text-white'
                                                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                                                    }`}
                                                >
                                                    No 400
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {availableFailureCodes.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            {availableFailureCodes.map(({ code, total }) => {
                                                const selected = selectedFailureCodeSet.has(code);
                                                return (
                                                    <button
                                                        key={code}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedFailureCodes((current) => {
                                                                const next = new Set(current);
                                                                if (next.has(code)) next.delete(code);
                                                                else next.add(code);
                                                                return availableFailureCodes
                                                                    .map((option) => option.code)
                                                                    .filter((optionCode) => next.has(optionCode));
                                                            });
                                                        }}
                                                        className={`inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
                                                            selected
                                                                ? 'border-emerald-900 bg-emerald-900 text-white'
                                                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        <span>{formatStatusCodeLabel(code)}</span>
                                                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                                            {formatCompact(total)}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
                                        <div className="min-w-0 flex-1">
                                            <input
                                                value={excludedEndpointQuery}
                                                onChange={(event) => setExcludedEndpointQuery(event.target.value)}
                                                placeholder="Exclude endpoints: /images, /health, POST /auth (comma separated)"
                                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                            />
                                        </div>
                                        {excludedEndpointTerms.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setExcludedEndpointQuery('')}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
                                            >
                                                Clear exclusions
                                            </button>
                                        )}
                                    </div>

                                    {excludedEndpointTerms.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {excludedEndpointTerms.map((term) => (
                                                <span
                                                    key={term}
                                                    className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800"
                                                >
                                                    {term}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                                    <div className="overflow-hidden border border-gray-200 bg-white" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                                        <div className="flex items-center justify-between border-b-2 border-black px-4 py-4">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                                                    <h3 className="text-sm font-bold font-mono uppercase text-black">Slowest Endpoints</h3>
                                                </div>
                                                <p className="mt-1 text-xs text-slate-500">Peak {slowEndpointRows[0] ? `${slowEndpointRows[0].avgLatencyMs} ms` : 'N/A'}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    aria-label="Previous slow endpoint page"
                                                    disabled={slowEndpointPageClamped <= 1}
                                                    onClick={() => setSlowEndpointPage((page) => Math.max(1, page - 1))}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </button>
                                                <span className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums text-slate-500">
                                                    {slowEndpointPageClamped}/{slowEndpointTotalPages}
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label="Next slow endpoint page"
                                                    disabled={slowEndpointPageClamped >= slowEndpointTotalPages}
                                                    onClick={() => setSlowEndpointPage((page) => Math.min(slowEndpointTotalPages, page + 1))}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto">
                                            <div className="min-w-[620px]">
                                                <div className="grid grid-cols-[42px_minmax(0,1fr)_90px_90px_110px] gap-3 border-b-2 border-black px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                                    <span>#</span>
                                                    <span>Endpoint</span>
                                                    <span className="text-right">Calls</span>
                                                    <span className="text-right">Fail</span>
                                                    <span className="text-right">Latency</span>
                                                </div>
                                                <div className="divide-y divide-gray-200">
                                                    {paginatedSlowEndpoints.length === 0 ? (
                                                        <div className="px-4 py-10 text-sm text-slate-500">No latency data</div>
                                                    ) : (
                                                        paginatedSlowEndpoints.map((endpoint, index) => {
                                                            const { method, path } = splitEndpointLabel(endpoint.endpoint);
                                                            return (
                                                                <div key={endpoint.endpoint} className="grid grid-cols-[42px_minmax(0,1fr)_90px_90px_110px] items-center gap-3 px-4 py-3">
                                                                    <div className="text-sm font-semibold text-slate-400">
                                                                        {String((slowEndpointPageClamped - 1) * HOTSPOT_PAGE_SIZE + index + 1).padStart(2, '0')}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            {method && (
                                                                                <span className="inline-flex border-2 border-black bg-[#f4f4f5] text-black font-mono px-2 py-0.5 text-[11px] font-semibold">
                                                                                    {method}
                                                                                </span>
                                                                            )}
                                                                            <span className="truncate text-sm font-medium text-slate-900">{path}</span>
                                                                        </div>
                                                                        {isVisibleStatusCode(endpoint.mostCommonErrorCode) && (
                                                                            <div className="mt-1">
                                                                                <span className={`inline-flex border-2 border-black bg-[#f4f4f5] text-black font-mono px-2 py-0.5 text-[11px] font-medium ${getStatusCodeBadgeClass(endpoint.mostCommonErrorCode)}`}>
                                                                                    {formatStatusCodeLabel(endpoint.mostCommonErrorCode)}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="text-right text-sm text-slate-700">{formatCompact(endpoint.totalCalls)}</div>
                                                                    <div className={`text-right text-sm font-medium ${getFailRateToneClass(endpoint.filteredErrorRate)}`}>
                                                                        {endpoint.filteredErrorRate.toFixed(1)}%
                                                                    </div>
                                                                    <div className={`text-right text-sm font-semibold ${getLatencyToneClass(endpoint.avgLatencyMs)}`}>
                                                                        {endpoint.avgLatencyMs} ms
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="overflow-hidden border border-gray-200 bg-white" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                                        <div className="flex items-center justify-between border-b-2 border-black px-4 py-4">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                                                    <h3 className="text-sm font-bold font-mono uppercase text-black">Most Erroring Endpoints</h3>
                                                </div>
                                                <p className="mt-1 text-xs text-slate-500">Top count {errorEndpointRows[0] ? formatCompact(errorEndpointRows[0].displayErrorCount) : 'N/A'}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    aria-label="Previous error endpoint page"
                                                    disabled={errorEndpointPageClamped <= 1}
                                                    onClick={() => setErrorEndpointPage((page) => Math.max(1, page - 1))}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </button>
                                                <span className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums text-slate-500">
                                                    {errorEndpointPageClamped}/{errorEndpointTotalPages}
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label="Next error endpoint page"
                                                    disabled={errorEndpointPageClamped >= errorEndpointTotalPages}
                                                    onClick={() => setErrorEndpointPage((page) => Math.min(errorEndpointTotalPages, page + 1))}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto">
                                            <div className="min-w-[620px]">
                                                <div className="grid grid-cols-[42px_minmax(0,1fr)_90px_100px_110px] gap-3 border-b-2 border-black px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                                    <span>#</span>
                                                    <span>Endpoint</span>
                                                    <span className="text-right">Calls</span>
                                                    <span className="text-right">Top Code</span>
                                                    <span className="text-right">Errors</span>
                                                </div>
                                                <div className="divide-y divide-gray-200">
                                                    {paginatedErrorEndpoints.length === 0 ? (
                                                        <div className="px-4 py-10 text-sm text-slate-500">
                                                            No failing endpoints
                                                        </div>
                                                    ) : (
                                                        paginatedErrorEndpoints.map((endpoint, index) => {
                                                            const { method, path } = splitEndpointLabel(endpoint.endpoint);
                                                            return (
                                                                <div key={endpoint.endpoint} className="grid grid-cols-[42px_minmax(0,1fr)_90px_100px_110px] items-center gap-3 px-4 py-3">
                                                                    <div className="text-sm font-semibold text-slate-400">
                                                                        {String((errorEndpointPageClamped - 1) * HOTSPOT_PAGE_SIZE + index + 1).padStart(2, '0')}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            {method && (
                                                                                <span className="inline-flex border-2 border-black bg-[#f4f4f5] text-black font-mono px-2 py-0.5 text-[11px] font-semibold">
                                                                                    {method}
                                                                                </span>
                                                                            )}
                                                                            <span className="truncate text-sm font-medium text-slate-900">{path}</span>
                                                                        </div>
                                                                        <div className="mt-1 text-xs text-slate-500">{endpoint.displayErrorRate.toFixed(1)}% fail</div>
                                                                    </div>
                                                                    <div className="text-right text-sm text-slate-700">{formatCompact(endpoint.totalCalls)}</div>
                                                                    <div className="text-right">
                                                                        {isVisibleStatusCode(endpoint.mostCommonErrorCode) ? (
                                                                            <span className={`inline-flex border-2 border-black bg-[#f4f4f5] text-black font-mono px-2 py-0.5 text-[11px] font-medium ${getStatusCodeBadgeClass(endpoint.mostCommonErrorCode)}`}>
                                                                                {formatStatusCodeLabel(endpoint.mostCommonErrorCode)}
                                                                            </span>
                                                                        ) : (
                                                                            <span className="text-xs font-medium text-slate-300">-</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="text-right text-sm font-semibold text-rose-600">
                                                                        {formatCompact(endpoint.displayErrorCount)}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="border border-gray-200 bg-white p-5" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                                <h2 className="mb-4 text-lg font-black font-mono uppercase tracking-wide text-black">API Usage Intensity</h2>
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

                            <div className="border border-gray-200 bg-white p-5" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                                <h2 className="mb-2 text-lg font-black font-mono uppercase tracking-wide text-black">Network Correlation</h2>
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
                                                            <div className="border border-gray-200 bg-white px-3 py-2 text-xs text-slate-700" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
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
                            <div className="border border-gray-200 bg-white p-5" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-black font-mono uppercase tracking-wide text-black">Regional API Latency</h2>
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

                            <div className="border border-gray-200 bg-white p-5" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                                <h2 className="mb-4 text-lg font-black font-mono uppercase tracking-wide text-black">Latency by Country</h2>
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

                            <div className="border border-gray-200 bg-white p-5" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                                <h2 className="mb-4 text-lg font-black font-mono uppercase tracking-wide text-black">Network Reliability Snapshot</h2>
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

                        <section className="border border-gray-200 bg-white p-5" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <h2 className="text-lg font-black font-mono uppercase tracking-wide text-black">Endpoint Activity</h2>
                                    <p className="mt-1 max-w-2xl text-sm text-slate-500">
                                        Sorted by call volume. Failure code rules and endpoint exclusions apply here.
                                    </p>
                                    {filteredEndpoints.length > endpointPageSize && (
                                        <p className="mt-2 max-w-xl text-xs text-slate-500">
                                            Showing {endpointPageSize} rows per page —{' '}
                                            <span className="font-medium text-slate-600">
                                                {filteredEndpoints.length.toLocaleString()} endpoints
                                            </span>{' '}
                                            in this range. Use <span className="font-medium">Rows per page</span> and the arrows under the table to see the rest.
                                        </p>
                                    )}
                                </div>
                                <div className="relative w-full md:w-[360px]">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <input
                                        value={searchQuery}
                                        onChange={(event) => setSearchQuery(event.target.value)}
                                        placeholder="Search shown endpoints"
                                        className="w-full rounded-2xl border border-slate-100/80 bg-slate-50/50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white"
                                    />
                                </div>
                            </div>

                            <div className="overflow-x-auto border border-gray-200" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                                <table className="w-full min-w-[1120px] text-left text-sm">
                                    <thead className="sticky top-0 bg-[#f4f4f5] text-black font-mono text-xs uppercase tracking-wide">
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
                                                    if (sortKey === 'filteredErrorCount') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('filteredErrorCount'); setSortOrder('desc'); }
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Errors
                                                    {sortKey === 'filteredErrorCount' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                            <th
                                                className="cursor-pointer px-4 py-3 pr-4 text-right hover:text-slate-900"
                                                onClick={() => {
                                                    if (sortKey === 'filteredErrorRate') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('filteredErrorRate'); setSortOrder('desc'); }
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Fail %
                                                    {sortKey === 'filteredErrorRate' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
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
                                            <th className="px-4 py-3 pr-4 text-right">
                                                Top Error Code
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
                                    <tbody className="divide-y divide-gray-200">
                                        {paginatedEndpoints.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                                                    No endpoints match the current search or exclusions.
                                                </td>
                                            </tr>
                                        ) : (
                                            paginatedEndpoints.map((endpoint) => (
                                                <tr key={endpoint.endpoint} className="transition-colors hover:bg-[#f4f4f5]">
                                                    <td className="px-4 py-3 pr-4 font-mono text-[12px] font-semibold text-slate-900">{endpoint.endpoint}</td>
                                                    <td className="px-4 py-3 pr-4 text-right text-slate-700">{formatCompact(endpoint.totalCalls)}</td>
                                                    <td className="px-4 py-3 pr-4 text-right text-slate-700">{formatCompact(endpoint.filteredErrorCount)}</td>
                                                    <td className={`px-4 py-3 pr-4 text-right font-semibold ${getFailRateToneClass(endpoint.filteredErrorRate)}`}>{endpoint.filteredErrorRate.toFixed(2)}%</td>
                                                    <td className={`px-4 py-3 pr-4 text-right font-semibold ${getLatencyToneClass(endpoint.avgLatencyMs)}`}>{endpoint.avgLatencyMs} ms</td>
                                                    <td className="px-4 py-3 pr-4 text-right">
                                                        {isVisibleStatusCode(endpoint.mostCommonErrorCode) ? (
                                                            <span className={`inline-flex border-2 border-black bg-[#f4f4f5] text-black font-mono px-2 py-0.5 text-xs font-semibold ${getStatusCodeBadgeClass(endpoint.mostCommonErrorCode)}`}>
                                                                {formatStatusCodeLabel(endpoint.mostCommonErrorCode)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs font-medium text-slate-300">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 pr-4 text-right">
                                                        <span className={`inline-flex border-2 border-black px-2 py-0.5 text-xs font-semibold ${getRiskBadgeClass(endpoint.riskScore)}`}>
                                                            {endpoint.riskScore.toFixed(1)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {filteredEndpoints.length > 0 && (
                                <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-sm text-slate-600">
                                        Showing{' '}
                                        <span className="font-semibold text-slate-900">
                                            {(endpointTablePageClamped - 1) * endpointPageSize + 1}
                                            –
                                            {Math.min(endpointTablePageClamped * endpointPageSize, filteredEndpoints.length)}
                                        </span>{' '}
                                        of <span className="font-semibold text-slate-900">{filteredEndpoints.length.toLocaleString()}</span> endpoints
                                    </p>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <label className="flex items-center gap-2 text-sm text-slate-600">
                                            <span className="whitespace-nowrap">Rows per page</span>
                                            <select
                                                value={endpointPageSize}
                                                onChange={(e) => {
                                                    const next = Number(e.target.value);
                                                    setEndpointPageSize(next);
                                                    setEndpointTablePage(1);
                                                }}
                                                className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-300"
                                            >
                                                {ENDPOINT_TABLE_PAGE_SIZES.map((n) => (
                                                    <option key={n} value={n}>
                                                        {n}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                aria-label="Previous page"
                                                disabled={endpointTablePageClamped <= 1}
                                                onClick={() => setEndpointTablePage((p) => Math.max(1, p - 1))}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                            </button>
                                            <span className="min-w-[7rem] px-2 text-center text-sm tabular-nums text-slate-700">
                                                Page {endpointTablePageClamped} / {endpointTableTotalPages}
                                            </span>
                                            <button
                                                type="button"
                                                aria-label="Next page"
                                                disabled={endpointTablePageClamped >= endpointTableTotalPages}
                                                onClick={() => setEndpointTablePage((p) => Math.min(endpointTableTotalPages, p + 1))}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </div>
    );
};

export default ApiAnalytics;
