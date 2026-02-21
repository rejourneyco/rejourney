import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Compass,
    Flag,
    HeartPulse,
    LayoutGrid,
    PlayCircle,
    Route,
    Timer,
} from 'lucide-react';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { useSessionData } from '../../context/SessionContext';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { SankeyJourney } from '../../components/analytics/SankeyJourney';
import { getJourneyObservability, ObservabilityJourneySummary } from '../../services/api';
import { usePathPrefix } from '../../hooks/usePathPrefix';

type TransitionInsight = ObservabilityJourneySummary['flows'][number] & {
    riskScore: number;
    recommendedAction: string;
};

type HappyPathStage = {
    from: string;
    to: string;
    entrants: number;
    progressed: number;
    dropoff: number;
    conversionRate: number;
    issueRatePer100: number;
    recommendation: string;
    evidenceSessionId?: string;
};

type ScreenPriority = ObservabilityJourneySummary['screenHealth'][number] & {
    impactScore: number;
    incidentRatePer100: number;
    recommendation: string;
};

const toJourneyTimeRange = (value: TimeRange): string | undefined => {
    if (value === 'all') return undefined;
    return value;
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

const getTransitionAction = (flow: ObservabilityJourneySummary['flows'][number]): string => {
    if (flow.crashCount > 0 || flow.anrCount > 0) {
        return 'Prioritize crash/ANR triage on this transition.';
    }
    if (flow.apiErrorRate > 5) {
        return 'Investigate backend failures and add retry/fallback UX.';
    }
    if (flow.avgApiLatencyMs > 1000) {
        return 'Optimize request fan-out or prefetch before this handoff.';
    }
    if (flow.rageTapCount >= 2) {
        return 'Review interaction affordance and tap target feedback.';
    }
    return 'Monitor; no immediate intervention required.';
};

const getScreenAction = (screen: ObservabilityJourneySummary['screenHealth'][number]): string => {
    if (screen.crashes + screen.anrs >= 8) return 'Stabilize crash/ANR path before UI tuning.';
    if (screen.apiErrors >= 50) return 'Fix API reliability and retry flows on this screen.';
    if (screen.rageTaps >= 40) return 'Improve interaction clarity and control feedback.';
    return 'Monitor for regressions and keep this screen healthy.';
};


export const Journeys: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [data, setData] = useState<ObservabilityJourneySummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!selectedProject?.id) {
            setData(null);
            setIsLoading(false);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);

        getJourneyObservability(selectedProject.id, toJourneyTimeRange(timeRange))
            .then((result) => {
                if (!isCancelled) setData(result);
            })
            .catch(() => {
                if (!isCancelled) setData(null);
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

    const riskyTransitions = useMemo<TransitionInsight[]>(() => {
        if (!data?.flows) return [];
        return data.flows
            .map((flow) => {
                const riskScore =
                    flow.crashCount * 12 +
                    flow.anrCount * 10 +
                    flow.rageTapCount * 2 +
                    flow.apiErrorRate * 4 +
                    Math.max(0, flow.avgApiLatencyMs - 300) / 45;
                return {
                    ...flow,
                    riskScore,
                    recommendedAction: getTransitionAction(flow),
                };
            })
            .sort((a, b) => b.riskScore - a.riskScore)
            .slice(0, 10);
    }, [data]);

    const transitionEvidenceMap = useMemo(() => {
        const mapping = new Map<string, string>();
        if (!data?.problematicJourneys?.length) return mapping;

        for (const journey of data.problematicJourneys) {
            for (let i = 0; i < journey.path.length - 1; i++) {
                const edgeKey = `${journey.path[i]}::${journey.path[i + 1]}`;
                if (!mapping.has(edgeKey) && journey.sampleSessionIds?.[0]) {
                    mapping.set(edgeKey, journey.sampleSessionIds[0]);
                }
            }
        }

        return mapping;
    }, [data]);

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
                recommendation: flow ? getTransitionAction(flow) : 'Instrument this transition and verify session continuity.',
                evidenceSessionId: transitionEvidenceMap.get(`${from}::${to}`) || data.happyPathJourney?.sampleSessionIds?.[0],
            };
        });
    }, [data, canonicalHappyPath, transitionEvidenceMap]);

    const largestLeakStage = useMemo(() => {
        if (!happyPathStages.length) return null;
        return [...happyPathStages].sort((a, b) => b.dropoff - a.dropoff)[0];
    }, [happyPathStages]);

    const startPopulation = happyPathStages[0]?.entrants || 0;
    const completionPopulation = happyPathStages[happyPathStages.length - 1]?.progressed || 0;
    const completionRateFromEntrants = startPopulation > 0 ? (completionPopulation / startPopulation) * 100 : 0;

    const screenPriorities = useMemo<ScreenPriority[]>(() => {
        if (!data?.screenHealth) return [];
        return data.screenHealth
            .map((screen) => {
                const weightedIncidents = (screen.crashes * 5) + (screen.anrs * 4) + (screen.apiErrors * 2) + screen.rageTaps;
                const incidentRatePer100 = screen.visits > 0 ? (weightedIncidents / screen.visits) * 100 : 0;
                const impactScore = Number((incidentRatePer100 * Math.log10(screen.visits + 9)).toFixed(1));
                return {
                    ...screen,
                    impactScore,
                    incidentRatePer100: Number(incidentRatePer100.toFixed(1)),
                    recommendation: getScreenAction(screen),
                };
            })
            .sort((a, b) => b.impactScore - a.impactScore)
            .slice(0, 8);
    }, [data]);

    const failingJourneys = useMemo(() => {
        if (!data?.problematicJourneys) return [];
        return data.problematicJourneys.slice(0, 6).map((journey) => ({
            ...journey,
            sessionShare: totalSessions > 0 ? (journey.sessionCount / totalSessions) * 100 : 0,
        }));
    }, [data, totalSessions]);

    const screenEvidenceMap = useMemo(() => {
        const mapping = new Map<string, string>();
        if (!data) return mapping;

        for (const item of data.exitAfterError || []) {
            if (item.sampleSessionIds?.[0] && !mapping.has(item.screen)) {
                mapping.set(item.screen, item.sampleSessionIds[0]);
            }
        }

        for (const journey of data.problematicJourneys || []) {
            const sessionId = journey.sampleSessionIds?.[0];
            if (!sessionId) continue;
            for (const screen of journey.path || []) {
                if (!mapping.has(screen)) {
                    mapping.set(screen, sessionId);
                }
            }
        }

        return mapping;
    }, [data]);

    const hasData = Boolean(data && totalSessions > 0);

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <div className="sticky top-0 z-30 bg-white">
                <DashboardPageHeader
                    title="User Journeys"
                    subtitle="Conversion leakage, failure impact, and where to intervene first"
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
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                            <Activity className="h-4 w-4 animate-pulse text-blue-600" />
                            Building journey intelligence from session and failure signals...
                        </div>
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                        No journey activity matched this filter yet.
                    </div>
                )}

                {!isLoading && hasData && data && (
                    <>
                        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Success Path Completion
                                    <HeartPulse className="h-4 w-4 text-emerald-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{pathCoverageRate.toFixed(1)}%</div>
                                <p className="mt-1 text-sm text-slate-600">
                                    {data.happyPathJourney?.sessionCount?.toLocaleString() || 0} sessions currently complete the dominant journey.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Happy-Path Entrants
                                    <Compass className="h-4 w-4 text-rose-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{formatCompact(startPopulation)}</div>
                                <p className="mt-1 text-sm text-slate-600">
                                    {formatCompact(completionPopulation)} completions from entrants ({completionRateFromEntrants.toFixed(1)}% completion from start).
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Largest Leakage Step
                                    <Route className="h-4 w-4 text-amber-600" />
                                </div>
                                <div className="mt-2 text-2xl font-semibold text-slate-900">
                                    {largestLeakStage ? `${largestLeakStage.from} -> ${largestLeakStage.to}` : 'N/A'}
                                </div>
                                <p className="mt-1 text-sm text-slate-600">
                                    {largestLeakStage
                                        ? `${formatCompact(largestLeakStage.dropoff)} sessions drop on this handoff.`
                                        : 'No dominant leak stage identified yet.'}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Avg Time to First Failure
                                    <Timer className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{formatMs(data.timeToFailure.avgTimeBeforeFirstErrorMs)}</div>
                                <p className="mt-1 text-sm text-slate-600">
                                    Crash after ~{data.timeToFailure.avgScreensBeforeCrash?.toFixed(1) || 'N/A'} screens | Rage after ~{data.timeToFailure.avgInteractionsBeforeRageTap?.toFixed(1) || 'N/A'} interactions.
                                </p>
                            </div>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div>
                                <div className="border-b border-slate-200 px-5 py-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h2 className="text-lg font-semibold text-slate-900">Journey Flow Map</h2>
                                            <p className="mt-1 text-sm text-slate-600">Green links show the schema-backed happy path when available.</p>
                                        </div>
                                        <Compass className="h-5 w-5 text-blue-600" />
                                    </div>
                                </div>
                                <div className="p-4">
                                    <SankeyJourney flows={data.flows} width={1450} height={520} happyPath={canonicalHappyPath} />
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Happy Path Leakage Pipeline</h2>
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                <p className="mt-1 text-sm text-slate-600">
                                    Step-by-step leakage on the core journey. Use this to prioritize the single stage that unlocks the largest completion gain.
                                </p>
                                <div className="mt-4 overflow-x-auto">
                                    <table className="w-full min-w-[900px] text-left text-sm">
                                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="pb-2 pr-4">Stage</th>
                                                <th className="pb-2 pr-4 text-right">Entrants</th>
                                                <th className="pb-2 pr-4 text-right">Progressed</th>
                                                <th className="pb-2 pr-4 text-right">Drop-off</th>
                                                <th className="pb-2 pr-4 text-right">Conversion</th>
                                                <th className="pb-2 pr-4 text-right">Issue Rate /100</th>
                                                <th className="pb-2 pr-4 text-right">Evidence</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {happyPathStages.map((stage) => (
                                                <tr key={`${stage.from}-${stage.to}`}>
                                                    <td className="py-3 pr-4">
                                                        <div className="font-medium text-slate-900">{stage.from}{' -> '}{stage.to}</div>
                                                        <div className="mt-1 text-xs text-slate-500">{stage.recommendation}</div>
                                                    </td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(stage.entrants)}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(stage.progressed)}</td>
                                                    <td className="py-3 pr-4 text-right font-semibold text-rose-700">{formatCompact(stage.dropoff)}</td>
                                                    <td className={`py-3 pr-4 text-right font-semibold ${stage.conversionRate < 45 ? 'text-rose-700' : stage.conversionRate < 70 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                        {stage.conversionRate.toFixed(1)}%
                                                    </td>
                                                    <td className={`py-3 pr-4 text-right font-semibold ${stage.issueRatePer100 > 18 ? 'text-rose-700' : stage.issueRatePer100 > 8 ? 'text-amber-700' : 'text-slate-700'}`}>
                                                        {stage.issueRatePer100.toFixed(1)}
                                                    </td>
                                                    <td className="py-3 pr-4 text-right">
                                                        {stage.evidenceSessionId ? (
                                                            <Link
                                                                to={`${pathPrefix}/sessions/${stage.evidenceSessionId}`}
                                                                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                                                            >
                                                                Replay <ArrowRight className="h-3.5 w-3.5" />
                                                            </Link>
                                                        ) : (
                                                            <span className="text-xs text-slate-400">-</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Intervention Playbook</h2>
                                    <Flag className="h-5 w-5 text-rose-600" />
                                </div>

                                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                                    <div className="text-xs uppercase tracking-wide text-blue-700">Path baseline</div>
                                    <p className="mt-1 text-sm text-blue-900">
                                        {startPopulation.toLocaleString()} entrants{' -> '}{completionPopulation.toLocaleString()} completions.
                                    </p>
                                    <p className="mt-1 text-xs text-blue-800">
                                        {data.configuredHappyPath
                                            ? `Schema-backed path confidence ${(data.configuredHappyPath.confidence * 100).toFixed(0)}%.`
                                            : 'Observed best path (no schema funnel configured).'}
                                    </p>
                                </div>

                                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                                    <div className="text-xs uppercase tracking-wide text-rose-700">Leak to fix first</div>
                                    <p className="mt-1 text-sm text-rose-900">
                                        {largestLeakStage
                                            ? `${largestLeakStage.from} -> ${largestLeakStage.to}`
                                            : 'No dominant leak detected'}
                                    </p>
                                    <p className="mt-1 text-xs text-rose-800">
                                        {largestLeakStage
                                            ? `${largestLeakStage.dropoff.toLocaleString()} lost sessions in this step.`
                                            : 'Collect more journey volume to isolate leakage.'}
                                    </p>
                                </div>

                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                    <div className="text-xs uppercase tracking-wide text-amber-700">Failure timing</div>
                                    <p className="mt-1 text-sm text-amber-900">First failure after {formatMs(data.timeToFailure.avgTimeBeforeFirstErrorMs)} on average.</p>
                                    <p className="mt-1 text-xs text-amber-800">
                                        Crash after ~{data.timeToFailure.avgScreensBeforeCrash?.toFixed(1) || 'N/A'} screens.
                                    </p>
                                </div>

                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">High-Impact Failing Journeys</h2>
                                    <PlayCircle className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="space-y-3">
                                    {failingJourneys.map((journey, idx) => (
                                        <div key={`${journey.path.join('-')}-${idx}`} className="rounded-xl border border-slate-200 p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-medium text-slate-900">{journey.path.join(' -> ')}</div>
                                                    <div className="mt-1 text-xs text-slate-500">
                                                        {formatCompact(journey.sessionCount)} sessions ({journey.sessionShare.toFixed(1)}% of total) - failure score {journey.failureScore.toFixed(0)}
                                                    </div>
                                                    <div className="mt-1 text-xs text-slate-600">
                                                        Crash {journey.crashes} | ANR {journey.anrs} | API {journey.apiErrors} | Rage {journey.rageTaps}
                                                    </div>
                                                </div>
                                                {journey.sampleSessionIds[0] && (
                                                    <Link
                                                        to={`${pathPrefix}/sessions/${journey.sampleSessionIds[0]}`}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                                                    >
                                                        Replay
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {failingJourneys.length === 0 && (
                                        <p className="text-sm text-slate-500">No failing journey clusters detected.</p>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Screen Impact Priorities</h2>
                                    <LayoutGrid className="h-5 w-5 text-rose-600" />
                                </div>
                                <div className="space-y-3">
                                    {screenPriorities.map((screen) => {
                                        const evidenceSessionId = screenEvidenceMap.get(screen.name);
                                        return (
                                            <div key={screen.name} className="rounded-xl border border-slate-200 p-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="text-sm font-medium text-slate-900">{screen.name}</div>
                                                        <div className="text-xs text-slate-500">{formatCompact(screen.visits)} visits</div>
                                                    </div>
                                                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${screen.health === 'problematic'
                                                        ? 'bg-rose-100 text-rose-700'
                                                        : screen.health === 'degraded'
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-emerald-100 text-emerald-700'
                                                        }`}>
                                                        {screen.health}
                                                    </span>
                                                </div>

                                                <div className="mt-2 flex items-center justify-between text-xs">
                                                    <span className="text-slate-600">Impact score</span>
                                                    <span className="font-semibold text-slate-900">{screen.impactScore.toFixed(1)}</span>
                                                </div>
                                                <div className="mt-1 flex items-center justify-between text-xs">
                                                    <span className="text-slate-600">Weighted incidents /100 visits</span>
                                                    <span className="font-semibold text-slate-900">{screen.incidentRatePer100.toFixed(1)}</span>
                                                </div>
                                                <p className="mt-2 text-xs text-slate-600">{screen.recommendation}</p>
                                                {evidenceSessionId && (
                                                    <Link
                                                        to={`${pathPrefix}/sessions/${evidenceSessionId}`}
                                                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                                                    >
                                                        Open replay evidence <ArrowRight className="h-3.5 w-3.5" />
                                                    </Link>
                                                )}
                                            </div>
                                        );
                                    })}
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
