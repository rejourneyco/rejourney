import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
    Check,
    ChevronDown,
    ChevronUp,
    Copy,
    Filter,
    Play,
    Route,
    Search,
    X,
} from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { AnimalAvatar, getAnimalAvatarSeed, getAnimalForIdentity } from '~/shared/ui/core/AnimalAvatar';
import { useSharedPlatformLens, platformLensToSessionPlatform } from '~/shared/hooks/useSharedPlatformLens';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { SankeyJourney, type SankeyEvidenceSession, type SankeyFlow } from '~/features/app/analytics/journeys/components/SankeyJourney';
import { KpiCardItem, KpiCardsGrid, computePeriodDeltaFromSeries } from '~/features/app/shared/dashboard/KpiCardsGrid';
import { DashboardGhostLoader, useInitialDashboardLoad } from '~/shared/ui/core/DashboardGhostLoader';
import {
    getSessionCore,
    getJourneysOverview,
    InsightsTrends,
    ObservabilityJourneySummary,
    transformToRecordingSession,
} from '~/shared/api/client';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import type { RecordingSession } from '~/shared/types';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { formatDeviceModel } from '~/shared/lib/deviceModelNames';
import { getWebSessionEnvironment } from '~/shared/lib/webSessionEnvironment';
import { BrowserBrandIcon } from '~/shared/ui/core/BrowserBrandIcon';
import { MobilePlatformBrandIcon } from '~/shared/ui/core/MobilePlatformBrandIcon';
import { CountryFlag } from '~/shared/ui/core/CountryFlag';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
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

const getReplayPriorityAccent = (priority?: SankeyEvidenceSession['priority']): string => {
    if (priority === 'high') return '#fb7185';
    if (priority === 'medium') return '#f9a8d4';
    return '#86efac';
};

const hasSuccessfulRecording = (session: RecordingSession | null | undefined): boolean =>
    Boolean(session?.hasSuccessfulRecording ?? ((session as any)?.stats?.screenshotSegmentCount ?? 0) > 0);

function isWebSession(session: RecordingSession | null | undefined): boolean {
    return String(session?.platform || '').toLowerCase() === 'web';
}

function getPlatformLabel(session: RecordingSession | null | undefined): string {
    const platform = String(session?.platform || '').toLowerCase();
    if (platform === 'web') return 'Web';
    if (platform === 'android') return 'Android';
    if (platform === 'ios') return 'iOS';
    return 'Mobile';
}

function formatNativeOsLabel(platformLabel: string, osVersion: unknown): string {
    const cleanVersion = String(osVersion || '').trim();
    if (!cleanVersion) return platformLabel;
    if (cleanVersion.toLowerCase().startsWith(platformLabel.toLowerCase())) {
        return `${platformLabel}${cleanVersion.slice(platformLabel.length)}`;
    }
    return `${platformLabel} ${cleanVersion.replace(/^v/i, '')}`;
}

function getReplaySessionRowAccent(
    session: RecordingSession | null | undefined,
    fallbackPriority?: SankeyEvidenceSession['priority'],
): string {
    if (!session) return getReplayPriorityAccent(fallbackPriority);
    if (!hasSuccessfulRecording(session) && !(session as any).canOpenReplay) return '#cbd5e1';
    if ((session.crashCount || 0) > 0) return '#fb7185';
    if (((session as any).anrCount || 0) > 0) return '#c4b5fd';
    if ((session.rageTapCount || 0) > 0 || ((session as any).deadTapCount || 0) > 0) return '#fbbf24';
    if (((session as any).errorCount || 0) > 0 || ((session as any).apiAvgResponseMs || 0) > 1000 || ((session as any).appStartupTimeMs || 0) > 3000) return '#f9a8d4';
    return '#86efac';
}

function formatReplayDuration(durationSeconds: number): string {
    const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds) : 0;
    return `${Math.floor(safeDuration / 60)}:${String(safeDuration % 60).padStart(2, '0')}`;
}

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
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const pathPrefix = usePathPrefix();
    const navigate = useNavigate();
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);
    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
    const [data, setData] = useState<ObservabilityJourneySummary | null>(null);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    const [partialError, setPartialError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedTransitionIds, setSelectedTransitionIds] = useState<string[]>([]);
    const [selectedAppVersion, setSelectedAppVersion] = useState<string | null>(null);
    const [hydratedSelectedTransitionsKey, setHydratedSelectedTransitionsKey] = useState<string | null>(null);
    const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
    const [evidenceSessionDetails, setEvidenceSessionDetails] = useState<Record<string, RecordingSession>>({});
    const [isEvidenceHydrating, setIsEvidenceHydrating] = useState(false);
    const [expandedEvidenceSessionId, setExpandedEvidenceSessionId] = useState<string | null>(null);
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
        setSelectedAppVersion(null);
    }, [selectedProject?.id, timeRange, platform]);

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

        void getJourneysOverview(selectedProject.id, timeRange, 'full', platform, selectedAppVersion)
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
    }, [manualRefreshVersion, selectedProject?.id, timeRange, platform, selectedAppVersion]);

    const totalSessions = useMemo(() => {
        if (!data) return 0;
        return data.healthSummary.healthy + data.healthSummary.degraded + data.healthSummary.problematic;
    }, [data]);

    const appVersionOptions = useMemo(
        () => data?.appVersions || [],
        [data?.appVersions],
    );

    useEffect(() => {
        if (!selectedAppVersion || appVersionOptions.length === 0) return;
        if (!appVersionOptions.some((option) => option.version === selectedAppVersion)) {
            setSelectedAppVersion(null);
        }
    }, [appVersionOptions, selectedAppVersion]);

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

    const journeyFlowPresentation = useMemo(
        () => buildJourneyFlowPresentation(data?.flows || [], canonicalHappyPath),
        [data?.flows, canonicalHappyPath],
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

    const selectedQuerySessionRows = useMemo(
        () => selectedQuerySessions.slice(0, 12),
        [selectedQuerySessions],
    );
    const selectedQuerySessionIdsKey = useMemo(
        () => selectedQuerySessionRows.map((row) => row.sessionId).join('|'),
        [selectedQuerySessionRows],
    );

    useEffect(() => {
        const sessionIds = selectedQuerySessionRows.map((row) => row.sessionId);
        if (sessionIds.length === 0) {
            setEvidenceSessionDetails({});
            setIsEvidenceHydrating(false);
            setExpandedEvidenceSessionId(null);
            return;
        }

        const sessionIdSet = new Set(sessionIds);
        setEvidenceSessionDetails((current) => Object.fromEntries(
            Object.entries(current).filter(([sessionId]) => sessionIdSet.has(sessionId)),
        ));
        setExpandedEvidenceSessionId((current) => (current && sessionIdSet.has(current) ? current : null));

        let isCancelled = false;
        const controller = new AbortController();
        setIsEvidenceHydrating(true);

        void Promise.all(sessionIds.map(async (sessionId) => {
            try {
                const core = await getSessionCore(sessionId, {
                    frameUrlMode: 'none',
                    includeReplay: false,
                    signal: controller.signal,
                });
                return [sessionId, transformToRecordingSession(core) as RecordingSession] as const;
            } catch (err) {
                if ((err as Error)?.name !== 'AbortError') {
                    console.warn('Journey evidence session hydrate failed:', sessionId, err);
                }
                return [sessionId, null] as const;
            }
        }))
            .then((entries) => {
                if (isCancelled) return;
                setEvidenceSessionDetails(Object.fromEntries(
                    entries.filter((entry): entry is readonly [string, RecordingSession] => Boolean(entry[1])),
                ));
            })
            .finally(() => {
                if (!isCancelled) setIsEvidenceHydrating(false);
            });

        return () => {
            isCancelled = true;
            controller.abort();
        };
    }, [selectedProject?.id, selectedQuerySessionIdsKey, selectedQuerySessionRows]);

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

    const shouldShowInitialGhost = useInitialDashboardLoad(isLoading);

    if (shouldShowInitialGhost && selectedProject?.id && !data) {
        return <DashboardGhostLoader variant="analytics" />;
    }

    return (
        <div className="rejourney-journeys-page min-h-screen bg-[#f8fafd] pb-12 font-sans text-[#202124]">
            <DashboardPageHeader
                title="User Journey"
                {...dashboardPageHeaderProps('journeys')}
            >
                <DashboardLensControls
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                />
            </DashboardPageHeader>

            <div className="journey-page-main mx-auto w-full max-w-[1560px] space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6">
                {!selectedProject?.id && (
                    <div className="dashboard-surface border-[#fbcfe8] bg-[#fdf2f8] p-4 text-sm font-semibold text-[#9d174d]">
                        Select a project to load journey analytics.
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="dashboard-surface p-6 text-sm font-medium text-slate-600">
                        No journey activity matched this filter yet.
                    </div>
                )}

                {!isLoading && partialError && (
                    <div className="dashboard-surface border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-semibold text-rose-800">
                        {partialError}
                    </div>
                )}

                {!isLoading && hasData && data && (
                    <div className="soft-border-scope space-y-5 sm:space-y-6">
                        <KpiCardsGrid
                            cards={kpiCards}
                            timeRange={timeRange}
                            storageKey="analytics-journeys"
                            showControls={false}
                            gridClassName="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4"
                        />

                        <SankeyJourney
                            flows={journeyFlowPresentation.flows}
                            height={700}
                            happyPath={canonicalHappyPath}
                            selectedTransitionIds={selectedTransitionIds}
                            onFlowToggle={toggleSelectedTransition}
                            appVersions={appVersionOptions}
                            selectedAppVersion={selectedAppVersion}
                            onAppVersionChange={setSelectedAppVersion}
                        />

                        <section className="rejourney-general-card overflow-hidden border border-[#dadce0] bg-white shadow-none">
                            <div className="h-1 bg-[#db2777]" />
                            <div className="border-b border-[#e8eaed] bg-white px-5 py-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <h2 className="text-[15px] font-medium text-[#202124] underline decoration-dotted decoration-[#bdc1c6] underline-offset-4">Replay Evidence</h2>
                                        <p className="mt-1 text-sm font-medium text-slate-600">Select map ribbons to find matching replay samples.</p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                                        <span className="journey-count-pill inline-flex h-9 items-center gap-1.5 rounded-full border border-[#dadce0] bg-white px-3 text-xs font-semibold text-[#3c4043] shadow-sm">
                                            <Filter className="h-3.5 w-3.5" />
                                            {formatCompact(selectedTransitionOptions.length)}
                                        </span>
                                        <span className="journey-count-pill inline-flex h-9 items-center rounded-full border border-[#dadce0] bg-white px-3 text-xs font-semibold text-[#3c4043] shadow-sm">
                                            {formatCompact(selectedQuerySessionCount)} evidence replays
                                        </span>
                                        {selectedTransitionIds.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedTransitionIds([])}
                                                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#dadce0] bg-white px-3 text-xs font-semibold text-[#3c4043] shadow-sm transition-colors hover:border-[#fbcfe8] hover:bg-[#fdf2f8] hover:text-[#be185d]"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                                Clear selection
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 p-4 sm:p-5">
                                {selectedTransitionOptions.length > 0 ? (
                                    <div className="dashboard-inner-surface p-4">
                                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[11px] font-bold uppercase text-slate-500">Query clauses</div>
                                                <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                                                    {selectedTransitionOptions.map((option, index) => (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            onClick={() => setSelectedTransitionIds((current) => current.filter((id) => id !== option.id))}
                                                            className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#dadce0] bg-white px-3 py-1.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:border-[#fbcfe8] hover:bg-[#fdf2f8] hover:text-[#be185d]"
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
                                                        className="inline-flex items-center justify-center gap-2 rounded-md bg-[#db2777] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#be185d]"
                                                    >
                                                        <Search className="h-4 w-4" />
                                                        Query Combined
                                                    </button>
                                                )}
                                                {selectedTransitionOptions.length === 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => applyJourneyQuery(selectedTransitionOptions[0].path)}
                                                        className="inline-flex items-center justify-center gap-2 rounded-md bg-[#db2777] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#be185d]"
                                                    >
                                                        <Search className="h-4 w-4" />
                                                        Search Replays
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {selectedContiguousJourneyPath && selectedTransitionOptions.length > 1 && (
                                            <div className="mt-4 flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-[#fbcfe8] bg-[#fdf2f8] px-3 py-2">
                                                {selectedContiguousJourneyPath.map((step, index) => (
                                                    <React.Fragment key={`${step}:${index}`}>
                                                        {index > 0 && <span className="text-xs font-semibold text-[#db2777]">→</span>}
                                                        <span className="max-w-full truncate rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-[#9d174d] ring-1 ring-[#fbcfe8]" title={step}>
                                                            {step}
                                                        </span>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="dashboard-inner-surface flex min-h-[180px] items-center justify-center border-dashed p-6 text-center">
                                        <div>
                                            <div className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-md border border-[#fbcfe8] bg-[#fdf2f8] text-[#db2777]">
                                                <Route className="h-5 w-5" />
                                            </div>
                                            <div className="text-sm font-semibold text-slate-900">No paths selected to search replays</div>
                                            {totalReplayEvidenceSessionCount > 0 && (
                                                <div className="mt-2 text-xs font-medium text-slate-500">
                                                    {formatCompact(totalReplayEvidenceSessionCount)} evidence replays are available across the map.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="dashboard-inner-surface overflow-hidden">
                                    <div className="flex flex-col gap-2 border-b border-[#dadce0] bg-[#f8fafd] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <div className="text-[11px] font-bold uppercase text-slate-500">Matching session sample</div>
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
                                        <div className="rejourney-replays-page dashboard-mobile-scroll overflow-x-auto">
                                            <div className="w-full min-w-[1160px] overflow-hidden border-2 border-black bg-white shadow-neo">
                                                <table className="w-full table-fixed border-collapse">
                                                    <thead>
                                                        <tr className="border-b-2 border-black bg-[#cffafe]">
                                                            <th className="sticky top-0 z-40 w-10 bg-[#cffafe] py-3 pl-4 pr-2" />
                                                            <th className="sticky top-0 z-40 w-[280px] bg-[#cffafe] px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-600">User</th>
                                                            <th className="sticky top-0 z-40 w-32 bg-[#cffafe] px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-600">Date</th>
                                                            <th className="sticky top-0 z-40 w-44 bg-[#cffafe] px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-600">Device</th>
                                                            <th className="sticky top-0 z-40 w-36 bg-[#cffafe] px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-600">Location</th>
                                                            <th className="sticky top-0 z-40 w-24 bg-[#cffafe] px-2 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-600">Screens</th>
                                                            <th className="sticky top-0 z-40 w-28 min-w-[7rem] bg-[#cffafe] px-2 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-600">Duration</th>
                                                            <th className="sticky top-0 z-40 w-36 bg-[#cffafe] px-3 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-600">Notes</th>
                                                            <th className="sticky top-0 z-40 w-12 bg-[#cffafe] py-3 pl-2 pr-4" />
                                                            <th className="sticky top-0 z-40 w-12 bg-[#cffafe] py-3 pl-2 pr-6" />
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y-2 divide-black/15">
                                                        {selectedQuerySessionRows.map((row, rowIndex) => {
                                                            const session = evidenceSessionDetails[row.sessionId];
                                                            const isExpanded = expandedEvidenceSessionId === row.sessionId;
                                                            const isZebraEven = rowIndex % 2 === 0;
                                                            const userId = session?.userId || (session as any)?.anonymousDisplayName || row.sessionId;
                                                            const displayUserId = userId.length > 20 ? `${userId.slice(0, 20)}…` : userId;
                                                            const avatarIdentity = {
                                                                id: row.sessionId,
                                                                anonymousDisplayName: (session as any)?.anonymousDisplayName || row.sessionId,
                                                            };
                                                            const replayAvatarSeed = getAnimalAvatarSeed(avatarIdentity);
                                                            const replayAvatar = getAnimalForIdentity(avatarIdentity);
                                                            const geoDisplay = formatGeoDisplay(session?.geoLocation);
                                                            const platformLabel = session ? getPlatformLabel(session) : 'Replay';
                                                            const displayDeviceModel = session ? formatDeviceModel(session.deviceModel) : 'Loading';
                                                            const webSession = isWebSession(session);
                                                            const webEnvironment = webSession && session ? getWebSessionEnvironment(session) : null;
                                                            const screensCount = session?.screensVisited?.length || row.matchedPaths.length;
                                                            const hasDeadTaps = ((session as any)?.deadTapCount || 0) > 0;
                                                            const hasSlowStart = false;
                                                            const hasSlowApi = ((session as any)?.apiAvgResponseMs || 0) > 1000;
                                                            const hasLowExploration = typeof session?.explorationScore === 'number' && session.explorationScore < 40;
                                                            const hasDeepExploration = typeof session?.explorationScore === 'number' && session.explorationScore >= 70;
                                                            const hasIssues = Boolean(session && (
                                                                (session.crashCount || 0) > 0 ||
                                                                ((session as any).anrCount || 0) > 0 ||
                                                                ((session as any).errorCount || 0) > 0 ||
                                                                (session.rageTapCount || 0) > 0 ||
                                                                hasDeadTaps ||
                                                                hasSlowStart ||
                                                                hasSlowApi
                                                            ));
                                                            const rowAccent = getReplaySessionRowAccent(session, row.priority);
                                                            const canOpenReplay = session ? ((session as any).canOpenReplay ?? hasSuccessfulRecording(session)) : true;
                                                            const date = session ? new Date(session.startedAt) : null;

                                                            return (
                                                                <React.Fragment key={row.sessionId}>
                                                                    <tr
                                                                        className={`cursor-pointer transition-colors ${isExpanded ? 'bg-[#f8fafc]' : isZebraEven ? 'bg-white hover:bg-[#f8fafc]' : 'bg-[#f8fafc] hover:bg-[#ecfeff]/45'}`}
                                                                        style={{ boxShadow: `inset 3px 0 0 ${rowAccent}` }}
                                                                        onClick={() => setExpandedEvidenceSessionId((current) => current === row.sessionId ? null : row.sessionId)}
                                                                    >
                                                                        <td className="w-10 py-2.5 pl-4 pr-2 align-middle text-center">
                                                                            <div className="mx-auto inline-flex h-7 w-7 items-center justify-center" title={`${row.sessionId} replay evidence`}>
                                                                                <AnimalAvatar animal={replayAvatar} seed={replayAvatarSeed} size={24} active={isExpanded} neutral />
                                                                            </div>
                                                                        </td>

                                                                        <td className="w-[280px] min-w-0 overflow-hidden px-3 py-2.5 align-middle">
                                                                            <div className="flex min-w-0 items-center gap-2">
                                                                                <h3
                                                                                    className="min-w-0 shrink truncate font-mono text-sm font-bold text-slate-900"
                                                                                    title={userId}
                                                                                >
                                                                                    {displayUserId}
                                                                                </h3>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(event) => {
                                                                                        event.stopPropagation();
                                                                                        void copySessionId(row.sessionId);
                                                                                    }}
                                                                                    className="text-slate-400 transition-colors hover:text-slate-900"
                                                                                    title="Copy session ID"
                                                                                >
                                                                                    {copiedSessionId === row.sessionId ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                                                                                </button>
                                                                            </div>
                                                                        </td>

                                                                        <td className="w-32 px-3 py-2.5 align-middle">
                                                                            {date ? (
                                                                                <>
                                                                                    <div className="text-xs font-black text-slate-900">{date.toLocaleDateString()}</div>
                                                                                    <div className="font-mono text-[10px] tracking-tight text-slate-400">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                                                                </>
                                                                            ) : (
                                                                                <span className="text-xs font-medium text-slate-400">{isEvidenceHydrating ? 'Loading' : '—'}</span>
                                                                            )}
                                                                        </td>

                                                                        <td className="w-44 px-3 py-2.5 align-middle text-left">
                                                                            {session ? (
                                                                                <div
                                                                                    className="flex min-w-0 items-center gap-2"
                                                                                    title={webEnvironment ? `${webEnvironment.browserTitle} · ${webEnvironment.osTitle}` : `${displayDeviceModel}${session.osVersion ? ` · ${session.osVersion}` : ''}`}
                                                                                >
                                                                                    {webEnvironment ? (
                                                                                        <BrowserBrandIcon browserName={webEnvironment.browserName} className="h-4 w-4 shrink-0" />
                                                                                    ) : (
                                                                                        <MobilePlatformBrandIcon platformName={platformLabel} className="h-4 w-4 shrink-0 text-slate-500" />
                                                                                    )}
                                                                                    <div className="min-w-0 leading-tight">
                                                                                        <div className="truncate text-sm font-bold text-slate-900">
                                                                                            {webEnvironment ? webEnvironment.browserLabel : formatNativeOsLabel(platformLabel, session.osVersion)}
                                                                                        </div>
                                                                                        <div className="truncate text-[10px] font-bold tracking-tight text-slate-500">
                                                                                            {webEnvironment ? webEnvironment.osLabel : displayDeviceModel}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="leading-tight">
                                                                                    <div className="text-sm font-bold text-slate-400">{isEvidenceHydrating ? 'Loading' : 'Replay'}</div>
                                                                                    <div className="text-[10px] font-bold tracking-tight text-slate-400">Evidence</div>
                                                                                </div>
                                                                            )}
                                                                        </td>

                                                                        <td className="w-36 overflow-hidden px-3 py-2.5 align-middle">
                                                                            {geoDisplay.hasLocation ? (
                                                                                <div className="leading-tight">
                                                                                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                                                                                        <CountryFlag countryCode={geoDisplay.countryCode} countryLabel={geoDisplay.countryLabel} decorative />
                                                                                        <span className="truncate">{geoDisplay.countryLabel}</span>
                                                                                    </div>
                                                                                    <div className="truncate pl-5 text-[10px] font-bold text-slate-500">
                                                                                        {geoDisplay.cityLabel || 'City Unknown'}
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <span className="text-xs font-medium text-slate-400">—</span>
                                                                            )}
                                                                        </td>

                                                                        <td className="w-24 px-2 py-2.5 text-right align-middle">
                                                                            {screensCount > 0 ? (
                                                                                <span className="inline-block border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-700">
                                                                                    {screensCount}
                                                                                </span>
                                                                            ) : (
                                                                                <span className="text-xs text-slate-300">—</span>
                                                                            )}
                                                                        </td>

                                                                        <td className="w-28 min-w-[7rem] px-2 py-2.5 text-right align-middle">
                                                                            {session ? (
                                                                                <span className="border border-black bg-[#ecfeff] px-1.5 py-0.5 font-mono text-xs font-bold text-black">
                                                                                    {formatReplayDuration(session.durationSeconds)}
                                                                                </span>
                                                                            ) : (
                                                                                <span className="text-xs font-medium text-slate-400">—</span>
                                                                            )}
                                                                        </td>

                                                                        <td className="w-36 px-3 py-2.5 text-right align-middle">
                                                                            <div className="flex min-h-[28px] flex-wrap items-center justify-end gap-1.5">
                                                                                {session?.isFirstSession && (
                                                                                    <span
                                                                                        className="inline-flex items-center border-2 border-black bg-[#86efac] px-2 py-0.5 text-[10px] font-black uppercase text-black shadow-neo-sm"
                                                                                        title="First recorded session for this visitor in this project"
                                                                                    >
                                                                                        NEW USER
                                                                                    </span>
                                                                                )}
                                                                                {row.priority === 'high' && <NeoBadge variant="danger" size="sm">HIGH</NeoBadge>}
                                                                                {row.priority === 'medium' && <NeoBadge variant="neutral" size="sm">MED</NeoBadge>}
                                                                                {session && (session.crashCount || 0) > 0 && (
                                                                                    <span
                                                                                        title="Application crash (fatal exception)"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=crash`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <NeoBadge variant="danger" size="sm">CRASH</NeoBadge>
                                                                                    </span>
                                                                                )}
                                                                                {session && ((session as any).anrCount || 0) > 0 && (
                                                                                    <span
                                                                                        title="App Not Responding (UI thread blocked)"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=anr`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <NeoBadge variant="neutral" size="sm">ANR</NeoBadge>
                                                                                    </span>
                                                                                )}
                                                                                {session && ((session as any).errorCount || 0) > 0 && (
                                                                                    <span
                                                                                        title="Logged error or resource loading failure"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=error`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <NeoBadge variant="neutral" size="sm">ERR</NeoBadge>
                                                                                    </span>
                                                                                )}
                                                                                {session && (session.rageTapCount || 0) > 0 && (
                                                                                    <span
                                                                                        title="Rage tap (repeated rapid taps in a small area)"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=rage`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <NeoBadge variant="danger" size="sm">RAGE</NeoBadge>
                                                                                    </span>
                                                                                )}
                                                                                {session && hasDeadTaps && (
                                                                                    <span
                                                                                        title="Dead tap (tap on a non-interactive area with no response)"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=dead`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <NeoBadge variant="neutral" size="sm">DEAD</NeoBadge>
                                                                                    </span>
                                                                                )}
                                                                                {session && hasSlowStart && (
                                                                                    <span
                                                                                        title="Slow cold startup duration"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=slow_start`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <NeoBadge variant="neutral" size="sm">SLOW</NeoBadge>
                                                                                    </span>
                                                                                )}
                                                                                {session && hasSlowApi && (
                                                                                    <span
                                                                                        title="Slow API average latency (over 1000ms)"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=api`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <NeoBadge variant="neutral" size="sm">API</NeoBadge>
                                                                                    </span>
                                                                                )}
                                                                                {session && hasLowExploration && (
                                                                                    <span
                                                                                        title="Shallow session (low exploration score under 40)"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=start`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <NeoBadge variant="low_exp" size="sm">SHALLOW</NeoBadge>
                                                                                    </span>
                                                                                )}
                                                                                {session && hasDeepExploration && (
                                                                                    <span
                                                                                        title="Deep session (high exploration score 70 or above)"
                                                                                        className={canOpenReplay ? "cursor-pointer hover:opacity-80" : ""}
                                                                                        onClick={(e) => {
                                                                                            if (canOpenReplay) {
                                                                                                e.stopPropagation();
                                                                                                e.preventDefault();
                                                                                                navigate(`${pathPrefix}/sessions/${row.sessionId}?seekToType=start`);
                                                                                            }
                                                                                        }}
                                                                                    >
                                                                                        <span className="inline-flex items-center border border-[#15803d] bg-[#dcfce7] px-2 py-0.5 text-[10px] font-black uppercase text-[#14532d]">
                                                                                            DEEP
                                                                                        </span>
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </td>

                                                                        <td className="w-12 py-2.5 pl-2 pr-4 text-center align-middle">
                                                                            <button
                                                                                type="button"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    if (canOpenReplay) navigate(`${pathPrefix}/sessions/${row.sessionId}`);
                                                                                }}
                                                                                disabled={!canOpenReplay}
                                                                                className={`group/play inline-flex items-center justify-center border-2 border-transparent p-1.5 transition-all ${canOpenReplay ? 'text-slate-700 hover:border-black hover:bg-[#67e8f9] hover:text-black hover:shadow-neo-sm' : 'cursor-not-allowed text-slate-300 opacity-40'}`}
                                                                                title={canOpenReplay ? 'Open Replay' : 'Replay unavailable for this session'}
                                                                            >
                                                                                <Play size={16} className={canOpenReplay ? 'group-hover/play:fill-current' : ''} />
                                                                            </button>
                                                                        </td>

                                                                        <td className="w-12 py-2.5 pl-2 pr-6 align-middle">
                                                                            <button
                                                                                type="button"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    setExpandedEvidenceSessionId((current) => current === row.sessionId ? null : row.sessionId);
                                                                                }}
                                                                                className={`mx-auto flex items-center justify-center border-2 border-transparent p-1.5 transition-all ${isExpanded ? 'border-black bg-[#67e8f9] text-black shadow-neo-sm' : 'text-slate-600 hover:border-black hover:bg-[#ecfeff] hover:text-black hover:shadow-neo-sm'}`}
                                                                                title={isExpanded ? 'Hide journey match details' : 'Show journey match details'}
                                                                            >
                                                                                {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                                                            </button>
                                                                        </td>
                                                                    </tr>

                                                                    {isExpanded && (
                                                                        <tr>
                                                                            <td colSpan={10} className="border-b-2 border-black bg-[#f8fafc] p-0 align-top">
                                                                                <div className="space-y-3 px-5 pb-5 pt-3 sm:px-7">
                                                                                    <div className="grid gap-2 text-xs md:grid-cols-3">
                                                                                        <div className="border border-black bg-white p-3">
                                                                                            <div className="mb-1 text-[10px] font-black uppercase text-slate-500">Source</div>
                                                                                            <div className="font-semibold text-slate-900">{row.source}</div>
                                                                                        </div>
                                                                                        <div className="border border-black bg-white p-3">
                                                                                            <div className="mb-1 text-[10px] font-black uppercase text-slate-500">Signal</div>
                                                                                            <div className="font-semibold text-slate-900">{row.signal}</div>
                                                                                        </div>
                                                                                        <div className="border border-black bg-white p-3">
                                                                                            <div className="mb-1 text-[10px] font-black uppercase text-slate-500">Matched Paths</div>
                                                                                            <div className="font-semibold text-slate-900">{row.matchedPaths.length}</div>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="flex flex-wrap gap-2">
                                                                                        {row.matchedPaths.map((path) => (
                                                                                            <span
                                                                                                key={path}
                                                                                                className="max-w-full truncate border border-[#dadce0] bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                                                                                                title={path}
                                                                                            >
                                                                                                {path}
                                                                                            </span>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex min-h-[180px] items-center justify-center p-6 text-center text-sm font-medium text-slate-500">
                                            Select one or more ribbons in the journey map to populate the replay table.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>

                    </div>
                )}
            </div>
        </div>
    );
};

export default Journeys;
