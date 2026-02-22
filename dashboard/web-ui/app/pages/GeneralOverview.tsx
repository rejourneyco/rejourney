import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    MessageSquareWarning,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { Link, useNavigate } from 'react-router';
import { useSessionData } from '../context/SessionContext';
import {
    api,
    getGeoSummary,
    getGrowthObservability,
    getObservabilityDeepMetrics,
    getUserEngagementTrends,
    GeoSummary,
    GrowthObservability,
    InsightsTrends,
    ObservabilityDeepMetrics,
    UserEngagementTrends,
} from '../services/api';
import { DashboardPageHeader } from '../components/ui/DashboardPageHeader';
import { TimeFilter, TimeRange } from '../components/ui/TimeFilter';
import { usePathPrefix } from '../hooks/usePathPrefix';
import { useSharedAnalyticsTimeRange } from '../hooks/useSharedAnalyticsTimeRange';
import { NeoBadge } from '../components/ui/neo/NeoBadge';
import { MiniSessionCard } from '../components/ui/MiniSessionCard';
import { Issue, RecordingSession } from '../types';

const toObservabilityRange = (value: TimeRange): string | undefined => {
    if (value === 'all') return undefined;
    return value;
};

const toUtcDateKey = (value: string): string | null => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
};

const formatDateLabel = (dateKey: string): string => {
    const date = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString();
};

const isKnownVersion = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return Boolean(normalized) && normalized !== 'unknown' && normalized !== 'n/a' && normalized !== 'na';
};

const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m === 0) return `${s}s`;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
};

const percentChange = (current: number, previous: number): number | null => {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
    return ((current - previous) / previous) * 100;
};

const pointChange = (current: number, previous: number): number | null => {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    return current - previous;
};

const formatSigned = (value: number, digits: number = 1): string => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const RETENTION_COHORT_WEEKS = 6;
const RETENTION_COHORT_ROWS = 6;

function getCohortUserKey(session: RecordingSession): string | null {
    return session.userId || session.anonymousId || session.anonymousDisplayName || session.deviceId || null;
}

function getUtcWeekStartKey(isoDate: string): string | null {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return null;

    const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = utcDate.getUTCDay();
    utcDate.setUTCDate(utcDate.getUTCDate() - day); // Sunday week start
    return utcDate.toISOString().slice(0, 10);
}

function formatWeekRange(weekStartKey: string): string {
    const start = new Date(`${weekStartKey}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);

    const format = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${format(start)} - ${format(end)}`;
}

function getCohortCellStyle(value: number | null, weekIndex: number): React.CSSProperties {
    if (value === null) {
        return { backgroundColor: '#f1f5f9', color: '#94a3b8' };
    }

    if (weekIndex === 0) {
        return { backgroundColor: '#1d4ed8', color: '#ffffff' };
    }

    const clamped = Math.max(0, Math.min(100, value));
    const lightness = Math.max(42, 95 - (clamped * 0.48));
    return {
        backgroundColor: `hsl(214 76% ${lightness}%)`,
        color: clamped >= 52 ? '#ffffff' : '#0f172a',
    };
}

function formatLastSeen(dateIso: string): string {
    const ts = new Date(dateIso).getTime();
    if (Number.isNaN(ts)) return 'unknown';
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
}

function issueSignalsForSession(session: RecordingSession): number {
    return (
        (session.errorCount || 0)
        + (session.crashCount || 0)
        + (session.anrCount || 0)
        + (session.rageTapCount || 0)
    );
}

function sessionUserKey(session: RecordingSession): string {
    if (session.userId) return session.userId;
    if (session.anonymousId) return session.anonymousId;
    if (session.anonymousDisplayName) return session.anonymousDisplayName;
    if (session.deviceId) return session.deviceId;
    return session.id;
}

function buildIssueSparkline(dailyEvents?: Record<string, number>): number[] {
    const defaultSparkline = Array(14).fill(0);
    if (!dailyEvents) return defaultSparkline;

    const sparkline = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        const raw = dailyEvents[dateKey];
        const value = typeof raw === 'number' ? raw : Number(raw);
        sparkline.push(Number.isFinite(value) && value > 0 ? value : 0);
    }

    if (sparkline.every((v) => v === 0) && Object.keys(dailyEvents).length > 0) {
        return Object.entries(dailyEvents)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-14)
            .map(([, raw]) => {
                const value = typeof raw === 'number' ? raw : Number(raw);
                return Number.isFinite(value) ? Math.max(0, value) : 0;
            });
    }

    return sparkline;
}

const ISSUE_TYPE_COLOR: Record<Issue['issueType'], string> = {
    error: '#f59e0b',
    crash: '#ef4444',
    anr: '#8b5cf6',
    rage_tap: '#ec4899',
    api_latency: '#6366f1',
    ux_friction: '#f97316',
    performance: '#06b6d4',
};

const ISSUE_TYPE_BADGE_VARIANT: Record<Issue['issueType'], 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'anr' | 'rage' | 'dead_tap' | 'slow_start' | 'slow_api' | 'low_exp'> = {
    error: 'warning',
    crash: 'danger',
    anr: 'anr',
    rage_tap: 'rage',
    api_latency: 'slow_api',
    ux_friction: 'low_exp',
    performance: 'info',
};

interface RecommendedSession {
    session: RecordingSession;
    category: string;
    priority: 'critical' | 'high' | 'watch' | 'baseline';
    reason: string;
}

const RECOMMENDED_SESSION_PRIORITY_STYLES: Record<RecommendedSession['priority'], string> = {
    critical: 'border-rose-200 bg-rose-50 text-rose-700',
    high: 'border-amber-200 bg-amber-50 text-amber-700',
    watch: 'border-sky-200 bg-sky-50 text-sky-700',
    baseline: 'border-slate-200 bg-slate-50 text-slate-700',
};

function buildRecommendedSessions(sessions: RecordingSession[]): RecommendedSession[] {
    if (sessions.length === 0) return [];

    const replayReady = sessions.filter((s) => s.replayPromoted !== false && !s.isReplayExpired);
    const pool = replayReady.length > 0 ? replayReady : sessions;

    const picks: RecommendedSession[] = [];
    const usedIds = new Set<string>();
    const byMostRecent = (a: RecordingSession, b: RecordingSession) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();

    const userSessionCounts = new Map<string, { count: number; bestSignalSession: RecordingSession; latestSession: RecordingSession }>();
    for (const s of pool) {
        const key = sessionUserKey(s);
        const existing = userSessionCounts.get(key);
        if (!existing) {
            userSessionCounts.set(key, { count: 1, bestSignalSession: s, latestSession: s });
        } else {
            existing.count += 1;
            if (issueSignalsForSession(s) > issueSignalsForSession(existing.bestSignalSession)) {
                existing.bestSignalSession = s;
            }
            if (new Date(s.startedAt).getTime() > new Date(existing.latestSession.startedAt).getTime()) {
                existing.latestSession = s;
            }
        }
    }

    const pick = (
        category: string,
        priority: RecommendedSession['priority'],
        reason: string,
        finder: (pool: RecordingSession[]) => RecordingSession | undefined,
    ) => {
        const available = pool.filter((s) => !usedIds.has(s.id));
        const session = finder(available);
        if (session) {
            usedIds.add(session.id);
            picks.push({ session, category, priority, reason });
        }
    };

    pick('High Friction Journey', 'critical', 'Highest issue signal count', (p) =>
        [...p].sort((a, b) => issueSignalsForSession(b) - issueSignalsForSession(a)).find((s) => issueSignalsForSession(s) > 0),
    );

    pick('Crash Impact', 'critical', 'Most recent session with a crash signal', (p) =>
        [...p]
            .filter((s) => (s.crashCount || 0) > 0)
            .sort(byMostRecent)[0],
    );

    pick('ANR Freeze Session', 'critical', 'Session with an ANR freeze signature', (p) =>
        [...p]
            .filter((s) => (s.anrCount || 0) > 0)
            .sort(byMostRecent)[0],
    );

    pick('API Failure Spike', 'critical', 'Highest number of failing API calls', (p) =>
        [...p].sort((a, b) => (b.apiErrorCount || 0) - (a.apiErrorCount || 0)).find((s) => (s.apiErrorCount || 0) > 0),
    );

    pick('Stable Journey', 'baseline', 'No issue signals with high engagement', (p) =>
        [...p]
            .filter((s) => (s.errorCount || 0) === 0 && (s.crashCount || 0) === 0 && (s.anrCount || 0) === 0 && (s.rageTapCount || 0) === 0)
            .sort((a, b) => (b.interactionScore + b.explorationScore) - (a.interactionScore + a.explorationScore))[0],
    );

    pick('Rage Input Pattern', 'high', 'Highest rage tap count', (p) =>
        [...p].sort((a, b) => (b.rageTapCount || 0) - (a.rageTapCount || 0)).find((s) => (s.rageTapCount || 0) > 0),
    );

    pick('API Latency Outlier', 'high', 'Slowest average API response time', (p) =>
        [...p]
            .filter((s) => (s.apiTotalCount || 0) > 0)
            .sort((a, b) => (b.apiAvgResponseMs || 0) - (a.apiAvgResponseMs || 0))[0],
    );

    pick('Deep Engagement', 'watch', 'Longest session with meaningful interaction', (p) =>
        [...p]
            .filter((s) => (s.touchCount || 0) > 10)
            .sort((a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0))[0],
    );

    const topUserEntry = [...userSessionCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .find(([, v]) => v.count > 1);

    if (topUserEntry && !usedIds.has(topUserEntry[1].bestSignalSession.id)) {
        usedIds.add(topUserEntry[1].bestSignalSession.id);
        picks.push({
            session: topUserEntry[1].bestSignalSession,
            category: 'Frequent Returning User',
            priority: 'watch',
            reason: `${topUserEntry[1].count} sessions from this user`,
        });
    }

    pick('New User Journey', 'high', 'First-time user path to validate onboarding health', (p) =>
        [...p]
            .filter((s) => (userSessionCounts.get(sessionUserKey(s))?.count || 0) <= 1)
            .sort((a, b) => {
                const signalDelta = issueSignalsForSession(b) - issueSignalsForSession(a);
                if (signalDelta !== 0) return signalDelta;
                return byMostRecent(a, b);
            })[0],
    );

    pick('Returning User Pattern', 'watch', 'Representative repeat-user behavior sample', (p) =>
        [...p]
            .filter((s) => (userSessionCounts.get(sessionUserKey(s))?.count || 0) >= 2)
            .sort((a, b) => {
                const signalDelta = issueSignalsForSession(b) - issueSignalsForSession(a);
                if (signalDelta !== 0) return signalDelta;
                return (b.interactionScore || 0) - (a.interactionScore || 0);
            })[0],
    );

    pick('Anonymous User Flow', 'watch', 'Anonymous visitor flow for pre-login experience', (p) =>
        [...p]
            .filter((s) => !s.userId && Boolean(s.anonymousId || s.anonymousDisplayName))
            .sort((a, b) => (b.interactionScore || 0) - (a.interactionScore || 0))[0],
    );

    pick('Power User Flow', 'watch', 'High-intent user session with deep interaction', (p) =>
        [...p]
            .filter((s) => (s.interactionScore || 0) > 90 || ((s.durationSeconds || 0) > 240 && (s.touchCount || 0) > 30))
            .sort((a, b) => (b.interactionScore || 0) - (a.interactionScore || 0))[0],
    );

    pick('Passive User Exit', 'high', 'Low-interaction user likely to bounce quickly', (p) =>
        [...p]
            .filter((s) => (s.touchCount || 0) < 5 && (s.durationSeconds || 0) < 45)
            .sort((a, b) => (a.durationSeconds || 0) - (b.durationSeconds || 0))[0],
    );

    pick('iOS User Sample', 'baseline', 'Representative iOS user session', (p) =>
        [...p]
            .filter((s) => s.platform === 'ios')
            .sort((a, b) => {
                const signalDelta = issueSignalsForSession(b) - issueSignalsForSession(a);
                if (signalDelta !== 0) return signalDelta;
                return byMostRecent(a, b);
            })[0],
    );

    pick('Android User Sample', 'baseline', 'Representative Android user session', (p) =>
        [...p]
            .filter((s) => s.platform === 'android')
            .sort((a, b) => {
                const signalDelta = issueSignalsForSession(b) - issueSignalsForSession(a);
                if (signalDelta !== 0) return signalDelta;
                return byMostRecent(a, b);
            })[0],
    );

    pick('Constrained Network User', 'high', 'User session on constrained or expensive network', (p) =>
        [...p]
            .filter((s) => s.isConstrained || s.isExpensive || s.cellularGeneration === '2G' || s.cellularGeneration === '3G')
            .sort((a, b) => (b.apiAvgResponseMs || 0) - (a.apiAvgResponseMs || 0))[0],
    );

    pick('Exploration Heavy', 'watch', 'Visited the most distinct screens', (p) =>
        [...p].sort((a, b) => (b.explorationScore || 0) - (a.explorationScore || 0)).find((s) => (s.explorationScore || 0) > 0),
    );

    pick('Early Exit', 'high', 'Short session with no interaction', (p) =>
        [...p]
            .filter((s) => (s.durationSeconds || 0) < 10 && (s.interactionScore || 0) === 0)
            .sort((a, b) => (a.durationSeconds || 0) - (b.durationSeconds || 0))[0],
    );

    pick('Funnel Drop-off', 'critical', 'High interaction session ending in an error or crash', (p) =>
        [...p]
            .filter((s) => (s.interactionScore || 0) > 50 && ((s.errorCount || 0) > 0 || (s.crashCount || 0) > 0))
            .sort((a, b) => (b.interactionScore || 0) - (a.interactionScore || 0))[0],
    );

    pick('Slow Startup', 'high', 'Longest app startup time', (p) =>
        [...p].sort((a, b) => (b.appStartupTimeMs || 0) - (a.appStartupTimeMs || 0)).find((s) => (s.appStartupTimeMs || 0) > 2000),
    );

    pick('Dead Tap Pattern', 'high', 'Highest dead tap count', (p) =>
        [...p].sort((a, b) => (b.deadTapCount || 0) - (a.deadTapCount || 0)).find((s) => (s.deadTapCount || 0) > 0),
    );

    pick('First Session Crash', 'critical', 'Crash detected on a first-time user session', (p) => {
        const singleUserSessions = p.filter((s) => {
            const key = sessionUserKey(s);
            return (userSessionCounts.get(key)?.count || 0) <= 1;
        });
        return singleUserSessions
            .filter((s) => (s.crashCount || 0) > 0)
            .sort(byMostRecent)[0];
    });

    pick('App Freeze', 'critical', 'Session experienced an ANR signal', (p) =>
        [...p].sort((a, b) => (b.anrCount || 0) - (a.anrCount || 0)).find((s) => (s.anrCount || 0) > 0),
    );

    pick('Navigation Confusion', 'high', 'High screen count with little interaction', (p) =>
        [...p]
            .filter((s) => (s.explorationScore || 0) > 5 && (s.interactionScore || 0) < 5)
            .sort((a, b) => (b.explorationScore || 0) - (a.explorationScore || 0))[0],
    );

    pick('UI Friction Cluster', 'high', 'Intense interaction concentrated on few screens with failed taps', (p) =>
        [...p]
            .filter((s) => (s.interactionScore || 0) > 20 && (s.explorationScore || 0) < 3 && ((s.deadTapCount || 0) > 0 || (s.rageTapCount || 0) > 0))
            .sort((a, b) => (b.interactionScore || 0) - (a.interactionScore || 0))[0],
    );

    pick('High API Volume', 'watch', 'Highest volume of API requests', (p) =>
        [...p].sort((a, b) => (b.apiTotalCount || 0) - (a.apiTotalCount || 0)).find((s) => (s.apiTotalCount || 0) > 50),
    );

    pick('Frustrated Exit', 'high', 'Rage taps followed by a short session', (p) =>
        [...p]
            .filter((s) => (s.rageTapCount || 0) > 0 && (s.durationSeconds || 0) < 30)
            .sort((a, b) => (a.durationSeconds || 0) - (b.durationSeconds || 0))[0],
    );

    const remaining = pool
        .filter((s) => !usedIds.has(s.id))
        .sort((a, b) => {
            const signalDelta = issueSignalsForSession(b) - issueSignalsForSession(a);
            if (signalDelta !== 0) return signalDelta;
            const interactionDelta = (b.interactionScore || 0) - (a.interactionScore || 0);
            if (interactionDelta !== 0) return interactionDelta;
            return byMostRecent(a, b);
        });

    for (const session of remaining.slice(0, 8)) {
        const issueCount = issueSignalsForSession(session);
        picks.push({
            session,
            category: issueCount > 0 ? 'Additional Risk Session' : 'Additional User Sample',
            priority: issueCount > 0 ? 'high' : 'watch',
            reason: issueCount > 0
                ? `${issueCount} issue signals detected in this session`
                : 'Additional user behavior sample in this time window',
        });
    }

    return picks.slice(0, 24);
}

const IssueSparkline: React.FC<{ dailyEvents?: Record<string, number>; color: string }> = ({ dailyEvents, color }) => {
    const values = buildIssueSparkline(dailyEvents);
    if (values.length === 0 || values.every((v) => v === 0)) {
        return (
            <div className="h-6 w-20 flex items-end gap-px">
                {Array(14).fill(0).map((_, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-slate-100" style={{ height: '2px' }} />
                ))}
            </div>
        );
    }
    const max = Math.max(...values, 1);
    return (
        <div className="h-6 w-20 flex items-end gap-px">
            {values.map((value, index) => (
                <div
                    key={index}
                    title={`${value}`}
                    className="flex-1 rounded-sm"
                    style={{
                        height: `${Math.max(12, (value / max) * 100)}%`,
                        backgroundColor: color,
                        opacity: 0.85,
                    }}
                />
            ))}
        </div>
    );
};

const EmptyStateCard: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-6 py-10 text-center">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <p className="mt-2 text-xs text-slate-500 max-w-sm mx-auto">{subtitle}</p>
    </div>
);

const GA4Card: React.FC<{
    title: string;
    action?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}> = ({ title, action, children, className = '' }) => (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col ${className}`}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h3 className="text-sm font-medium text-slate-700">{title}</h3>
            {action ? <div className="flex items-center gap-1.5">{action}</div> : null}
        </div>
        <div className="flex-1 px-5 pb-4">{children}</div>
    </div>
);

type TrendChartRow = {
    dateKey: string;
    sessions: number;
    crashes: number;
    errorCount: number;
    apiErrorRate: number;
    totalApiCalls: number;
    dau: number;
    mau: number;
    avgDurationSeconds: number;
};

type MomentumCard = {
    label: string;
    value: string;
    delta: string;
    positiveIsGood: boolean;
    deltaValue: number | null;
};

export const GeneralOverview: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
    const navigate = useNavigate();
    const { timeRange, setTimeRange } = useSharedAnalyticsTimeRange(selectedProject?.id);

    const [isLoading, setIsLoading] = useState(true);
    const [partialError, setPartialError] = useState<string | null>(null);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    const [overviewObs, setOverviewObs] = useState<GrowthObservability | null>(null);
    const [deepMetrics, setDeepMetrics] = useState<ObservabilityDeepMetrics | null>(null);
    const [engagementTrends, setEngagementTrends] = useState<UserEngagementTrends | null>(null);
    const [geoSummary, setGeoSummary] = useState<GeoSummary | null>(null);
    const [issues, setIssues] = useState<Issue[]>([]);
    const [sessions, setSessions] = useState<RecordingSession[]>([]);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIsLoading(false);
            setPartialError(null);
            setTrends(null);
            setOverviewObs(null);
            setDeepMetrics(null);
            setEngagementTrends(null);
            setGeoSummary(null);
            setIssues([]);
            setSessions([]);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);
        setPartialError(null);

        const obsRange = toObservabilityRange(timeRange);

        Promise.allSettled([
            api.getInsightsTrends(selectedProject.id, timeRange),
            getGrowthObservability(selectedProject.id, obsRange),
            getObservabilityDeepMetrics(selectedProject.id, obsRange),
            getUserEngagementTrends(selectedProject.id, obsRange),
            getGeoSummary(selectedProject.id, obsRange),
            api.getIssues(selectedProject.id, timeRange),
            api.getSessionsPaginated({
                projectId: selectedProject.id,
                timeRange,
                limit: 120,
            }),
        ])
            .then(([trendData, obsData, deepData, engagementData, geoData, issueData, replayData]) => {
                if (isCancelled) return;

                const failedSections: string[] = [];

                if (trendData.status === 'fulfilled') {
                    setTrends(trendData.value);
                } else {
                    failedSections.push('activity trends');
                    setTrends(null);
                }

                if (obsData.status === 'fulfilled') {
                    setOverviewObs(obsData.value);
                } else {
                    failedSections.push('observability');
                    setOverviewObs(null);
                }

                if (deepData.status === 'fulfilled') {
                    setDeepMetrics(deepData.value);
                } else {
                    failedSections.push('deep metrics');
                    setDeepMetrics(null);
                }

                if (engagementData.status === 'fulfilled') {
                    setEngagementTrends(engagementData.value);
                } else {
                    failedSections.push('engagement segments');
                    setEngagementTrends(null);
                }

                if (geoData.status === 'fulfilled') {
                    setGeoSummary(geoData.value);
                } else {
                    failedSections.push('geographic activity');
                    setGeoSummary(null);
                }

                if (issueData.status === 'fulfilled') {
                    setIssues(issueData.value.issues || []);
                } else {
                    failedSections.push('top issues');
                    setIssues([]);
                }

                if (replayData.status === 'fulfilled') {
                    setSessions((replayData.value.sessions || []) as RecordingSession[]);
                } else {
                    failedSections.push('recommended sessions');
                    setSessions([]);
                }

                if (failedSections.length > 0) {
                    setPartialError(`Some general widgets are unavailable (${failedSections.join(', ')}).`);
                }
            })
            .finally(() => {
                if (!isCancelled) setIsLoading(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    const trendChartData = useMemo<TrendChartRow[]>(() => {
        if (!trends?.daily?.length) return [];

        return trends.daily
            .map((entry) => {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) return null;
                return {
                    dateKey,
                    sessions: Number(entry.sessions || 0),
                    crashes: Number(entry.crashes || 0),
                    errorCount: Number(entry.errorCount || 0),
                    apiErrorRate: Number(entry.apiErrorRate || 0),
                    totalApiCalls: Number(entry.totalApiCalls || 0),
                    dau: Number(entry.dau || 0),
                    mau: Number(entry.mau || 0),
                    avgDurationSeconds: Number(entry.avgDurationSeconds || 0),
                };
            })
            .filter((row): row is TrendChartRow => Boolean(row))
            .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }, [trends]);

    const activitySummary = useMemo(() => {
        if (!trendChartData.length) {
            return { latestDau: 0, avgDau: 0, peakMau: 0 };
        }

        const latest = trendChartData[trendChartData.length - 1];
        const totalDau = trendChartData.reduce((sum, row) => sum + row.dau, 0);
        const peakMau = trendChartData.reduce((max, row) => Math.max(max, row.mau), 0);

        return {
            latestDau: latest?.dau ?? 0,
            avgDau: Math.round(totalDau / trendChartData.length),
            peakMau,
        };
    }, [trendChartData]);

    const activeUsersPerMinute = useMemo(() => {
        const latestDau = activitySummary.latestDau;
        if (latestDau <= 0) return 0;
        return Math.max(1, Math.round(latestDau / 1440));
    }, [activitySummary.latestDau]);

    const realtimeActivitySeries = useMemo(() => {
        return trendChartData.slice(-14).map((row) => ({
            dateKey: row.dateKey,
            dau: row.dau,
        }));
    }, [trendChartData]);

    const versionChartData = useMemo(() => {
        if (!trends?.daily?.length) return [];

        const versionSet = new Set<string>();
        for (const day of trends.daily) {
            for (const version of Object.keys(day.appVersionBreakdown || {})) {
                if (isKnownVersion(version)) versionSet.add(version);
            }
        }

        const versions = Array.from(versionSet).sort();

        return trends.daily
            .map((entry) => {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) return null;

                const row: Record<string, string | number> = { dateKey };
                for (const version of versions) {
                    row[version] = Number(entry.appVersionBreakdown?.[version] || 0);
                }
                return row;
            })
            .filter((row): row is NonNullable<typeof row> => Boolean(row));
    }, [trends]);

    const versionKeys = useMemo(() => {
        if (!versionChartData.length) return [];
        return Object.keys(versionChartData[0]).filter((key) => key !== 'dateKey');
    }, [versionChartData]);

    const versionColors = ['#1a73e8', '#e8710a', '#d93025', '#1e8e3e', '#9334e6', '#0f766e'];

    const topCountries = useMemo(() => {
        if (!geoSummary?.countries?.length) return [];

        return [...geoSummary.countries]
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map((country) => ({
                country: country.country || 'Unknown',
                count: country.count,
            }));
    }, [geoSummary]);

    const latestReleases = useMemo(() => {
        if (!deepMetrics?.releaseRisk?.length) return [];

        return [...deepMetrics.releaseRisk]
            .sort((a, b) => new Date(b.latestSeen).getTime() - new Date(a.latestSeen).getTime())
            .slice(0, 4)
            .map((row) => ({
                version: row.version,
                sessions: row.sessions,
                status: row.failureRate < 5 ? 'Successful' : 'Degraded',
            }));
    }, [deepMetrics]);

    const crashFreeRate = deepMetrics?.reliability?.crashFreeSessionRate ?? null;
    const anrFreeRate = deepMetrics?.reliability?.anrFreeSessionRate ?? null;

    const avgEngagementTime = useMemo(() => {
        if (!trendChartData.length) return '0s';

        const values = trendChartData
            .map((row) => row.avgDurationSeconds)
            .filter((value) => Number.isFinite(value) && value > 0);

        if (!values.length) return '0s';

        const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
        return formatDuration(avg);
    }, [trendChartData]);

    const engagedUserShare = useMemo(() => {
        const totals = engagementTrends?.totals;
        if (!totals) return null;

        const engaged = Number(totals.explorers || 0) + Number(totals.loyalists || 0);
        const total = engaged + Number(totals.casuals || 0) + Number(totals.bouncers || 0);
        if (total <= 0) return null;

        return (engaged / total) * 100;
    }, [engagementTrends]);

    const engagementChartData = useMemo(() => {
        return trendChartData.map((row) => ({
            dateKey: row.dateKey,
            engagementTime: Math.round(row.avgDurationSeconds || 0),
        }));
    }, [trendChartData]);

    const retentionChartData = useMemo(() => {
        return trendChartData.map((row) => ({
            dateKey: row.dateKey,
            retention: row.mau > 0 ? Math.round((row.dau / row.mau) * 100) : 0,
        }));
    }, [trendChartData]);

    const retentionCohorts = useMemo(() => {
        const weeklyActiveUsers = new Map<string, Set<string>>();
        const userFirstWeek = new Map<string, string>();

        for (const session of sessions) {
            const userKey = getCohortUserKey(session);
            if (!userKey) continue;

            const weekKey = getUtcWeekStartKey(session.startedAt);
            if (!weekKey) continue;

            if (!weeklyActiveUsers.has(weekKey)) {
                weeklyActiveUsers.set(weekKey, new Set<string>());
            }
            weeklyActiveUsers.get(weekKey)!.add(userKey);

            const existingFirst = userFirstWeek.get(userKey);
            if (!existingFirst || weekKey < existingFirst) {
                userFirstWeek.set(userKey, weekKey);
            }
        }

        const weekKeys = Array.from(weeklyActiveUsers.keys()).sort((a, b) => a.localeCompare(b));
        if (weekKeys.length === 0) return [];

        const weekIndex = new Map<string, number>();
        weekKeys.forEach((key, idx) => weekIndex.set(key, idx));

        const cohortMembers = new Map<string, Set<string>>();
        for (const [userKey, firstWeek] of userFirstWeek.entries()) {
            if (!cohortMembers.has(firstWeek)) {
                cohortMembers.set(firstWeek, new Set<string>());
            }
            cohortMembers.get(firstWeek)!.add(userKey);
        }

        const rows = weekKeys
            .map((cohortWeek) => {
                const members = cohortMembers.get(cohortWeek);
                if (!members || members.size === 0) return null;

                const index = weekIndex.get(cohortWeek);
                if (index === undefined) return null;

                const retention = Array.from({ length: RETENTION_COHORT_WEEKS }, (_, offset) => {
                    const targetWeek = weekKeys[index + offset];
                    if (!targetWeek) return null;
                    if (offset === 0) return 100;

                    const activeUsers = weeklyActiveUsers.get(targetWeek);
                    if (!activeUsers) return 0;

                    let retained = 0;
                    for (const user of members) {
                        if (activeUsers.has(user)) retained += 1;
                    }
                    return (retained / members.size) * 100;
                });

                return {
                    weekStartKey: cohortWeek,
                    label: formatWeekRange(cohortWeek),
                    users: members.size,
                    retention,
                };
            })
            .filter((row): row is NonNullable<typeof row> => Boolean(row));

        return rows.slice(-RETENTION_COHORT_ROWS);
    }, [sessions]);

    const trendComparison = useMemo(() => {
        if (!trendChartData.length) return null;

        const windowSize = Math.max(1, Math.min(14, Math.floor(trendChartData.length / 2) || 1));
        const currentWindow = trendChartData.slice(-windowSize);
        const previousWindow = trendChartData.slice(-windowSize * 2, -windowSize);

        const sum = (rows: TrendChartRow[], selector: (row: TrendChartRow) => number) =>
            rows.reduce((total, row) => total + selector(row), 0);
        const average = (rows: TrendChartRow[], selector: (row: TrendChartRow) => number) =>
            rows.length > 0 ? sum(rows, selector) / rows.length : 0;
        const averageRetention = (rows: TrendChartRow[]) =>
            average(rows, (row) => (row.mau > 0 ? (row.dau / row.mau) * 100 : 0));
        const weightedApiErrorRate = (rows: TrendChartRow[]) => {
            const totalCalls = sum(rows, (row) => row.totalApiCalls);
            if (totalCalls > 0) {
                return rows.reduce((total, row) => total + (row.apiErrorRate * row.totalApiCalls), 0) / totalCalls;
            }
            return average(rows, (row) => row.apiErrorRate);
        };
        const crashRate = (rows: TrendChartRow[]) => {
            const totalSessions = sum(rows, (row) => row.sessions);
            return totalSessions > 0 ? (sum(rows, (row) => row.crashes) / totalSessions) * 100 : 0;
        };
        const averageDuration = (rows: TrendChartRow[]) => {
            const totalSessions = sum(rows, (row) => row.sessions);
            if (totalSessions <= 0) return 0;
            return rows.reduce((total, row) => total + (row.avgDurationSeconds * row.sessions), 0) / totalSessions;
        };

        const current = {
            sessions: sum(currentWindow, (row) => row.sessions),
            avgDau: average(currentWindow, (row) => row.dau),
            avgRetention: averageRetention(currentWindow),
            apiErrorRate: weightedApiErrorRate(currentWindow),
            crashRate: crashRate(currentWindow),
            avgDurationSeconds: averageDuration(currentWindow),
        };

        if (!previousWindow.length) {
            return {
                windowSize,
                current,
                sessionDeltaPct: null,
                dauDeltaPct: null,
                retentionDeltaPts: null,
                apiErrorDeltaPts: null,
                crashRateDeltaPts: null,
                durationDeltaPct: null,
            };
        }

        const previous = {
            sessions: sum(previousWindow, (row) => row.sessions),
            avgDau: average(previousWindow, (row) => row.dau),
            avgRetention: averageRetention(previousWindow),
            apiErrorRate: weightedApiErrorRate(previousWindow),
            crashRate: crashRate(previousWindow),
            avgDurationSeconds: averageDuration(previousWindow),
        };

        return {
            windowSize,
            current,
            sessionDeltaPct: percentChange(current.sessions, previous.sessions),
            dauDeltaPct: percentChange(current.avgDau, previous.avgDau),
            retentionDeltaPts: pointChange(current.avgRetention, previous.avgRetention),
            apiErrorDeltaPts: pointChange(current.apiErrorRate, previous.apiErrorRate),
            crashRateDeltaPts: pointChange(current.crashRate, previous.crashRate),
            durationDeltaPct: percentChange(current.avgDurationSeconds, previous.avgDurationSeconds),
        };
    }, [trendChartData]);

    const healthShift = useMemo(() => {
        const daily = overviewObs?.dailyHealth || [];
        if (!daily.length) return null;

        const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
        const windowSize = Math.max(1, Math.min(14, Math.floor(sorted.length / 2) || 1));
        const currentWindow = sorted.slice(-windowSize);
        const previousWindow = sorted.slice(-windowSize * 2, -windowSize);

        const toDegradedRate = (rows: typeof sorted) => {
            const totals = rows.reduce((agg, row) => {
                agg.total += row.clean + row.error + row.rage + row.slow + row.crash;
                agg.degraded += row.error + row.rage + row.slow + row.crash;
                return agg;
            }, { total: 0, degraded: 0 });

            return totals.total > 0 ? (totals.degraded / totals.total) * 100 : 0;
        };

        const currentRate = toDegradedRate(currentWindow);
        const previousRate = previousWindow.length > 0 ? toDegradedRate(previousWindow) : null;

        return {
            currentRate,
            deltaPts: previousRate === null ? null : pointChange(currentRate, previousRate),
        };
    }, [overviewObs]);

    const acquisitionSnapshot = useMemo(() => {
        const firstSessionStats = overviewObs?.firstSessionStats;
        const newUserGrowth = overviewObs?.newUserGrowth;
        const firstSessionTotal = Number(firstSessionStats?.total || 0);
        const firstSessionClean = Number(firstSessionStats?.clean || 0);
        const firstSessionFailureRate = firstSessionTotal > 0
            ? ((firstSessionTotal - firstSessionClean) / firstSessionTotal) * 100
            : 0;

        return {
            firstSessionSuccessRate: Number(overviewObs?.firstSessionSuccessRate || 0),
            firstSessionFailureRate,
            firstSessionTotal,
            firstSessionClean,
            acquiredUsers: Number(newUserGrowth?.acquiredUsers || 0),
            acquisitionRate: Number(newUserGrowth?.acquisitionRate || 0),
            returnedUsers: Number(newUserGrowth?.returnedUsers || 0),
            returnRate: Number(newUserGrowth?.returnRate || 0),
        };
    }, [overviewObs]);

    const firstSessionIssueMix = useMemo(() => {
        const first = overviewObs?.firstSessionStats;
        if (!first || Number(first.total || 0) <= 0) return [];

        const total = Number(first.total || 0);
        const mix = [
            { label: 'Crash', count: Number(first.withCrash || 0), color: '#ef4444' },
            { label: 'ANR', count: Number(first.withAnr || 0), color: '#f97316' },
            { label: 'Rage Tap', count: Number(first.withRageTaps || 0), color: '#eab308' },
            { label: 'Slow API', count: Number(first.withSlowApi || 0), color: '#3b82f6' },
        ];

        return mix
            .filter((row) => row.count > 0)
            .map((row) => ({
                ...row,
                rate: (row.count / total) * 100,
            }))
            .sort((a, b) => b.rate - a.rate);
    }, [overviewObs]);

    const momentumCards = useMemo<MomentumCard[]>(() => {
        if (!trendComparison) return [];

        const cards: MomentumCard[] = [
            {
                label: 'Session Volume',
                value: formatCompact(trendComparison.current.sessions),
                delta: trendComparison.sessionDeltaPct === null ? 'No prior window' : `${formatSigned(trendComparison.sessionDeltaPct)}%`,
                positiveIsGood: true,
                deltaValue: trendComparison.sessionDeltaPct,
            },
            {
                label: 'DAU Momentum',
                value: formatCompact(Math.round(trendComparison.current.avgDau)),
                delta: trendComparison.dauDeltaPct === null ? 'No prior window' : `${formatSigned(trendComparison.dauDeltaPct)}%`,
                positiveIsGood: true,
                deltaValue: trendComparison.dauDeltaPct,
            },
            {
                label: 'Avg Session Time',
                value: formatDuration(trendComparison.current.avgDurationSeconds),
                delta: trendComparison.durationDeltaPct === null ? 'No prior window' : `${formatSigned(trendComparison.durationDeltaPct)}%`,
                positiveIsGood: true,
                deltaValue: trendComparison.durationDeltaPct,
            },
            {
                label: 'Retention (DAU/MAU)',
                value: `${trendComparison.current.avgRetention.toFixed(1)}%`,
                delta: trendComparison.retentionDeltaPts === null ? 'No prior window' : `${formatSigned(trendComparison.retentionDeltaPts)} pts`,
                positiveIsGood: true,
                deltaValue: trendComparison.retentionDeltaPts,
            },
            {
                label: 'Crash Rate',
                value: `${trendComparison.current.crashRate.toFixed(2)}%`,
                delta: trendComparison.crashRateDeltaPts === null ? 'No prior window' : `${formatSigned(trendComparison.crashRateDeltaPts)} pts`,
                positiveIsGood: false,
                deltaValue: trendComparison.crashRateDeltaPts,
            },
            {
                label: 'API Error Rate',
                value: `${trendComparison.current.apiErrorRate.toFixed(2)}%`,
                delta: trendComparison.apiErrorDeltaPts === null ? 'No prior window' : `${formatSigned(trendComparison.apiErrorDeltaPts)} pts`,
                positiveIsGood: false,
                deltaValue: trendComparison.apiErrorDeltaPts,
            },
        ];

        if (healthShift) {
            cards.push({
                label: 'Degraded Session Share',
                value: `${healthShift.currentRate.toFixed(1)}%`,
                delta: healthShift.deltaPts === null ? 'No prior window' : `${formatSigned(healthShift.deltaPts)} pts`,
                positiveIsGood: false,
                deltaValue: healthShift.deltaPts,
            });
        } else if (deepMetrics?.reliability?.degradedSessionRate !== undefined) {
            cards.push({
                label: 'Degraded Session Share',
                value: `${deepMetrics.reliability.degradedSessionRate.toFixed(1)}%`,
                delta: 'Current window',
                positiveIsGood: false,
                deltaValue: null,
            });
        }

        return cards;
    }, [trendComparison, healthShift, deepMetrics]);

    const keyEvents = useMemo(() => {
        const events: Array<{ name: string; count: number }> = [];

        if (overviewObs?.firstSessionStats) {
            const first = overviewObs.firstSessionStats;
            events.push(
                { name: 'First Open Sessions', count: Number(first.total || 0) },
                { name: 'First Session Crashes', count: Number(first.withCrash || 0) },
                { name: 'First Session ANRs', count: Number(first.withAnr || 0) },
                { name: 'First Session Rage Taps', count: Number(first.withRageTaps || 0) },
                { name: 'First Session Slow API', count: Number(first.withSlowApi || 0) },
            );
        }

        if (overviewObs?.sessionHealth) {
            events.push(
                { name: 'Crash Sessions', count: Number(overviewObs.sessionHealth.crash || 0) },
                { name: 'Error Sessions', count: Number(overviewObs.sessionHealth.error || 0) },
                { name: 'Rage Sessions', count: Number(overviewObs.sessionHealth.rage || 0) },
            );
        }

        if (deepMetrics?.ingestHealth) {
            events.push(
                { name: 'Upload Failure Sessions', count: Number(deepMetrics.ingestHealth.sessionsWithUploadFailures || 0) },
                { name: 'Heavy Retry Sessions', count: Number(deepMetrics.ingestHealth.sessionsWithHeavyRetries || 0) },
            );
        }

        if (overviewObs?.growthKillers?.length) {
            for (const killer of overviewObs.growthKillers.slice(0, 4)) {
                events.push({ name: killer.reason, count: Number(killer.affectedSessions || 0) });
            }
        }

        return events
            .filter((event) => Number.isFinite(event.count) && event.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);
    }, [overviewObs, deepMetrics]);

    const maxKeyEventCount = useMemo(
        () => keyEvents.reduce((max, item) => Math.max(max, item.count), 0),
        [keyEvents],
    );

    const topIssues = useMemo(
        () =>
            [...issues]
                .sort((a, b) => {
                    if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount;
                    return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
                })
                .slice(0, 8),
        [issues],
    );

    const recommendedSessions = useMemo(
        () => buildRecommendedSessions(sessions),
        [sessions],
    );

    const hasData = useMemo(() => {
        return (
            trendChartData.length > 0
            || (overviewObs?.dailyHealth?.length ?? 0) > 0
            || (deepMetrics?.dataWindow?.analyzedSessions ?? 0) > 0
            || (engagementTrends?.daily?.length ?? 0) > 0
            || (geoSummary?.countries?.length ?? 0) > 0
            || issues.length > 0
            || sessions.length > 0
        );
    }, [trendChartData, overviewObs, deepMetrics, engagementTrends, geoSummary, issues.length, sessions.length]);

    return (
        <div className="min-h-screen bg-transparent font-sans text-slate-900 pb-12">
            <DashboardPageHeader
                title="General"
                subtitle="Acquisition, reliability, retention, and replay-driven issue triage"
                icon={<MessageSquareWarning className="w-6 h-6" />}
                iconColor="bg-sky-500"
            >
                <TimeFilter value={timeRange} onChange={setTimeRange} />
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1600px] space-y-4 px-6 py-6">
                {!selectedProject?.id && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                        Select a project to view general diagnostics.
                    </div>
                )}

                {isLoading && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                            <Activity className="h-4 w-4 animate-pulse text-blue-600" />
                            Loading general analytics...
                        </div>
                    </div>
                )}

                {!isLoading && partialError && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        {partialError}
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                        No general analytics available for this filter yet.
                    </div>
                )}

                {!isLoading && hasData && (
                    <>
                        {momentumCards.length > 0 && (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
                                {momentumCards.map((card) => {
                                    const deltaClass = card.deltaValue === null || card.deltaValue === 0
                                        ? 'text-slate-500'
                                        : (card.positiveIsGood ? card.deltaValue > 0 : card.deltaValue < 0)
                                            ? 'text-emerald-600'
                                            : 'text-rose-600';

                                    return (
                                        <div key={card.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                                            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{card.label}</div>
                                            <div className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</div>
                                            <div className={`mt-1 text-xs font-medium ${deltaClass}`}>
                                                {card.delta}
                                            </div>
                                            {trendComparison && (
                                                <div className="mt-0.5 text-[10px] text-slate-400">
                                                    vs previous {trendComparison.windowSize}-point window
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <GA4Card title="User activity over time">
                                <div className="mb-2 flex items-baseline gap-4">
                                    <div>
                                        <span className="text-[11px] text-slate-400">LATEST DAU</span>
                                        <div className="text-2xl font-semibold">{formatCompact(activitySummary.latestDau)}</div>
                                    </div>
                                    <div>
                                        <span className="text-[11px] text-slate-400">AVG DAU</span>
                                        <div className="text-lg font-semibold text-slate-700">{formatCompact(activitySummary.avgDau)}</div>
                                    </div>
                                    <div>
                                        <span className="text-[11px] text-slate-400">PEAK MAU</span>
                                        <div className="text-lg font-semibold text-slate-700">{formatCompact(activitySummary.peakMau)}</div>
                                    </div>
                                </div>
                                <div className="h-[130px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={trendChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip labelFormatter={(value) => formatDateLabel(String(value))} />
                                            <Line type="monotone" dataKey="dau" stroke="#1a73e8" strokeWidth={2} dot={false} name="DAU" />
                                            <Line type="monotone" dataKey="mau" stroke="#34a853" strokeWidth={1.5} dot={false} name="MAU" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </GA4Card>

                            <GA4Card title="Active users snapshot">
                                <div className="mt-1 text-center">
                                    <div className="text-4xl font-semibold text-slate-900">{formatCompact(activitySummary.latestDau)}</div>
                                    <div className="mt-1 text-xs text-slate-500">LATEST DAILY ACTIVE USERS</div>
                                    <div className="mt-1 text-[11px] text-slate-500">Estimated {formatCompact(activeUsersPerMinute)} users/min</div>
                                </div>

                                <div className="mt-3 h-[80px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={realtimeActivitySeries} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                                            <XAxis dataKey="dateKey" hide />
                                            <YAxis hide domain={[0, 'auto']} />
                                            <Tooltip
                                                labelFormatter={(value) => formatDateLabel(String(value))}
                                                formatter={(value: number | undefined) => [formatCompact(value ?? 0), 'DAU']}
                                            />
                                            <Area type="monotone" dataKey="dau" stroke="#1a73e8" fill="#dbeafe" strokeWidth={2} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="mt-3 border-t border-slate-100 pt-3">
                                    <div className="mb-1.5 flex justify-between text-[11px] font-medium text-slate-500">
                                        <span>TOP COUNTRIES</span>
                                        <span>ACTIVE USERS</span>
                                    </div>
                                    {topCountries.length > 0 ? topCountries.map((country) => (
                                        <div key={country.country} className="flex justify-between text-xs text-slate-700">
                                            <span>{country.country}</span>
                                            <span className="font-medium">{formatCompact(country.count)}</span>
                                        </div>
                                    )) : (
                                        <div className="text-xs text-slate-400">No geographic activity available for this filter.</div>
                                    )}
                                </div>

                                <div className="mt-3 text-right">
                                    <Link to={`${pathPrefix}/analytics/geo`} className="text-xs text-blue-600 hover:underline">
                                        View geographic activity →
                                    </Link>
                                </div>
                            </GA4Card>

                            <GA4Card title="Active users by app version">
                                <div className="h-[180px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={versionChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip labelFormatter={(value) => formatDateLabel(String(value))} />
                                            {versionKeys.map((version, index) => (
                                                <Line
                                                    key={version}
                                                    type="monotone"
                                                    dataKey={version}
                                                    stroke={versionColors[index % versionColors.length]}
                                                    strokeWidth={2}
                                                    dot={false}
                                                    name={version}
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                {versionKeys.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-3">
                                        {versionKeys.map((version, index) => (
                                            <span key={version} className="flex items-center gap-1 text-[10px] text-slate-500">
                                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: versionColors[index % versionColors.length] }} />
                                                {version}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="mt-2 text-xs text-slate-400">No app version data for this filter.</div>
                                )}

                                <div className="mt-2 text-right">
                                    <Link to={`${pathPrefix}/analytics/devices`} className="text-xs text-blue-600 hover:underline">
                                        View app versions →
                                    </Link>
                                </div>
                            </GA4Card>

                            <GA4Card title="Latest app release overview">
                                <table className="mt-1 w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                                            <th className="py-2 text-left font-medium">APP</th>
                                            <th className="py-2 text-left font-medium">VERSION</th>
                                            <th className="py-2 text-left font-medium">STATUS</th>
                                            <th className="py-2 text-right font-medium">SESSIONS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {latestReleases.map((release) => (
                                            <tr key={release.version} className="border-b border-slate-50">
                                                <td className="flex items-center gap-1.5 py-2 text-slate-700">
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                                    {selectedProject?.name ?? 'App'}
                                                </td>
                                                <td className="py-2 text-slate-700">{release.version}</td>
                                                <td className="py-2">
                                                    <span className={release.status === 'Successful' ? 'text-green-600' : 'text-amber-600'}>
                                                        {release.status}
                                                    </span>
                                                </td>
                                                <td className="py-2 text-right text-slate-700">{formatCompact(release.sessions)}</td>
                                            </tr>
                                        ))}
                                        {latestReleases.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="py-4 text-center text-slate-400">No releases found</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </GA4Card>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <GA4Card title="App stability overview">
                                <table className="mt-1 w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                                            <th className="py-2 text-left font-medium">APP</th>
                                            <th className="py-2 text-right font-medium">CRASH-FREE</th>
                                            <th className="py-2 text-right font-medium">ANR-FREE</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b border-slate-50">
                                            <td className="py-2 text-slate-700">{selectedProject?.name ?? 'App'}</td>
                                            <td className="py-2 text-right text-slate-700 font-medium">
                                                {crashFreeRate !== null ? `${crashFreeRate.toFixed(1)}%` : 'N/A'}
                                            </td>
                                            <td className="py-2 text-right text-slate-700 font-medium">
                                                {anrFreeRate !== null ? `${anrFreeRate.toFixed(1)}%` : 'N/A'}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </GA4Card>

                            <GA4Card title="Average engagement time per active user">
                                <div className="mb-2 flex items-baseline gap-6">
                                    <div>
                                        <div className="text-2xl font-semibold">{avgEngagementTime}</div>
                                    </div>
                                    <div>
                                        <span className="text-[11px] text-slate-400">Engaged user share</span>
                                        <div className="text-lg font-semibold text-slate-700">
                                            {engagedUserShare === null ? 'N/A' : `${engagedUserShare.toFixed(1)}%`}
                                        </div>
                                    </div>
                                </div>
                                <div className="h-[130px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={engagementChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip
                                                labelFormatter={(value) => formatDateLabel(String(value))}
                                                formatter={(value: number | undefined) => [formatDuration(value ?? 0), 'Avg engagement']}
                                            />
                                            <Line type="monotone" dataKey="engagementTime" stroke="#1a73e8" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </GA4Card>

                            <GA4Card title="User retention">
                                <div className="h-[180px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={retentionChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                                            <Tooltip
                                                labelFormatter={(value) => formatDateLabel(String(value))}
                                                formatter={(value: number | undefined) => [`${value ?? 0}%`, 'DAU/MAU stickiness']}
                                            />
                                            <Bar dataKey="retention" fill="#1a73e8" radius={[2, 2, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-1 text-center text-[10px] text-slate-400">
                                    Last {retentionChartData.length} points
                                </div>
                            </GA4Card>

                            <GA4Card title="Retention cohorts">
                                <div className="mb-2 text-[10px] text-slate-400">
                                    Weekly user retention by first active week (Week 0 to Week 5)
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full border-separate border-spacing-0 text-[11px]">
                                        <thead>
                                            <tr className="text-slate-500">
                                                <th className="whitespace-nowrap py-1 pr-2 text-left font-medium">Cohort</th>
                                                {Array.from({ length: RETENTION_COHORT_WEEKS }, (_, i) => (
                                                    <th key={`cohort-week-${i}`} className="whitespace-nowrap px-1 py-1 text-center font-medium">
                                                        Week {i}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {retentionCohorts.map((row) => (
                                                <tr key={row.weekStartKey}>
                                                    <td className="whitespace-nowrap py-1 pr-2 align-middle text-slate-700">
                                                        <div className="font-semibold">{row.label}</div>
                                                        <div className="text-[10px] text-slate-500">{formatCompact(row.users)} users</div>
                                                    </td>
                                                    {row.retention.map((value, weekIdx) => (
                                                        <td key={`${row.weekStartKey}-${weekIdx}`} className="px-1 py-1">
                                                            <div
                                                                className="flex h-8 min-w-[62px] items-center justify-center rounded-md text-[10px] font-semibold"
                                                                style={getCohortCellStyle(value, weekIdx)}
                                                            >
                                                                {value === null ? '—' : `${value.toFixed(1)}%`}
                                                            </div>
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                            {retentionCohorts.length === 0 && (
                                                <tr>
                                                    <td colSpan={RETENTION_COHORT_WEEKS + 1} className="py-5 text-center text-slate-400">
                                                        Not enough user-level replay sessions for cohort retention yet.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-2 flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400">Week 0 = first active week for that cohort</span>
                                    <Link to={`${pathPrefix}/analytics/journeys`} className="text-xs text-blue-600 hover:underline">
                                        View journeys →
                                    </Link>
                                </div>
                            </GA4Card>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            <GA4Card title="Key risk events by impact">
                                {keyEvents.length > 0 ? (
                                    <div className="space-y-2">
                                        {keyEvents.map((event) => {
                                            const width = maxKeyEventCount > 0
                                                ? Math.max(8, Math.round((event.count / maxKeyEventCount) * 100))
                                                : 0;

                                            return (
                                                <div key={event.name}>
                                                    <div className="mb-1 flex justify-between text-xs">
                                                        <span className="truncate text-slate-700" title={event.name}>{event.name}</span>
                                                        <span className="font-semibold text-slate-900">{formatCompact(event.count)}</span>
                                                    </div>
                                                    <div className="h-1.5 rounded bg-slate-100">
                                                        <div className="h-1.5 rounded bg-blue-500" style={{ width: `${width}%` }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="py-4 text-center text-xs text-slate-400">
                                        No key events available for this filter.
                                    </div>
                                )}
                            </GA4Card>

                            <GA4Card title="Acquisition and activation quality">
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="text-[11px] uppercase tracking-wide text-slate-500">First session success</div>
                                        <div className="mt-1 text-xl font-semibold text-slate-900">{acquisitionSnapshot.firstSessionSuccessRate.toFixed(1)}%</div>
                                        <div className="mt-0.5 text-[11px] text-slate-500">{formatCompact(acquisitionSnapshot.firstSessionClean)} clean / {formatCompact(acquisitionSnapshot.firstSessionTotal)} total</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="text-[11px] uppercase tracking-wide text-slate-500">First session failure</div>
                                        <div className="mt-1 text-xl font-semibold text-slate-900">{acquisitionSnapshot.firstSessionFailureRate.toFixed(1)}%</div>
                                        <div className="mt-0.5 text-[11px] text-slate-500">Crash, ANR, rage, or slow API on first session</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Acquired users</div>
                                        <div className="mt-1 text-xl font-semibold text-slate-900">{formatCompact(acquisitionSnapshot.acquiredUsers)}</div>
                                        <div className="mt-0.5 text-[11px] text-slate-500">{acquisitionSnapshot.acquisitionRate.toFixed(1)}% acquisition rate</div>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Returned users</div>
                                        <div className="mt-1 text-xl font-semibold text-slate-900">{formatCompact(acquisitionSnapshot.returnedUsers)}</div>
                                        <div className="mt-0.5 text-[11px] text-slate-500">{acquisitionSnapshot.returnRate.toFixed(1)}% return rate</div>
                                    </div>
                                </div>
                                {firstSessionIssueMix.length > 0 && (
                                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                                        <div className="font-medium text-slate-700">First-session issue mix</div>
                                        <div className="mt-2 space-y-2">
                                            {firstSessionIssueMix.map((issue) => (
                                                <div key={issue.label}>
                                                    <div className="mb-1 flex justify-between text-slate-600">
                                                        <span>{issue.label}</span>
                                                        <span>{issue.rate.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-1.5 rounded bg-slate-100">
                                                        <div className="h-1.5 rounded" style={{ width: `${Math.min(100, issue.rate)}%`, backgroundColor: issue.color }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </GA4Card>
                        </div>

                        <section className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h2 className="text-base font-semibold text-slate-900">Top Issues</h2>
                                <NeoBadge variant="neutral" size="sm" className="shadow-none border-slate-200">
                                    {topIssues.length} of {issues.length}
                                </NeoBadge>
                            </div>

                            {topIssues.length === 0 ? (
                                <EmptyStateCard
                                    title="No issues in this window"
                                    subtitle="Issue groups appear here as they are detected."
                                />
                            ) : (
                                <div className="rounded-3xl border border-slate-100/80 bg-white shadow-sm ring-1 ring-slate-900/5 overflow-hidden">
                                    <div className="divide-y divide-slate-100/80">
                                        {topIssues.map((issue) => {
                                            const issueColor = ISSUE_TYPE_COLOR[issue.issueType] || '#64748b';
                                            return (
                                                <div
                                                    key={issue.id}
                                                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/80 transition-colors"
                                                >
                                                    <NeoBadge variant={ISSUE_TYPE_BADGE_VARIANT[issue.issueType] || 'neutral'} size="sm">
                                                        {issue.issueType.replace('_', ' ')}
                                                    </NeoBadge>

                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-semibold text-slate-900">
                                                            {issue.title}
                                                        </div>
                                                        <div className="truncate text-[11px] text-slate-500 mt-0.5">
                                                            {issue.subtitle || issue.culprit || '—'}
                                                        </div>
                                                    </div>

                                                    <div className="hidden md:block shrink-0">
                                                        <IssueSparkline dailyEvents={issue.dailyEvents} color={issueColor} />
                                                    </div>

                                                    <div className="hidden sm:flex items-center gap-4 shrink-0 text-right">
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Events</div>
                                                            <div className="text-sm font-black text-slate-900">{formatCompact(issue.eventCount)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Users</div>
                                                            <div className="text-sm font-black text-slate-900">{formatCompact(issue.userCount)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Last</div>
                                                            <div className="text-xs font-bold text-slate-700">{formatLastSeen(issue.lastSeen)}</div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <Link
                                                            to={`${pathPrefix}/general/${issue.id}`}
                                                            className="rounded-md border border-slate-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700 hover:border-slate-900 hover:text-slate-900 transition-colors"
                                                        >
                                                            View
                                                        </Link>
                                                        {issue.sampleSessionId && (
                                                            <Link
                                                                to={`${pathPrefix}/sessions/${issue.sampleSessionId}`}
                                                                className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-700 hover:border-sky-500 transition-colors"
                                                            >
                                                                Replay
                                                            </Link>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-base font-semibold text-slate-900">Recommended Sessions</h2>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        Mixed user segments: new, returning, anonymous, platform-specific, and risk-heavy journeys.
                                    </p>
                                </div>
                                <NeoBadge variant="neutral" size="sm" className="shadow-none border-slate-200">
                                    {recommendedSessions.length} picks
                                </NeoBadge>
                            </div>

                            {recommendedSessions.length === 0 ? (
                                <EmptyStateCard
                                    title="No recommended sessions"
                                    subtitle="Sessions will appear here once replay data is available in this time window."
                                />
                            ) : (
                                <div className="relative">
                                    <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-white via-white/80 to-transparent" />
                                    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-white via-white/80 to-transparent" />
                                    <div className="overflow-x-auto pb-3">
                                        <div className="flex min-w-max snap-x snap-mandatory gap-3 pr-4">
                                        {recommendedSessions.map((rec) => (
                                            <article
                                                key={rec.session.id}
                                                className="group w-[360px] snap-start rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 p-3 shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <span
                                                            className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${RECOMMENDED_SESSION_PRIORITY_STYLES[rec.priority]}`}
                                                        >
                                                            {rec.category}
                                                        </span>
                                                        <div className="mt-1 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                                            {(rec.session.userId
                                                                ? 'Identified user'
                                                                : (rec.session.anonymousId || rec.session.anonymousDisplayName)
                                                                    ? 'Anonymous user'
                                                                    : 'Device-only user')}
                                                            {' · '}
                                                            {rec.session.platform.toUpperCase()}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => navigate(`${pathPrefix}/sessions/${rec.session.id}`)}
                                                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900"
                                                    >
                                                        Open
                                                    </button>
                                                </div>

                                                <p className="mt-2 min-h-[2rem] text-xs leading-relaxed text-slate-600">
                                                    {rec.reason}
                                                </p>

                                                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                                                    <div className="rounded-lg border border-slate-200/80 bg-white/90 px-2 py-1.5">
                                                        <div className="text-slate-400">Duration</div>
                                                        <div className="font-semibold text-slate-700">{formatDuration(rec.session.durationSeconds || 0)}</div>
                                                    </div>
                                                    <div className="rounded-lg border border-slate-200/80 bg-white/90 px-2 py-1.5">
                                                        <div className="text-slate-400">Signals</div>
                                                        <div className="font-semibold text-slate-700">{issueSignalsForSession(rec.session)}</div>
                                                    </div>
                                                    <div className="rounded-lg border border-slate-200/80 bg-white/90 px-2 py-1.5">
                                                        <div className="text-slate-400">Last Seen</div>
                                                        <div className="font-semibold text-slate-700">{formatLastSeen(rec.session.startedAt)}</div>
                                                    </div>
                                                </div>

                                                <div className="mt-2 flex items-end justify-between gap-2">
                                                    <div className="flex min-w-0 flex-wrap gap-1.5">
                                                        {rec.session.appVersion && (
                                                            <span className="inline-flex items-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                                                v{rec.session.appVersion}
                                                            </span>
                                                        )}
                                                        {rec.session.networkType && (
                                                            <span className="inline-flex items-center rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                                                {rec.session.networkType}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="shrink-0 scale-[0.85] origin-bottom-right">
                                                        <MiniSessionCard
                                                            session={{
                                                                id: rec.session.id,
                                                                deviceModel: rec.session.deviceModel,
                                                                createdAt: rec.session.startedAt,
                                                                coverPhotoUrl:
                                                                    rec.session.replayPromoted !== false
                                                                        ? `/api/sessions/${rec.session.id}/cover`
                                                                        : null,
                                                            }}
                                                            onClick={() =>
                                                                navigate(`${pathPrefix}/sessions/${rec.session.id}`)
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </article>
                                        ))}
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

export default GeneralOverview;
