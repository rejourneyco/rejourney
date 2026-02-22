import React, { useEffect, useMemo, useState } from 'react';
import { TimeRange } from '../ui/TimeFilter';
import { InfoTooltip } from '../ui/InfoTooltip';
import { NeoCard } from '../ui/neo/NeoCard';

export type KpiTrendState = 'improving' | 'declining' | 'flat' | 'unknown';
export type KpiTrendFilter = 'all' | KpiTrendState;
export type KpiSortMode = 'default' | 'value-desc' | 'value-asc' | 'delta-desc' | 'delta-asc';

export type KpiCardDelta = {
    value: number | null;
    unit?: string;
    precision?: number;
    betterDirection?: 'up' | 'down';
    neutralThreshold?: number;
    label?: string;
};

export type KpiCardItem = {
    id: string;
    label: string;
    value: string;
    info: string;
    detail?: string;
    sortValue?: number | null;
    delta?: KpiCardDelta;
};

type KpiPreferenceState = {
    trendFilter: KpiTrendFilter;
    sortMode: KpiSortMode;
    visibleIds: string[];
    showDetails: boolean;
};

type KpiCardsGridProps = {
    cards: KpiCardItem[];
    timeRange: TimeRange;
    storageKey: string;
    className?: string;
    gridClassName?: string;
    showControls?: boolean;
};

type SeriesDeltaResult = {
    deltaPct: number;
    comparisonLabel: string;
    currentValue: number;
    previousValue: number;
    windowSize: number;
};

const STORAGE_PREFIX = 'kpi-cards-v1:';

const WINDOW_DAYS_BY_RANGE: Record<TimeRange, number> = {
    '24h': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    all: 30,
};

export function getKpiComparisonLabel(timeRange: TimeRange): string {
    if (timeRange === '24h') return 'vs previous day';
    if (timeRange === '7d') return 'vs previous week';
    if (timeRange === '30d') return 'vs previous 30d';
    if (timeRange === '90d') return 'vs previous 90d';
    return 'vs previous cycle';
}

function getTrendState(delta?: KpiCardDelta): KpiTrendState {
    if (!delta || delta.value === null || delta.value === undefined || Number.isNaN(delta.value)) {
        return 'unknown';
    }

    const neutralThreshold = delta.neutralThreshold ?? 0.05;
    if (Math.abs(delta.value) < neutralThreshold) {
        return 'flat';
    }

    const betterDirection = delta.betterDirection ?? 'up';
    const improving = betterDirection === 'up' ? delta.value > 0 : delta.value < 0;
    return improving ? 'improving' : 'declining';
}

function getTrendToneClass(trendState: KpiTrendState): string {
    if (trendState === 'improving') return 'bg-emerald-100 text-emerald-700';
    if (trendState === 'declining') return 'bg-rose-100 text-rose-700';
    if (trendState === 'flat') return 'bg-slate-100 text-slate-700';
    return 'bg-slate-100 text-slate-500';
}

function formatDelta(delta: KpiCardDelta): string {
    if (delta.value === null || delta.value === undefined || Number.isNaN(delta.value)) {
        return 'N/A';
    }

    const precision = delta.precision ?? 1;
    const rounded = Number(delta.value.toFixed(precision));
    const sign = rounded > 0 ? '+' : '';
    const unit = delta.unit ?? '%';
    const unitSuffix = unit === '%' || unit.startsWith(' ') ? unit : ` ${unit}`;

    return `${sign}${rounded.toFixed(precision)}${unitSuffix}`;
}

function toNumericSortValue(card: KpiCardItem): number {
    if (card.sortValue !== null && card.sortValue !== undefined && Number.isFinite(card.sortValue)) {
        return card.sortValue;
    }
    const normalized = Number(String(card.value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(normalized) ? normalized : 0;
}

function toDeltaSortValue(card: KpiCardItem): number {
    if (card.delta?.value === null || card.delta?.value === undefined || Number.isNaN(card.delta.value)) {
        return Number.NEGATIVE_INFINITY;
    }
    return card.delta.value;
}

export function computePeriodDeltaFromSeries(
    rawSeries: number[],
    timeRange: TimeRange,
    aggregate: 'sum' | 'avg' = 'sum',
): SeriesDeltaResult | null {
    const series = rawSeries.filter((value) => Number.isFinite(value));
    if (series.length < 4) return null;

    const targetWindow = WINDOW_DAYS_BY_RANGE[timeRange];
    const fullWindowAvailable = series.length >= targetWindow * 2;
    const fallbackWindow = Math.max(2, Math.floor(series.length / 2));
    const windowSize = fullWindowAvailable ? targetWindow : fallbackWindow;

    if (series.length < windowSize * 2) return null;

    const previousSlice = series.slice(-windowSize * 2, -windowSize);
    const currentSlice = series.slice(-windowSize);

    const previousValue = aggregate === 'sum'
        ? previousSlice.reduce((sum, value) => sum + value, 0)
        : previousSlice.reduce((sum, value) => sum + value, 0) / previousSlice.length;

    const currentValue = aggregate === 'sum'
        ? currentSlice.reduce((sum, value) => sum + value, 0)
        : currentSlice.reduce((sum, value) => sum + value, 0) / currentSlice.length;

    let deltaPct = 0;
    if (previousValue > 0) {
        deltaPct = ((currentValue - previousValue) / previousValue) * 100;
    } else if (currentValue > 0) {
        deltaPct = 100;
    }

    return {
        deltaPct,
        comparisonLabel: fullWindowAvailable
            ? getKpiComparisonLabel(timeRange)
            : `vs prior ${windowSize}-day window`,
        currentValue,
        previousValue,
        windowSize,
    };
}

export const KpiCardsGrid: React.FC<KpiCardsGridProps> = ({
    cards,
    timeRange,
    storageKey,
    className = '',
    gridClassName = 'grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4',
    showControls = true,
}) => {
    const [trendFilter, setTrendFilter] = useState<KpiTrendFilter>('all');
    const [sortMode, setSortMode] = useState<KpiSortMode>('default');
    const [visibleIds, setVisibleIds] = useState<string[]>(cards.map((card) => card.id));
    const [showDetails, setShowDetails] = useState(false);
    const [customizeOpen, setCustomizeOpen] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    const cardIdsSignature = useMemo(() => cards.map((card) => card.id).join(','), [cards]);

    useEffect(() => {
        const ids = cardIdsSignature ? cardIdsSignature.split(',') : [];
        setVisibleIds((prev) => {
            if (prev.length === 0) return ids;
            const allowed = new Set(ids);
            const kept = prev.filter((id) => allowed.has(id));
            const appended = ids.filter((id) => !kept.includes(id));
            const next = [...kept, ...appended];
            if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
                return prev;
            }
            return next;
        });
    }, [cardIdsSignature]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const ids = cardIdsSignature ? cardIdsSignature.split(',') : [];
        const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
        if (!raw) {
            setHydrated(true);
            return;
        }

        try {
            const parsed = JSON.parse(raw) as Partial<KpiPreferenceState>;
            if (parsed.trendFilter === 'all' || parsed.trendFilter === 'improving' || parsed.trendFilter === 'declining' || parsed.trendFilter === 'flat' || parsed.trendFilter === 'unknown') {
                setTrendFilter(parsed.trendFilter);
            }
            if (parsed.sortMode === 'default' || parsed.sortMode === 'value-desc' || parsed.sortMode === 'value-asc' || parsed.sortMode === 'delta-desc' || parsed.sortMode === 'delta-asc') {
                setSortMode(parsed.sortMode);
            }
            if (Array.isArray(parsed.visibleIds)) {
                const allowed = new Set(ids);
                const filtered = parsed.visibleIds.filter((id): id is string => typeof id === 'string' && allowed.has(id));
                if (filtered.length > 0) {
                    setVisibleIds(filtered);
                }
            }
            if (typeof parsed.showDetails === 'boolean') {
                setShowDetails(parsed.showDetails);
            }
        } catch {
            // Ignore invalid local storage payloads.
        } finally {
            setHydrated(true);
        }
    }, [cardIdsSignature, storageKey]);

    useEffect(() => {
        if (!hydrated || typeof window === 'undefined') return;
        const payload: KpiPreferenceState = {
            trendFilter,
            sortMode,
            visibleIds,
            showDetails,
        };
        window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(payload));
    }, [hydrated, trendFilter, sortMode, visibleIds, showDetails, storageKey]);

    const comparisonLabel = useMemo(() => getKpiComparisonLabel(timeRange), [timeRange]);

    const cardIndex = useMemo(() => {
        return new Map(cards.map((card, index) => [card.id, index]));
    }, [cards]);

    const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);

    const filteredCards = useMemo(() => {
        const base = cards.filter((card) => visibleSet.has(card.id));

        const trendFiltered = trendFilter === 'all'
            ? base
            : base.filter((card) => getTrendState(card.delta) === trendFilter);

        const sorted = [...trendFiltered];
        sorted.sort((left, right) => {
            if (sortMode === 'default') {
                return (cardIndex.get(left.id) ?? 0) - (cardIndex.get(right.id) ?? 0);
            }
            if (sortMode === 'value-desc') {
                return toNumericSortValue(right) - toNumericSortValue(left);
            }
            if (sortMode === 'value-asc') {
                return toNumericSortValue(left) - toNumericSortValue(right);
            }
            if (sortMode === 'delta-desc') {
                return toDeltaSortValue(right) - toDeltaSortValue(left);
            }
            return toDeltaSortValue(left) - toDeltaSortValue(right);
        });

        return sorted;
    }, [cards, visibleSet, trendFilter, sortMode, cardIndex]);

    const toggleCardVisibility = (cardId: string) => {
        setVisibleIds((prev) => {
            if (prev.includes(cardId)) {
                return prev.filter((id) => id !== cardId);
            }
            return [...prev, cardId];
        });
    };

    const resetPreferences = () => {
        setTrendFilter('all');
        setSortMode('default');
        setVisibleIds(cards.map((card) => card.id));
        setShowDetails(false);
    };

    return (
        <section className={className}>
            {showControls && (
                <div className="mb-4 rounded-xl border border-slate-100/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                            Trend
                            <select
                                value={trendFilter}
                                onChange={(event) => setTrendFilter(event.target.value as KpiTrendFilter)}
                                className="rounded-md border border-slate-200/60 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300"
                            >
                                <option value="all">All</option>
                                <option value="improving">Improving</option>
                                <option value="declining">Declining</option>
                                <option value="flat">Flat</option>
                                <option value="unknown">Missing Delta</option>
                            </select>
                        </label>

                        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                            Sort
                            <select
                                value={sortMode}
                                onChange={(event) => setSortMode(event.target.value as KpiSortMode)}
                                className="rounded-md border border-slate-200/60 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300"
                            >
                                <option value="default">Default</option>
                                <option value="value-desc">Highest value</option>
                                <option value="value-asc">Lowest value</option>
                                <option value="delta-desc">Best delta</option>
                                <option value="delta-asc">Worst delta</option>
                            </select>
                        </label>

                        <button
                            type="button"
                            className="rounded-md border border-slate-200/60 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-300"
                            onClick={() => setCustomizeOpen((open) => !open)}
                        >
                            {customizeOpen ? 'Hide Customize' : 'Customize'}
                        </button>

                        <span className="ml-auto text-[11px] text-slate-400">
                            {filteredCards.length} cards visible
                        </span>
                    </div>

                    {customizeOpen && (
                        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={showDetails}
                                    onChange={(event) => setShowDetails(event.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                                />
                                Show KPI detail line
                            </label>

                            <div className="flex flex-wrap gap-2">
                                {cards.map((card) => {
                                    const selected = visibleSet.has(card.id);
                                    return (
                                        <label
                                            key={card.id}
                                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${selected ? 'border-slate-300 bg-slate-50 shadow-sm text-slate-800' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selected}
                                                onChange={() => toggleCardVisibility(card.id)}
                                                className="h-3 w-3 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                                            />
                                            {card.label}
                                        </label>
                                    );
                                })}
                            </div>

                            <button
                                type="button"
                                className="rounded-md border border-slate-200/60 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-300"
                                onClick={resetPreferences}
                            >
                                Reset
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className={gridClassName.replace('gap-4', 'gap-5')}>
                {filteredCards.map((card) => {
                    const trendState = getTrendState(card.delta);
                    const deltaLabel = card.delta?.label ?? comparisonLabel;

                    return (
                        <NeoCard key={card.id} className="bg-white">
                            <div className="flex items-start justify-between gap-2">
                                <div className="text-xs font-medium text-slate-500">
                                    {card.label}
                                </div>
                                <InfoTooltip content={card.info} align="right" />
                            </div>

                            <div className="mt-2 text-[1.75rem] font-semibold leading-tight text-slate-900">
                                {card.value}
                            </div>

                            <div className="mt-2 flex items-center gap-2">
                                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${getTrendToneClass(trendState)}`}>
                                    {card.delta ? formatDelta(card.delta) : 'N/A'}
                                </span>
                                <span className="text-[11px] text-slate-400">{deltaLabel}</span>
                            </div>

                            {showDetails && card.detail && (
                                <div className="mt-1 text-xs leading-relaxed text-slate-500">{card.detail}</div>
                            )}
                        </NeoCard>
                    );
                })}

                {filteredCards.length === 0 && (
                    <NeoCard className="col-span-full border-dashed border-slate-300 bg-white">
                        <div className="py-5 text-center text-xs font-medium text-slate-500">
                            No KPI cards match the current filters
                        </div>
                    </NeoCard>
                )}
            </div>
        </section>
    );
};
