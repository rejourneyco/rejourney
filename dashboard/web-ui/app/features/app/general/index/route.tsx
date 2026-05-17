import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BookOpen,
    ChevronLeft,
    ChevronRight,
    Check,
    Copy,
    ExternalLink,
    Globe2,
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
    getSessionsPaginated,
    GeoSummary,
    GrowthObservability,
    InsightsTrends,
    ObservabilityDeepMetrics,
    RetentionCohortRow,
    TopUserEntry,
    UserEngagementTrends,
} from '~/shared/api/client';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { useSharedPlatformLens, platformLensToSessionPlatform } from '~/shared/hooks/useSharedPlatformLens';
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
        + (session.deadTapCount || 0)
        + (session.apiErrorCount || 0)
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

const MAX_RECOMMENDED_SESSIONS = 8;
const MIN_RECOMMENDED_SESSION_SCORE = 70;
const MAX_RECOMMENDATIONS_PER_CATEGORY = 2;

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

    type RecommendationCandidate = RecommendedSession & {
        categoryKey: string;
        score: number;
    };

    const candidates: RecommendationCandidate[] = [];
    const byMostRecent = (a: RecordingSession, b: RecordingSession) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();

    const userSessionCounts = new Map<string, { count: number; sessions: RecordingSession[] }>();
    for (const s of pool) {
        const key = sessionUserKey(s);
        const existing = userSessionCounts.get(key);
        if (!existing) {
            userSessionCounts.set(key, { count: 1, sessions: [s] });
        } else {
            existing.count += 1;
            existing.sessions.push(s);
        }
    }

    const startedAtMs = (session: RecordingSession) => {
        const value = new Date(session.startedAt).getTime();
        return Number.isFinite(value) ? value : 0;
    };

    const recencyBonus = (session: RecordingSession): number => {
        const ageHours = (Date.now() - startedAtMs(session)) / 36e5;
        if (!Number.isFinite(ageHours) || ageHours < 0) return 6;
        if (ageHours <= 1) return 6;
        if (ageHours <= 24) return 4;
        if (ageHours <= 168) return 2;
        return 0;
    };

    const issueWeight = (session: RecordingSession): number => (
        ((session.crashCount || 0) * 45)
        + ((session.anrCount || 0) * 42)
        + ((session.errorCount || 0) * 14)
        + ((session.apiErrorCount || 0) * 9)
        + ((session.rageTapCount || 0) * 16)
        + ((session.deadTapCount || 0) * 12)
    );

    const activityCount = (session: RecordingSession): number => (
        (session.touchCount || 0)
        + (session.scrollCount || 0)
        + (session.gestureCount || 0)
        + (session.inputCount || 0)
    );

    const screenCount = (session: RecordingSession): number => (
        Array.isArray(session.screensVisited) ? session.screensVisited.length : 0
    );

    const engagementWatchScore = (session: RecordingSession): number => {
        const duration = session.durationSeconds || 0;
        const interactions = activityCount(session);
        const screens = screenCount(session);
        const interactionScore = session.interactionScore || 0;
        const explorationScore = session.explorationScore || 0;

        if (duration < 120) return 0;
        if (interactionScore < 45 && interactions < 20 && screens < 4 && explorationScore < 6) return 0;

        return Math.min(34, duration / 18)
            + Math.min(28, interactionScore / 3)
            + Math.min(18, interactions / 3)
            + Math.min(14, screens * 3)
            + Math.min(12, explorationScore * 1.5);
    };

    const recommendationPriority = (score: number): RecommendedSession['priority'] => {
        if (score >= 112) return 'critical';
        if (score >= 82) return 'high';
        return 'watch';
    };

    const addCandidate = (
        session: RecordingSession,
        category: string,
        reason: string,
        rawScore: number,
        priority?: RecommendedSession['priority'],
    ) => {
        const score = Math.round(rawScore + recencyBonus(session));
        if (score < MIN_RECOMMENDED_SESSION_SCORE) return;
        candidates.push({
            session,
            category,
            categoryKey: category.toLowerCase(),
            priority: priority || recommendationPriority(score),
            reason,
            score,
        });
    };

    for (const session of pool) {
        const signals = issueSignalsForSession(session);
        const weightedIssues = issueWeight(session);
        const duration = session.durationSeconds || 0;
        const apiTotal = session.apiTotalCount || 0;
        const apiErrors = session.apiErrorCount || 0;
        const apiAvgMs = session.apiAvgResponseMs || 0;
        const apiErrorRate = apiTotal > 0 ? apiErrors / apiTotal : 0;
        const interactions = activityCount(session);
        const screens = screenCount(session);
        const network = String(session.networkType || '').toLowerCase();
        const constrainedNetwork =
            Boolean(session.isConstrained)
            || Boolean(session.isExpensive)
            || session.cellularGeneration === '2G'
            || session.cellularGeneration === '3G'
            || network.includes('2g')
            || network.includes('3g');
        const userGroup = userSessionCounts.get(sessionUserKey(session));
        const isFirstKnownSession = Boolean(session.isFirstSession) || (userGroup?.count || 0) <= 1;

        if ((session.crashCount || 0) > 0) {
            addCandidate(
                session,
                isFirstKnownSession ? 'First Session Crash' : 'Crash Impact',
                isFirstKnownSession
                    ? 'Crash detected on a first-time user session'
                    : `${session.crashCount} crash signal${session.crashCount === 1 ? '' : 's'} in this replay`,
                104 + (session.crashCount || 0) * 34 + Math.min(12, duration / 30),
                'critical',
            );
        }

        if ((session.anrCount || 0) > 0) {
            addCandidate(
                session,
                'ANR Freeze Session',
                `${session.anrCount} freeze signal${session.anrCount === 1 ? '' : 's'} captured`,
                100 + (session.anrCount || 0) * 32 + Math.min(10, duration / 45),
                'critical',
            );
        }

        if (signals >= 3 || weightedIssues >= 50) {
            addCandidate(
                session,
                'High Friction Journey',
                `${signals} issue signal${signals === 1 ? '' : 's'} detected in this replay`,
                56 + weightedIssues + Math.min(12, duration / 45),
            );
        }

        if (apiErrors > 0 && (apiErrors >= 2 || apiErrorRate >= 0.1 || weightedIssues >= 50)) {
            addCandidate(
                session,
                'API Failure Spike',
                `${apiErrors} failing API call${apiErrors === 1 ? '' : 's'}${apiTotal > 0 ? ` across ${apiTotal} request${apiTotal === 1 ? '' : 's'}` : ''}`,
                68 + apiErrors * 12 + Math.min(28, apiErrorRate * 100),
            );
        }

        if ((session.rageTapCount || 0) >= 2) {
            addCandidate(
                session,
                'Rage Input Pattern',
                `${session.rageTapCount} rage tap signal${session.rageTapCount === 1 ? '' : 's'} found`,
                66 + (session.rageTapCount || 0) * 18 + Math.min(10, interactions / 5),
            );
        }

        if ((session.deadTapCount || 0) >= 2) {
            addCandidate(
                session,
                'Dead Tap Pattern',
                `${session.deadTapCount} dead tap signal${session.deadTapCount === 1 ? '' : 's'} found`,
                62 + (session.deadTapCount || 0) * 15 + Math.min(10, interactions / 5),
            );
        }

        if (
            apiAvgMs > 0
            && (
                (apiTotal >= 3 && apiAvgMs >= 1200)
                || (apiTotal >= 10 && apiAvgMs >= 800)
                || apiAvgMs >= 2500
            )
        ) {
            addCandidate(
                session,
                'API Latency Outlier',
                `${Math.round(apiAvgMs).toLocaleString()}ms average API response time`,
                54 + Math.min(48, apiAvgMs / 65) + Math.min(14, apiTotal / 2) + Math.min(14, duration / 30),
            );
        }

        if ((session.appStartupTimeMs || 0) >= 3000) {
            addCandidate(
                session,
                'Slow Startup',
                `${Math.round((session.appStartupTimeMs || 0) / 100) / 10}s startup time`,
                60 + Math.min(55, (session.appStartupTimeMs || 0) / 120),
            );
        }

        if (constrainedNetwork && (apiAvgMs >= 1000 || apiErrors > 0 || signals > 0 || duration >= 120)) {
            addCandidate(
                session,
                'Constrained Network User',
                'Slow or constrained network coincides with replay-worthy behavior',
                58 + Math.min(30, apiAvgMs / 100) + Math.min(24, weightedIssues / 2) + Math.min(12, duration / 45),
            );
        }

        if (isFirstKnownSession && (signals > 0 || apiErrors > 0)) {
            addCandidate(
                session,
                'New User Friction',
                'First-known user session includes friction signals',
                62 + weightedIssues + Math.min(12, duration / 40),
            );
        }

        if (duration <= 45 && (signals > 0 || apiErrors > 0) && (interactions > 0 || apiTotal > 0)) {
            addCandidate(
                session,
                'Frustrated Exit',
                'Short replay ended after observable friction',
                62 + weightedIssues + Math.max(0, 45 - duration) / 2,
            );
        }

        if ((session.explorationScore || 0) >= 8 && (session.interactionScore || 0) <= 10 && duration >= 45) {
            addCandidate(
                session,
                'Navigation Confusion',
                'High exploration with little interaction suggests a confusing path',
                58 + Math.min(34, (session.explorationScore || 0) * 3) + Math.min(12, screens * 2),
            );
        }

        if (apiTotal >= 100 || (apiTotal >= 50 && (apiAvgMs >= 500 || apiErrors > 0))) {
            addCandidate(
                session,
                'High API Volume',
                `${apiTotal} API request${apiTotal === 1 ? '' : 's'} in one replay`,
                54 + Math.min(32, apiTotal / 6) + Math.min(20, apiAvgMs / 100) + apiErrors * 4,
                'watch',
            );
        }

        const engagementScore = engagementWatchScore(session);
        if (engagementScore >= 70 && signals === 0) {
            addCandidate(
                session,
                'Deep Engagement',
                `${formatDuration(duration)} replay with ${interactions} interaction event${interactions === 1 ? '' : 's'}${screens > 0 ? ` across ${screens} screen${screens === 1 ? '' : 's'}` : ''}`,
                engagementScore,
                'watch',
            );
        }
    }

    for (const [, group] of userSessionCounts) {
        if (group.count < 3) continue;

        const best = [...group.sessions]
            .map((session) => ({
                session,
                score: issueWeight(session) + engagementWatchScore(session) + Math.min(32, (session.apiAvgResponseMs || 0) / 90),
            }))
            .filter((entry) => entry.score >= MIN_RECOMMENDED_SESSION_SCORE)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return byMostRecent(a.session, b.session);
            })[0];

        if (!best) continue;

        const signals = issueSignalsForSession(best.session);
        addCandidate(
            best.session,
            signals > 0 ? 'Returning User With Friction' : 'Power Returning User',
            signals > 0
                ? `${group.count} sessions from this user; this replay has the strongest friction`
                : `${group.count} sessions from this user; this is their most informative replay`,
            best.score + Math.min(18, group.count),
            signals > 0 ? 'high' : 'watch',
        );
    }

    const usedSessionIds = new Set<string>();
    const categoryCounts = new Map<string, number>();
    const picks: RecommendedSession[] = [];

    for (const candidate of candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return byMostRecent(a.session, b.session);
    })) {
        if (usedSessionIds.has(candidate.session.id)) continue;
        const categoryCount = categoryCounts.get(candidate.categoryKey) || 0;
        if (categoryCount >= MAX_RECOMMENDATIONS_PER_CATEGORY) continue;

        usedSessionIds.add(candidate.session.id);
        categoryCounts.set(candidate.categoryKey, categoryCount + 1);
        picks.push({
            session: candidate.session,
            category: candidate.category,
            priority: candidate.priority,
            reason: candidate.reason,
        });

        if (picks.length >= MAX_RECOMMENDED_SESSIONS) break;
    }

    return picks;
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
    <div className={`firebase-general-card flex h-full min-w-0 flex-col overflow-hidden border border-[#dadce0] bg-white shadow-none ${className}`}>
        <div className={`h-1 ${accentClassName}`} />
        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-[#e8eaed] pb-3">
                <h3 className="min-w-0 break-words text-[15px] font-medium text-[#202124] underline decoration-dotted decoration-[#bdc1c6] underline-offset-4">{title}</h3>
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

type CustomEventTrendRow = {
    dateKey: string;
} & Record<string, string | number>;

const ENGAGEMENT_SEGMENTS: Array<{ key: EngagementSegmentKey; label: string; color: string }> = [
    { key: 'bouncers', label: 'Bouncers', color: '#ef4444' },
    { key: 'casuals', label: 'Casuals', color: '#f9a8d4' },
    { key: 'explorers', label: 'Explorers', color: '#3b82f6' },
    { key: 'loyalists', label: 'Loyalists', color: '#10b981' },
];

const CUSTOM_EVENT_TREND_COLORS = ['#1a73e8', '#1e8e3e', '#9334e6', '#f9a8d4', '#0f766e', '#f59e0b'];

type MomentumCard = {
    label: string;
    value: string;
    delta: string;
    positiveIsGood: boolean;
    deltaValue: number | null;
};

const RETRO_CARD_ACCENTS = ['#67e8f9', '#86efac', '#f9a8d4', '#c4b5fd'];
const DIRECT_REFERRAL_LABEL = 'Direct / none';

type ReferralSourceRow = {
    source: string;
    count: number;
    share: number;
};

function readMetadataStringValue(metadata: Record<string, unknown> | undefined, keys: string[]): string | null {
    if (!metadata || typeof metadata !== 'object') return null;
    for (const key of keys) {
        const value = metadata[key];
        if (value === null || value === undefined) continue;
        const normalized = String(value).trim();
        if (normalized) return normalized;
    }
    return null;
}

function normalizeReferralSource(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) return DIRECT_REFERRAL_LABEL;

    const lower = raw.toLowerCase();
    if (['direct', '(direct)', 'none', 'null', 'undefined'].includes(lower)) {
        return DIRECT_REFERRAL_LABEL;
    }
    if (lower === 'internal') return 'Internal';

    const maybeUrl = raw.includes('://')
        ? raw
        : raw.includes('.') && !raw.includes(' ')
            ? `https://${raw}`
            : null;

    if (maybeUrl) {
        try {
            const hostname = new URL(maybeUrl).hostname.replace(/^www\./i, '');
            if (hostname) return hostname;
        } catch {
            // Keep the raw source below when it is not a valid URL or domain.
        }
    }

    return raw.length > 64 ? `${raw.slice(0, 61)}...` : raw;
}

function getSessionReferralSource(session: RecordingSession): string {
    return normalizeReferralSource(
        session.webReferral ||
        readMetadataStringValue(session.metadata, [
            'webReferral',
            'webReferrerDomain',
            'webAttributionSource',
            'utm_source',
            'webAttributionChannel',
            'webAttributionCampaign',
            'utm_campaign',
        ]),
    );
}

export const GeneralOverview: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
    const navigate = useNavigate();
    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);

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
    const [webReferralSessions, setWebReferralSessions] = useState<RecordingSession[]>([]);
    const [isReferralLoading, setIsReferralLoading] = useState(false);
    const [retentionCohortRows, setRetentionCohortRows] = useState<RetentionCohortRow[]>([]);
    const [topIssuesPage, setTopIssuesPage] = useState(0);
    const [copiedTopUserKey, setCopiedTopUserKey] = useState<string | null>(null);
    const [copiedPublicKey, setCopiedPublicKey] = useState(false);
    const [copiedDocsPrompt, setCopiedDocsPrompt] = useState(false);
    const [selectedCustomEventNames, setSelectedCustomEventNames] = useState<string[]>([]);
    const [customEventSelectionTouched, setCustomEventSelectionTouched] = useState(false);

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

        getDashboardOverview(selectedProject.id, timeRange, platform)
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
    }, [selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIsHeavyLoading(false);
            setSessions([]);
            setTopUsersFromBackend([]);
            return;
        }

        let isCancelled = false;
        setIsHeavyLoading(true);

        getDashboardOverviewHeavy(selectedProject.id, timeRange, platform)
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
    }, [selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (!selectedProject?.id) {
            setIsReferralLoading(false);
            setWebReferralSessions([]);
            return;
        }
        if (platform === 'mobile') {
            setIsReferralLoading(false);
            setWebReferralSessions([]);
            return;
        }

        let isCancelled = false;
        setIsReferralLoading(true);

        getSessionsPaginated({
            projectId: selectedProject.id,
            timeRange,
            platform: 'web',
            limit: 200,
            includeTotal: false,
            sort: 'date',
            sortDir: 'desc',
        })
            .then((response) => {
                if (isCancelled) return;
                setWebReferralSessions((response.sessions || []) as RecordingSession[]);
            })
            .catch(() => {
                if (isCancelled) return;
                setWebReferralSessions([]);
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsReferralLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        setTopIssuesPage(0);
    }, [selectedProject?.id, timeRange, platform]);

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

    const activeUsersPerMinuteLabel = useMemo(() => {
        const latestDau = activitySummary.latestDau;
        if (latestDau <= 0) return '0';

        const usersPerMinute = latestDau / 1440;
        if (usersPerMinute < 1) return '<1';

        return formatCompact(Math.round(usersPerMinute));
    }, [activitySummary.latestDau]);

    const activeUsersPerMinuteUnit = activeUsersPerMinuteLabel === '1' || activeUsersPerMinuteLabel === '<1'
        ? 'user'
        : 'users';

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

    const referralSummary = useMemo(() => {
        const webSessions = webReferralSessions.filter((session) => session.platform === 'web');
        const counts = new Map<string, number>();

        for (const session of webSessions) {
            const source = getSessionReferralSource(session);
            counts.set(source, (counts.get(source) || 0) + 1);
        }

        const rows: ReferralSourceRow[] = [...counts.entries()]
            .map(([source, count]) => ({
                source,
                count,
                share: webSessions.length > 0 ? (count / webSessions.length) * 100 : 0,
            }))
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return a.source.localeCompare(b.source);
            })
            .slice(0, 8);

        return {
            total: webSessions.length,
            rows,
        };
    }, [webReferralSessions]);
    const isMobileLens = platform === 'mobile';

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

    const customEventNameSet = useMemo(
        () => new Set(customEvents.map((event) => event.name)),
        [customEvents],
    );

    const defaultCustomEventNames = useMemo(
        () => customEvents.slice(0, 3).map((event) => event.name),
        [customEvents],
    );

    useEffect(() => {
        setCustomEventSelectionTouched(false);
    }, [selectedProject?.id, timeRange]);

    useEffect(() => {
        setSelectedCustomEventNames((current) => {
            const validCurrent = current.filter((eventName) => customEventNameSet.has(eventName));
            if (!customEventSelectionTouched || validCurrent.length === 0) {
                return defaultCustomEventNames;
            }
            return validCurrent;
        });
    }, [customEventNameSet, customEventSelectionTouched, defaultCustomEventNames]);

    const selectedCustomEvents = useMemo(
        () => selectedCustomEventNames.filter((eventName) => customEventNameSet.has(eventName)),
        [selectedCustomEventNames, customEventNameSet],
    );

    const customEventTrendData = useMemo<CustomEventTrendRow[]>(() => {
        const dailyEvents = overviewObs?.dailyCustomEvents || [];
        return dailyEvents
            .map((entry) => {
                const dateKey = toUtcDateKey(entry.date);
                if (!dateKey) return null;
                const row: CustomEventTrendRow = { dateKey };
                for (const eventName of selectedCustomEvents) {
                    row[eventName] = Number(entry.events?.[eventName] || 0);
                }
                return row;
            })
            .filter((row): row is CustomEventTrendRow => Boolean(row))
            .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }, [overviewObs, selectedCustomEvents]);

    const handleToggleCustomEvent = useCallback((eventName: string) => {
        setCustomEventSelectionTouched(true);
        setSelectedCustomEventNames((current) => (
            current.includes(eventName)
                ? current.filter((name) => name !== eventName)
                : [...current, eventName]
        ));
    }, []);

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
            || (!isMobileLens && referralSummary.total > 0)
        );
    }, [trendChartData, overviewObs, deepMetrics, engagementTrends, geoSummary, issues.length, referralSummary.total, isMobileLens]);

    if (isLoading && selectedProject?.id) {
        return <DashboardGhostLoader variant="general" />;
    }

    return (
        <div className="firebase-general-page min-h-screen bg-[#f8fafd] pb-12 font-sans text-[#202124]">
            <DashboardPageHeader
                title="General"
                icon={<MessageSquareWarning className="h-5 w-5" />}
                iconColor="bg-[#cffafe]"
            >
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
                </div>
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1560px] space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6">
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
                    <div className="dashboard-surface overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-sm">
                        <div className="border-b border-[#dadce0] bg-[#e6f4ea] px-4 py-4 sm:px-5">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase text-[#137333]">
                                <Info className="h-4 w-4 shrink-0" aria-hidden />
                                New project setup
                            </div>
                            <h3 className="mt-2 text-lg font-semibold text-[#202124]">No analytics yet - connect your project first</h3>
                            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[#3c4043]">
                                Once your first SDK sends data, this General dashboard will populate automatically.
                                Use these shortcuts to finish setup for either React Native or Swift.
                            </p>
                        </div>

                        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                            <button
                                type="button"
                                onClick={handleCopyProjectKey}
                                disabled={!selectedProject.publicKey}
                                className="flex items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-xs font-semibold text-[#202124] transition-colors hover:border-[#137333] hover:bg-[#f0fdf4] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Copy className="h-4 w-4" />
                                {copiedPublicKey ? 'Public key copied' : 'Copy public key'}
                            </button>

                            <button
                                type="button"
                                onClick={handleCopyIntegrationPrompt}
                                className="flex items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-xs font-semibold text-[#202124] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
                            >
                                <BookOpen className="h-4 w-4" />
                                {copiedDocsPrompt ? 'AI prompt copied' : 'Copy AI docs prompt'}
                            </button>

                            <a
                                href="/docs/reactnative/overview"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-xs font-semibold text-[#1a73e8] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
                            >
                                <ExternalLink className="h-4 w-4" />
                                View React Native docs
                            </a>

                            <a
                                href="/docs/swift/overview"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-xs font-semibold text-[#1a73e8] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
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
                                            <div key={card.label} className="firebase-kpi-card min-w-0 rounded-xl border border-[#dadce0] bg-white p-4 shadow-none transition-colors hover:border-[#bdc1c6] sm:p-5">
                                                <div className="dashboard-label break-words text-[#5f6368]">{card.label}</div>
                                                <div className="mt-3 break-words text-[1.6rem] font-normal leading-none text-[#202124] sm:text-[2rem]">{card.value}</div>
                                                <div className={`mt-4 inline-flex rounded-full border border-[#dadce0] bg-white px-2.5 py-1 text-[11px] font-semibold uppercase sm:text-xs ${deltaClass}`}>
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
                                    <div className="mt-1 text-[11px] font-bold text-slate-500">Estimated {activeUsersPerMinuteLabel} {activeUsersPerMinuteUnit}/min</div>
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

                                <GA4Card title="Referral sources" className="xl:col-span-4" accentClassName="bg-[#f9a8d4]">
                                {isMobileLens ? (
                                    <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-slate-400">
                                        Referral sources are only captured for web sessions. Mobile attribution will appear in the appropriate acquisition view.
                                    </div>
                                ) : isReferralLoading && referralSummary.rows.length === 0 ? (
                                    <div className="space-y-2.5">
                                        {Array.from({ length: 8 }, (_, index) => (
                                            <div key={index} className="flex items-center gap-3">
                                                <div className="h-8 w-8 animate-pulse border border-[#dadce0] bg-[#eef4ff]" />
                                                <div className="h-5 flex-1 animate-pulse bg-[#f1f5f9]" />
                                            </div>
                                        ))}
                                    </div>
                                ) : referralSummary.rows.length > 0 ? (
                                    <div className="space-y-2">
                                        {referralSummary.rows.map((row) => (
                                            <div key={row.source} className="group min-w-0">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-black bg-[#eef4ff] text-xs font-black uppercase text-black">
                                                        {row.source === DIRECT_REFERRAL_LABEL ? (
                                                            <Globe2 className="h-4 w-4" />
                                                        ) : (
                                                            row.source.slice(0, 1)
                                                        )}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex min-w-0 items-center justify-between gap-3">
                                                            <span className="truncate text-sm font-semibold text-[#202124]" title={row.source}>{row.source}</span>
                                                            <span className="shrink-0 font-mono text-xs font-semibold text-slate-500">{formatCompact(row.count)}</span>
                                                        </div>
                                                        <div className="mt-1 h-1.5 border border-[#dadce0] bg-white">
                                                            <div className="h-full bg-[#1a73e8]" style={{ width: `${Math.max(6, row.share)}%` }} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-slate-400">
                                        No web referral sources observed for this filter.
                                    </div>
                                )}
                                </GA4Card>

                                <GA4Card title="Active users by version" className="xl:col-span-4" accentClassName="bg-[#c4b5fd]">
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
                                    <div className="mt-2 text-xs text-slate-400">No version data for this filter.</div>
                                )}

                                <div className="mt-2 text-right">
                                    <Link to={`${pathPrefix}/analytics/devices`} className="text-[11px] font-bold text-[#2563eb] transition-colors hover:text-black">
                                        View versions →
                                    </Link>
                                </div>
                                </GA4Card>

                                <GA4Card title="User engagement mix" className="xl:col-span-8" accentClassName="bg-[#67e8f9]">
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
                            <GA4Card title="Stability overview" className="xl:col-span-4" accentClassName="bg-[#f9a8d4]">
                                <div className="-mx-1 overflow-x-auto px-1">
                                    <table className="mt-1 min-w-[360px] w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-200 text-[11px] text-black">
                                                <th className="py-2 text-left font-medium">PROJECT</th>
                                                <th className="py-2 text-right font-medium">CRASH-FREE</th>
                                                <th className="py-2 text-right font-medium">ANR-FREE</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {platformBreakdown.length > 0 ? (
                                                platformBreakdown.map((platformData) => (
                                                    <tr key={platformData.platform} className="border-b border-slate-50">
                                                        <td className="py-2 text-slate-700 capitalize">
                                                            {selectedProject?.name ?? 'Project'} ({platformData.platform})
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
                                                    <td className="py-2 text-slate-700">{selectedProject?.name ?? 'Project'}</td>
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

                            <GA4Card
                                title="Custom event usage over time"
                                className="xl:col-span-7"
                                accentClassName="bg-[#c4b5fd]"
                                action={customEvents.length > 0 ? (
                                    <span className="border border-[#dadce0] bg-[#f8fafc] px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                                        {selectedCustomEvents.length} selected
                                    </span>
                                ) : null}
                            >
                                {customEvents.length > 0 ? (
                                    <>
                                        <div className="mb-3 max-h-[76px] overflow-y-auto pr-1">
                                            <div className="flex flex-wrap gap-1.5">
                                                {customEvents.map((event, index) => {
                                                    const isSelected = selectedCustomEvents.includes(event.name);
                                                    return (
                                                        <button
                                                            key={event.name}
                                                            type="button"
                                                            onClick={() => handleToggleCustomEvent(event.name)}
                                                            className={`inline-flex min-w-0 items-center gap-1.5 border px-2 py-1 text-[10px] font-semibold transition-colors ${
                                                                isSelected
                                                                    ? 'border-black bg-black text-white'
                                                                    : 'border-[#dadce0] bg-white text-slate-600 hover:border-black hover:text-black'
                                                            }`}
                                                            title={event.name}
                                                        >
                                                            <span
                                                                className="h-2 w-2 shrink-0 border border-black"
                                                                style={{ backgroundColor: CUSTOM_EVENT_TREND_COLORS[index % CUSTOM_EVENT_TREND_COLORS.length] }}
                                                            />
                                                            <span className="max-w-[11rem] truncate">{event.name}</span>
                                                            <span className={isSelected ? 'text-white/70' : 'text-slate-400'}>
                                                                {formatCompact(event.count)}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {customEventTrendData.length > 0 && selectedCustomEvents.length > 0 ? (
                                        <div className="h-[220px]">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={customEventTrendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                    <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                                                    <Tooltip
                                                        labelFormatter={(value) => formatDateLabel(String(value))}
                                                        formatter={(value: number | undefined, name: string | undefined) => [formatCompact(value ?? 0), name ?? 'Events']}
                                                    />
                                                    {selectedCustomEvents.map((eventName, index) => (
                                                        <Line
                                                            key={eventName}
                                                            type="monotone"
                                                            dataKey={eventName}
                                                            stroke={CUSTOM_EVENT_TREND_COLORS[index % CUSTOM_EVENT_TREND_COLORS.length]}
                                                            strokeWidth={2}
                                                            dot={false}
                                                            name={eventName}
                                                            isAnimationActive={false}
                                                        />
                                                    ))}
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                        ) : (
                                            <div className="flex h-[220px] items-center justify-center text-center text-xs text-slate-400">
                                                {selectedCustomEvents.length === 0 ? 'No custom events selected.' : 'No daily event trend data.'}
                                            </div>
                                        )}

                                        <div className="mt-3 flex flex-wrap gap-3">
                                            {selectedCustomEvents.map((eventName, index) => (
                                                <span key={eventName} className="flex min-w-0 items-center gap-1 text-[10px] text-slate-500">
                                                    <span className="h-2 w-2 shrink-0" style={{ backgroundColor: CUSTOM_EVENT_TREND_COLORS[index % CUSTOM_EVENT_TREND_COLORS.length] }} />
                                                    <span className="truncate">{eventName}</span>
                                                </span>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-slate-400">
                                        No custom events observed for this filter.
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
                                                                platform: session.platform,
                                                                appVersion: session.appVersion,
                                                                sdkVersion: session.sdkVersion,
                                                                osVersion: session.osVersion,
                                                                webLandingRoute: session.webLandingRoute,
                                                                metadata: session.metadata,
                                                                networkType: session.networkType,
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
                                        Only sessions with clear friction, performance risk, or unusually informative behavior are shown.
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
                                    subtitle="No replay in this time window crossed the recommendation threshold."
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
                                                                    platform: rec.session.platform,
                                                                    appVersion: rec.session.appVersion,
                                                                    sdkVersion: rec.session.sdkVersion,
                                                                    osVersion: rec.session.osVersion,
                                                                    webLandingRoute: rec.session.webLandingRoute,
                                                                    metadata: rec.session.metadata,
                                                                    networkType: rec.session.networkType,
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
