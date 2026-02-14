import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Compass,
    Flag,
    GitBranch,
    HeartPulse,
    LayoutGrid,
    PlayCircle,
    Route,
    Timer,
    TrendingDown,
} from 'lucide-react';
import { useSessionData } from '../../context/SessionContext';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { SankeyJourney } from '../../components/analytics/SankeyJourney';
import { getJourneyObservability, ObservabilityJourneySummary } from '../../services/api';
import { usePathPrefix } from '../../hooks/usePathPrefix';

type TransitionInsight = ObservabilityJourneySummary['flows'][number] & {
    riskScore: number;
    recommendedAction: string;
};

type ActionItem = {
    title: string;
    impact: string;
    evidence: string;
    sessionId?: string;
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

const buildActionQueue = (
    data: ObservabilityJourneySummary | null,
    riskyTransitions: TransitionInsight[],
    pathCoverageRate: number,
): ActionItem[] => {
    if (!data) return [];

    const actions: ActionItem[] = [];

    if (pathCoverageRate > 0 && pathCoverageRate < 35) {
        actions.push({
            title: 'Happy-path completion is low',
            impact: `${pathCoverageRate.toFixed(1)}% of sessions currently follow the observed happy path.`,
            evidence: 'Focus onboarding and checkout path friction first.',
            sessionId: data.happyPathJourney?.sampleSessionIds?.[0],
        });
    }

    const topProblemJourney = data.problematicJourneys?.[0];
    if (topProblemJourney) {
        actions.push({
            title: 'Highest-failure journey should be debugged first',
            impact: `${topProblemJourney.failureScore.toFixed(0)} failure score across ${topProblemJourney.sessionCount.toLocaleString()} sessions.`,
            evidence: topProblemJourney.path.join(' -> '),
            sessionId: topProblemJourney.sampleSessionIds?.[0],
        });
    }

    const topTransition = riskyTransitions[0];
    if (topTransition) {
        actions.push({
            title: 'Highest-risk transition is causing avoidable drop-offs',
            impact: `${topTransition.from} -> ${topTransition.to} has ${topTransition.apiErrorRate.toFixed(1)}% API failures and ${topTransition.avgApiLatencyMs}ms latency.`,
            evidence: topTransition.recommendedAction,
        });
    }

    const topExit = data.exitAfterError?.[0];
    if (topExit) {
        actions.push({
            title: 'Error exits cluster on one terminal screen',
            impact: `${topExit.exitCount.toLocaleString()} sessions exit from ${topExit.screen} after failures.`,
            evidence: `Crash:${topExit.errorTypes.crash} API:${topExit.errorTypes.api} Rage:${topExit.errorTypes.rage}`,
            sessionId: topExit.sampleSessionIds?.[0],
        });
    }

    return actions.slice(0, 4);
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

    const healthRate = useMemo(() => {
        if (!data || totalSessions === 0) return 0;
        return (data.healthSummary.healthy / totalSessions) * 100;
    }, [data, totalSessions]);

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

    const actionQueue = useMemo(
        () => buildActionQueue(data, riskyTransitions, pathCoverageRate),
        [data, riskyTransitions, pathCoverageRate],
    );

    const topScreens = useMemo(() => {
        if (!data?.topScreens) return [];
        const maxVisits = Math.max(...data.topScreens.map((item) => item.visits), 1);
        return data.topScreens.slice(0, 8).map((item) => ({
            ...item,
            share: (item.visits / maxVisits) * 100,
        }));
    }, [data]);

    const hasData = Boolean(data && totalSessions > 0);

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100/70">
            <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">User Journeys</div>
                        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Actionable Journey Diagnostics</h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Understand where users diverge, fail, and exit so product and engineering can fix the highest-impact path first.
                        </p>
                    </div>
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </div>
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
                                    Session Health
                                    <HeartPulse className="h-4 w-4 text-emerald-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{healthRate.toFixed(1)}%</div>
                                <p className="mt-1 text-sm text-slate-600">{data.healthSummary.healthy.toLocaleString()} of {totalSessions.toLocaleString()} sessions are healthy.</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Happy Path Coverage
                                    <Route className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{pathCoverageRate.toFixed(1)}%</div>
                                <p className="mt-1 text-sm text-slate-600">
                                    {data.happyPathJourney?.sessionCount?.toLocaleString() || 0} sessions follow the dominant success path.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Time To First Failure
                                    <Timer className="h-4 w-4 text-amber-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{formatMs(data.timeToFailure.avgTimeBeforeFirstErrorMs)}</div>
                                <p className="mt-1 text-sm text-slate-600">Average time before first crash, API failure, or ANR signal.</p>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Error Exit Concentration
                                    <TrendingDown className="h-4 w-4 text-rose-600" />
                                </div>
                                <div className="mt-2 text-3xl font-semibold text-slate-900">{data.exitAfterError[0]?.exitCount?.toLocaleString() || 0}</div>
                                <p className="mt-1 text-sm text-slate-600">Top post-failure exit screen: {data.exitAfterError[0]?.screen || 'N/A'}.</p>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm">
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

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Priority Action Queue</h2>
                                    <Flag className="h-5 w-5 text-rose-600" />
                                </div>
                                {actionQueue.length === 0 && (
                                    <p className="text-sm text-slate-500">No high-priority actions identified for this window.</p>
                                )}
                                {actionQueue.map((item, index) => (
                                    <div key={`${item.title}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                                        <p className="mt-1 text-sm text-slate-600">{item.impact}</p>
                                        <p className="mt-2 text-xs text-slate-500">{item.evidence}</p>
                                        {item.sessionId && (
                                            <Link
                                                to={`${pathPrefix}/sessions/${item.sessionId}`}
                                                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                                            >
                                                Open evidence replay <ArrowRight className="h-3.5 w-3.5" />
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Transition Risk Ranking</h2>
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                </div>
                                <div className="mt-4 overflow-x-auto">
                                    <table className="w-full min-w-[760px] text-left text-sm">
                                        <thead className="text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="pb-2 pr-4">Transition</th>
                                                <th className="pb-2 pr-4 text-right">Volume</th>
                                                <th className="pb-2 pr-4 text-right">API Fail</th>
                                                <th className="pb-2 pr-4 text-right">Latency</th>
                                                <th className="pb-2 pr-4 text-right">Crash/ANR</th>
                                                <th className="pb-2 pr-4 text-right">Rage</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {riskyTransitions.map((flow) => (
                                                <tr key={`${flow.from}-${flow.to}`}>
                                                    <td className="py-3 pr-4">
                                                        <div className="font-medium text-slate-900">{flow.from}</div>
                                                        <div className="text-xs text-slate-500">to {flow.to}</div>
                                                        <div className="mt-1 text-xs text-slate-500">{flow.recommendedAction}</div>
                                                    </td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{formatCompact(flow.count)}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{flow.apiErrorRate.toFixed(1)}%</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{flow.avgApiLatencyMs} ms</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{flow.crashCount + flow.anrCount}</td>
                                                    <td className="py-3 pr-4 text-right text-slate-700">{flow.rageTapCount}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Happy Path Source</h2>
                                    <GitBranch className="h-5 w-5 text-emerald-600" />
                                </div>

                                {canonicalHappyPath && canonicalHappyPath.length > 0 ? (
                                    <>
                                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                                            {data.configuredHappyPath
                                                ? `Using schema funnel path (confidence ${(data.configuredHappyPath.confidence * 100).toFixed(0)}%, sample ${data.configuredHappyPath.sampleSize.toLocaleString()}).`
                                                : 'No schema funnel was available. Highlighting best observed clean path.'}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {canonicalHappyPath.map((screen, index) => (
                                                <span
                                                    key={`${screen}-${index}`}
                                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                                                >
                                                    {screen}
                                                    {index < canonicalHappyPath.length - 1 && <ArrowRight className="h-3 w-3 text-slate-400" />}
                                                </span>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm text-slate-500">No happy-path signal is available yet.</p>
                                )}

                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <div className="text-xs uppercase tracking-wide text-slate-500">Screen Reach</div>
                                    <div className="mt-3 space-y-2">
                                        {topScreens.map((screen) => (
                                            <div key={screen.screen}>
                                                <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                                                    <span>{screen.screen}</span>
                                                    <span>{screen.visits.toLocaleString()}</span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-slate-200">
                                                    <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${screen.share}%` }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Most Fragile Screens</h2>
                                    <LayoutGrid className="h-5 w-5 text-rose-600" />
                                </div>
                                <div className="space-y-3">
                                    {data.screenHealth.slice(0, 8).map((screen) => {
                                        const isProblem = screen.health === 'problematic';
                                        const isDegraded = screen.health === 'degraded';
                                        return (
                                            <div key={screen.name} className="rounded-xl border border-slate-200 p-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="text-sm font-medium text-slate-900">{screen.name}</div>
                                                        <div className="text-xs text-slate-500">{screen.visits.toLocaleString()} visits</div>
                                                    </div>
                                                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isProblem
                                                        ? 'bg-rose-100 text-rose-700'
                                                        : isDegraded
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-emerald-100 text-emerald-700'
                                                        }`}>
                                                        {screen.health}
                                                    </span>
                                                </div>
                                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                                                    <span>Crash {screen.crashes}</span>
                                                    <span>ANR {screen.anrs}</span>
                                                    <span>API {screen.apiErrors}</span>
                                                    <span>Rage {screen.rageTaps}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-slate-900">Failure Evidence Replays</h2>
                                    <PlayCircle className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="space-y-3">
                                    {data.problematicJourneys.slice(0, 6).map((journey, idx) => (
                                        <div key={`${journey.path.join('-')}-${idx}`} className="rounded-xl border border-slate-200 p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-medium text-slate-900">{journey.path.join(' -> ')}</div>
                                                    <div className="mt-1 text-xs text-slate-500">
                                                        {journey.sessionCount.toLocaleString()} sessions, failure score {journey.failureScore.toFixed(0)}
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
