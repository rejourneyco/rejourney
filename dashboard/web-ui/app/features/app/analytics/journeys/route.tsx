import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
    Check,
    Compass,
    Copy,
    Filter,
    Play,
    Route,
    Search,
    X,
} from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { useSessionData } from '~/shared/providers/SessionContext';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { useSharedPlatformLens, platformLensToSessionPlatform } from '~/shared/hooks/useSharedPlatformLens';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { SankeyJourney, type SankeyEvidenceSession, type SankeyFlow } from '~/features/app/analytics/journeys/components/SankeyJourney';
import { KpiCardItem, KpiCardsGrid, computePeriodDeltaFromSeries } from '~/features/app/shared/dashboard/KpiCardsGrid';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import {
    getJourneysOverview,
    InsightsTrends,
    ObservabilityJourneySummary,
} from '~/shared/api/client';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import {
    generateConditionId,
    generateGroupId,
    type QueryGroup,
} from '~/features/app/sessions/index/queryBuilderTypes';

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
const SESSION_QUERY_GROUPS_STORAGE_PREFIX = 'rejourney:session-archive:query-groups:v1';
const MAX_DRAWN_JOURNEY_FLOWS = 28;
const DIRECT_JOURNEY_FLOW_BUDGET = 22;
const MAX_AGGREGATE_JOURNEY_BUCKETS = 5;

type JourneyFlowPresentation = {
    flows: SankeyFlow[];
    directCount: number;
    aggregatedCount: number;
    aggregateEventCount: number;
    droppedCount: number;
    droppedEventCount: number;
};

const getSankeyFlowHealth = (flow: SankeyFlow): 'healthy' | 'degraded' | 'problematic' => {
    if (flow.health) return flow.health;
    if (flow.crashCount > 0 || flow.anrCount > 0) return 'problematic';
    if (flow.apiErrorRate > 5 || flow.rageTapCount >= 2 || (flow.avgApiLatencyMs || 0) > 1000) return 'degraded';
    return 'healthy';
};

const healthRank: Record<'healthy' | 'degraded' | 'problematic', number> = {
    healthy: 0,
    degraded: 1,
    problematic: 2,
};

const buildAggregateFlow = (from: string, members: SankeyFlow[]): SankeyFlow => {
    const count = members.reduce((sum, flow) => sum + flow.count, 0);
    const weightedRate = count > 0
        ? members.reduce((sum, flow) => sum + flow.apiErrorRate * flow.count, 0) / count
        : 0;
    const weightedLatency = count > 0
        ? members.reduce((sum, flow) => sum + (flow.avgApiLatencyMs || 0) * flow.count, 0) / count
        : 0;
    const health = members.reduce<'healthy' | 'degraded' | 'problematic'>((worst, flow) => {
        const current = getSankeyFlowHealth(flow);
        return healthRank[current] > healthRank[worst] ? current : worst;
    }, 'healthy');

    return {
        from,
        to: `Other after ${from}`,
        count,
        apiErrors: members.reduce((sum, flow) => sum + (flow.apiErrors || 0), 0),
        apiErrorRate: Math.round(weightedRate * 10) / 10,
        avgApiLatencyMs: Math.round(weightedLatency),
        rageTapCount: members.reduce((sum, flow) => sum + flow.rageTapCount, 0),
        crashCount: members.reduce((sum, flow) => sum + flow.crashCount, 0),
        anrCount: members.reduce((sum, flow) => sum + flow.anrCount, 0),
        health,
        replayCount: members.reduce((sum, flow) => sum + (flow.replayCount || 0), 0),
        sampleSessionIds: Array.from(new Set(members.flatMap((flow) => flow.sampleSessionIds || []))).slice(0, 6),
        isAggregate: true,
        aggregateFlowCount: members.length,
    };
};

const buildJourneyFlowPresentation = (
    flows: SankeyFlow[],
    happyPath: string[] | null,
): JourneyFlowPresentation => {
    if (flows.length <= MAX_DRAWN_JOURNEY_FLOWS) {
        return {
            flows,
            directCount: flows.length,
            aggregatedCount: 0,
            aggregateEventCount: 0,
            droppedCount: 0,
            droppedEventCount: 0,
        };
    }

    const totalEvents = flows.reduce((sum, flow) => sum + flow.count, 0);
    const maxCount = flows.reduce((max, flow) => Math.max(max, flow.count), 0);
    const minOutlierCount = Math.max(2, Math.ceil(totalEvents * 0.0025), Math.ceil(maxCount * 0.01));
    const happyTransitionIds = new Set<string>();
    if (happyPath && happyPath.length > 1) {
        for (let index = 0; index < happyPath.length - 1; index += 1) {
            happyTransitionIds.add(getTransitionKey(happyPath[index], happyPath[index + 1]));
        }
    }

    const sorted = [...flows].sort((a, b) => {
        const countDelta = b.count - a.count;
        if (countDelta !== 0) return countDelta;
        return healthRank[getSankeyFlowHealth(b)] - healthRank[getSankeyFlowHealth(a)];
    });

    const droppedOutliers = sorted.filter((flow) => (
        flow.count < minOutlierCount
        && !happyTransitionIds.has(getTransitionKey(flow.from, flow.to))
    ));
    const outlierIds = new Set(droppedOutliers.map((flow) => getTransitionKey(flow.from, flow.to)));
    const candidates = sorted.filter((flow) => !outlierIds.has(getTransitionKey(flow.from, flow.to)));

    const direct: SankeyFlow[] = [];
    const directIds = new Set<string>();
    const addDirect = (flow: SankeyFlow) => {
        const key = getTransitionKey(flow.from, flow.to);
        if (directIds.has(key) || direct.length >= DIRECT_JOURNEY_FLOW_BUDGET) return;
        direct.push(flow);
        directIds.add(key);
    };

    if (happyPath && happyPath.length > 1) {
        for (let index = 0; index < happyPath.length - 1; index += 1) {
            const key = getTransitionKey(happyPath[index], happyPath[index + 1]);
            const flow = candidates.find((candidate) => getTransitionKey(candidate.from, candidate.to) === key);
            if (flow) addDirect(flow);
        }
    }

    for (const flow of candidates) {
        addDirect(flow);
    }

    const tail = candidates.filter((flow) => !directIds.has(getTransitionKey(flow.from, flow.to)));
    const groupedTail = new Map<string, SankeyFlow[]>();
    for (const flow of tail) {
        if (!groupedTail.has(flow.from)) groupedTail.set(flow.from, []);
        groupedTail.get(flow.from)!.push(flow);
    }

    const aggregateGroups = Array.from(groupedTail.entries())
        .map(([from, members]) => ({
            from,
            members,
            count: members.reduce((sum, flow) => sum + flow.count, 0),
        }))
        .sort((a, b) => b.count - a.count);

    const visibleAggregateGroups = aggregateGroups.slice(0, MAX_AGGREGATE_JOURNEY_BUCKETS);
    const hiddenAggregateGroups = aggregateGroups.slice(MAX_AGGREGATE_JOURNEY_BUCKETS);
    const aggregateFlows = visibleAggregateGroups.map((group) => buildAggregateFlow(group.from, group.members));
    const hiddenAggregateMembers = hiddenAggregateGroups.flatMap((group) => group.members);
    const droppedFlows = [...droppedOutliers, ...hiddenAggregateMembers];

    return {
        flows: [...direct, ...aggregateFlows],
        directCount: direct.length,
        aggregatedCount: visibleAggregateGroups.reduce((sum, group) => sum + group.members.length, 0),
        aggregateEventCount: visibleAggregateGroups.reduce((sum, group) => sum + group.count, 0),
        droppedCount: droppedFlows.length,
        droppedEventCount: droppedFlows.reduce((sum, flow) => sum + flow.count, 0),
    };
};

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

const getReplayHealthPillClass = (health: TransitionReplayOption['health']): string => {
    if (health === 'problematic') return 'border-rose-200 bg-rose-50 text-rose-700';
    if (health === 'degraded') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

const getReplayPriorityPillClass = (priority?: SankeyEvidenceSession['priority']): string => {
    if (priority === 'high') return 'border-rose-200 bg-rose-50 text-rose-700';
    if (priority === 'medium') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-slate-200 bg-slate-50 text-slate-600';
};

const getReplayPriorityDotClass = (priority?: SankeyEvidenceSession['priority']): string => {
    if (priority === 'high') return 'bg-[#fb7185]';
    if (priority === 'medium') return 'bg-[#f9a8d4]';
    return 'bg-[#86efac]';
};

const getSessionQueryGroupsStorageKey = (projectId: string): string => `${SESSION_QUERY_GROUPS_STORAGE_PREFIX}:${projectId}`;

const buildJourneyQueryGroups = (path: string[]): QueryGroup[] => [
    {
        id: generateGroupId(),
        conditions: [
            {
                id: generateConditionId(),
                type: 'journey',
                steps: path,
            },
        ],
    },
];

const buildContiguousJourneyPath = (options: TransitionReplayOption[]): string[] | null => {
    if (options.length === 0) return null;
    if (options.length === 1) return options[0].path;

    const outgoing = new Map<string, string>();
    const incoming = new Map<string, string>();

    for (const option of options) {
        const [from, to] = option.path;
        if (!from || !to || outgoing.has(from) || incoming.has(to)) return null;
        outgoing.set(from, to);
        incoming.set(to, from);
    }

    const starts = Array.from(outgoing.keys()).filter((node) => !incoming.has(node));
    if (starts.length !== 1) return null;

    const path = [starts[0]];
    let current = starts[0];

    while (outgoing.has(current)) {
        current = outgoing.get(current)!;
        if (path.includes(current)) return null;
        path.push(current);
    }

    return path.length === options.length + 1 ? path : null;
};


export const Journeys: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
    const navigate = useNavigate();
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);
    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
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
    const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
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

        void getJourneysOverview(selectedProject.id, timeRange, 'full', platform)
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
    }, [selectedProject?.id, timeRange, platform]);

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

    const journeyFlowPresentation = useMemo(
        () => buildJourneyFlowPresentation(filteredSankeyFlows, canonicalHappyPath),
        [filteredSankeyFlows, canonicalHappyPath],
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
    const selectedContiguousJourneyPath = useMemo(
        () => buildContiguousJourneyPath(selectedTransitionOptions),
        [selectedTransitionOptions],
    );

    const toggleSelectedTransition = (flow: Pick<SankeyFlow, 'from' | 'to'>) => {
        const transitionKey = getTransitionKey(flow.from, flow.to);
        setSelectedTransitionIds((current) => current.includes(transitionKey)
            ? current.filter((id) => id !== transitionKey)
            : [...current, transitionKey]);
    };

    const applyJourneyQuery = (path: string[]) => {
        if (!selectedProject?.id || path.length < 2) return;

        const queryGroups = buildJourneyQueryGroups(path);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(getSessionQueryGroupsStorageKey(selectedProject.id), JSON.stringify(queryGroups));
        }
        navigate(`${pathPrefix}/sessions`);
    };

    const copySessionId = async (sessionId: string) => {
        try {
            await navigator.clipboard.writeText(sessionId);
            setCopiedSessionId(sessionId);
            window.setTimeout(() => setCopiedSessionId((current) => current === sessionId ? null : current), 1400);
        } catch (err) {
            console.error('Failed to copy session id:', err);
        }
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
        <div className="firebase-journeys-page min-h-screen bg-[#f8fafd] pb-12 font-sans text-slate-900">
            <DashboardPageHeader
                title="User Journeys"
                icon={<Route className="w-6 h-6" />}
                iconColor="bg-[#fce7f3]"
            >
                <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
                        Select a project to load journey analytics.
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="dashboard-surface p-6 text-sm text-slate-600">
                        No journey activity matched this filter yet.
                    </div>
                )}

                {!isLoading && partialError && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                        {partialError}
                    </div>
                )}

                {!isLoading && hasData && data && (
                    <>
                        <KpiCardsGrid
                            cards={kpiCards}
                            timeRange={timeRange}
                            storageKey="analytics-journeys"
                            showControls={false}
                            gridClassName="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4"
                        />

                        <section className="dashboard-surface overflow-hidden">
                            <div>
                                <div className="border-b-2 border-black bg-[#f8fafc] px-5 py-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h2 className="text-lg font-semibold uppercase tracking-wide text-black">Flow Map</h2>
                                            <p className="mt-1 text-sm text-slate-500">Screen transitions by volume and health.</p>
                                        </div>
                                        <Compass className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div className="journey-filter-grid mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(160px,0.8fr)_minmax(160px,0.8fr)_minmax(240px,1.35fr)_minmax(220px,1fr)]">
                                        <label className="space-y-1 text-xs text-slate-600">
                                            <span className="font-semibold text-slate-700">Health</span>
                                            <select
                                                value={flowHealthFilter}
                                                onChange={(event) => setFlowHealthFilter(event.target.value as FlowHealthFilter)}
                                                className="w-full border-2 border-black bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 shadow-neo-sm focus:outline-none focus:ring-2 focus:ring-black"
                                            >
                                                <option value="all">All paths</option>
                                                <option value="healthy">Healthy only</option>
                                                <option value="degraded">Degraded only</option>
                                                <option value="problematic">Problematic only</option>
                                            </select>
                                        </label>

                                        <label className="space-y-1 text-xs text-slate-600">
                                            <span className="font-semibold text-slate-700">Min volume</span>
                                            <select
                                                value={minFlowCount}
                                                onChange={(event) => setMinFlowCount(Number(event.target.value))}
                                                className="w-full border-2 border-black bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 shadow-neo-sm focus:outline-none focus:ring-2 focus:ring-black"
                                            >
                                                {flowVolumeOptions.map((option) => (
                                                    <option key={option} value={option}>
                                                        {option === 0 ? 'No minimum' : `${formatCompact(option)}+ sessions`}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="space-y-1 text-xs text-slate-600">
                                            <span className="font-semibold text-slate-700">Search</span>
                                            <input
                                                type="text"
                                                value={flowSearch}
                                                onChange={(event) => setFlowSearch(event.target.value)}
                                                placeholder="e.g. Checkout or Search"
                                                className="w-full border-2 border-black bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 shadow-neo-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black"
                                            />
                                        </label>

                                        <label className="journey-evidence-toggle flex items-center gap-2 self-end border-2 border-black bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-neo-sm">
                                            <input
                                                type="checkbox"
                                                checked={onlyWithEvidence}
                                                onChange={(event) => setOnlyWithEvidence(event.target.checked)}
                                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="font-semibold">Evidence only</span>
                                        </label>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                        <span>{journeyFlowPresentation.flows.length.toLocaleString()} lanes</span>
                                        <span className="text-slate-300">/</span>
                                        <span>{filteredSankeyFlows.length.toLocaleString()} matching transitions</span>
                                        <span className="text-slate-300">/</span>
                                        <span>{formatCompact(filteredFlowEventCount)} events</span>
                                    </div>
                                </div>
                                <div className="p-4">
                                    <SankeyJourney
                                        flows={journeyFlowPresentation.flows}
                                        height={560}
                                        happyPath={canonicalHappyPath}
                                        selectedTransitionIds={selectedTransitionIds}
                                        onFlowToggle={toggleSelectedTransition}
                                    />
                                </div>
                            </div>
                        </section>

                        <section className="dashboard-surface overflow-hidden">
                            <div className="border-b-2 border-black bg-[#f8fafc] px-5 py-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <h2 className="text-lg font-semibold uppercase tracking-wide text-black">Replay Evidence</h2>
                                        <p className="mt-1 text-sm text-slate-500">Select map ribbons to find matching replay samples.</p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                                        <span className="journey-count-pill inline-flex h-9 items-center gap-1.5 border-2 border-black bg-white px-3 text-xs font-black uppercase text-black shadow-neo-sm">
                                            <Filter className="h-3.5 w-3.5" />
                                            {formatCompact(selectedTransitionOptions.length)}
                                        </span>
                                        <span className="journey-count-pill inline-flex h-9 items-center border-2 border-black bg-white px-3 text-xs font-black uppercase text-black shadow-neo-sm">
                                            {formatCompact(selectedQuerySessionCount)} evidence replays
                                        </span>
                                        {selectedTransitionIds.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedTransitionIds([])}
                                                className="inline-flex h-9 items-center gap-1.5 border-2 border-black bg-white px-3 text-xs font-black uppercase text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#fecaca] hover:shadow-neo"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                                Clear selection
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-5 p-5">
                                {selectedTransitionOptions.length > 0 ? (
                                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Query clauses</div>
                                                <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                                                    {selectedTransitionOptions.map((option, index) => (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            onClick={() => setSelectedTransitionIds((current) => current.filter((id) => id !== option.id))}
                                                            className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                                                            title="Remove clause"
                                                        >
                                                            <span className="shrink-0 text-slate-400">#{index + 1}</span>
                                                            <span className="min-w-0 truncate">{option.label}</span>
                                                            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase ${getReplayHealthPillClass(option.health)}`}>
                                                                {option.health}
                                                            </span>
                                                            <X className="h-3 w-3 shrink-0" />
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 flex-wrap gap-2">
                                                {selectedContiguousJourneyPath && selectedTransitionOptions.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => applyJourneyQuery(selectedContiguousJourneyPath)}
                                                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold uppercase text-white shadow-sm transition hover:bg-slate-800"
                                                    >
                                                        <Search className="h-4 w-4" />
                                                        Query Combined
                                                    </button>
                                                )}
                                                {selectedTransitionOptions.length === 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => applyJourneyQuery(selectedTransitionOptions[0].path)}
                                                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold uppercase text-white shadow-sm transition hover:bg-slate-800"
                                                    >
                                                        <Search className="h-4 w-4" />
                                                        Search Replays
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {selectedContiguousJourneyPath && selectedTransitionOptions.length > 1 && (
                                            <div className="mt-4 flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2">
                                                {selectedContiguousJourneyPath.map((step, index) => (
                                                    <React.Fragment key={`${step}:${index}`}>
                                                        {index > 0 && <span className="text-xs font-semibold text-cyan-500">→</span>}
                                                        <span className="max-w-full truncate rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-cyan-900 ring-1 ring-cyan-100" title={step}>
                                                            {step}
                                                        </span>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
                                        <div>
                                            <div className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                                                <Route className="h-5 w-5" />
                                            </div>
                                            <div className="text-sm font-bold uppercase text-slate-900">No paths selected to search replays</div>
                                            {totalReplayEvidenceSessionCount > 0 && (
                                                <div className="mt-2 text-xs font-medium text-slate-500">
                                                    {formatCompact(totalReplayEvidenceSessionCount)} evidence replays are available across the map.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                                    <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Matching session sample</div>
                                            <div className="mt-0.5 text-sm font-semibold text-slate-900">
                                                {selectedQuerySessions.length > 0
                                                    ? `${formatCompact(selectedQuerySessions.length)} replay IDs match selected clauses`
                                                    : 'Build a path clause to preview matching replay IDs'}
                                            </div>
                                        </div>
                                        <span className="text-xs font-medium text-slate-500">
                                            Opens filtered replay search
                                        </span>
                                    </div>

                                    {selectedQuerySessions.length > 0 ? (
                                        <>
                                            <div className="divide-y divide-slate-100 md:hidden">
                                                {selectedQuerySessions.slice(0, 12).map((row, rowIndex) => (
                                                    <div key={row.sessionId} className={`p-4 ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getReplayPriorityDotClass(row.priority)}`} />
                                                            <div className="min-w-0 truncate font-mono text-xs font-semibold text-slate-950" title={row.sessionId}>
                                                                {row.sessionId}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => copySessionId(row.sessionId)}
                                                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
                                                                title="Copy session ID"
                                                            >
                                                                {copiedSessionId === row.sessionId ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                                            </button>
                                                        </div>
                                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${getReplayPriorityPillClass(row.priority)}`}>
                                                                {row.source}
                                                            </span>
                                                            <span className="text-[10px] font-semibold uppercase text-slate-500">
                                                                {row.matchedPaths.length} clause match{row.matchedPaths.length === 1 ? '' : 'es'}
                                                            </span>
                                                        </div>
                                                        <div className="mt-2 text-xs font-medium text-slate-700">
                                                            {row.signal}
                                                        </div>
                                                        <div className="mt-3 flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => navigate(`${pathPrefix}/sessions/${row.sessionId}`)}
                                                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-slate-950 px-3 text-[11px] font-bold uppercase text-white transition hover:bg-slate-800"
                                                                title="Play replay"
                                                            >
                                                                <Play className="h-3.5 w-3.5 fill-current" />
                                                                Play
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="hidden overflow-x-auto md:block">
                                                <table className="w-full min-w-[760px] table-fixed border-collapse">
                                                    <thead>
                                                        <tr className="border-b border-slate-200 bg-white">
                                                            <th className="w-10 px-4 py-3" />
                                                            <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Session</th>
                                                            <th className="w-[22%] px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Source</th>
                                                            <th className="w-[32%] px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Signal</th>
                                                            <th className="w-[18%] px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Match</th>
                                                            <th className="w-[72px] px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Replay</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {selectedQuerySessions.slice(0, 12).map((row, rowIndex) => (
                                                            <tr key={row.sessionId} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'}>
                                                                <td className="px-4 py-3 align-middle">
                                                                    <span className={`block h-2.5 w-2.5 rounded-full ${getReplayPriorityDotClass(row.priority)}`} />
                                                                </td>
                                                                <td className="min-w-0 px-3 py-3 align-middle">
                                                                    <div className="flex min-w-0 items-center gap-2">
                                                                        <div className="min-w-0 truncate font-mono text-xs font-semibold text-slate-950" title={row.sessionId}>
                                                                            {row.sessionId}
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => copySessionId(row.sessionId)}
                                                                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
                                                                            title="Copy session ID"
                                                                        >
                                                                            {copiedSessionId === row.sessionId ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-3 align-middle">
                                                                    <span className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${getReplayPriorityPillClass(row.priority)}`}>
                                                                        <span className="truncate">{row.source}</span>
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-3 align-middle">
                                                                    <div className="truncate text-xs font-medium text-slate-700" title={row.signal}>
                                                                        {row.signal}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3 align-middle text-xs font-semibold text-slate-600">
                                                                    {row.matchedPaths.length} clause{row.matchedPaths.length === 1 ? '' : 's'}
                                                                </td>
                                                                <td className="px-4 py-3 align-middle">
                                                                    <div className="flex items-center justify-end gap-1.5">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => navigate(`${pathPrefix}/sessions/${row.sessionId}`)}
                                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-950 text-white transition hover:bg-slate-800"
                                                                            title="Play replay"
                                                                        >
                                                                            <Play className="h-3.5 w-3.5 fill-current" />
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex min-h-[180px] items-center justify-center p-6 text-center text-sm font-medium text-slate-500">
                                            Select one or more ribbons in the journey map to populate the replay table.
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
