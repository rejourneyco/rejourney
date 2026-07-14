import React, { startTransition, useEffect, useMemo, useState } from 'react';
import { TimeRange } from '~/shared/ui/core/TimeFilter';
import { InfoTooltip } from '~/shared/ui/core/InfoTooltip';

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
const KPI_CARD_ACCENTS = ['#67e8f9', '#86efac', '#f9a8d4', '#c4b5fd'];

const WINDOW_DAYS_BY_RANGE: Record<TimeRange, number> = {
    '24h': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '1y': 365,
    all: 30,
};

export function getKpiComparisonLabel(timeRange: TimeRange): string {
    if (timeRange === '24h') return 'vs previous day';
    if (timeRange === '7d') return 'vs previous week';
    if (timeRange === '30d') return 'vs previous 30d';
    if (timeRange === '90d') return 'vs previous 90d';
    if (timeRange === '180d') return 'vs previous 180d';
    if (timeRange === '1y') return 'vs previous year';
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
    if (trendState === 'improving') return 'text-emerald-700';
    if (trendState === 'declining') return 'text-rose-700';
    return 'text-slate-600';
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
    gridClassName = 'grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4',
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
            startTransition(() => {
                setHydrated(true);
            });
            return;
        }

        try {
            const parsed = JSON.parse(raw) as Partial<KpiPreferenceState>;
            startTransition(() => {
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
                        const appended = ids.filter((id) => !filtered.includes(id));
                        setVisibleIds([...filtered, ...appended]);
                    }
                }
                if (typeof parsed.showDetails === 'boolean') {
                    setShowDetails(parsed.showDetails);
                }
            });
        } catch {
            // Ignore invalid local storage payloads.
        } finally {
            startTransition(() => {
                setHydrated(true);
            });
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
                <div className="dashboard-surface mb-4 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-xs font-black text-slate-600 uppercase">
                            Trend
                            <select
                                value={trendFilter}
                                onChange={(event) => setTrendFilter(event.target.value as KpiTrendFilter)}
                                className="border-2 border-black bg-white px-2.5 py-1.5 text-xs font-black text-black shadow-neo-sm focus:outline-none focus:ring-2 focus:ring-black"
                            >
                                <option value="all">All</option>
                                <option value="improving">Improving</option>
                                <option value="declining">Declining</option>
                                <option value="flat">Flat</option>
                                <option value="unknown">Missing Delta</option>
                            </select>
                        </label>

                        <label className="inline-flex items-center gap-2 text-xs font-black text-slate-600 uppercase">
                            Sort
                            <select
                                value={sortMode}
                                onChange={(event) => setSortMode(event.target.value as KpiSortMode)}
                                className="border-2 border-black bg-white px-2.5 py-1.5 text-xs font-black text-black shadow-neo-sm focus:outline-none focus:ring-2 focus:ring-black"
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
                            className="border-2 border-black bg-white px-3 py-1.5 text-xs font-black text-black uppercase shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo transition-all"
                            onClick={() => setCustomizeOpen((open) => !open)}
                        >
                            {customizeOpen ? 'Hide Customize' : 'Customize'}
                        </button>

                        <span className="dashboard-meta w-full text-[11px] text-gray-500 sm:ml-auto sm:w-auto">
                            {filteredCards.length} cards visible
                        </span>
                    </div>

                    {customizeOpen && (
                        <div className="mt-3 space-y-3 border-t-2 border-black pt-3">
                            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={showDetails}
                                    onChange={(event) => setShowDetails(event.target.checked)}
                                    className="h-3.5 w-3.5 rounded-none border-black text-slate-900 focus:ring-black"
                                />
                                Show KPI detail line
                            </label>

                            <div className="flex flex-wrap gap-2">
                                {cards.map((card) => {
                                    const selected = visibleSet.has(card.id);
                                    return (
                                        <label
                                            key={card.id}
                                        className={`inline-flex items-center gap-1.5 border-2 px-2 py-1.5 text-[11px] font-bold transition-all ${selected ? 'border-black bg-[#67e8f9] text-black shadow-neo-sm' : 'border-black bg-white text-gray-600 hover:bg-[#ecfeff]'}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selected}
                                                onChange={() => toggleCardVisibility(card.id)}
                                                className="h-3 w-3 rounded-none border-black text-slate-900 focus:ring-black"
                                            />
                                            {card.label}
                                        </label>
                                    );
                                })}
                            </div>

                            <button
                                type="button"
                                className="border-2 border-black bg-white px-3 py-1.5 text-xs font-black text-black uppercase shadow-neo-sm hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo transition-all"
                                onClick={resetPreferences}
                            >
                                Reset
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className={gridClassName}>
                {filteredCards.map((card, index) => {
                    const trendState = getTrendState(card.delta);
                    const deltaLabel = card.delta?.label ?? comparisonLabel;

                    return (
                        <div key={card.id} className="dashboard-analytics-card dashboard-kpi-card min-w-0">
                            <div
                                className="dashboard-kpi-accent"
                                style={{ backgroundColor: KPI_CARD_ACCENTS[index % KPI_CARD_ACCENTS.length] }}
                            />
                            <div className="dashboard-kpi-header">
                                <InfoTooltip
                                    content={card.info}
                                    align="left"
                                    className="min-w-0"
                                    trigger={<span className="dashboard-label block break-words">{card.label}</span>}
                                />
                            </div>

                            <div className="dashboard-kpi-value break-words">
                                {card.value}
                            </div>

                            <div className="dashboard-kpi-comparison">
                                <span className={`dashboard-kpi-delta ${getTrendToneClass(trendState)}`}>
                                    {card.delta ? formatDelta(card.delta) : 'N/A'}
                                </span>
                                <span className="dashboard-kpi-comparison-label">{deltaLabel}</span>
                            </div>

                            {showDetails && card.detail && (
                                <div className="dashboard-kpi-detail">{card.detail}</div>
                            )}
                        </div>
                    );
                })}

                {filteredCards.length === 0 && (
                    <div className="dashboard-surface col-span-full border-dashed border-slate-300 bg-white">
                        <div className="py-5 text-center text-xs font-medium text-slate-500">
                            No KPI cards match the current filters
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};
