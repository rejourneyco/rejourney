import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BookOpen,
    ChevronLeft,
    ChevronRight,
    Check,
    Copy,
    ExternalLink,
    Info,
    MessageSquareWarning,
    User,
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
import { useSessionData } from '~/shared/providers/SessionContext';
import {
    getDashboardOverview,
    getDashboardOverviewHeavy,
    GeoSummary,
    GrowthObservability,
    InsightsTrends,
    ObservabilityDeepMetrics,
    RetentionCohortRow,
    TopUserEntry,
    UserEngagementTrends,
} from '~/shared/api/client';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TimeFilter } from '~/shared/ui/core/TimeFilter';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { useSharedAnalyticsTimeRange } from '~/shared/hooks/useSharedAnalyticsTimeRange';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { formatDeviceModel } from '~/shared/lib/deviceModelNames';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { MiniSessionCard } from '~/shared/ui/core/MiniSessionCard';
import { buildProjectAIIntegrationPrompt } from '~/shared/constants/aiPrompts';
import { Issue, RecordingSession } from '~/shared/types';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';

const toUtcDateKey = (value: string): string | null => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
};

const formatDateLabel = (dateKey: string): string => {
    const date = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
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
function formatWeekRange(weekStartKey: string): string {
    const start = new Date(`${weekStartKey}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);

    const format = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
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
    error: '#f9a8d4',
    crash: '#ef4444',
    anr: '#8b5cf6',
    rage_tap: '#ec4899',
    api_latency: '#6366f1',
    ux_friction: '#f9a8d4',
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

interface TopUserRecommendation {
    userKey: string;
    displayName: string;
    copyValue: string;
    sessions: RecordingSession[];
    firstSession: RecordingSession;
    latestSession: RecordingSession;
    replayCount: number;
    totalDurationSeconds: number;
    userFirstSeenAt?: string;
}

const RECOMMENDED_SESSION_PRIORITY_STYLES: Record<RecommendedSession['priority'], string> = {
    critical: 'bg-rose-50 text-rose-700',
    high: 'bg-pink-50 text-pink-700',
    watch: 'bg-sky-50 text-sky-700',
    baseline: 'bg-slate-50 text-slate-700',
};

const ANONYMOUS_NICKNAME_STYLES = [
    'border-emerald-200 bg-emerald-100 text-emerald-800',
    'border-teal-200 bg-teal-100 text-teal-800',
    'border-cyan-200 bg-cyan-100 text-cyan-800',
    'border-sky-200 bg-sky-100 text-sky-800',
    'border-blue-200 bg-blue-100 text-blue-800',
    'border-indigo-200 bg-indigo-100 text-indigo-800',
    'border-violet-200 bg-violet-100 text-violet-800',
    'border-purple-200 bg-purple-100 text-purple-800',
    'border-fuchsia-200 bg-fuchsia-100 text-fuchsia-800',
    'border-pink-200 bg-pink-100 text-pink-800',
    'border-lime-200 bg-lime-100 text-lime-800',
    'border-green-200 bg-green-100 text-green-800',
];

const TOP_USER_ICON_STYLES = [
    'border-rose-200 bg-rose-100 text-rose-700',
    'border-pink-200 bg-pink-100 text-pink-700',
    'border-emerald-200 bg-emerald-100 text-emerald-700',
    'border-cyan-200 bg-cyan-100 text-cyan-700',
    'border-blue-200 bg-blue-100 text-blue-700',
    'border-indigo-200 bg-indigo-100 text-indigo-700',
    'border-fuchsia-200 bg-fuchsia-100 text-fuchsia-700',
    'border-lime-200 bg-lime-100 text-lime-700',
];

function hashString(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function getAnonymousNickname(session: RecordingSession): string | null {
    const displayName = session.anonymousDisplayName?.trim();
    if (displayName) return displayName;

    const anonymousId = session.anonymousId?.trim();
    if (!anonymousId || anonymousId.toLowerCase() === 'anonymous') return null;
    return anonymousId.length > 22 ? `${anonymousId.slice(0, 22)}...` : anonymousId;
}

function getAnonymousNicknameStyle(nickname: string): string {
    const idx = hashString(nickname) % ANONYMOUS_NICKNAME_STYLES.length;
    return ANONYMOUS_NICKNAME_STYLES[idx];
}

function getTopUserIconStyle(value: string): string {
    const idx = hashString(value) % TOP_USER_ICON_STYLES.length;
    return TOP_USER_ICON_STYLES[idx];
}

function getSessionLocationLabel(session: RecordingSession): string {
    const city = session.geoLocation?.city?.trim();
    const region = session.geoLocation?.region?.trim();
    const country = session.geoLocation?.country?.trim();

    if (city && country) return `${city}, ${country}`;
    if (city && region) return `${city}, ${region}`;
    if (city) return city;
    if (region && country) return `${region}, ${country}`;
    if (region) return region;
    if (country) return country;
    return 'Unknown location';
}

function hasSuccessfulRecording(session: RecordingSession): boolean {
    return Boolean(session.hasSuccessfulRecording);
}

function getTopUserIdentity(session: RecordingSession): { key: string; displayName: string; copyValue: string } {
    const anonymousNickname = getAnonymousNickname(session);
    if (session.userId) {
        return { key: `user:${session.userId}`, displayName: session.userId, copyValue: session.userId };
    }
    if (anonymousNickname) {
        return { key: `anonymous:${anonymousNickname}`, displayName: anonymousNickname, copyValue: anonymousNickname };
    }
    if (session.deviceId) {
        return { key: `device:${session.deviceId}`, displayName: session.deviceId, copyValue: session.deviceId };
    }
    return { key: `session:${session.id}`, displayName: session.id, copyValue: session.id };
}

function truncateUserLabel(value: string): string {
    return value.length > 28 ? `${value.slice(0, 12)}...${value.slice(-10)}` : value;
}

function buildTopUsers(sessions: RecordingSession[]): TopUserRecommendation[] {
    if (sessions.length === 0) return [];

    const pool = sessions.filter((s) => hasSuccessfulRecording(s) && !s.isReplayExpired);
    if (pool.length === 0) return [];
    const groups = new Map<string, TopUserRecommendation>();

    for (const session of pool) {
        const identity = getTopUserIdentity(session);
        const existing = groups.get(identity.key);

        if (!existing) {
            groups.set(identity.key, {
                userKey: identity.key,
                displayName: identity.displayName,
                copyValue: identity.copyValue,
                sessions: [session],
                firstSession: session,
                latestSession: session,
                replayCount: 1,
                totalDurationSeconds: session.durationSeconds || 0,
                userFirstSeenAt: session.userFirstSeenAt,
            });
            continue;
        }

        existing.sessions.push(session);
        existing.replayCount += 1;
        existing.totalDurationSeconds += session.durationSeconds || 0;

        if (new Date(session.startedAt).getTime() < new Date(existing.firstSession.startedAt).getTime()) {
            existing.firstSession = session;
        }
        if (new Date(session.startedAt).getTime() > new Date(existing.latestSession.startedAt).getTime()) {
            existing.latestSession = session;
        }
        if (session.userFirstSeenAt && (!existing.userFirstSeenAt || new Date(session.userFirstSeenAt) < new Date(existing.userFirstSeenAt))) {
            existing.userFirstSeenAt = session.userFirstSeenAt;
        }
    }

    return [...groups.values()]
        .sort((a, b) => {
            if (b.replayCount !== a.replayCount) return b.replayCount - a.replayCount;
            return new Date(b.latestSession.startedAt).getTime() - new Date(a.latestSession.startedAt).getTime();
        })
        .slice(0, 20);
}

function buildRecommendedSessions(sessions: RecordingSession[]): RecommendedSession[] {
    if (sessions.length === 0) return [];

    const pool = sessions.filter((s) => hasSuccessfulRecording(s) && !s.isReplayExpired);
    if (pool.length === 0) return [];

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
    <div className="border-2 border-dashed border-black bg-[#f8fafc] px-6 py-10 text-center shadow-neo-sm">
        <p className="text-sm font-extrabold text-black">{title}</p>
        <p className="mx-auto mt-2 max-w-sm text-xs font-semibold text-slate-600">{subtitle}</p>
    </div>
);

const GA4Card: React.FC<{
    title: string;
    action?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    accentClassName?: string;
}> = ({ title, action, children, className = '', accentClassName = 'bg-[#67e8f9]' }) => (
    <div className={`flex h-full min-w-0 flex-col border-2 border-black bg-white shadow-neo transition-all hover:-translate-y-0.5 hover:shadow-neo-lg ${className}`}>
        <div className={`h-1.5 border-b-2 border-black ${accentClassName}`} />
        <div className="flex min-h-0 flex-1 flex-col p-3.5 sm:p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b-2 border-black pb-2.5">
                <h3 className="min-w-0 break-words text-sm font-extrabold text-black">{title}</h3>
                {action ? <div className="flex flex-wrap items-center gap-1.5">{action}</div> : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
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

type CountryUsersChartRow = {
    dateKey: string;
} & Record<string, string | number>;

type EngagementSegmentKey = 'bouncers' | 'casuals' | 'explorers' | 'loyalists';

type EngagementMixChartRow = {
    dateKey: string;
    bouncers: number;
    casuals: number;
    explorers: number;
    loyalists: number;
    total: number;
    engagedShare: number;
};

const ENGAGEMENT_SEGMENTS: Array<{ key: EngagementSegmentKey; label: string; color: string }> = [
    { key: 'bouncers', label: 'Bouncers', color: '#ef4444' },
    { key: 'casuals', label: 'Casuals', color: '#f9a8d4' },
    { key: 'explorers', label: 'Explorers', color: '#3b82f6' },
    { key: 'loyalists', label: 'Loyalists', color: '#10b981' },
];

const COUNTRY_LINE_COLORS = ['#1a73e8', '#5dadec', '#1e8e3e', '#f9a8d4', '#9334e6', '#0f766e'];

type MomentumCard = {
    label: string;
    value: string;
    delta: string;
    positiveIsGood: boolean;
    deltaValue: number | null;
};

const RETRO_CARD_ACCENTS = ['#67e8f9', '#86efac', '#f9a8d4', '#c4b5fd'];

export const GeneralOverview: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
    const navigate = useNavigate();
    const { timeRange, setTimeRange } = useSharedAnalyticsTimeRange(selectedProject?.id);

    const [isLoading, setIsLoading] = useState(true);
    const [isHeavyLoading, setIsHeavyLoading] = useState(true);
    const [partialError, setPartialError] = useState<string | null>(null);
    const [topUsersFromBackend, setTopUsersFromBackend] = useState<TopUserEntry[]>([]);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    const [overviewObs, setOverviewObs] = useState<GrowthObservability | null>(null);
    const [deepMetrics, setDeepMetrics] = useState<ObservabilityDeepMetrics | null>(null);
    const [engagementTrends, setEngagementTrends] = useState<UserEngagementTrends | null>(null);
    const [geoSummary, setGeoSummary] = useState<GeoSummary | null>(null);
    const [issues, setIssues] = useState<Issue[]>([]);
    const [sessions, setSessions] = useState<RecordingSession[]>([]);
    const [retentionCohortRows, setRetentionCohortRows] = useState<RetentionCohortRow[]>([]);
    const [topIssuesPage, setTopIssuesPage] = useState(0);
    const [copiedTopUserKey, setCopiedTopUserKey] = useState<string | null>(null);
    const [copiedPublicKey, setCopiedPublicKey] = useState(false);
    const [copiedDocsPrompt, setCopiedDocsPrompt] = useState(false);

    const TOP_ISSUES_PAGE_SIZE = 5;

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
            setRetentionCohortRows([]);
            return;
        }

        let isCancelled = false;
        setIsLoading(true);
        setPartialError(null);

        getDashboardOverview(selectedProject.id, timeRange)
            .then((overviewData) => {
                if (isCancelled) return;

                setTrends(overviewData.trends || null);
                setOverviewObs(overviewData.overviewObs || null);
                setDeepMetrics(overviewData.deepMetrics || null);
                setEngagementTrends(overviewData.engagementTrends || null);
                setGeoSummary(overviewData.geoSummary || null);
                setRetentionCohortRows(overviewData.retention?.rows || []);
                setIssues(overviewData.issues || []);

                if (overviewData.failedSections?.length) {
                    setPartialError(`Some widgets unavailable (${overviewData.failedSections.join(', ')}).`);
                } else {
                    setPartialError(null);
                }
            })
            .catch(() => {
                if (isCancelled) return;
                setTrends(null);
                setOverviewObs(null);
                setDeepMetrics(null);
                setEngagementTrends(null);
                setGeoSummary(null);
                setRetentionCohortRows([]);
                setIssues([]);
                setPartialError('General overview unavailable.');
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIsHeavyLoading(false);
            setSessions([]);
            setTopUsersFromBackend([]);
            return;
        }

        let isCancelled = false;
        setIsHeavyLoading(true);

        getDashboardOverviewHeavy(selectedProject.id, timeRange)
            .then((heavyData) => {
                if (isCancelled) return;
                setSessions((heavyData.sessions || []) as RecordingSession[]);
                setTopUsersFromBackend(heavyData.topUsers || []);
            })
            .catch(() => {
                if (isCancelled) return;
                setSessions([]);
                setTopUsersFromBackend([]);
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsHeavyLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange]);

    useEffect(() => {
        setTopIssuesPage(0);
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
            return { latestDau: 0, avgDau: 0, peakMau: 0, latestSessions: 0 };
        }

        const latest = trendChartData[trendChartData.length - 1];
        const totalDau = trendChartData.reduce((sum, row) => sum + row.dau, 0);
        const peakMau = trendChartData.reduce((max, row) => Math.max(max, row.mau), 0);

        return {
            latestDau: latest?.dau ?? 0,
            avgDau: Math.round(totalDau / trendChartData.length),
            peakMau,
            latestSessions: latest?.sessions ?? 0,
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
            const breakdown = day.appVersionDauBreakdown || day.appVersionBreakdown || {};
            for (const version of Object.keys(breakdown)) {
                if (isKnownVersion(version)) versionSet.add(version);
            }
        }

        const versions = Array.from(versionSet).sort();

        return trends.daily
            .map((entry) => {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) return null;

                const row: Record<string, string | number> = { dateKey };
                const breakdown = entry.appVersionDauBreakdown || entry.appVersionBreakdown || {};
                for (const version of versions) {
                    row[version] = Number(breakdown[version] || 0);
                }
                return row;
            })
            .filter((row): row is NonNullable<typeof row> => Boolean(row));
    }, [trends]);

    const versionKeys = useMemo(() => {
        if (!versionChartData.length) return [];
        return Object.keys(versionChartData[0]).filter((key) => key !== 'dateKey');
    }, [versionChartData]);

    const versionColors = ['#1a73e8', '#5dadec', '#f9a8d4', '#1e8e3e', '#9334e6', '#0f766e'];

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

    const countryUsersByRegion = useMemo(() => {
        const totals = new Map<string, number>();
        let rows: CountryUsersChartRow[] = [];

        if (trends?.daily?.some((entry) => entry.countryDauBreakdown && Object.keys(entry.countryDauBreakdown).length > 0)) {
            for (const entry of trends.daily) {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) continue;

                const breakdown = entry.countryDauBreakdown || {};
                for (const [country, value] of Object.entries(breakdown)) {
                    const count = Number(value || 0);
                    if (count > 0) totals.set(country || 'Unknown', (totals.get(country || 'Unknown') || 0) + count);
                }
            }

            const countryKeys = [...totals.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([country]) => country);

            rows = trends.daily
                .map((entry) => {
                    const dateKey = toUtcDateKey(entry.date);
                    if (!dateKey) return null;
                    const row: CountryUsersChartRow = { dateKey };
                    for (const country of countryKeys) {
                        row[country] = Number(entry.countryDauBreakdown?.[country] || 0);
                    }
                    return row;
                })
                .filter((row): row is CountryUsersChartRow => Boolean(row))
                .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
        } else {
            const dailyCountryUsers = new Map<string, Map<string, Set<string>>>();

            for (const session of sessions) {
                const dateKey = toUtcDateKey(session.startedAt);
                const country = session.geoLocation?.country?.trim();
                if (!dateKey || !country) continue;

                const userKey = sessionUserKey(session);
                if (!dailyCountryUsers.has(dateKey)) dailyCountryUsers.set(dateKey, new Map());
                const countryMap = dailyCountryUsers.get(dateKey)!;
                if (!countryMap.has(country)) countryMap.set(country, new Set());
                countryMap.get(country)!.add(userKey);
            }

            for (const countryMap of dailyCountryUsers.values()) {
                for (const [country, usersForCountry] of countryMap.entries()) {
                    totals.set(country, (totals.get(country) || 0) + usersForCountry.size);
                }
            }

            const countryKeys = [...totals.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([country]) => country);

            const dateKeys = trendChartData.length > 0
                ? trendChartData.map((row) => row.dateKey)
                : [...dailyCountryUsers.keys()].sort();

            rows = dateKeys.map((dateKey) => {
                const row: CountryUsersChartRow = { dateKey };
                const countryMap = dailyCountryUsers.get(dateKey);
                for (const country of countryKeys) {
                    row[country] = countryMap?.get(country)?.size || 0;
                }
                return row;
            });
        }

        const countryKeys = [...totals.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([country]) => country);
        const totalUserDays = [...totals.values()].reduce((sum, value) => sum + value, 0);
        const topCountry = countryKeys[0] || null;
        const topCountryUsers = topCountry ? totals.get(topCountry) || 0 : 0;

        return {
            rows,
            countryKeys,
            activeCountries: totals.size,
            totalUserDays,
            topCountry,
            topCountryShare: totalUserDays > 0 ? (topCountryUsers / totalUserDays) * 100 : null,
        };
    }, [trends, sessions, trendChartData]);

    const engagementMixChartData = useMemo<EngagementMixChartRow[]>(() => {
        if (!engagementTrends?.daily?.length) return [];

        return engagementTrends.daily
            .map((entry) => {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) return null;

                const bouncers = Number(entry.bouncers || 0);
                const casuals = Number(entry.casuals || 0);
                const explorers = Number(entry.explorers || 0);
                const loyalists = Number(entry.loyalists || 0);
                const total = bouncers + casuals + explorers + loyalists;

                return {
                    dateKey,
                    bouncers,
                    casuals,
                    explorers,
                    loyalists,
                    total,
                    engagedShare: total > 0 ? ((explorers + loyalists) / total) * 100 : 0,
                };
            })
            .filter((row): row is EngagementMixChartRow => Boolean(row))
            .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }, [engagementTrends]);

    const latestEngagementMix = useMemo(() => {
        if (!engagementMixChartData.length) return null;
        return engagementMixChartData[engagementMixChartData.length - 1];
    }, [engagementMixChartData]);

    const crashFreeRate = deepMetrics?.reliability?.crashFreeSessionRate ?? null;
    const anrFreeRate = deepMetrics?.reliability?.anrFreeSessionRate ?? null;
    const platformBreakdown = deepMetrics?.reliability?.platformBreakdown ?? [];

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

    const retentionCohortTableRows = useMemo(() => {
        return retentionCohortRows.map((row) => ({
            ...row,
            label: formatWeekRange(row.weekStartKey),
        }));
    }, [retentionCohortRows]);

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

    const momentumCards = useMemo<MomentumCard[]>(() => {
        if (!trendComparison) return [];

        const qualityCard: MomentumCard = healthShift
            ? {
                label: 'Degraded Sessions',
                value: `${healthShift.currentRate.toFixed(1)}%`,
                delta: healthShift.deltaPts === null ? 'No prior window' : `${formatSigned(healthShift.deltaPts)} pts`,
                positiveIsGood: false,
                deltaValue: healthShift.deltaPts,
            }
            : deepMetrics?.reliability?.degradedSessionRate !== undefined
                ? {
                    label: 'Degraded Sessions',
                    value: `${deepMetrics.reliability.degradedSessionRate.toFixed(1)}%`,
                    delta: 'Current window',
                    positiveIsGood: false,
                    deltaValue: null,
                }
                : {
                    label: 'API Error Rate',
                    value: `${trendComparison.current.apiErrorRate.toFixed(2)}%`,
                    delta: trendComparison.apiErrorDeltaPts === null ? 'No prior window' : `${formatSigned(trendComparison.apiErrorDeltaPts)} pts`,
                    positiveIsGood: false,
                    deltaValue: trendComparison.apiErrorDeltaPts,
                };

        return [
            {
                label: 'Active Users',
                value: formatCompact(Math.round(trendComparison.current.avgDau)),
                delta: trendComparison.dauDeltaPct === null ? 'No prior window' : `${formatSigned(trendComparison.dauDeltaPct)}%`,
                positiveIsGood: true,
                deltaValue: trendComparison.dauDeltaPct,
            },
            {
                label: 'Session Volume',
                value: formatCompact(trendComparison.current.sessions),
                delta: trendComparison.sessionDeltaPct === null ? 'No prior window' : `${formatSigned(trendComparison.sessionDeltaPct)}%`,
                positiveIsGood: true,
                deltaValue: trendComparison.sessionDeltaPct,
            },
            {
                label: 'Retention',
                value: `${trendComparison.current.avgRetention.toFixed(1)}%`,
                delta: trendComparison.retentionDeltaPts === null ? 'No prior window' : `${formatSigned(trendComparison.retentionDeltaPts)} pts`,
                positiveIsGood: true,
                deltaValue: trendComparison.retentionDeltaPts,
            },
            qualityCard,
        ];
    }, [trendComparison, healthShift, deepMetrics]);

    const customEvents = useMemo(() => {
        return overviewObs?.customEvents || [];
    }, [overviewObs]);

    const maxCustomEventCount = useMemo(
        () => customEvents.reduce((max, item) => Math.max(max, item.count), 0),
        [customEvents],
    );

    const sortedIssues = useMemo(() => {
        return [...issues].sort((a, b) => {
            if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount;
            return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
        });
    }, [issues]);

    const topIssuesTotalPages = useMemo(() => {
        if (sortedIssues.length === 0) return 0;
        return Math.max(1, Math.ceil(sortedIssues.length / TOP_ISSUES_PAGE_SIZE));
    }, [sortedIssues.length]);

    useEffect(() => {
        if (topIssuesTotalPages === 0) return;
        if (topIssuesPage <= topIssuesTotalPages - 1) return;
        setTopIssuesPage(Math.max(0, topIssuesTotalPages - 1));
    }, [topIssuesPage, topIssuesTotalPages]);

    const topIssues = useMemo(() => {
        if (sortedIssues.length === 0) return [];
        const start = topIssuesPage * TOP_ISSUES_PAGE_SIZE;
        return sortedIssues.slice(start, start + TOP_ISSUES_PAGE_SIZE);
    }, [sortedIssues, topIssuesPage]);

    const recommendedSessions = useMemo(
        () => buildRecommendedSessions(sessions),
        [sessions],
    );

    // Prefer backend-aggregated top users (accurate all-window counts).
    // Fall back to session-pool computation only in demo mode.
    const topUsers = useMemo(() => {
        if (topUsersFromBackend.length > 0) {
            return topUsersFromBackend.map((entry) => {
                const identity = getTopUserIdentity(entry.latestSession);
                return {
                    userKey: identity.key,
                    displayName: identity.displayName,
                    copyValue: identity.copyValue,
                    sessions: [entry.latestSession],
                    firstSession: entry.latestSession,
                    latestSession: entry.latestSession,
                    replayCount: entry.sessionCount,
                    totalDurationSeconds: entry.totalDurationSeconds,
                    userFirstSeenAt: entry.userFirstSeenAt,
                };
            });
        }
        return buildTopUsers(sessions);
    }, [topUsersFromBackend, sessions]);

    const handleCopyTopUser = useCallback(async (value: string, userKey: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedTopUserKey(userKey);
            window.setTimeout(() => {
                setCopiedTopUserKey((current) => current === userKey ? null : current);
            }, 1600);
        } catch (error) {
            console.error('Failed to copy top user identifier:', error);
        }
    }, []);

    const handleCopyProjectKey = useCallback(async () => {
        if (!selectedProject?.publicKey) return;
        try {
            await navigator.clipboard.writeText(selectedProject.publicKey);
            setCopiedPublicKey(true);
            window.setTimeout(() => setCopiedPublicKey(false), 1600);
        } catch (error) {
            console.error('Failed to copy project public key:', error);
        }
    }, [selectedProject?.publicKey]);

    const handleCopyIntegrationPrompt = useCallback(async () => {
        try {
            const prompt = buildProjectAIIntegrationPrompt(selectedProject);
            await navigator.clipboard.writeText(prompt);
            setCopiedDocsPrompt(true);
            window.setTimeout(() => setCopiedDocsPrompt(false), 1600);
        } catch (error) {
            console.error('Failed to copy AI integration prompt:', error);
        }
    }, [selectedProject]);

    const anonymousNicknameStyleMap = useMemo(() => {
        const styleMap: Record<string, string> = {};
        let paletteIndex = 0;

        for (const rec of recommendedSessions) {
            const nickname = getAnonymousNickname(rec.session);
            if (!nickname || styleMap[nickname]) continue;
            styleMap[nickname] = ANONYMOUS_NICKNAME_STYLES[paletteIndex % ANONYMOUS_NICKNAME_STYLES.length];
            paletteIndex += 1;
        }

        return styleMap;
    }, [recommendedSessions]);

    const hasData = useMemo(() => {
        return (
            trendChartData.length > 0
            || (overviewObs?.dailyHealth?.length ?? 0) > 0
            || (deepMetrics?.dataWindow?.analyzedSessions ?? 0) > 0
            || (engagementTrends?.daily?.length ?? 0) > 0
            || (geoSummary?.countries?.length ?? 0) > 0
            || issues.length > 0
        );
    }, [trendChartData, overviewObs, deepMetrics, engagementTrends, geoSummary, issues.length]);

    if (isLoading && selectedProject?.id) {
        return <DashboardGhostLoader variant="general" />;
    }

    return (
        <div className="min-h-screen bg-[#f8fafc] bg-[linear-gradient(90deg,rgba(0,0,0,0.045)_1px,transparent_1px),linear-gradient(rgba(0,0,0,0.045)_1px,transparent_1px)] bg-[length:28px_28px] pb-12 font-sans text-slate-900">
            <DashboardPageHeader
                title="General"
                icon={<MessageSquareWarning className="h-5 w-5" />}
                iconColor="bg-[#cffafe]"
            >
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </div>
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1600px] space-y-5 px-3 py-4 sm:space-y-6 sm:px-5 sm:py-5">
                {!selectedProject?.id && (
                    <div className="border-2 border-black bg-[#f9a8d4] p-4 text-sm font-extrabold text-black shadow-neo">
                        Select a project to view general diagnostics.
                    </div>
                )}

                {!isLoading && partialError && (
                    <div className="border-2 border-black bg-[#f9a8d4] p-4 text-sm font-bold text-black shadow-neo-sm">
                        {partialError}
                    </div>
                )}

                {!isLoading && selectedProject?.id && !hasData && (
                    <div className="overflow-hidden border-2 border-black bg-white shadow-neo-lg">
                        <div className="border-b-2 border-black bg-[#86efac] px-4 py-4 sm:px-5">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase text-black">
                                <Info className="h-4 w-4 shrink-0" aria-hidden />
                                New project setup
                            </div>
                            <h3 className="mt-2 text-lg font-extrabold text-black">No analytics yet - connect your app first</h3>
                            <p className="mt-2 max-w-3xl text-sm font-semibold text-slate-700">
                                Once your first build sends data, this General dashboard will populate automatically.
                                Use these shortcuts to finish setup for either React Native or Swift.
                            </p>
                        </div>

                        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                            <button
                                type="button"
                                onClick={handleCopyProjectKey}
                                disabled={!selectedProject.publicKey}
                                className="flex items-center justify-center gap-2 border-2 border-black bg-[#86efac] px-4 py-2.5 text-xs font-extrabold text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#4ade80] hover:shadow-neo disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Copy className="h-4 w-4" />
                                {copiedPublicKey ? 'Public key copied' : 'Copy public key'}
                            </button>

                            <button
                                type="button"
                                onClick={handleCopyIntegrationPrompt}
                                className="flex items-center justify-center gap-2 border-2 border-black bg-[#60a5fa] px-4 py-2.5 text-xs font-extrabold text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#3b82f6] hover:shadow-neo"
                            >
                                <BookOpen className="h-4 w-4" />
                                {copiedDocsPrompt ? 'AI prompt copied' : 'Copy AI docs prompt'}
                            </button>

                            <a
                                href="/docs/reactnative/overview"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-center gap-2 border-2 border-black bg-[#f9a8d4] px-4 py-2.5 text-xs font-extrabold text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#f472b6] hover:shadow-neo"
                            >
                                <ExternalLink className="h-4 w-4" />
                                View React Native docs
                            </a>

                            <a
                                href="/docs/swift/overview"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-center gap-2 border-2 border-black bg-[#c4b5fd] px-4 py-2.5 text-xs font-extrabold text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#a78bfa] hover:shadow-neo"
                            >
                                <ExternalLink className="h-4 w-4" />
                                View Swift docs
                            </a>
                        </div>
                    </div>
                )}

                {!isLoading && hasData && (
                    <>
                        {momentumCards.length > 0 && (
                            <section>
                                <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                                    {momentumCards.map((card, index) => {
                                        const deltaClass = card.deltaValue === null || card.deltaValue === 0
                                            ? 'text-slate-600'
                                            : (card.positiveIsGood ? card.deltaValue > 0 : card.deltaValue < 0)
                                                ? 'text-emerald-700'
                                                : 'text-rose-700';

                                        return (
                                            <div key={card.label} className="min-w-0 border-2 border-black bg-white p-2.5 shadow-neo transition-all hover:-translate-y-0.5 hover:shadow-neo-lg sm:p-4">
                                                <div className="mb-2 h-1 border-2 border-black sm:mb-2.5 sm:h-1.5" style={{ backgroundColor: RETRO_CARD_ACCENTS[index % RETRO_CARD_ACCENTS.length] }} />
                                                <div className="dashboard-label break-words text-slate-700">{card.label}</div>
                                                <div className="mt-1.5 break-words text-[1.35rem] font-extrabold leading-none text-black sm:mt-2 sm:text-3xl">{card.value}</div>
                                                <div className={`mt-1.5 inline-flex border-2 border-black bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase shadow-neo-sm sm:mt-2 sm:px-2 sm:py-1 sm:text-[11px] ${deltaClass}`}>
                                                    {card.delta}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        <div className="soft-border-scope space-y-4 sm:space-y-5">
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                                <GA4Card title="User activity over time" className="xl:col-span-5" accentClassName="bg-[#67e8f9]">
                                <div className="mb-3 grid grid-cols-2 gap-3 text-left">
                                    <div>
                                        <span className="dashboard-label">Latest DAU</span>
                                        <div className="dashboard-value-lg">{formatCompact(activitySummary.latestDau)}</div>
                                    </div>
                                    <div>
                                        <span className="dashboard-label">Avg DAU</span>
                                        <div className="dashboard-value-md">{formatCompact(activitySummary.avgDau)}</div>
                                    </div>
                                    <div>
                                        <span className="dashboard-label">Peak MAU</span>
                                        <div className="dashboard-value-md">{formatCompact(activitySummary.peakMau)}</div>
                                    </div>
                                    <div>
                                        <span className="dashboard-label">Latest sessions</span>
                                        <div className="dashboard-value-md">{formatCompact(activitySummary.latestSessions)}</div>
                                    </div>
                                </div>
                                <div className="h-[130px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={trendChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip labelFormatter={(value) => formatDateLabel(String(value))} />
                                            <Line type="monotone" dataKey="sessions" stroke="#f9a8d4" strokeWidth={1.75} dot={false} name="Sessions" isAnimationActive={false} />
                                            <Line type="monotone" dataKey="dau" stroke="#1a73e8" strokeWidth={2} dot={false} name="DAU" isAnimationActive={false} />
                                            <Line type="monotone" dataKey="mau" stroke="#34a853" strokeWidth={1.5} dot={false} name="MAU" isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                                </GA4Card>

                                <GA4Card title="Active users snapshot" className="xl:col-span-3" accentClassName="bg-[#86efac]">
                                <div className="mt-1 text-center">
                                    <div className="text-3xl font-extrabold leading-none text-black">{formatCompact(activitySummary.latestDau)}</div>
                                    <div className="dashboard-label mt-2">Latest daily active users</div>
                                    <div className="mt-1 text-[11px] font-bold text-slate-500">Estimated {formatCompact(activeUsersPerMinute)} users/min</div>
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
                                            <Area type="monotone" dataKey="dau" stroke="#1a73e8" fill="#dbeafe" strokeWidth={2} isAnimationActive={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="mt-3 border-t border-slate-100 pt-3">
                                    <div className="mb-2 flex justify-between text-[10px] font-bold uppercase text-slate-400">
                                        <span>TOP COUNTRIES</span>
                                        <span>SESSIONS</span>
                                    </div>
                                    {topCountries.length > 0 ? topCountries.map((country) => (
                                        <div key={country.country} className="flex justify-between text-xs font-bold text-slate-700 py-0.5">
                                            <span>{country.country}</span>
                                            <span className="font-extrabold text-black">{formatCompact(country.count)}</span>
                                        </div>
                                    )) : (
                                        <div className="text-[10px] font-bold text-slate-400">No geographic activity available for this filter.</div>
                                    )}
                                </div>

                                <div className="mt-3 text-right">
                                    <Link to={`${pathPrefix}/analytics/geo`} className="text-[11px] font-bold text-[#2563eb] transition-colors hover:text-black">
                                        View geographic activity →
                                    </Link>
                                </div>
                                </GA4Card>

                                <GA4Card title="Active users by app version" className="xl:col-span-4" accentClassName="bg-[#c4b5fd]">
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
                                                    isAnimationActive={false}
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
                                    <Link to={`${pathPrefix}/analytics/devices`} className="text-[11px] font-bold text-[#2563eb] transition-colors hover:text-black">
                                        View app versions →
                                    </Link>
                                </div>
                                </GA4Card>

                                <GA4Card title="User engagement mix" className="xl:col-span-12" accentClassName="bg-[#67e8f9]">
                                <div className="mb-3 grid grid-cols-2 gap-3 text-left">
                                    <div>
                                        <span className="dashboard-label">Latest tracked users</span>
                                        <div className="dashboard-value-lg">
                                            {latestEngagementMix ? formatCompact(latestEngagementMix.total) : '0'}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="dashboard-label">Engaged share</span>
                                        <div className="dashboard-value-md">
                                            {latestEngagementMix ? `${latestEngagementMix.engagedShare.toFixed(1)}%` : 'N/A'}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="dashboard-label">Loyalists</span>
                                        <div className="dashboard-value-md">
                                            {latestEngagementMix ? formatCompact(latestEngagementMix.loyalists) : '0'}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="dashboard-label">Bouncers</span>
                                        <div className="dashboard-value-md">
                                            {latestEngagementMix ? formatCompact(latestEngagementMix.bouncers) : '0'}
                                        </div>
                                    </div>
                                </div>

                                {engagementMixChartData.length > 0 ? (
                                    <>
                                        <div className="h-[180px]">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={engagementMixChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                    <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                                    <YAxis tick={{ fontSize: 10 }} />
                                                    <Tooltip
                                                        labelFormatter={(value) => formatDateLabel(String(value))}
                                                        formatter={(value: number | undefined, name: string | undefined) => [formatCompact(value ?? 0), name ?? 'Users']}
                                                    />
                                                    {ENGAGEMENT_SEGMENTS.map((segment) => (
                                                        <Area
                                                            key={segment.key}
                                                            type="monotone"
                                                            dataKey={segment.key}
                                                            stackId="segments"
                                                            stroke={segment.color}
                                                            fill={segment.color}
                                                            strokeWidth={1.5}
                                                            fillOpacity={0.95}
                                                            dot={false}
                                                            name={segment.label}
                                                            isAnimationActive={false}
                                                        />
                                                    ))}
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="mt-3 flex flex-wrap gap-3">
                                            {ENGAGEMENT_SEGMENTS.slice().reverse().map((segment) => (
                                                <span key={segment.key} className="flex items-center gap-1 text-[10px] text-slate-500">
                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                                                    {segment.label}
                                                </span>
                                            ))}
                                        </div>

                                        <div className="mt-2 text-right">
                                            <Link to={`${pathPrefix}/analytics/journeys`} className="text-[11px] font-bold text-[#2563eb] transition-colors hover:text-black">
                                                View journey analytics →
                                            </Link>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-slate-400">
                                        No engagement segment rollups for this filter.
                                    </div>
                                )}
                                </GA4Card>
                            </div>

                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                            <GA4Card title="App stability overview" className="xl:col-span-4" accentClassName="bg-[#f9a8d4]">
                                <div className="-mx-1 overflow-x-auto px-1">
                                    <table className="mt-1 min-w-[360px] w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-200 text-[11px] text-black">
                                                <th className="py-2 text-left font-medium">APP</th>
                                                <th className="py-2 text-right font-medium">CRASH-FREE</th>
                                                <th className="py-2 text-right font-medium">ANR-FREE</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {platformBreakdown.length > 0 ? (
                                                platformBreakdown.map((platformData) => (
                                                    <tr key={platformData.platform} className="border-b border-slate-50">
                                                        <td className="py-2 text-slate-700 capitalize">
                                                            {selectedProject?.name ?? 'App'} ({platformData.platform})
                                                        </td>
                                                        <td className="py-2 text-right text-slate-700 font-medium">
                                                            {platformData.crashFreeSessionRate !== null ? `${platformData.crashFreeSessionRate.toFixed(1)}%` : 'N/A'}
                                                        </td>
                                                        <td className="py-2 text-right text-slate-700 font-medium">
                                                            {platformData.anrFreeSessionRate !== null ? `${platformData.anrFreeSessionRate.toFixed(1)}%` : 'N/A'}
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr className="border-b border-slate-50">
                                                    <td className="py-2 text-slate-700">{selectedProject?.name ?? 'App'}</td>
                                                    <td className="py-2 text-right text-slate-700 font-medium">
                                                        {crashFreeRate !== null ? `${crashFreeRate.toFixed(1)}%` : 'N/A'}
                                                    </td>
                                                    <td className="py-2 text-right text-slate-700 font-medium">
                                                        {anrFreeRate !== null ? `${anrFreeRate.toFixed(1)}%` : 'N/A'}
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </GA4Card>

                            <GA4Card title="Average engagement time per active user" className="xl:col-span-4" accentClassName="bg-[#67e8f9]">
                                <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-3">
                                    <div>
                                        <div className="dashboard-value-lg">{avgEngagementTime}</div>
                                    </div>
                                    <div>
                                        <span className="dashboard-label">Engaged user share</span>
                                        <div className="dashboard-value-md">
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
                                            <Line type="monotone" dataKey="engagementTime" stroke="#1a73e8" strokeWidth={2} dot={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </GA4Card>

                            <GA4Card title="User retention" className="xl:col-span-4" accentClassName="bg-[#86efac]">
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
                                            <Bar dataKey="retention" fill="#1a73e8" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-1 text-center text-[10px] text-slate-400">
                                    Last {retentionChartData.length} points
                                </div>
                            </GA4Card>

                            <GA4Card title="Retention cohorts" className="xl:col-span-12" accentClassName="bg-[#c4b5fd]">
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
                                            {retentionCohortTableRows.map((row) => (
                                                <tr key={row.weekStartKey}>
                                                    <td className="whitespace-nowrap py-1 pr-2 align-middle text-slate-700">
                                                        <div className="font-semibold">{row.label}</div>
                                                        <div className="text-[10px] text-slate-500">{formatCompact(row.users)} users</div>
                                                    </td>
                                                    {row.retention.map((value, weekIdx) => (
                                                        <td key={`${row.weekStartKey}-${weekIdx}`} className="px-1 py-1">
                                                            <div
                                                                className="flex h-8 min-w-[62px] items-center justify-center border border-black text-[10px] font-bold"
                                                                style={getCohortCellStyle(value, weekIdx)}
                                                            >
                                                                {value === null ? '—' : `${value.toFixed(1)}%`}
                                                            </div>
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                            {retentionCohortTableRows.length === 0 && (
                                                <tr>
                                                    <td colSpan={RETENTION_COHORT_WEEKS + 1} className="py-5 text-center text-slate-400">
                                                        Not enough user-level replay sessions for cohort retention yet.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-2 text-[10px] text-slate-400">
                                    Week 0 = first active week for that cohort
                                </div>
                            </GA4Card>
                            </div>

                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                            <GA4Card title="Custom Events" className="xl:col-span-5" accentClassName="bg-[#f9a8d4]">
                                {customEvents.length > 0 ? (
                                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                        {customEvents.map((event) => {
                                            const width = maxCustomEventCount > 0
                                                ? Math.max(8, Math.round((event.count / maxCustomEventCount) * 100))
                                                : 0;

                                            return (
                                                <div key={event.name} className="py-1">
                                                    <div className="mb-1 flex justify-between text-xs">
                                                        <span className="truncate text-slate-700" title={event.name}>{event.name}</span>
                                                        <span className="font-semibold text-slate-900">{formatCompact(event.count)}</span>
                                                    </div>
                                                    <div className="h-2 border border-black bg-white">
                                                        <div className="h-full bg-[#5dadec]" style={{ width: `${width}%` }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="py-4 text-center text-xs text-slate-400">
                                        No custom events observed for this filter.
                                    </div>
                                )}
                            </GA4Card>

                            <GA4Card title="Regional user reach" className="xl:col-span-7" accentClassName="bg-[#c4b5fd]">
                                {countryUsersByRegion.countryKeys.length > 0 ? (
                                    <>
                                        <div className="h-[220px]">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={countryUsersByRegion.rows} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                    <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                                                    <Tooltip
                                                        labelFormatter={(value) => formatDateLabel(String(value))}
                                                        formatter={(value: number | undefined, name: string | undefined) => [formatCompact(value ?? 0), name ?? 'Users']}
                                                    />
                                                    {countryUsersByRegion.countryKeys.map((country, index) => (
                                                        <Line
                                                            key={country}
                                                            type="monotone"
                                                            dataKey={country}
                                                            stroke={COUNTRY_LINE_COLORS[index % COUNTRY_LINE_COLORS.length]}
                                                            strokeWidth={2}
                                                            dot={false}
                                                            name={country}
                                                            isAnimationActive={false}
                                                        />
                                                    ))}
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="mt-3 flex flex-wrap gap-3">
                                            {countryUsersByRegion.countryKeys.map((country, index) => (
                                                <span key={country} className="flex items-center gap-1 text-[10px] text-slate-500">
                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COUNTRY_LINE_COLORS[index % COUNTRY_LINE_COLORS.length] }} />
                                                    {country}
                                                </span>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-slate-400">
                                        No country-level user activity available for this filter.
                                    </div>
                                )}
                            </GA4Card>
                            </div>

                            <section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h2 className="border-2 border-black bg-[#fb7185] px-3 py-1.5 text-base font-extrabold text-black shadow-neo-sm">Top Issues</h2>
                                <div className="flex flex-wrap items-center gap-2">
                                    {topIssuesTotalPages > 1 && (
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setTopIssuesPage((prev) => Math.max(0, prev - 1))}
                                                disabled={topIssuesPage === 0}
                                                className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-white text-black shadow-neo-sm transition hover:-translate-y-0.5 hover:bg-[#f4f4f5] hover:shadow-neo disabled:pointer-events-none disabled:opacity-40"
                                                aria-label="Previous issues page"
                                            >
                                                <ChevronLeft className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setTopIssuesPage((prev) => Math.min(topIssuesTotalPages - 1, prev + 1))}
                                                disabled={topIssuesPage >= topIssuesTotalPages - 1}
                                                className="inline-flex h-8 w-8 items-center justify-center border-2 border-black bg-white text-black shadow-neo-sm transition hover:-translate-y-0.5 hover:bg-[#f4f4f5] hover:shadow-neo disabled:pointer-events-none disabled:opacity-40"
                                                aria-label="Next issues page"
                                            >
                                                <ChevronRight className="h-4 w-4" />
                                            </button>
                                        </div>
                                    )}
                                    <NeoBadge variant="neutral" size="sm" className="rounded-none border-black bg-white text-black shadow-neo-sm">
                                        Page {sortedIssues.length === 0 ? '0/0' : `${topIssuesPage + 1}/${topIssuesTotalPages}`}
                                    </NeoBadge>
                                    <NeoBadge variant="neutral" size="sm" className="rounded-none border-black bg-white text-black shadow-neo-sm">
                                        {sortedIssues.length} total
                                    </NeoBadge>
                                </div>
                            </div>

                            {topIssues.length === 0 ? (
                                <EmptyStateCard
                                    title="No issues in this window"
                                    subtitle="Issue groups appear here as they are detected."
                                />
                            ) : (
                                <div className="overflow-hidden border-2 border-black bg-white shadow-neo">
                                    <div className="divide-y-2 divide-black">
                                        {topIssues.map((issue) => {
                                            const issueColor = ISSUE_TYPE_COLOR[issue.issueType] || '#64748b';
                                            return (
                                                <div
                                                    key={issue.id}
                                                    className="flex flex-col gap-3 px-5 py-3.5 transition-colors hover:bg-[#f8fafc] md:flex-row md:items-center"
                                                >
                                                    <NeoBadge variant={ISSUE_TYPE_BADGE_VARIANT[issue.issueType] || 'neutral'} size="sm" className="rounded-none border-black font-bold uppercase shadow-neo-sm">
                                                        {issue.issueType.replace('_', ' ')}
                                                    </NeoBadge>

                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-extrabold text-black">
                                                            {issue.title}
                                                        </div>
                                                        <div className="truncate text-[11px] text-slate-500 mt-0.5">
                                                            {issue.subtitle || issue.culprit || '—'}
                                                        </div>
                                                    </div>

                                                    <div className="hidden md:block shrink-0">
                                                        <IssueSparkline dailyEvents={issue.dailyEvents} color={issueColor} />
                                                    </div>

                                                    <div className="hidden shrink-0 items-center gap-4 text-right sm:flex">
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase text-slate-400">Events</div>
                                                            <div className="text-sm font-black text-slate-900">{formatCompact(issue.eventCount)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase text-slate-400">Users</div>
                                                            <div className="text-sm font-black text-slate-900">{formatCompact(issue.userCount)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold uppercase text-slate-400">Last</div>
                                                            <div className="text-xs font-bold text-slate-700">{formatLastSeen(issue.lastSeen)}</div>
                                                        </div>
                                                    </div>

                                                    <div className="flex w-full flex-wrap items-center gap-2 shrink-0 md:w-auto">
                                                        <Link
                                                            to={`${pathPrefix}/general/${issue.id}`}
                                                            className="border-2 border-black bg-white px-2.5 py-1 text-[11px] font-bold text-black shadow-neo-sm transition hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo"
                                                        >
                                                            View
                                                        </Link>
                                                        {issue.sampleSessionId && (
                                                            <Link
                                                                to={`${pathPrefix}/sessions/${issue.sampleSessionId}`}
                                                                className="border-2 border-black bg-[#67e8f9] px-2.5 py-1 text-[11px] font-bold text-black shadow-neo-sm transition hover:-translate-y-0.5 hover:bg-[#22d3ee] hover:shadow-neo"
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

                            <section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="border-2 border-black bg-[#86efac] px-3 py-1.5 text-base font-extrabold text-black shadow-neo-sm">Top Users</h2>
                                </div>
                                <NeoBadge variant="info" size="sm" className="rounded-none border-black bg-white text-black shadow-neo-sm">
                                    {isHeavyLoading ? '…' : `${topUsers.length}/20 users`}
                                </NeoBadge>
                            </div>

                            {isHeavyLoading ? (
                                <div className="h-[180px] animate-pulse border-2 border-black bg-white shadow-neo" />
                            ) : topUsers.length === 0 ? (
                                <EmptyStateCard
                                    title="No top users yet"
                                    subtitle="Top users will appear once replay data is available in this time window."
                                />
                            ) : (
                                <div className="relative">
                                    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-12 bg-gradient-to-l from-[#f8fafc] via-[#f8fafc]/80 to-transparent sm:block" />
                                    <div className="overflow-x-auto pb-3">
                                        <div className="flex min-w-full snap-x snap-mandatory gap-3 pl-1 pr-2 sm:min-w-max sm:pl-3 sm:pr-4">
                                            {topUsers.map((user, index) => {
                                        const session = user.latestSession;
                                        const firstSession = user.firstSession;
                                        const displayName = truncateUserLabel(user.displayName);
                                        const geoDisplay = formatGeoDisplay(session.geoLocation);
                                        const isCopied = copiedTopUserKey === user.userKey;
                                        const iconStyle = getTopUserIconStyle(user.userKey);
                                        const platforms = [...new Set(user.sessions.map((s) => s.platform).filter(Boolean))];
                                        const appVersions = [...new Set(user.sessions.map((s) => s.appVersion).filter(Boolean))];
                                        const devices = [...new Set(user.sessions.map((s) => s.deviceModel).filter(Boolean).map((model) => formatDeviceModel(model, 'Unknown device')))];
                                        const platformLabel = platforms.length > 1 ? `${platforms.length} platforms` : (platforms[0] || 'unknown');
                                        const versionLabel = appVersions.length > 1 ? `${appVersions.length} versions` : (appVersions[0] ? `v${appVersions[0]}` : 'unknown version');
                                        const deviceLabel = devices.length > 1 ? `${devices.length} devices` : (devices[0] || 'Unknown device');

                                        return (
                                            <article
                                                key={user.userKey}
                                                className="group min-w-[320px] w-[calc(100vw-4rem)] max-w-[420px] snap-start border-2 border-black bg-white p-3 shadow-neo transition-all hover:-translate-y-1 hover:shadow-neo-lg sm:w-[360px] lg:w-[400px]"
                                            >
                                                <div className="mb-3 h-2 border-2 border-black" style={{ backgroundColor: RETRO_CARD_ACCENTS[index % RETRO_CARD_ACCENTS.length] }} />
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${iconStyle}`}>
                                                                <User size={15} className="stroke-[2.4]" />
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopyTopUser(user.copyValue, user.userKey)}
                                                                className="inline-flex min-w-0 max-w-full items-center gap-1.5 border-2 border-black bg-white px-2 py-1 text-left font-mono text-[11px] font-black text-slate-900 shadow-neo-sm transition hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo"
                                                                title={`Copy ${user.displayName}`}
                                                                aria-label={`Copy ${user.displayName}`}
                                                            >
                                                                <span className="truncate">{displayName}</span>
                                                                {isCopied ? <Check size={13} className="shrink-0 text-emerald-600" /> : <Copy size={13} className="shrink-0 text-slate-400" />}
                                                            </button>
                                                        </div>
                                                        <div className="mt-2 text-[11px] text-slate-500">
                                                            Last seen {formatLastSeen(session.startedAt)}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => navigate(`${pathPrefix}/sessions/${session.id}`)}
                                                        className="inline-flex items-center gap-1.5 border-2 border-black bg-black px-3 py-2 text-[11px] font-bold text-white shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-neo active:translate-y-0"
                                                    >
                                                        Open latest
                                                        <ChevronRight size={13} className="shrink-0" />
                                                    </button>
                                                </div>

                                                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] text-slate-600">
                                                    <div>
                                                        <div className="text-[10px] font-semibold uppercase text-slate-400">Country</div>
                                                        <div className="mt-0.5 flex items-center gap-2 truncate font-semibold text-slate-800" title={geoDisplay.fullLabel}>
                                                            <span className="text-base leading-none">{geoDisplay.flagEmoji}</span>
                                                            <span className="truncate">{geoDisplay.fullLabel}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-semibold uppercase text-slate-400">Total Sessions</div>
                                                        <div className="mt-0.5 font-semibold text-slate-800">{user.replayCount.toLocaleString()}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-semibold uppercase text-slate-400">First Appeared</div>
                                                        <div className="mt-0.5 font-semibold text-slate-800">
                                                            {new Date(user.userFirstSeenAt ?? firstSession.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-semibold uppercase text-slate-400">Last Appeared</div>
                                                        <div className="mt-0.5 font-semibold text-slate-800">
                                                            {new Date(session.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-semibold uppercase text-slate-400">Total Time</div>
                                                        <div className="mt-0.5 font-semibold text-slate-800">{formatDuration(user.totalDurationSeconds)}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-semibold uppercase text-slate-400">Latest Device</div>
                                                        <div className="mt-0.5 truncate font-semibold text-slate-800" title={deviceLabel}>
                                                            {deviceLabel}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="mt-3 flex flex-col gap-3 border-t-2 border-black pt-3 sm:flex-row sm:items-start sm:justify-between">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-[11px] font-bold text-[#2563eb]" title={deviceLabel}>
                                                            {deviceLabel}
                                                        </div>
                                                        <div className="mt-1 text-[10px] text-slate-500">
                                                            First seen {formatLastSeen(user.userFirstSeenAt ?? firstSession.startedAt)} and last seen {formatLastSeen(session.startedAt)}
                                                        </div>
                                                        <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
                                                            <span className="inline-flex items-center border border-black bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                                                                {platformLabel}
                                                            </span>
                                                            <span className="inline-flex items-center border border-black bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                                                {versionLabel}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="shrink-0 self-end sm:self-auto">
                                                        <MiniSessionCard
                                                            session={{
                                                                id: session.id,
                                                                deviceModel: session.deviceModel,
                                                                createdAt: session.startedAt,
                                                                coverPhotoUrl:
                                                                    hasSuccessfulRecording(session)
                                                                        ? `/api/sessions/cover/${session.id}`
                                                                        : null,
                                                            }}
                                                            onClick={() => navigate(`${pathPrefix}/sessions/${session.id}`)}
                                                            size="xs"
                                                            showMeta={false}
                                                            className="p-0"
                                                        />
                                                    </div>
                                                </div>
                                            </article>
                                        );
                                    })}
                                        </div>
                                    </div>
                                </div>
                            )}
                            </section>

                            <section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="border-2 border-black bg-[#67e8f9] px-3 py-1.5 text-base font-extrabold text-black shadow-neo-sm">Recommended Sessions</h2>
                                    <p className="mt-2 text-xs font-semibold text-slate-600">
                                        Mixed user segments: new, returning, anonymous, platform-specific, and risk-heavy journeys.
                                    </p>
                                </div>
                                <NeoBadge variant="neutral" size="sm" className="rounded-none border-black bg-white text-black shadow-neo-sm">
                                    {isHeavyLoading ? '…' : `${recommendedSessions.length} picks`}
                                </NeoBadge>
                            </div>

                            {isHeavyLoading ? (
                                <div className="h-[200px] animate-pulse border-2 border-black bg-white shadow-neo" />
                            ) : recommendedSessions.length === 0 ? (
                                <EmptyStateCard
                                    title="No recommended sessions"
                                    subtitle="Sessions will appear here once replay data is available in this time window."
                                />
                            ) : (
                                <div className="relative">
                                    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-12 bg-gradient-to-l from-[#f8fafc] via-[#f8fafc]/80 to-transparent sm:block" />
                                    <div className="overflow-x-auto pb-3">
                                        <div className="flex min-w-full snap-x snap-mandatory gap-3 pl-1 pr-2 sm:min-w-max sm:pl-3 sm:pr-4">
                                            {recommendedSessions.map((rec, index) => {
                                                const anonymousNickname = getAnonymousNickname(rec.session);
                                                const nicknameStyle = anonymousNickname
                                                    ? (anonymousNicknameStyleMap[anonymousNickname] || getAnonymousNicknameStyle(anonymousNickname))
                                                    : '';
                                                const locationLabel = getSessionLocationLabel(rec.session);
                                                const audienceLabel = rec.session.userId ? 'Identified user' : 'Device-only user';
                                                return (
                                                    <article
                                                        key={rec.session.id}
                                                        className="group min-w-[280px] w-[calc(100vw-4rem)] max-w-[360px] snap-start border-2 border-black bg-white p-3 shadow-neo transition-all hover:-translate-y-1 hover:shadow-neo-lg sm:w-[320px] lg:w-[360px]"
                                                    >
                                                        <div className="mb-3 h-2 border-2 border-black" style={{ backgroundColor: RETRO_CARD_ACCENTS[(index + 1) % RETRO_CARD_ACCENTS.length] }} />
                                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <span
                                                                    className={`inline-flex items-center border-2 border-black px-2 py-1 text-[10px] font-bold uppercase shadow-neo-sm ${RECOMMENDED_SESSION_PRIORITY_STYLES[rec.priority]}`}
                                                                >
                                                                    {rec.category}
                                                                </span>
                                                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                                    {anonymousNickname ? (
                                                                        <span
                                                                            className={`inline-flex max-w-[200px] items-center truncate border px-2 py-0.5 text-[10px] font-bold ${nicknameStyle}`}
                                                                            title={anonymousNickname}
                                                                        >
                                                                            {anonymousNickname}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center border border-black bg-[#f4f4f5] px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                                                                            {audienceLabel}
                                                                        </span>
                                                                    )}
                                                                    <span className="inline-flex items-center border border-black bg-[#f4f4f5] px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                                                                        {rec.session.platform.toUpperCase()}
                                                                    </span>
                                                                </div>
                                                                <div className="mt-1 truncate text-[11px] text-slate-500">{locationLabel}</div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => navigate(`${pathPrefix}/sessions/${rec.session.id}`)}
                                                                className="inline-flex items-center gap-1.5 border-2 border-black bg-black px-3 py-2 text-[11px] font-bold text-white shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-neo active:translate-y-0"
                                                            >
                                                                Open
                                                                <ChevronRight size={13} className="shrink-0" />
                                                            </button>
                                                        </div>

                                                        <p className="mt-2 min-h-[2rem] text-xs leading-relaxed text-slate-600">
                                                            {rec.reason}
                                                        </p>

                                                        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-3">
                                                            <div className="border border-black bg-[#f8fafc] px-2 py-1.5">
                                                                <div className="font-bold text-slate-500">Duration</div>
                                                                <div className="font-semibold text-slate-700">{formatDuration(rec.session.durationSeconds || 0)}</div>
                                                            </div>
                                                            <div className="border border-black bg-[#f8fafc] px-2 py-1.5">
                                                                <div className="font-bold text-slate-500">Signals</div>
                                                                <div className="font-black text-black text-xl">{issueSignalsForSession(rec.session)}</div>
                                                            </div>
                                                            <div className="border border-black bg-[#f8fafc] px-2 py-1.5">
                                                                <div className="font-bold text-slate-500">Last Seen</div>
                                                                <div className="font-black text-black text-xl">{formatLastSeen(rec.session.startedAt)}</div>
                                                            </div>
                                                        </div>

                                                        <div className="mt-3 flex flex-col gap-3 border-t-2 border-black pt-3 sm:flex-row sm:items-start sm:justify-between">
                                                            <div className="min-w-0 flex-1">
                                                                <div
                                                                    className="truncate text-[11px] font-bold text-[#2563eb] hover:underline"
                                                                    title={rec.session.deviceModel}
                                                                >
                                                                    {formatDeviceModel(rec.session.deviceModel, 'Unknown device')}
                                                                </div>
                                                                <div className="text-[10px] text-slate-500">
                                                                    {formatLastSeen(rec.session.startedAt)}
                                                                </div>
                                                                <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
                                                                    {rec.session.appVersion && (
                                                                        <span className="inline-flex items-center border border-black bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                                                            v{rec.session.appVersion}
                                                                        </span>
                                                                    )}
                                                                    {rec.session.networkType && (
                                                                        <span className="inline-flex items-center border border-black bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                                                            {rec.session.networkType}
                                                                        </span>
                                                                    )}
                                                                    <span className="inline-flex items-center border border-black bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                                                                        {rec.session.platform}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <MiniSessionCard
                                                                session={{
                                                                    id: rec.session.id,
                                                                    deviceModel: rec.session.deviceModel,
                                                                    createdAt: rec.session.startedAt,
                                                                    coverPhotoUrl:
                                                                        hasSuccessfulRecording(rec.session)
                                                                            ? `/api/sessions/cover/${rec.session.id}`
                                                                            : null,
                                                                }}
                                                                onClick={() =>
                                                                    navigate(`${pathPrefix}/sessions/${rec.session.id}`)
                                                                }
                                                                size="xs"
                                                                showMeta={false}
                                                                className="self-end p-0 sm:self-auto"
                                                            />
                                                        </div>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                            </section>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default GeneralOverview;
