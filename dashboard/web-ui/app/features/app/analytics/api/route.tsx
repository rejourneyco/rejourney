import React, { startTransition, useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Database,
    Filter,
    Search,
    SlidersHorizontal,
    X,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    Legend,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useSessionData } from '~/shared/providers/SessionContext';
import {
    getApiOverview,
    ApiEndpointStats,
    InsightsTrends,
} from '~/shared/api/client';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { type TimeRange } from '~/shared/ui/core/TimeFilter';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { useSharedPlatformLens, platformLensToSessionPlatform } from '~/shared/hooks/useSharedPlatformLens';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
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

type EndpointLatencyFilter = 'all' | 'fast' | 'warm' | 'slow' | 'tail';
type EndpointStatusFamilyFilter = 'all' | 'errors' | '4xx' | '5xx';
type EndpointVolumeFilter = 'all' | 'active' | 'hot' | 'heavy';
type EndpointRiskFilter = 'all' | 'watch' | 'critical';

type NumericQueryRule = {
    operator: '>' | '>=' | '<' | '<=' | '=';
    value: number;
};

type ParsedEndpointQuery = {
    terms: string[];
    method?: string;
    pathTerms: string[];
    statusCode?: string;
    statusFamily?: '4xx' | '5xx';
    calls?: NumericQueryRule;
    errors?: NumericQueryRule;
    latency?: NumericQueryRule;
    failRate?: NumericQueryRule;
    risk?: NumericQueryRule;
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
const UNKNOWN_STATUS_CODE_KEY = 'unknown';
const API_ENDPOINT_FILTER_PREFERENCES_PREFIX = 'rejourney.analytics.api.endpointFilters.';

const ENDPOINT_TABLE_PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_ENDPOINT_TABLE_PAGE_SIZE = 25;

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

const getStatusCodeBadgeClass = (value: string | null | undefined): string => {
    if (!value) return 'border-slate-200 bg-slate-50 text-slate-500';
    if (value === UNKNOWN_STATUS_CODE_KEY) return 'border-slate-300 bg-slate-100 text-slate-700';

    const statusCode = parseStatusCode(value);
    if (statusCode !== null && statusCode >= 500) return 'border-rose-200 bg-rose-50 text-rose-700';
    if (statusCode !== null && statusCode >= 400) return 'border-rose-200 bg-rose-50 text-rose-700';
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

const splitEndpointLabel = (endpoint: string): { method: string | null; path: string } => {
    const match = endpoint.match(/^([A-Z]+)\s+(.+)$/);
    if (!match) return { method: null, path: endpoint };
    return { method: match[1], path: match[2] };
};

const parseExcludedEndpointTerms = (value: string): string[] => value
    .split(/[,\n]+/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

const serializeExcludedEndpointTerms = (terms: string[]): string => terms.join(', ');

const getFailRateToneClass = (failRate: number): string => {
    if (failRate >= 5) return 'text-rose-700';
    if (failRate >= 2) return 'text-rose-700';
    return 'text-emerald-700';
};

const getLatencyToneClass = (latencyMs: number): string => {
    if (latencyMs >= 1000) return 'text-rose-800';
    if (latencyMs >= 500) return 'text-rose-700';
    return 'text-slate-700';
};

const getRiskBadgeClass = (riskScore: number): string => {
    if (riskScore >= 80) return 'border-rose-300 bg-rose-50 text-rose-700';
    if (riskScore >= 50) return 'border-rose-300 bg-rose-50 text-rose-700';
    return 'border-emerald-300 bg-emerald-50 text-emerald-700';
};

const getFailurePresetButtonClass = (selected: boolean): string =>
    selected
        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
        : 'border-transparent bg-transparent text-slate-500 hover:bg-[#f8fafc] hover:text-slate-800';

const getFailureCodeFilterClass = (code: string, selected: boolean): string => {
    if (selected) return 'border-emerald-300 bg-emerald-50 text-emerald-800';

    const statusCode = parseStatusCode(code);
    if (statusCode !== null && statusCode >= 500) {
        return 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-800';
    }
    if (statusCode !== null && statusCode >= 400) {
        return 'border-slate-200 bg-white text-slate-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-800';
    }
    return 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-[#f8fafc]';
};

const getFailureCodeCountClass = (code: string, selected: boolean): string => {
    if (selected) return 'text-emerald-700';

    const statusCode = parseStatusCode(code);
    if (statusCode !== null && statusCode >= 500) return 'text-rose-500';
    if (statusCode !== null && statusCode >= 400) return 'text-amber-600';
    return 'text-slate-400';
};

const parseScaledNumber = (rawValue: string): number | null => {
    const match = rawValue.trim().match(/^(\d+(?:\.\d+)?)(k|m|ms|%)?$/i);
    if (!match) return null;

    const base = Number(match[1]);
    if (!Number.isFinite(base)) return null;

    const suffix = match[2]?.toLowerCase();
    if (suffix === 'k') return base * 1_000;
    if (suffix === 'm') return base * 1_000_000;
    return base;
};

const parseNumericQueryRule = (rawValue: string): NumericQueryRule | undefined => {
    const trimmed = rawValue.trim();
    const match = trimmed.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!match) return undefined;

    const value = parseScaledNumber(match[2]);
    if (value === null) return undefined;

    return {
        operator: (match[1] as NumericQueryRule['operator'] | undefined) ?? '>=',
        value,
    };
};

const matchesNumericQueryRule = (actual: number, rule?: NumericQueryRule): boolean => {
    if (!rule) return true;
    switch (rule.operator) {
        case '>':
            return actual > rule.value;
        case '>=':
            return actual >= rule.value;
        case '<':
            return actual < rule.value;
        case '<=':
            return actual <= rule.value;
        case '=':
            return actual === rule.value;
        default:
            return true;
    }
};

const parseEndpointQuery = (rawQuery: string): ParsedEndpointQuery => {
    const parsed: ParsedEndpointQuery = { terms: [], pathTerms: [] };
    const tokens = rawQuery
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);

    for (const token of tokens) {
        const separatorIndex = token.indexOf(':');
        if (separatorIndex <= 0) {
            parsed.terms.push(token.toLowerCase());
            continue;
        }

        const key = token.slice(0, separatorIndex).toLowerCase();
        const value = token.slice(separatorIndex + 1).trim();
        if (!value) continue;

        if (key === 'method' || key === 'm') {
            parsed.method = value.toUpperCase();
            continue;
        }
        if (key === 'path' || key === 'endpoint' || key === 'url') {
            parsed.pathTerms.push(value.toLowerCase());
            continue;
        }
        if (key === 'status' || key === 'code') {
            const normalized = value.toLowerCase();
            if (normalized === '4xx' || normalized === '5xx') parsed.statusFamily = normalized;
            else parsed.statusCode = value;
            continue;
        }
        if (key === 'calls') {
            parsed.calls = parseNumericQueryRule(value);
            continue;
        }
        if (key === 'errors') {
            parsed.errors = parseNumericQueryRule(value);
            continue;
        }
        if (key === 'latency' || key === 'ms') {
            parsed.latency = parseNumericQueryRule(value);
            continue;
        }
        if (key === 'fail' || key === 'errorrate' || key === 'failrate') {
            parsed.failRate = parseNumericQueryRule(value);
            continue;
        }
        if (key === 'risk') {
            parsed.risk = parseNumericQueryRule(value);
            continue;
        }

        parsed.terms.push(token.toLowerCase());
    }

    return parsed;
};

const endpointHasStatusCode = (
    breakdown: Record<string, number> | null | undefined,
    code: string,
): boolean => Number(breakdown?.[code] || 0) > 0;

const endpointHasStatusFamily = (
    breakdown: Record<string, number> | null | undefined,
    family: '4xx' | '5xx',
): boolean => {
    if (!breakdown) return false;
    const min = family === '4xx' ? 400 : 500;
    const max = family === '4xx' ? 499 : 599;

    return Object.entries(breakdown).some(([code, count]) => {
        const parsed = parseStatusCode(code);
        return parsed !== null && parsed >= min && parsed <= max && Number(count || 0) > 0;
    });
};

const endpointMatchesParsedQuery = (endpoint: EndpointRisk, query: ParsedEndpointQuery): boolean => {
    const { method, path } = splitEndpointLabel(endpoint.endpoint);
    const endpointText = endpoint.endpoint.toLowerCase();
    const pathText = path.toLowerCase();

    if (query.method && method !== query.method) return false;
    if (query.statusCode && !endpointHasStatusCode(endpoint.statusCodeBreakdown, query.statusCode)) return false;
    if (query.statusFamily && !endpointHasStatusFamily(endpoint.statusCodeBreakdown, query.statusFamily)) return false;
    if (!query.terms.every((term) => endpointText.includes(term))) return false;
    if (!query.pathTerms.every((term) => pathText.includes(term))) return false;
    if (!matchesNumericQueryRule(endpoint.totalCalls, query.calls)) return false;
    if (!matchesNumericQueryRule(endpoint.filteredErrorCount, query.errors)) return false;
    if (!matchesNumericQueryRule(endpoint.avgLatencyMs, query.latency)) return false;
    if (!matchesNumericQueryRule(endpoint.filteredErrorRate, query.failRate)) return false;
    if (!matchesNumericQueryRule(endpoint.riskScore, query.risk)) return false;

    return true;
};

const getTopStatusCodes = (breakdown: Record<string, number> | null | undefined, limit = 3): FailureCodeOption[] => {
    if (!breakdown) return [];
    return Object.entries(breakdown)
        .map(([code, total]) => ({ code, total: Number(total || 0) }))
        .filter(({ code, total }) => code !== UNKNOWN_STATUS_CODE_KEY && Number.isFinite(total) && total > 0)
        .sort((a, b) => b.total - a.total || compareStatusCodes(a.code, b.code))
        .slice(0, limit);
};

export const ApiAnalytics: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);

    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortKey, setSortKey] = useState<EndpointSortKey>('totalCalls');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [endpointTablePage, setEndpointTablePage] = useState(1);
    const [endpointPageSize, setEndpointPageSize] = useState<number>(DEFAULT_ENDPOINT_TABLE_PAGE_SIZE);
    const [methodFilter, setMethodFilter] = useState<string>('all');
    const [statusFamilyFilter, setStatusFamilyFilter] = useState<EndpointStatusFamilyFilter>('all');
    const [latencyFilter, setLatencyFilter] = useState<EndpointLatencyFilter>('all');
    const [volumeFilter, setVolumeFilter] = useState<EndpointVolumeFilter>('all');
    const [riskFilter, setRiskFilter] = useState<EndpointRiskFilter>('all');
    const [selectedFailureCodes, setSelectedFailureCodes] = useState<string[]>([]);
    const [excludedEndpointQuery, setExcludedEndpointQuery] = useState('');
    const [hydratedFilterPreferenceKey, setHydratedFilterPreferenceKey] = useState<string | null>(null);

    const [endpointStats, setEndpointStats] = useState<ApiEndpointStats | null>(null);
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
            setTrends(null);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);

        void getApiOverview(selectedProject.id, timeRange, platform)
            .then((overview) => {
                if (isCancelled) return;
                setEndpointStats(overview.endpointStats);
                setTrends(overview.trends);
            })
            .catch((err) => {
                console.error('ApiAnalytics overview failed:', err);
                if (isCancelled) return;
                setEndpointStats(null);
                setTrends(null);
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!endpointFilterPersistenceKey) {
            startTransition(() => {
                setHydratedFilterPreferenceKey(null);
            });
            return;
        }

        try {
            let raw = window.localStorage.getItem(endpointFilterPersistenceKey);
            if (!raw) {
                raw = window.localStorage.getItem(`${API_ENDPOINT_FILTER_PREFERENCES_PREFIX}global`);
            }
            if (!raw) {
                startTransition(() => {
                    setExcludedEndpointQuery('');
                    setSelectedFailureCodes([]);
                });
            } else {
                const parsed = JSON.parse(raw) as ApiEndpointFilterPreferences;
                startTransition(() => {
                    setExcludedEndpointQuery(typeof parsed.excludedEndpointQuery === 'string' ? parsed.excludedEndpointQuery : '');
                    setSelectedFailureCodes(
                        Array.isArray(parsed.selectedFailureCodes)
                            ? parsed.selectedFailureCodes.filter((value): value is string => typeof value === 'string')
                            : [],
                    );
                });
            }
        } catch {
            startTransition(() => {
                setExcludedEndpointQuery('');
                setSelectedFailureCodes([]);
            });
        } finally {
            startTransition(() => {
                setHydratedFilterPreferenceKey(endpointFilterPersistenceKey);
            });
        }
    }, [endpointFilterPersistenceKey]);

    const hasData = Boolean(endpointStats);
    const selectedFailureCodeKey = selectedFailureCodes.join('|');
    const excludedEndpointTerms = useMemo(
        () => parseExcludedEndpointTerms(excludedEndpointQuery),
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
    const availableFailureCodeValues = useMemo(
        () => availableFailureCodes.map(({ code }) => code),
        [availableFailureCodes],
    );

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
    // before the fetch completed, which made the endpoint database ignore saved failure-code filters.
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
    const isDefaultFailureCodeSelection = availableFailureCodeValues.length > 0 && matchesSelectedFailureCodes(availableFailureCodeValues);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!endpointFilterPersistenceKey) return;
        if (hydratedFilterPreferenceKey !== endpointFilterPersistenceKey) return;
        if (!endpointStats) return;

        const payload: ApiEndpointFilterPreferences = {};
        if (excludedEndpointQuery.trim()) {
            payload.excludedEndpointQuery = excludedEndpointQuery;
        }
        if (!isDefaultFailureCodeSelection) {
            payload.selectedFailureCodes = selectedFailureCodes;
        }

        if (payload.excludedEndpointQuery || payload.selectedFailureCodes) {
            window.localStorage.setItem(endpointFilterPersistenceKey, JSON.stringify(payload));
        } else {
            window.localStorage.removeItem(endpointFilterPersistenceKey);
        }
    }, [
        endpointFilterPersistenceKey,
        endpointStats,
        excludedEndpointQuery,
        hydratedFilterPreferenceKey,
        isDefaultFailureCodeSelection,
        selectedFailureCodes,
    ]);

    const failureCodeSummary = useMemo(() => {
        if (!availableFailureCodes.length) return 'No captured codes';
        if (!selectedFailureCodes.length) return 'Nothing selected';
        if (isDefaultFailureCodeSelection) return 'All captured codes';
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
    const updateExcludedEndpointTerms = (updater: (current: string[]) => string[]) => {
        setExcludedEndpointQuery((currentQuery) => {
            const nextTerms = updater(parseExcludedEndpointTerms(currentQuery));
            return serializeExcludedEndpointTerms(Array.from(new Set(nextTerms)));
        });
    };
    const removeExcludedEndpointTerm = (termToRemove: string) => {
        updateExcludedEndpointTerms((current) => current.filter((term) => term !== termToRemove));
    };
    const clearEndpointHotspotFilters = () => {
        setSelectedFailureCodes(availableFailureCodes.map(({ code }) => code));
        setExcludedEndpointQuery('');
        setSearchQuery('');
        setMethodFilter('all');
        setStatusFamilyFilter('all');
        setLatencyFilter('all');
        setVolumeFilter('all');
        setRiskFilter('all');
    };

    const methodOptions = useMemo(() => {
        const methods = new Set<string>();
        for (const endpoint of includedEndpoints) {
            const { method } = splitEndpointLabel(endpoint.endpoint);
            if (method) methods.add(method);
        }
        return Array.from(methods).sort();
    }, [includedEndpoints]);

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

    const parsedEndpointQuery = useMemo(() => parseEndpointQuery(searchQuery), [searchQuery]);

    const filteredEndpoints = useMemo(() => {
        return endpointRisks.filter((endpoint) => {
            const { method } = splitEndpointLabel(endpoint.endpoint);
            if (methodFilter !== 'all' && method !== methodFilter) return false;
            if (!endpointMatchesParsedQuery(endpoint, parsedEndpointQuery)) return false;

            if (statusFamilyFilter === 'errors' && endpoint.filteredErrorCount <= 0 && endpoint.totalErrors <= 0) return false;
            if (statusFamilyFilter === '4xx' && !endpointHasStatusFamily(endpoint.statusCodeBreakdown, '4xx')) return false;
            if (statusFamilyFilter === '5xx' && !endpointHasStatusFamily(endpoint.statusCodeBreakdown, '5xx')) return false;

            if (latencyFilter === 'fast' && endpoint.avgLatencyMs > 250) return false;
            if (latencyFilter === 'warm' && (endpoint.avgLatencyMs <= 250 || endpoint.avgLatencyMs > 750)) return false;
            if (latencyFilter === 'slow' && (endpoint.avgLatencyMs <= 750 || endpoint.avgLatencyMs > 1500)) return false;
            if (latencyFilter === 'tail' && endpoint.avgLatencyMs <= 1500) return false;

            if (volumeFilter === 'active' && endpoint.totalCalls < 100) return false;
            if (volumeFilter === 'hot' && endpoint.totalCalls < 1_000) return false;
            if (volumeFilter === 'heavy' && endpoint.totalCalls < 10_000) return false;

            if (riskFilter === 'watch' && endpoint.riskScore < 50) return false;
            if (riskFilter === 'critical' && endpoint.riskScore < 80) return false;

            return true;
        });
    }, [
        endpointRisks,
        latencyFilter,
        methodFilter,
        parsedEndpointQuery,
        riskFilter,
        statusFamilyFilter,
        volumeFilter,
    ]);

    const endpointTableTotalPages = Math.max(1, Math.ceil(filteredEndpoints.length / endpointPageSize));
    const endpointTablePageClamped = Math.min(endpointTablePage, endpointTableTotalPages);

    const paginatedEndpoints = useMemo(() => {
        const start = (endpointTablePageClamped - 1) * endpointPageSize;
        return filteredEndpoints.slice(start, start + endpointPageSize);
    }, [filteredEndpoints, endpointTablePageClamped, endpointPageSize]);

    const endpointDatabaseSummary = useMemo(() => {
        const totalCalls = filteredEndpoints.reduce((sum, endpoint) => sum + endpoint.totalCalls, 0);

        return {
            totalCalls,
        };
    }, [filteredEndpoints]);

    const activeFacetCount = [
        methodFilter !== 'all',
        statusFamilyFilter !== 'all',
        latencyFilter !== 'all',
        volumeFilter !== 'all',
        riskFilter !== 'all',
        Boolean(searchQuery.trim()),
        excludedEndpointTerms.length > 0,
        !isDefaultFailureCodeSelection,
    ].filter(Boolean).length;

    useEffect(() => {
        setEndpointTablePage(1);
    }, [
        searchQuery,
        excludedEndpointKey,
        selectedFailureCodeKey,
        sortKey,
        sortOrder,
        timeRange,
        selectedProject?.id,
        methodFilter,
        statusFamilyFilter,
        latencyFilter,
        volumeFilter,
        riskFilter,
    ]);

    useEffect(() => {
        if (endpointTablePage > endpointTableTotalPages) {
            setEndpointTablePage(endpointTableTotalPages);
        }
    }, [endpointTablePage, endpointTableTotalPages]);

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

    const trendReleaseMarkers = useMemo(() => {
        return alignReleaseMarkersToChart(
            trendReleaseMarkersFromBreakdown,
            trendChartData.map((entry) => entry.dateKey),
        );
    }, [trendReleaseMarkersFromBreakdown, trendChartData]);

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
        const maxEndpointLatency = endpointRisks.reduce((max, endpoint) => Math.max(max, endpoint.avgLatencyMs), 0);
        const totalErrors = endpointRisks.reduce((sum, endpoint) => sum + endpoint.filteredErrorCount, 0);
        const criticalEndpoints = endpointRisks.filter((endpoint) => endpoint.riskScore >= 80).length;

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
                id: 'avg-response',
                label: 'Avg Response',
                value: formatMs(endpointStats?.summary.avgLatency),
                sortValue: endpointStats?.summary.avgLatency ?? null,
                info: 'Average response time across captured endpoint traffic.',
                detail: `Slowest indexed endpoint ${formatMs(maxEndpointLatency)}`,
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
                id: 'fail-rate',
                label: 'Fail Rate',
                value: pct(endpointStats?.summary.errorRate, 2),
                sortValue: endpointStats?.summary.errorRate ?? null,
                info: 'Share of captured API calls that returned an error status.',
                detail: `${formatCompact(totalErrors)} failed requests`,
                delta: errorRateDelta
                    ? {
                        value: errorRateDelta.deltaPct,
                        label: errorRateDelta.comparisonLabel,
                        betterDirection: 'down',
                        precision: 1,
                    }
                    : undefined,
            },
            {
                id: 'critical-endpoints',
                label: 'Critical',
                value: formatCompact(criticalEndpoints),
                sortValue: criticalEndpoints,
                info: 'Endpoints with high combined volume, failure, and latency risk.',
                detail: `${formatCompact(endpointStats?.allEndpoints.length || 0)} indexed endpoints`,
            },
        ];
    }, [trends, timeRange, endpointStats, endpointRisks]);

    if (isLoading && selectedProject?.id && !endpointStats) {
        return <DashboardGhostLoader variant="analytics" />;
    }

    return (
        <div className="rejourney-api-page min-h-screen bg-[#f8fafd] font-sans text-slate-900 pb-12">
            <DashboardPageHeader
                title="API Endpoint Database"
                icon={<Database className="w-6 h-6" />}
                iconColor="bg-[#e8f0fe]"
            >
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
                    <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
                </div>
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
                        Select a project to load API insights.
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="dashboard-surface p-6 text-sm text-slate-600">
                        No API telemetry available for this window.
                    </div>
                )}

                {!isLoading && hasData && endpointStats && (
                    <>
                        <KpiCardsGrid
                            cards={kpiCards}
                            timeRange={timeRange}
                            storageKey="analytics-api-endpoint-database"
                            showControls={false}
                        />

                        <section className="dashboard-surface overflow-hidden p-0">
                            <div className="border-b border-slate-200 px-5 py-4">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-3">
                                        <div className="inline-flex h-10 w-10 items-center justify-center dashboard-inner-surface text-slate-700">
                                            <Database className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-semibold text-slate-950">Endpoint Database</h2>
                                            <p className="mt-1 text-sm text-slate-500">
                                                {filteredEndpoints.length.toLocaleString()} rows from {endpointRisks.length.toLocaleString()} indexed endpoints
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="border-b border-slate-200 bg-white px-5 py-4">
                                <div className="grid gap-3 xl:grid-cols-[minmax(300px,1.2fr)_repeat(5,minmax(140px,0.55fr))_auto] xl:items-end">
                                    <label className="block min-w-0">
                                        <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Query</span>
                                        <div className="relative">
                                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <input
                                                value={searchQuery}
                                                onChange={(event) => setSearchQuery(event.target.value)}
                                                placeholder="method:POST path:/checkout status:5xx latency:>500"
                                                className="w-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none"
                                            />
                                        </div>
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Method</span>
                                        <select
                                            value={methodFilter}
                                            onChange={(event) => setMethodFilter(event.target.value)}
                                            className="w-full border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800 outline-none"
                                        >
                                            <option value="all">All</option>
                                            {methodOptions.map((method) => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Status</span>
                                        <select
                                            value={statusFamilyFilter}
                                            onChange={(event) => setStatusFamilyFilter(event.target.value as EndpointStatusFamilyFilter)}
                                            className="w-full border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800 outline-none"
                                        >
                                            <option value="all">All</option>
                                            <option value="errors">Errors</option>
                                            <option value="5xx">5xx</option>
                                            <option value="4xx">4xx</option>
                                        </select>
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Latency</span>
                                        <select
                                            value={latencyFilter}
                                            onChange={(event) => setLatencyFilter(event.target.value as EndpointLatencyFilter)}
                                            className="w-full border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800 outline-none"
                                        >
                                            <option value="all">All</option>
                                            <option value="fast">≤ 250 ms</option>
                                            <option value="warm">251-750 ms</option>
                                            <option value="slow">751-1500 ms</option>
                                            <option value="tail">&gt; 1500 ms</option>
                                        </select>
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Volume</span>
                                        <select
                                            value={volumeFilter}
                                            onChange={(event) => setVolumeFilter(event.target.value as EndpointVolumeFilter)}
                                            className="w-full border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800 outline-none"
                                        >
                                            <option value="all">All</option>
                                            <option value="active">≥ 100</option>
                                            <option value="hot">≥ 1k</option>
                                            <option value="heavy">≥ 10k</option>
                                        </select>
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">Risk</span>
                                        <select
                                            value={riskFilter}
                                            onChange={(event) => setRiskFilter(event.target.value as EndpointRiskFilter)}
                                            className="w-full border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800 outline-none"
                                        >
                                            <option value="all">All</option>
                                            <option value="watch">≥ 50</option>
                                            <option value="critical">≥ 80</option>
                                        </select>
                                    </label>

                                    <button
                                        type="button"
                                        onClick={clearEndpointHotspotFilters}
                                        className="inline-flex h-[38px] items-center justify-center gap-2 border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                        <X className="h-4 w-4" />
                                        Reset
                                    </button>
                                </div>

                                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.46fr)]">
                                    <div className="dashboard-inner-surface p-3">
                                        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                                            <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase text-slate-500">
                                                <Filter className="h-3.5 w-3.5" />
                                                Failure codes
                                            </div>
                                            <span className="min-w-0 truncate text-xs font-medium text-slate-500">{failureCodeSummary}</span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <div className="mr-1 flex items-center gap-1 border-r border-slate-200 pr-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const allCodesSelected = matchesSelectedFailureCodes(availableFailureCodeValues) && availableFailureCodeValues.length > 0;
                                                        setSelectedFailureCodes(allCodesSelected ? [] : availableFailureCodeValues);
                                                    }}
                                                    className={`inline-flex h-7 items-center border px-2.5 text-xs font-medium transition ${getFailurePresetButtonClass(
                                                        matchesSelectedFailureCodes(availableFailureCodeValues) && availableFailureCodeValues.length > 0,
                                                    )}`}
                                                >
                                                    All
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedFailureCodes(serverFailureCodes)}
                                                    disabled={serverFailureCodes.length === 0}
                                                    className={`inline-flex h-7 items-center border px-2.5 text-xs font-medium transition ${getFailurePresetButtonClass(
                                                        matchesSelectedFailureCodes(serverFailureCodes) && serverFailureCodes.length > 0,
                                                    )} disabled:pointer-events-none disabled:opacity-40`}
                                                >
                                                    5xx
                                                </button>
                                                {has400FailureCode && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedFailureCodes(non400FailureCodes)}
                                                        disabled={non400FailureCodes.length === 0}
                                                        className={`inline-flex h-7 items-center border px-2.5 text-xs font-medium transition ${getFailurePresetButtonClass(
                                                            matchesSelectedFailureCodes(non400FailureCodes) && non400FailureCodes.length > 0,
                                                        )} disabled:pointer-events-none disabled:opacity-40`}
                                                    >
                                                        No 400
                                                    </button>
                                                )}
                                            </div>

                                            {availableFailureCodes.length === 0 ? (
                                                <span className="px-2 py-1 text-xs font-medium text-slate-400">No captured failure codes</span>
                                            ) : (
                                                availableFailureCodes.map(({ code, total }) => {
                                                    const selected = selectedFailureCodeSet.has(code);
                                                    return (
                                                        <button
                                                            key={code}
                                                            type="button"
                                                            title={`${formatStatusCodeLabel(code)}: ${total.toLocaleString()} failures`}
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
                                                            className={`inline-flex h-7 items-center gap-1.5 border px-2.5 text-xs font-medium transition ${getFailureCodeFilterClass(code, selected)}`}
                                                        >
                                                            <span className="font-mono font-semibold">{formatStatusCodeLabel(code)}</span>
                                                            <span className={`font-mono text-[10px] ${getFailureCodeCountClass(code, selected)}`}>
                                                                {formatCompact(total)}
                                                            </span>
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>

                                    <div className="dashboard-inner-surface p-3">
                                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500">
                                            <SlidersHorizontal className="h-3.5 w-3.5" />
                                            Exclusions
                                            {activeFacetCount > 0 && <span className="ml-auto text-slate-400">{activeFacetCount} active</span>}
                                        </div>
                                        <input
                                            value={excludedEndpointQuery}
                                            onChange={(event) => setExcludedEndpointQuery(event.target.value)}
                                            onBlur={() => {
                                                setExcludedEndpointQuery((current) => serializeExcludedEndpointTerms(parseExcludedEndpointTerms(current)));
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key !== 'Enter' && event.key !== ',') return;
                                                event.preventDefault();
                                                setExcludedEndpointQuery((current) => serializeExcludedEndpointTerms(parseExcludedEndpointTerms(current)));
                                            }}
                                            placeholder="/health, /metrics"
                                            className="w-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                                        />
                                        {excludedEndpointTerms.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {excludedEndpointTerms.map((term) => (
                                                    <button
                                                        key={term}
                                                        type="button"
                                                        onClick={() => removeExcludedEndpointTerm(term)}
                                                        className="inline-flex items-center gap-1.5 border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-800 hover:bg-blue-100"
                                                    >
                                                        {term}
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[1220px] text-left text-sm">
                                    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                                        <tr>
                                            <th
                                                className="cursor-pointer px-4 py-3 hover:text-slate-900"
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
                                                className="cursor-pointer px-4 py-3 text-right hover:text-slate-900"
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
                                                className="cursor-pointer px-4 py-3 text-right hover:text-slate-900"
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
                                                className="cursor-pointer px-4 py-3 text-right hover:text-slate-900"
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
                                                className="cursor-pointer px-4 py-3 text-right hover:text-slate-900"
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
                                            <th className="px-4 py-3 text-right">Status codes</th>
                                            <th
                                                className="cursor-pointer px-4 py-3 text-right hover:text-slate-900"
                                                onClick={() => {
                                                    if (sortKey === 'riskScore') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                                    else { setSortKey('riskScore'); setSortOrder('desc'); }
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Risk
                                                    {sortKey === 'riskScore' && (sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {paginatedEndpoints.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                                                    No endpoints match the current query.
                                                </td>
                                            </tr>
                                        ) : (
                                            paginatedEndpoints.map((endpoint) => {
                                                const { method, path } = splitEndpointLabel(endpoint.endpoint);
                                                const topCodes = getTopStatusCodes(endpoint.statusCodeBreakdown);

                                                return (
                                                    <tr key={endpoint.endpoint} className="transition-colors">
                                                        <td className="max-w-[540px] px-4 py-3">
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                {method && (
                                                                    <span className="inline-flex min-w-[48px] justify-center border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700">
                                                                        {method}
                                                                    </span>
                                                                )}
                                                                <span className="truncate font-mono text-[12px] font-semibold text-slate-950">{path}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <div className="text-sm font-semibold tabular-nums text-slate-900">{formatCompact(endpoint.totalCalls)}</div>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">
                                                            {formatCompact(endpoint.filteredErrorCount)}
                                                        </td>
                                                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${getFailRateToneClass(endpoint.filteredErrorRate)}`}>
                                                            {endpoint.filteredErrorRate.toFixed(2)}%
                                                        </td>
                                                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${getLatencyToneClass(endpoint.avgLatencyMs)}`}>
                                                            {endpoint.avgLatencyMs} ms
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            {topCodes.length > 0 ? (
                                                                <div className="flex justify-end gap-1.5">
                                                                    {topCodes.map(({ code, total }) => (
                                                                        <span key={code} className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] font-semibold ${getStatusCodeBadgeClass(code)}`}>
                                                                            {formatStatusCodeLabel(code)}
                                                                            <span className="text-[10px] opacity-70">{formatCompact(total)}</span>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs font-medium text-slate-300">-</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <span className={`inline-flex min-w-[48px] justify-center border px-2 py-0.5 text-xs font-semibold tabular-nums ${getRiskBadgeClass(endpoint.riskScore)}`}>
                                                                {endpoint.riskScore.toFixed(1)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {filteredEndpoints.length > 0 && (
                                <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-sm text-slate-600">
                                        Showing{' '}
                                        <span className="font-semibold text-slate-900">
                                            {(endpointTablePageClamped - 1) * endpointPageSize + 1}
                                            –
                                            {Math.min(endpointTablePageClamped * endpointPageSize, filteredEndpoints.length)}
                                        </span>{' '}
                                        of <span className="font-semibold text-slate-900">{filteredEndpoints.length.toLocaleString()}</span>
                                    </p>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <label className="flex items-center gap-2 text-sm text-slate-600">
                                            <span className="whitespace-nowrap">Rows</span>
                                            <select
                                                value={endpointPageSize}
                                                onChange={(e) => {
                                                    const next = Number(e.target.value);
                                                    setEndpointPageSize(next);
                                                    setEndpointTablePage(1);
                                                }}
                                                className="border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none"
                                            >
                                                {ENDPOINT_TABLE_PAGE_SIZES.map((n) => (
                                                    <option key={n} value={n}>{n}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                aria-label="Previous page"
                                                disabled={endpointTablePageClamped <= 1}
                                                onClick={() => setEndpointTablePage((p) => Math.max(1, p - 1))}
                                                className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
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
                                                className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className="dashboard-surface p-5">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="text-lg font-semibold uppercase tracking-wide text-black">Traffic vs Errors vs Latency</h2>
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
                                            <Area yAxisId="left" type="monotone" dataKey="sessions" name="Sessions" stroke="#2563eb" fill="#bfdbfe" fillOpacity={0.45} isAnimationActive={false} />
                                            <Line yAxisId="left" type="monotone" dataKey="errorCount" name="Errors" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
                                            <Line yAxisId="right" type="monotone" dataKey="avgApiResponseMs" name="Avg API ms" stroke="#f9a8d4" strokeWidth={2} dot={false} isAnimationActive={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500">No traffic/error/latency trend data available for this range.</p>
                            )}
                        </section>

                    </>
                )}
            </div>
        </div>
    );
};

export default ApiAnalytics;
