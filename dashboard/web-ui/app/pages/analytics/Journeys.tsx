import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Compass,
    HeartPulse,
    Route,
    Users,
} from 'lucide-react';
import {
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
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { useSessionData } from '../../context/SessionContext';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { SankeyEvidenceSession, SankeyJourney } from '../../components/analytics/SankeyJourney';
import { KpiCardItem, KpiCardsGrid, computePeriodDeltaFromSeries } from '../../components/dashboard/KpiCardsGrid';
import { TouchHeatmapSection } from '../../components/dashboard/TouchHeatmapSection';
import {
    getInsightsTrends,
    getJourneyObservability,
    getUserEngagementTrends,
    InsightsTrends,
    ObservabilityJourneySummary,
    UserEngagementTrends,
} from '../../services/api';
import { usePathPrefix } from '../../hooks/usePathPrefix';

type HappyPathStage = {
    from: string;
    to: string;
    entrants: number;
    progressed: number;
    dropoff: number;
    conversionRate: number;
    issueRatePer100: number;
};

type UserTypeMixRow = {
    key: 'loyalists' | 'explorers' | 'casuals' | 'bouncers';
    label: string;
    value: number;
    color: string;
};

type NavigationLoopRow = {
    loop: string;
    forwardLabel: string;
    backwardLabel: string;
    forwardCount: number;
    backCount: number;
    forwardSigned: number;
    backSigned: number;
    loopVolume: number;
    totalLoopTraffic: number;
    reciprocityPct: number;
};

type BacktrackHotspotRow = {
    screen: string;
    outgoing: number;
    backtrackVolume: number;
    backtrackRate: number;
    dominantRouteShare: number;
    branchCount: number;
    visits: number;
};

type JourneyFailureSignatureRow = {
    journeyLabel: string;
    path: string;
    sessions: number;
    apiPer100: number;
    ragePer100: number;
    stabilityPer100: number;
};

type DailyBehaviorLoadRow = {
    date: string;
    sessions: number;
    apiCallsPerSession: number;
    errorPer100Sessions: number;
    ragePer100Sessions: number;
    avgDurationMin: number;
};

type FlowHealthFilter = 'all' | 'healthy' | 'degraded' | 'problematic';
type JourneyFlow = ObservabilityJourneySummary['flows'][number];

const EVIDENCE_PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = {
    high: 3,
    medium: 2,
    low: 1,
};

const toJourneyTimeRange = (value: TimeRange): string | undefined => {
    if (value === 'all') return undefined;
    return value;
};

const toTrendsRange = (value: TimeRange): string => {
    if (value === '24h') return '7d';
    if (value === '7d') return '30d';
    if (value === '30d') return '90d';
    return 'all';
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


export const Journeys: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [data, setData] = useState<ObservabilityJourneySummary | null>(null);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    const [userEngagementTrends, setUserEngagementTrends] = useState<UserEngagementTrends | null>(null);
    const [partialError, setPartialError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [flowHealthFilter, setFlowHealthFilter] = useState<FlowHealthFilter>('all');
    const [flowSearch, setFlowSearch] = useState('');
    const [minFlowCount, setMinFlowCount] = useState(0);
    const [onlyWithEvidence, setOnlyWithEvidence] = useState(false);

    useEffect(() => {
        if (!selectedProject?.id) {
            setData(null);
            setTrends(null);
            setUserEngagementTrends(null);
            setPartialError(null);
            setIsLoading(false);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);
        setPartialError(null);

        Promise.allSettled([
            getJourneyObservability(selectedProject.id, toJourneyTimeRange(timeRange)),
            getInsightsTrends(selectedProject.id, toTrendsRange(timeRange)),
            getUserEngagementTrends(selectedProject.id, toJourneyTimeRange(timeRange)),
        ])
            .then(([journeyData, trendData, userTypeData]) => {
                if (isCancelled) return;

                const failedSections: string[] = [];

                if (journeyData.status === 'fulfilled') {
                    setData(journeyData.value);
                } else {
                    failedSections.push('journey summary');
                    setData(null);
                }

                if (trendData.status === 'fulfilled') {
                    setTrends(trendData.value);
                } else {
                    failedSections.push('trend window');
                    setTrends(null);
                }

                if (userTypeData.status === 'fulfilled') {
                    setUserEngagementTrends(userTypeData.value);
                } else {
                    failedSections.push('user segment mix');
                    setUserEngagementTrends(null);
                }

                if (failedSections.length > 0) {
                    setPartialError(`Some journey widgets are unavailable (${failedSections.join(', ')}).`);
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
        if (!data?.happyPathJourney || totalSessions === 0) return 0;
        return (data.happyPathJourney.sessionCount / totalSessions) * 100;
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
        if (!happyPathStages.length) return null;
        return [...happyPathStages].sort((a, b) => b.dropoff - a.dropoff)[0];
    }, [happyPathStages]);

    const startPopulation = happyPathStages[0]?.entrants || 0;
    const completionPopulation = happyPathStages[happyPathStages.length - 1]?.progressed || 0;
    const completionRateFromEntrants = startPopulation > 0 ? (completionPopulation / startPopulation) * 100 : 0;

    const userTypeMixData = useMemo<UserTypeMixRow[]>(() => {
        const totals = userEngagementTrends?.totals;
        return [
            { key: 'loyalists', label: 'Loyalists', value: Number(totals?.loyalists || 0), color: '#10b981' },
            { key: 'explorers', label: 'Explorers', value: Number(totals?.explorers || 0), color: '#3b82f6' },
            { key: 'casuals', label: 'Casuals', value: Number(totals?.casuals || 0), color: '#f59e0b' },
            { key: 'bouncers', label: 'Bouncers', value: Number(totals?.bouncers || 0), color: '#ef4444' },
        ];
    }, [userEngagementTrends]);

    const totalUserTypeMixUsers = useMemo(
        () => userTypeMixData.reduce((sum, row) => sum + row.value, 0),
        [userTypeMixData],
    );

    const leakageChartData = useMemo(() => {
        if (!happyPathStages.length) return [];
        return happyPathStages
            .map((stage) => ({
                stage: `${stage.from} -> ${stage.to}`,
                dropoff: stage.dropoff,
                issueRatePer100: Number(stage.issueRatePer100.toFixed(1)),
            }))
            .sort((a, b) => b.dropoff - a.dropoff)
            .slice(0, 6);
    }, [happyPathStages]);

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

    const navigationLoopData = useMemo<NavigationLoopRow[]>(() => {
        if (!data?.flows?.length) return [];

        const edgeMap = new Map<string, JourneyFlow>();
        for (const flow of data.flows) {
            edgeMap.set(`${flow.from}::${flow.to}`, flow);
        }

        const visitedPairs = new Set<string>();
        const loops: NavigationLoopRow[] = [];

        for (const flow of data.flows) {
            if (flow.from === flow.to) continue;

            const pairKey = [flow.from, flow.to].sort().join('::');
            if (visitedPairs.has(pairKey)) continue;
            visitedPairs.add(pairKey);

            const reverse = edgeMap.get(`${flow.to}::${flow.from}`);
            if (!reverse) continue;

            const loopVolume = Math.min(flow.count, reverse.count);
            const reciprocityBase = Math.max(flow.count, reverse.count);
            const reciprocityPct = reciprocityBase > 0
                ? Number(((loopVolume / reciprocityBase) * 100).toFixed(1))
                : 0;

            loops.push({
                loop: `${flow.from} <-> ${flow.to}`,
                forwardLabel: `${flow.from} -> ${flow.to}`,
                backwardLabel: `${flow.to} -> ${flow.from}`,
                forwardCount: flow.count,
                backCount: reverse.count,
                forwardSigned: flow.count,
                backSigned: -reverse.count,
                loopVolume,
                totalLoopTraffic: flow.count + reverse.count,
                reciprocityPct,
            });
        }

        return loops
            .sort((a, b) => b.loopVolume - a.loopVolume || b.reciprocityPct - a.reciprocityPct)
            .slice(0, 8);
    }, [data]);

    const maxLoopDirectionMagnitude = useMemo(() => {
        if (!navigationLoopData.length) return 100;
        const maxValue = navigationLoopData.reduce(
            (max, loop) => Math.max(max, loop.forwardCount, loop.backCount),
            0,
        );
        return Math.max(100, Math.ceil(maxValue * 1.12));
    }, [navigationLoopData]);

    const backtrackHotspotData = useMemo<BacktrackHotspotRow[]>(() => {
        if (!data?.flows?.length) return [];

        const edgeMap = new Map<string, JourneyFlow>();
        const flowsBySource = new Map<string, JourneyFlow[]>();

        for (const flow of data.flows) {
            edgeMap.set(`${flow.from}::${flow.to}`, flow);
            if (!flowsBySource.has(flow.from)) flowsBySource.set(flow.from, []);
            flowsBySource.get(flow.from)!.push(flow);
        }

        const visitsByScreen = new Map<string, number>();
        for (const screen of data.topScreens) {
            visitsByScreen.set(screen.screen, screen.visits);
        }
        for (const screen of data.screenHealth) {
            const current = visitsByScreen.get(screen.name) || 0;
            visitsByScreen.set(screen.name, Math.max(current, screen.visits));
        }

        return Array.from(flowsBySource.entries())
            .map(([screen, outgoing]) => {
                const totalOutgoing = outgoing.reduce((sum, flow) => sum + flow.count, 0);
                if (totalOutgoing <= 0) return null;

                const maxBranchCount = outgoing.reduce((max, flow) => Math.max(max, flow.count), 0);
                const backtrackVolume = outgoing.reduce((sum, flow) => {
                    const reverse = edgeMap.get(`${flow.to}::${flow.from}`);
                    if (!reverse) return sum;
                    return sum + Math.min(flow.count, reverse.count);
                }, 0);

                return {
                    screen,
                    outgoing: totalOutgoing,
                    backtrackVolume,
                    backtrackRate: Number(((backtrackVolume / totalOutgoing) * 100).toFixed(1)),
                    dominantRouteShare: Number(((maxBranchCount / totalOutgoing) * 100).toFixed(1)),
                    branchCount: outgoing.length,
                    visits: visitsByScreen.get(screen) || totalOutgoing,
                };
            })
            .filter((item): item is BacktrackHotspotRow => Boolean(item))
            .sort((a, b) => {
                const scoreA = a.backtrackRate * Math.log10(a.outgoing + 10);
                const scoreB = b.backtrackRate * Math.log10(b.outgoing + 10);
                return scoreB - scoreA;
            })
            .slice(0, 8);
    }, [data]);

    const journeyFailureSignatureData = useMemo<JourneyFailureSignatureRow[]>(() => {
        if (!data?.problematicJourneys?.length) return [];

        return data.problematicJourneys
            .filter((journey) => journey.sessionCount > 0)
            .sort((a, b) => b.sessionCount - a.sessionCount)
            .slice(0, 8)
            .map((journey, idx) => ({
                journeyLabel: `J${idx + 1}`,
                path: journey.path.join(' -> '),
                sessions: journey.sessionCount,
                apiPer100: Number(((journey.apiErrors / journey.sessionCount) * 100).toFixed(1)),
                ragePer100: Number(((journey.rageTaps / journey.sessionCount) * 100).toFixed(1)),
                stabilityPer100: Number((((journey.crashes + journey.anrs) / journey.sessionCount) * 100).toFixed(1)),
            }));
    }, [data]);

    const dailyBehaviorLoadData = useMemo<DailyBehaviorLoadRow[]>(() => {
        if (!trends?.daily?.length) return [];

        return trends.daily.map((day) => {
            const sessions = Math.max(0, day.sessions || 0);
            const formatDate = day.date.length >= 10 ? day.date.slice(5) : day.date;

            return {
                date: formatDate,
                sessions,
                apiCallsPerSession: sessions > 0 ? Number((day.totalApiCalls / sessions).toFixed(2)) : 0,
                errorPer100Sessions: sessions > 0 ? Number(((day.errorCount / sessions) * 100).toFixed(2)) : 0,
                ragePer100Sessions: sessions > 0 ? Number(((day.rageTaps / sessions) * 100).toFixed(2)) : 0,
                avgDurationMin: Number(((day.avgDurationSeconds || 0) / 60).toFixed(2)),
            };
        });
    }, [trends]);

    const kpiCards = useMemo<KpiCardItem[]>(() => {
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
                info: 'Share of sessions that followed the dominant happy path.',
                detail: `${data?.happyPathJourney?.sessionCount?.toLocaleString() || 0} sessions on dominant path`,
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
                label: 'Happy Entrants',
                value: formatCompact(startPopulation),
                sortValue: startPopulation,
                info: 'Sessions that reached the first stage of the configured happy path.',
                detail: `${formatCompact(completionPopulation)} completions (${completionRateFromEntrants.toFixed(1)}%)`,
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
                value: largestLeakStage ? `${largestLeakStage.from} -> ${largestLeakStage.to}` : 'N/A',
                sortValue: largestLeakStage?.dropoff ?? 0,
                info: 'Most severe transition drop-off in the current happy path sequence.',
                detail: largestLeakStage ? `${formatCompact(largestLeakStage.dropoff)} drop-off sessions` : 'No dominant leak',
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
    }, [pathCoverageRate, data, startPopulation, completionPopulation, completionRateFromEntrants, largestLeakStage, trends, timeRange]);

    const hasData = Boolean(data && totalSessions > 0);

    return (
        <div className="min-h-screen font-sans text-slate-900 bg-transparent">
            <div className="sticky top-0 z-30 bg-white">
                <DashboardPageHeader
                    title="User Journeys"
                    icon={<Route className="w-6 h-6" />}
                    iconColor="bg-fuchsia-500"
                >
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </DashboardPageHeader>
            </div>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-6 py-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to load journey analytics.
                    </div>
                )}

                {isLoading && (
                    <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-6 shadow-sm">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                            <Activity className="h-4 w-4 animate-pulse text-blue-600" />
                            Loading journey analytics...
                        </div>
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-6 text-sm text-slate-600 shadow-sm">
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

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">User Type Mix</h2>
                                    <Users className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="h-[260px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={userTypeMixData}
                                                dataKey="value"
                                                nameKey="label"
                                                innerRadius={58}
                                                outerRadius={88}
                                                paddingAngle={3}
                                            >
                                                {userTypeMixData.map((row) => (
                                                    <Cell key={row.key} fill={row.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                formatter={(value: number | string | undefined, name: string) => [
                                                    formatCompact(Number(value || 0)),
                                                    name || 'Users',
                                                ]}
                                                contentStyle={{ padding: '8px 12px' }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                    {userTypeMixData.map((row) => (
                                        <div
                                            key={row.key}
                                            className="flex items-center gap-2 rounded-xl border border-slate-100/80 bg-slate-50/50 p-2"
                                            style={{ borderLeftWidth: 4, borderLeftColor: row.color }}
                                        >
                                            <div className="flex-1 text-center">
                                                <div className="font-semibold text-slate-900">{row.label}</div>
                                                <div className="mt-0.5 text-slate-600">
                                                    {totalUserTypeMixUsers > 0 ? `${((row.value / totalUserTypeMixUsers) * 100).toFixed(1)}%` : '0%'}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Top Leakage Stages</h2>
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                <div className="h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={leakageChartData} layout="vertical" margin={{ left: 8, right: 16, top: 6, bottom: 6 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis type="number" tick={{ fontSize: 11 }} />
                                            <YAxis dataKey="stage" type="category" width={180} tick={{ fontSize: 11 }} />
                                            <Tooltip />
                                            <Bar dataKey="dropoff" name="Drop-off sessions" fill="#ef4444" radius={[4, 4, 4, 4]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 shadow-sm">
                            <div>
                                <div className="border-b border-slate-200 px-5 py-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <h2 className="text-lg font-semibold text-slate-900">Journey Flow Map</h2>
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

                                        <label className="flex items-end gap-2 rounded-xl border border-slate-100/80 bg-slate-50/50 px-3 py-2 text-xs text-slate-700">
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
                                        sessionPathPrefix={pathPrefix}
                                        transitionEvidence={sankeyTransitionEvidence}
                                    />
                                </div>
                            </div>
                        </section>

                        <TouchHeatmapSection timeRange={timeRange} compact />

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Backtrack Loop Imbalance</h2>
                                    <Compass className="h-5 w-5 text-indigo-600" />
                                </div>
                                <div className="h-[320px]">
                                    {navigationLoopData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={navigationLoopData} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis
                                                    type="number"
                                                    domain={[-maxLoopDirectionMagnitude, maxLoopDirectionMagnitude]}
                                                    tick={{ fontSize: 11 }}
                                                    tickFormatter={(value: number) => formatCompact(Math.abs(value))}
                                                />
                                                <YAxis dataKey="loop" type="category" width={170} tick={{ fontSize: 11 }} />
                                                <ReferenceLine x={0} stroke="#64748b" strokeOpacity={0.45} />
                                                <Tooltip
                                                    formatter={(value, name, item) => {
                                                        if (name === 'Forward continuation') {
                                                            return [formatCompact(Math.abs(Number(value || 0))), item?.payload?.forwardLabel || 'Forward'];
                                                        }
                                                        if (name === 'Return backtrack') {
                                                            return [formatCompact(Math.abs(Number(value || 0))), item?.payload?.backwardLabel || 'Backward'];
                                                        }
                                                        return [value || 0, String(name)];
                                                    }}
                                                    labelFormatter={(_label, payload) => {
                                                        const row = payload?.[0]?.payload as NavigationLoopRow | undefined;
                                                        if (!row) return 'Loop';
                                                        return `${row.loop} (${row.reciprocityPct.toFixed(1)}% reciprocity • ${formatCompact(row.totalLoopTraffic)} total transitions)`;
                                                    }}
                                                />
                                                <Legend />
                                                <Bar dataKey="backSigned" name="Return backtrack" fill="#f97316" radius={[4, 0, 0, 4]} />
                                                <Bar dataKey="forwardSigned" name="Forward continuation" fill="#2563eb" radius={[0, 4, 4, 0]} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500">
                                            No reciprocal flow loops detected in this window.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Backtrack Hotspots by Screen</h2>
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                <div className="h-[320px]">
                                    {backtrackHotspotData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={backtrackHotspotData} layout="vertical" margin={{ left: 8, right: 18, top: 8, bottom: 8 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis type="number" tick={{ fontSize: 11 }} />
                                                <YAxis dataKey="screen" type="category" width={145} tick={{ fontSize: 11 }} />
                                                <Tooltip
                                                    formatter={(value, name, item) => {
                                                        if (name === 'Backtrack rate (%)') {
                                                            const row = item?.payload as BacktrackHotspotRow | undefined;
                                                            return [
                                                                `${Number(value || 0).toFixed(1)}%`,
                                                                `Backtrack rate (${formatCompact(row?.backtrackVolume || 0)} of ${formatCompact(row?.outgoing || 0)} transitions)`,
                                                            ];
                                                        }
                                                        if (name === 'Branch count') {
                                                            const row = item?.payload as BacktrackHotspotRow | undefined;
                                                            return [
                                                                Number(value || 0).toFixed(0),
                                                                `Branch count (dominant route ${row?.dominantRouteShare?.toFixed(1) || '0.0'}%)`,
                                                            ];
                                                        }
                                                        return [value || 0, String(name)];
                                                    }}
                                                    labelFormatter={(label) => `Screen: ${label}`}
                                                />
                                                <Legend />
                                                <Bar dataKey="backtrackRate" name="Backtrack rate (%)" fill="#dc2626" radius={[4, 4, 4, 4]} />
                                                <Bar dataKey="branchCount" name="Branch count" fill="#0ea5e9" radius={[4, 4, 4, 4]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500">
                                            Backtrack hotspot data is not available for this filter.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Failure Signatures by Journey Cluster</h2>
                                    <HeartPulse className="h-5 w-5 text-rose-600" />
                                </div>
                                <div className="h-[320px]">
                                    {journeyFailureSignatureData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={journeyFailureSignatureData} margin={{ left: 0, right: 18, top: 8, bottom: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis dataKey="journeyLabel" tick={{ fontSize: 11 }} />
                                                <YAxis tick={{ fontSize: 11 }} />
                                                <Tooltip
                                                    formatter={(value, name, item) => {
                                                        if (name === 'API errors /100 sessions') return [Number(value || 0).toFixed(1), 'API errors /100 sessions'];
                                                        if (name === 'Rage taps /100 sessions') return [Number(value || 0).toFixed(1), 'Rage taps /100 sessions'];
                                                        if (name === 'Crashes+ANRs /100 sessions') return [Number(value || 0).toFixed(1), 'Crashes+ANRs /100 sessions'];
                                                        return [value || 0, String(name)];
                                                    }}
                                                    labelFormatter={(_label, payload) => {
                                                        const row = payload?.[0]?.payload as JourneyFailureSignatureRow | undefined;
                                                        return row?.path || 'Journey cluster';
                                                    }}
                                                />
                                                <Legend />
                                                <Bar dataKey="apiPer100" stackId="signature" name="API errors /100 sessions" fill="#2563eb" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="ragePer100" stackId="signature" name="Rage taps /100 sessions" fill="#f97316" />
                                                <Bar dataKey="stabilityPer100" stackId="signature" name="Crashes+ANRs /100 sessions" fill="#ef4444" radius={[0, 0, 4, 4]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500">
                                            No problematic journey clusters for this period.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5 p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Daily Interaction Load</h2>
                                    <Activity className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="h-[320px]">
                                    {dailyBehaviorLoadData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={dailyBehaviorLoadData} margin={{ left: 0, right: 12, top: 10, bottom: 8 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={18} />
                                                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                                                <Tooltip
                                                    formatter={(value, name) => {
                                                        if (name === 'Sessions') return [formatCompact(Number(value || 0)), 'Sessions'];
                                                        if (name === 'API calls / session') return [Number(value || 0).toFixed(2), 'API calls / session'];
                                                        if (name === 'Errors /100 sessions') return [Number(value || 0).toFixed(2), 'Errors /100 sessions'];
                                                        if (name === 'Rage taps /100 sessions') return [Number(value || 0).toFixed(2), 'Rage taps /100 sessions'];
                                                        return [Number(value || 0).toFixed(2), 'Avg duration (min)'];
                                                    }}
                                                />
                                                <Legend />
                                                <Bar yAxisId="left" dataKey="sessions" name="Sessions" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                                                <Line yAxisId="right" type="monotone" dataKey="apiCallsPerSession" name="API calls / session" stroke="#2563eb" strokeWidth={2} dot={false} />
                                                <Line yAxisId="right" type="monotone" dataKey="errorPer100Sessions" name="Errors /100 sessions" stroke="#ef4444" strokeWidth={2} dot={false} />
                                                <Line yAxisId="right" type="monotone" dataKey="ragePer100Sessions" name="Rage taps /100 sessions" stroke="#f97316" strokeWidth={2} dot={false} />
                                                <Line yAxisId="right" type="monotone" dataKey="avgDurationMin" name="Avg duration (min)" stroke="#0f766e" strokeWidth={2} dot={false} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500">
                                            Daily behavior trend data is unavailable for this range.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
};

export default Journeys;
