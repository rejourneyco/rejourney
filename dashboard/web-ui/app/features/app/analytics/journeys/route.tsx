import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
    ArrowRight,
    Compass,
    Play,
    Route,
} from 'lucide-react';
import { DataWatermarkBanner } from '~/features/app/shared/dashboard/DataWatermarkBanner';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { useSessionData } from '~/shared/providers/SessionContext';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '~/shared/ui/core/TimeFilter';
import { SankeyJourney, type SankeyEvidenceSession, type SankeyFlow } from '~/features/app/analytics/journeys/components/SankeyJourney';
import { KpiCardItem, KpiCardsGrid, computePeriodDeltaFromSeries } from '~/features/app/shared/dashboard/KpiCardsGrid';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import {
    getJourneysOverview,
    InsightsTrends,
    ObservabilityJourneySummary,
} from '~/shared/api/client';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';

type HappyPathStage = {
    from: string;
    to: string;
    entrants: number;
    progressed: number;
    dropoff: number;
    conversionRate: number;
    issueRatePer100: number;
};

type FlowHealthFilter = 'all' | 'healthy' | 'degraded' | 'problematic';

type TransitionReplayOption = {
    id: string;
    label: string;
    path: string[];
    sessionCount: number;
    health: 'healthy' | 'degraded' | 'problematic';
    priority: 'high' | 'medium' | 'low';
    detail: string;
    evidenceRows: SankeyEvidenceSession[];
};

type QueryReplaySession = SankeyEvidenceSession & {
    matchedPaths: string[];
};

const EVIDENCE_PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = {
    high: 3,
    medium: 2,
    low: 1,
};

const formatMs = (value: number | null | undefined): string => {
    if (!value || value <= 0) return 'N/A';
    if (value >= 60_000) return `${(value / 60_000).toFixed(1)} min`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)} s`;
    return `${Math.round(value)} ms`;
};

const formatCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString();
};

const getFlowHealth = (flow: ObservabilityJourneySummary['flows'][number]): 'healthy' | 'degraded' | 'problematic' => {
    if (flow.health) return flow.health;
    if (flow.crashCount > 0 || flow.anrCount > 0) return 'problematic';
    if (flow.apiErrorRate > 5 || flow.rageTapCount >= 2 || flow.avgApiLatencyMs > 1000) return 'degraded';
    return 'healthy';
};

const getFlowEvidencePriority = (flow: ObservabilityJourneySummary['flows'][number]): 'high' | 'medium' | 'low' => {
    const health = getFlowHealth(flow);
    if (health === 'problematic') return 'high';
    if (health === 'degraded') return 'medium';
    return 'low';
};

const getFlowEvidenceSignal = (flow: ObservabilityJourneySummary['flows'][number]): string => {
    if (flow.crashCount > 0 || flow.anrCount > 0) return `${flow.crashCount} crashes / ${flow.anrCount} ANRs`;
    if (flow.rageTapCount > 0) return `${flow.rageTapCount} rage taps`;
    if (flow.apiErrorRate > 0) return `${flow.apiErrorRate.toFixed(1)}% API errors`;
    return 'Traffic sample';
};

const getTransitionKey = (from: string, to: string): string => `${from}→${to}`;

const JOURNEY_SELECTED_TRANSITIONS_STORAGE_PREFIX = 'rejourney.analytics.journeys.selectedTransitions.';

const parseStoredSelectedTransitionIds = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((value): value is string => typeof value === 'string')
            : [];
    } catch {
        return [];
    }
};

const dedupeEvidenceRows = (rows: SankeyEvidenceSession[], limit = 18): SankeyEvidenceSession[] => {
    const deduped = new Map<string, SankeyEvidenceSession>();

    for (const row of rows) {
        if (!row.sessionId) continue;
        const existing = deduped.get(row.sessionId);
        if (!existing) {
            deduped.set(row.sessionId, row);
            continue;
        }

        const existingRank = EVIDENCE_PRIORITY_RANK[existing.priority || 'low'];
        const incomingRank = EVIDENCE_PRIORITY_RANK[row.priority || 'low'];
        if (incomingRank >= existingRank) {
            deduped.set(row.sessionId, row);
        }
    }

    return Array.from(deduped.values())
        .sort((a, b) => EVIDENCE_PRIORITY_RANK[b.priority || 'low'] - EVIDENCE_PRIORITY_RANK[a.priority || 'low'])
        .slice(0, limit);
};

const getReplayHealthBadgeClass = (health: TransitionReplayOption['health']): string => {
    if (health === 'problematic') return 'border-rose-200 bg-rose-50 text-rose-700';
    if (health === 'degraded') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};


export const Journeys: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [data, setData] = useState<ObservabilityJourneySummary | null>(null);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    const [partialError, setPartialError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [flowHealthFilter, setFlowHealthFilter] = useState<FlowHealthFilter>('all');
    const [flowSearch, setFlowSearch] = useState('');
    const [minFlowCount, setMinFlowCount] = useState(0);
    const [onlyWithEvidence, setOnlyWithEvidence] = useState(false);
    const [selectedTransitionIds, setSelectedTransitionIds] = useState<string[]>([]);
    const [hydratedSelectedTransitionsKey, setHydratedSelectedTransitionsKey] = useState<string | null>(null);
    const selectedTransitionsStorageKey = selectedProject?.id
        ? `${JOURNEY_SELECTED_TRANSITIONS_STORAGE_PREFIX}${selectedProject.id}`
        : null;

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!selectedTransitionsStorageKey) {
            setSelectedTransitionIds([]);
            setHydratedSelectedTransitionsKey(null);
            return;
        }

        setSelectedTransitionIds(parseStoredSelectedTransitionIds(window.localStorage.getItem(selectedTransitionsStorageKey)));
        setHydratedSelectedTransitionsKey(selectedTransitionsStorageKey);
    }, [selectedTransitionsStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!selectedTransitionsStorageKey || hydratedSelectedTransitionsKey !== selectedTransitionsStorageKey) return;

        if (selectedTransitionIds.length > 0) {
            window.localStorage.setItem(selectedTransitionsStorageKey, JSON.stringify(selectedTransitionIds));
        } else {
            window.localStorage.removeItem(selectedTransitionsStorageKey);
        }
    }, [hydratedSelectedTransitionsKey, selectedTransitionIds, selectedTransitionsStorageKey]);

    useEffect(() => {
        if (!selectedProject?.id) {
            setData(null);
            setTrends(null);
            setPartialError(null);
            setIsLoading(false);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);
        setPartialError(null);

        void getJourneysOverview(selectedProject.id, timeRange, 'full')
            .then((overview) => {
                if (isCancelled) return;
                setData(overview.journey);
                setTrends(overview.trends);
                setPartialError(overview.failedSections.length > 0 ? `${overview.failedSections.join(', ')} unavailable.` : null);
            })
            .catch((err) => {
                console.error('Journeys overview failed:', err);
                if (!isCancelled) {
                    setData(null);
                    setTrends(null);
                    setPartialError('Journey overview unavailable.');
                }
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const totalSessions = useMemo(() => {
        if (!data) return 0;
        return data.healthSummary.healthy + data.healthSummary.degraded + data.healthSummary.problematic;
    }, [data]);

    const canonicalHappyPath = useMemo(() => {
        const configured = data?.configuredHappyPath?.path;
        if (configured && configured.length > 0) return configured;
        return data?.happyPathJourney?.path || null;
    }, [data]);

    const pathCoverageRate = useMemo(() => {
        if (totalSessions === 0) return 0;
        if (data?.happyPathJourney) return (data.happyPathJourney.sessionCount / totalSessions) * 100;
        return ((data?.healthSummary.healthy ?? 0) / totalSessions) * 100;
    }, [data, totalSessions]);

    const happyPathStages = useMemo<HappyPathStage[]>(() => {
        if (!data || !canonicalHappyPath || canonicalHappyPath.length < 2) return [];

        const flowMap = new Map(data.flows.map((flow) => [`${flow.from}::${flow.to}`, flow]));
        const firstEdge = `${canonicalHappyPath[0]}::${canonicalHappyPath[1]}`;
        const firstFlow = flowMap.get(firstEdge);
        const entryCount = data.entryPoints.find((item) => item.screen === canonicalHappyPath[0])?.count
            ?? firstFlow?.count
            ?? data.happyPathJourney?.sessionCount
            ?? 0;

        let previousProgressed = entryCount;

        return canonicalHappyPath.slice(0, -1).map((from, idx) => {
            const to = canonicalHappyPath[idx + 1];
            const flow = flowMap.get(`${from}::${to}`);
            const entrants = idx === 0 ? entryCount : previousProgressed;
            const progressed = flow?.count ?? 0;
            const dropoff = Math.max(0, entrants - progressed);
            const conversionRate = entrants > 0 ? (progressed / entrants) * 100 : 0;
            const issueRatePer100 = flow
                ? flow.apiErrorRate
                + ((flow.crashCount + flow.anrCount) / Math.max(flow.count, 1)) * 100
                + (flow.rageTapCount / Math.max(flow.count, 1)) * 100
                : 0;

            previousProgressed = progressed;

            return {
                from,
                to,
                entrants,
                progressed,
                dropoff,
                conversionRate,
                issueRatePer100,
            };
        });
    }, [data, canonicalHappyPath]);

    const largestLeakStage = useMemo(() => {
        if (happyPathStages.length > 0) return [...happyPathStages].sort((a, b) => b.dropoff - a.dropoff)[0];
        const topExit = data?.exitPoints?.[0];
        if (!topExit) return null;
        return { from: topExit.screen, to: '(exit)', dropoff: topExit.count, entrants: topExit.count, progressed: 0, conversionRate: 0, issueRatePer100: 0 };
    }, [happyPathStages, data]);

    const startPopulation = happyPathStages[0]?.entrants || totalSessions;
    const completionPopulation = happyPathStages[happyPathStages.length - 1]?.progressed || 0;
    const completionRateFromEntrants = startPopulation > 0 ? (completionPopulation / startPopulation) * 100 : 0;

    const sankeyTransitionEvidence = useMemo<Record<string, SankeyEvidenceSession[]>>(() => {
        if (!data) return {};

        const transitionMap = new Map<string, Map<string, SankeyEvidenceSession>>();

        const addEvidence = (transitionKey: string, evidence: SankeyEvidenceSession) => {
            if (!evidence.sessionId) return;
            if (!transitionMap.has(transitionKey)) {
                transitionMap.set(transitionKey, new Map<string, SankeyEvidenceSession>());
            }

            const sessionMap = transitionMap.get(transitionKey)!;
            const existing = sessionMap.get(evidence.sessionId);
            if (!existing) {
                sessionMap.set(evidence.sessionId, evidence);
                return;
            }

            const existingRank = EVIDENCE_PRIORITY_RANK[existing.priority || 'low'];
            const incomingRank = EVIDENCE_PRIORITY_RANK[evidence.priority || 'low'];
            if (incomingRank >= existingRank) {
                sessionMap.set(evidence.sessionId, evidence);
            }
        };

        for (const flow of data.flows) {
            const transitionKey = `${flow.from}→${flow.to}`;
            const signal = getFlowEvidenceSignal(flow);
            const priority = getFlowEvidencePriority(flow);
            for (const sessionId of (flow.sampleSessionIds || []).slice(0, 6)) {
                addEvidence(transitionKey, {
                    sessionId,
                    source: 'Flow sample',
                    signal,
                    priority,
                });
            }
        }

        for (const journey of data.problematicJourneys.slice(0, 15)) {
            if (journey.path.length < 2) continue;
            const priority: 'high' | 'medium' = journey.failureScore > 120 ? 'high' : 'medium';
            const signal = `Failure score ${journey.failureScore.toFixed(0)}`;

            for (let i = 0; i < journey.path.length - 1; i++) {
                const transitionKey = `${journey.path[i]}→${journey.path[i + 1]}`;
                for (const sessionId of journey.sampleSessionIds.slice(0, 4)) {
                    addEvidence(transitionKey, {
                        sessionId,
                        source: 'Problematic journey',
                        signal,
                        priority,
                    });
                }
            }
        }

        const happyPathJourney = data.happyPathJourney;
        if (happyPathJourney && happyPathJourney.path.length > 1) {
            for (let i = 0; i < happyPathJourney.path.length - 1; i++) {
                const transitionKey = `${happyPathJourney.path[i]}→${happyPathJourney.path[i + 1]}`;
                for (const sessionId of happyPathJourney.sampleSessionIds.slice(0, 3)) {
                    addEvidence(transitionKey, {
                        sessionId,
                        source: 'Happy path',
                        signal: 'Successful completion sample',
                        priority: 'low',
                    });
                }
            }
        }

        const flowsByTarget = new Map<string, ObservabilityJourneySummary['flows'][number][]>();
        for (const flow of data.flows) {
            if (!flowsByTarget.has(flow.to)) flowsByTarget.set(flow.to, []);
            flowsByTarget.get(flow.to)!.push(flow);
        }

        for (const exitPath of data.exitAfterError.slice(0, 8)) {
            const inboundFlows = flowsByTarget.get(exitPath.screen) || [];
            const signal = `${formatCompact(exitPath.exitCount)} exits after errors`;
            for (const inboundFlow of inboundFlows.slice(0, 6)) {
                const transitionKey = `${inboundFlow.from}→${inboundFlow.to}`;
                for (const sessionId of exitPath.sampleSessionIds.slice(0, 3)) {
                    addEvidence(transitionKey, {
                        sessionId,
                        source: 'Exit after error',
                        signal,
                        priority: 'high',
                    });
                }
            }
        }

        const result: Record<string, SankeyEvidenceSession[]> = {};
        for (const [transitionKey, sessionMap] of transitionMap.entries()) {
            result[transitionKey] = Array.from(sessionMap.values())
                .sort((a, b) => EVIDENCE_PRIORITY_RANK[b.priority || 'low'] - EVIDENCE_PRIORITY_RANK[a.priority || 'low'])
                .slice(0, 10);
        }

        return result;
    }, [data]);

    const maxFlowCount = useMemo(
        () => data?.flows.reduce((max, flow) => Math.max(max, flow.count), 0) || 0,
        [data],
    );

    const flowVolumeOptions = useMemo(() => {
        const baseOptions = [0, 10, 25, 50, 100, 250, 500, 1000, 2500];
        const options = baseOptions.filter((value) => value === 0 || value <= maxFlowCount);
        if (maxFlowCount > 0 && !options.includes(maxFlowCount)) {
            options.push(maxFlowCount);
        }
        return options.sort((a, b) => a - b);
    }, [maxFlowCount]);

    useEffect(() => {
        if (minFlowCount > maxFlowCount) {
            setMinFlowCount(0);
        }
    }, [minFlowCount, maxFlowCount]);

    const filteredSankeyFlows = useMemo(() => {
        if (!data?.flows) return [];
        const searchTerm = flowSearch.trim().toLowerCase();

        return data.flows.filter((flow) => {
            if (flowHealthFilter !== 'all' && getFlowHealth(flow) !== flowHealthFilter) {
                return false;
            }

            if (flow.count < minFlowCount) {
                return false;
            }

            if (searchTerm) {
                const haystack = `${flow.from} ${flow.to}`.toLowerCase();
                if (!haystack.includes(searchTerm)) return false;
            }

            if (onlyWithEvidence) {
                const transitionKey = `${flow.from}→${flow.to}`;
                const evidenceCount = (sankeyTransitionEvidence[transitionKey]?.length || 0) + (flow.sampleSessionIds?.length || 0);
                if (evidenceCount === 0) return false;
            }

            return true;
        });
    }, [data, flowSearch, flowHealthFilter, minFlowCount, onlyWithEvidence, sankeyTransitionEvidence]);

    const filteredFlowEventCount = useMemo(
        () => filteredSankeyFlows.reduce((sum, flow) => sum + flow.count, 0),
        [filteredSankeyFlows],
    );

    const transitionReplayOptions = useMemo<TransitionReplayOption[]>(() => {
        if (!data) return [];

        return data.flows.map((flow) => {
            const transitionKey = getTransitionKey(flow.from, flow.to);
            const priority = getFlowEvidencePriority(flow);
            const signal = getFlowEvidenceSignal(flow);

            return {
                id: transitionKey,
                label: `${flow.from} → ${flow.to}`,
                path: [flow.from, flow.to],
                sessionCount: flow.count,
                health: getFlowHealth(flow),
                priority,
                detail: signal,
                evidenceRows: dedupeEvidenceRows([
                    ...(flow.sampleSessionIds || []).map((sessionId) => ({
                        sessionId,
                        source: 'Flow sample',
                        signal,
                        priority,
                    })),
                    ...(sankeyTransitionEvidence[transitionKey] || []),
                ]),
            };
        });
    }, [data, sankeyTransitionEvidence]);

    const transitionReplayOptionMap = useMemo(
        () => new Map(transitionReplayOptions.map((option) => [option.id, option])),
        [transitionReplayOptions],
    );

    useEffect(() => {
        if (selectedTransitionIds.length === 0) return;
        const available = new Set(transitionReplayOptions.map((option) => option.id));
        const nextSelected = selectedTransitionIds.filter((id) => available.has(id));
        if (nextSelected.length !== selectedTransitionIds.length) {
            setSelectedTransitionIds(nextSelected);
        }
    }, [selectedTransitionIds, transitionReplayOptions]);

    const selectedTransitionOptions = useMemo(
        () => selectedTransitionIds
            .map((id) => transitionReplayOptionMap.get(id))
            .filter((option): option is TransitionReplayOption => Boolean(option)),
        [selectedTransitionIds, transitionReplayOptionMap],
    );

    const selectedQuerySessions = useMemo<QueryReplaySession[]>(() => {
        const sessionMap = new Map<string, QueryReplaySession>();

        for (const option of selectedTransitionOptions) {
            for (const row of option.evidenceRows) {
                if (!row.sessionId) continue;
                const existing = sessionMap.get(row.sessionId);
                if (!existing) {
                    sessionMap.set(row.sessionId, {
                        ...row,
                        matchedPaths: [option.label],
                    });
                    continue;
                }

                if (!existing.matchedPaths.includes(option.label)) {
                    existing.matchedPaths.push(option.label);
                }

                const existingRank = EVIDENCE_PRIORITY_RANK[existing.priority || 'low'];
                const incomingRank = EVIDENCE_PRIORITY_RANK[row.priority || 'low'];
                if (incomingRank >= existingRank) {
                    sessionMap.set(row.sessionId, {
                        ...existing,
                        source: row.source,
                        signal: row.signal,
                        priority: row.priority,
                    });
                }
            }
        }

        return Array.from(sessionMap.values()).sort((a, b) => {
            if (b.matchedPaths.length !== a.matchedPaths.length) return b.matchedPaths.length - a.matchedPaths.length;
            return EVIDENCE_PRIORITY_RANK[b.priority || 'low'] - EVIDENCE_PRIORITY_RANK[a.priority || 'low'];
        });
    }, [selectedTransitionOptions]);

    const selectedQuerySessionCount = selectedQuerySessions.length;
    const totalReplayEvidenceSessionCount = useMemo(
        () => new Set(transitionReplayOptions.flatMap((option) => option.evidenceRows.map((row) => row.sessionId))).size,
        [transitionReplayOptions],
    );

    const toggleSelectedTransition = (flow: Pick<SankeyFlow, 'from' | 'to'>) => {
        const transitionKey = getTransitionKey(flow.from, flow.to);
        setSelectedTransitionIds((current) => current.includes(transitionKey)
            ? current.filter((id) => id !== transitionKey)
            : [...current, transitionKey]);
    };

    const kpiCards = useMemo<KpiCardItem[]>(() => {
        const hasHappyPathData = Boolean(canonicalHappyPath && happyPathStages.length > 0);

        const sessionDelta = computePeriodDeltaFromSeries(
            (trends?.daily || []).map((day) => day.sessions),
            timeRange,
            'sum',
        );
        const issueRateDelta = computePeriodDeltaFromSeries(
            (trends?.daily || []).map((day) => (day.sessions > 0 ? (day.errorCount / day.sessions) * 100 : 0)),
            timeRange,
            'avg',
        );
        const durationDelta = computePeriodDeltaFromSeries(
            (trends?.daily || []).map((day) => day.avgDurationSeconds),
            timeRange,
            'avg',
        );

        return [
            {
                id: 'success-path-completion',
                label: 'Path Completion',
                value: `${pathCoverageRate.toFixed(1)}%`,
                sortValue: pathCoverageRate,
                info: hasHappyPathData
                    ? 'Share of sessions that followed the dominant happy path.'
                    : 'Healthy session rate. Configure a funnel to enable precise path completion tracking.',
                detail: hasHappyPathData
                    ? `${data?.happyPathJourney?.sessionCount?.toLocaleString() || 0} sessions on dominant path`
                    : `${formatCompact(data?.healthSummary.healthy || 0)} of ${formatCompact(totalSessions)} healthy sessions`,
                delta: issueRateDelta
                    ? {
                        value: issueRateDelta.deltaPct,
                        label: issueRateDelta.comparisonLabel,
                        betterDirection: 'down',
                        precision: 1,
                    }
                    : undefined,
            },
            {
                id: 'happy-path-entrants',
                label: hasHappyPathData ? 'Happy Entrants' : 'Total Sessions',
                value: formatCompact(startPopulation),
                sortValue: startPopulation,
                info: hasHappyPathData
                    ? 'Sessions that reached the first stage of the configured happy path.'
                    : 'Total sessions tracked in the selected period.',
                detail: hasHappyPathData
                    ? `${formatCompact(completionPopulation)} completions (${completionRateFromEntrants.toFixed(1)}%)`
                    : `${formatCompact(data?.healthSummary.healthy || 0)} healthy · ${formatCompact((data?.healthSummary.degraded || 0) + (data?.healthSummary.problematic || 0))} with issues`,
                delta: sessionDelta
                    ? {
                        value: sessionDelta.deltaPct,
                        label: sessionDelta.comparisonLabel,
                        betterDirection: 'up',
                        precision: 1,
                    }
                    : undefined,
            },
            {
                id: 'largest-leakage-step',
                label: 'Largest Leak',
                value: largestLeakStage ? `${largestLeakStage.from} → ${largestLeakStage.to}` : 'N/A',
                sortValue: largestLeakStage?.dropoff ?? 0,
                info: hasHappyPathData
                    ? 'Most severe transition drop-off in the current happy path sequence.'
                    : 'Screen with the most app exits.',
                detail: largestLeakStage
                    ? `${formatCompact(largestLeakStage.dropoff)} ${hasHappyPathData ? 'drop-off sessions' : 'exits'}`
                    : 'No exit data available',
                delta: issueRateDelta
                    ? {
                        value: issueRateDelta.deltaPct,
                        label: issueRateDelta.comparisonLabel,
                        betterDirection: 'down',
                        precision: 1,
                    }
                    : undefined,
            },
            {
                id: 'time-to-first-failure',
                label: 'Time to Failure',
                value: formatMs(data?.timeToFailure.avgTimeBeforeFirstErrorMs),
                sortValue: data?.timeToFailure.avgTimeBeforeFirstErrorMs ?? null,
                info: 'Average session time until the first tracked failure signal.',
                detail: `Crash around ${data?.timeToFailure.avgScreensBeforeCrash?.toFixed(1) || 'N/A'} screens`,
                delta: durationDelta
                    ? {
                        value: durationDelta.deltaPct,
                        label: durationDelta.comparisonLabel,
                        betterDirection: 'up',
                        precision: 1,
                    }
                    : undefined,
            },
        ];
    }, [pathCoverageRate, data, totalSessions, startPopulation, completionPopulation, completionRateFromEntrants, largestLeakStage, trends, timeRange, canonicalHappyPath, happyPathStages]);

    const hasData = Boolean(data && totalSessions > 0);

    if (isLoading && selectedProject?.id && !data) {
        return <DashboardGhostLoader variant="analytics" />;
    }

    return (
        <div className="min-h-screen bg-transparent pb-12 font-sans text-slate-900">
            <DashboardPageHeader
                title="User Journeys"
                icon={<Route className="w-6 h-6" />}
                iconColor="bg-fuchsia-500"
            >
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
                    <DataWatermarkBanner dataCompleteThrough={trends?.dataCompleteThrough} />
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </div>
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to load journey analytics.
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="dashboard-surface p-6 text-sm text-slate-600">
                        No journey activity matched this filter yet.
                    </div>
                )}

                {!isLoading && partialError && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        {partialError}
                    </div>
                )}

                {!isLoading && hasData && data && (
                    <>
                        <KpiCardsGrid
                            cards={kpiCards}
                            timeRange={timeRange}
                            storageKey="analytics-journeys"
                        />

                        <section className="dashboard-surface">
                            <div>
                                <div className="border-b border-slate-200 px-5 py-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <h2 className="text-lg font-semibold uppercase tracking-wide text-black">Journey Flow Map</h2>
                                        <Compass className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                                        <label className="space-y-1 text-xs text-slate-600">
                                            <span className="font-semibold text-slate-700">Path health</span>
                                            <select
                                                value={flowHealthFilter}
                                                onChange={(event) => setFlowHealthFilter(event.target.value as FlowHealthFilter)}
                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                                            >
                                                <option value="all">All paths</option>
                                                <option value="healthy">Healthy only</option>
                                                <option value="degraded">Degraded only</option>
                                                <option value="problematic">Problematic only</option>
                                            </select>
                                        </label>

                                        <label className="space-y-1 text-xs text-slate-600">
                                            <span className="font-semibold text-slate-700">Min transition volume</span>
                                            <select
                                                value={minFlowCount}
                                                onChange={(event) => setMinFlowCount(Number(event.target.value))}
                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                                            >
                                                {flowVolumeOptions.map((option) => (
                                                    <option key={option} value={option}>
                                                        {option === 0 ? 'No minimum' : `${formatCompact(option)}+ sessions`}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="space-y-1 text-xs text-slate-600">
                                            <span className="font-semibold text-slate-700">Screen/path search</span>
                                            <input
                                                type="text"
                                                value={flowSearch}
                                                onChange={(event) => setFlowSearch(event.target.value)}
                                                placeholder="e.g. Checkout or Search"
                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                                            />
                                        </label>

                                        <label className="flex items-center gap-2 self-end border border-gray-200 bg-[#f4f4f5] px-3 py-2 text-xs text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={onlyWithEvidence}
                                                onChange={(event) => setOnlyWithEvidence(event.target.checked)}
                                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="font-semibold">Only show paths with evidence sessions</span>
                                        </label>
                                    </div>
                                    <div className="mt-2 text-xs text-slate-500">
                                        Showing {filteredSankeyFlows.length.toLocaleString()} of {data.flows.length.toLocaleString()} transitions
                                        {' • '}
                                        {formatCompact(filteredFlowEventCount)} total transition events in view
                                    </div>
                                </div>
                                <div className="p-4">
                                    <SankeyJourney
                                        flows={filteredSankeyFlows}
                                        width={1450}
                                        height={520}
                                        happyPath={canonicalHappyPath}
                                        transitionEvidence={sankeyTransitionEvidence}
                                        selectedTransitionIds={selectedTransitionIds}
                                        onFlowToggle={toggleSelectedTransition}
                                    />
                                </div>
                            </div>
                        </section>

                        <section className="dashboard-surface overflow-hidden">
                            <div className="border-b border-slate-200 px-5 py-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <h2 className="text-lg font-semibold uppercase tracking-wide text-black">Selected Path Replay Query</h2>
                                        <p className="mt-1 text-sm text-slate-500">Click one or more paths in the flow map. Blue selected paths build this replay query.</p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                                        <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                                            {formatCompact(selectedTransitionOptions.length)} selected paths
                                        </span>
                                        <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                                            {formatCompact(selectedQuerySessionCount)} matching replays
                                        </span>
                                        {selectedTransitionIds.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedTransitionIds([])}
                                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-black hover:text-black"
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="p-5">
                                {selectedTransitionOptions.length > 0 ? (
                                    <div className="mb-4 flex flex-wrap gap-2">
                                        {selectedTransitionOptions.map((option) => (
                                            <button
                                                key={option.id}
                                                type="button"
                                                onClick={() => setSelectedTransitionIds((current) => current.filter((id) => id !== option.id))}
                                                className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-left text-xs font-bold text-blue-800 transition hover:border-blue-700 hover:bg-blue-100"
                                                title="Remove this selected path"
                                            >
                                                <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                                                <span className="truncate">{option.label}</span>
                                                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${getReplayHealthBadgeClass(option.health)}`}>
                                                    {option.health}
                                                </span>
                                                <span className="shrink-0 text-blue-500">x</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                                        Select one or more paths in the Sankey map to show matching replay sessions here.
                                        {totalReplayEvidenceSessionCount > 0 && (
                                            <span className="mt-2 block text-xs font-semibold text-slate-400">
                                                {formatCompact(totalReplayEvidenceSessionCount)} replay sessions are available across all paths.
                                            </span>
                                        )}
                                    </div>
                                )}

                                {selectedTransitionOptions.length > 0 && (
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                        {selectedQuerySessions.length > 0 ? (
                                            <div className="space-y-2">
                                                {selectedQuerySessions.map((row) => (
                                                    <div
                                                        key={row.sessionId}
                                                        className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                                                    >
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                                                <span className="max-w-full truncate font-mono text-xs font-bold text-slate-900" title={row.sessionId}>
                                                                    {row.sessionId}
                                                                </span>
                                                                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                                                    {row.source}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1 break-words text-sm text-slate-600">
                                                                {row.signal}
                                                            </div>
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {row.matchedPaths.map((pathLabel) => (
                                                                    <span
                                                                        key={`${row.sessionId}:${pathLabel}`}
                                                                        className="rounded border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700"
                                                                    >
                                                                        {pathLabel}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <Link
                                                            to={`${pathPrefix}/sessions/${row.sessionId}`}
                                                            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-black bg-black px-3 py-2 text-xs font-bold text-white transition hover:-translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.35)] sm:self-center"
                                                        >
                                                            <Play className="h-3 w-3 fill-current" />
                                                            Open Replay
                                                            <ArrowRight className="h-3 w-3" />
                                                        </Link>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="flex min-h-[220px] items-center justify-center bg-white p-6 text-center text-sm text-slate-500">
                                                The selected paths do not have replay evidence in this time range.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </section>

                    </>
                )}
            </div>
        </div>
    );
};

export default Journeys;
