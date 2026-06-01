import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BookOpen,
    ChevronDown,
    ChevronRight,
    Check,
    Copy,
    ExternalLink,
    Globe2,
    Info,
    Mail,
    MessageSquareWarning,
    Search,
    User,
    X,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { Link, useNavigate } from 'react-router';
import { useSessionData } from '~/shared/providers/SessionContext';
import {
    getDashboardOverviewHeavy,
    getGeoSummary,
    getGrowthObservability,
    getInsightsTrends,
    getObservabilityDeepMetrics,
    getRetentionCohorts,
    getSessionsPaginated,
    getUserEngagementTrends,
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
import { RecordingSession } from '~/shared/types';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { DEMO_REPLAY_SESSION_IDS, getDemoReplayCoverPhotoUrl } from '~/shared/data/demoData';

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
const DEMO_REPLAY_SESSION_ID_SET = new Set(DEMO_REPLAY_SESSION_IDS);

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

function getMiniSessionCoverPhotoUrl(session: RecordingSession, isDemoMode: boolean): string | null {
    if (!hasSuccessfulRecording(session)) return null;

    if (isDemoMode) {
        return getDemoReplayCoverPhotoUrl(
            session.id,
            session.platform === 'web' ? null : session.id,
        );
    }

    return `/api/sessions/cover/${session.id}`;
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

function getRecordedDemoSessions(sessions: RecordingSession[]): RecordingSession[] {
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return DEMO_REPLAY_SESSION_IDS
        .map((sessionId) => byId.get(sessionId))
        .filter((session): session is RecordingSession => Boolean(session));
}

function buildDemoRecommendedSessions(sessions: RecordingSession[]): RecommendedSession[] {
    const recordedSessions = getRecordedDemoSessions(sessions);
    const scoredRecommendations = new Map(
        buildRecommendedSessions(recordedSessions).map((recommendation) => [recommendation.session.id, recommendation]),
    );

    return recordedSessions.map((session) => {
        const scored = scoredRecommendations.get(session.id);
        if (scored) return scored;

        if (session.platform === 'web') {
            return {
                session,
                category: 'Web SDK Replay',
                priority: 'watch',
                reason: 'Docs path replay shows the Web SDK setup flow and custom-event section',
            };
        }

        return {
            session,
            category: 'Recorded Demo Replay',
            priority: 'watch',
            reason: 'Recorded replay with visual artifacts available for inspection',
        };
    });
}

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
    <div className={`rejourney-general-card flex h-full min-w-0 flex-col overflow-hidden border border-[#dadce0] bg-white shadow-none ${className}`}>
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

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type GeneralSectionKey = 'trends' | 'observability' | 'deepMetrics' | 'engagement' | 'geo' | 'retention';

const GENERAL_SECTION_KEYS: GeneralSectionKey[] = [
    'trends',
    'observability',
    'deepMetrics',
    'engagement',
    'geo',
    'retention',
];

const GENERAL_SECTION_LABELS: Record<GeneralSectionKey, string> = {
    trends: 'activity trends',
    observability: 'observability',
    deepMetrics: 'deep metrics',
    engagement: 'engagement segments',
    geo: 'geographic activity',
    retention: 'retention cohorts',
};

function buildGeneralSectionStatuses(status: LoadStatus): Record<GeneralSectionKey, LoadStatus> {
    return GENERAL_SECTION_KEYS.reduce((acc, key) => {
        acc[key] = status;
        return acc;
    }, {} as Record<GeneralSectionKey, LoadStatus>);
}

const GhostBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div
        aria-hidden="true"
        className={`animate-pulse rounded-none border border-white/80 bg-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] ${className}`.trim()}
    />
);

const MomentumCardGhostGrid: React.FC = () => (
    <section aria-busy="true">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
                <div key={`momentum-ghost-${index}`} className="min-w-0 rounded-xl border border-[#dadce0] bg-white p-4 sm:p-5">
                    <GhostBlock className="h-3 w-28" />
                    <GhostBlock className="mt-3 h-8 w-20" />
                    <GhostBlock className="mt-4 h-6 w-24 rounded-full" />
                </div>
            ))}
        </div>
    </section>
);

const GA4CardGhost: React.FC<{
    title: string;
    className?: string;
    accentClassName?: string;
    minHeight?: string;
    rows?: number;
}> = ({
    title,
    className = '',
    accentClassName = 'bg-[#67e8f9]',
    minHeight = '240px',
    rows = 4,
}) => (
    <GA4Card title={title} className={className} accentClassName={accentClassName}>
        <div className="flex flex-1 flex-col justify-between gap-4" style={{ minHeight }} aria-busy="true">
            <div className="space-y-3">
                {Array.from({ length: rows }).map((_, index) => (
                    <div key={`row-${index}`} className="flex items-center gap-3">
                        <GhostBlock className="h-8 w-8 shrink-0" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <GhostBlock className="h-3 w-full" />
                            <GhostBlock className="h-2 w-3/4" />
                        </div>
                    </div>
                ))}
            </div>
            <GhostBlock className="h-24 w-full" />
        </div>
    </GA4Card>
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

type VersionReleaseMarker = {
    dateKey: string;
    version: string;
    count: number;
};

type VersionChartRow = {
    dateKey: string;
} & Record<string, string | number>;

type VersionAwareTooltipPayloadItem = {
    color?: string;
    name?: string | number;
    value?: unknown;
};

type VersionAwareTooltipFormatter = (
    value: number | undefined,
    name: string | undefined,
) => [React.ReactNode, React.ReactNode] | React.ReactNode;

type VersionAwareChartTooltipProps = {
    active?: boolean;
    label?: string | number;
    payload?: VersionAwareTooltipPayloadItem[];
    releaseMarkers?: VersionReleaseMarker[];
    formatter?: VersionAwareTooltipFormatter;
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
const NO_UTM_LABEL = 'No UTM tag';
const CUSTOM_EVENT_SELECTION_STORAGE_PREFIX = 'rejourney.general.customEventSelection';
const MAX_VERSION_RELEASE_MARKERS = 6;
const VERSION_RELEASE_TOOLTIP_WINDOW_MS = 36 * 60 * 60 * 1000;
const VERSION_TOOLTIP_WRAPPER_STYLE: React.CSSProperties = { zIndex: 40 };
const VERSION_TOOLTIP_ALLOW_ESCAPE = { x: true, y: true };
const VERSION_TOOLTIP_POSITION = { x: 12, y: -8 };

function parseStoredCustomEventSelection(raw: string | null): string[] | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
    } catch {
        return null;
    }
}

type ReleaseLabelViewBox = {
    x?: number;
    y?: number;
    width?: number;
};

type ReferralSourceRow = {
    key: string;
    source: string;
    detail?: string;
    count: number;
    share: number;
};

type ReferralSourceMode = 'referrer' | 'utm';
type ReferralUtmDimension = keyof UtmAttribution;

type UtmAttribution = {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    campaignId: string | null;
    term: string | null;
    content: string | null;
    sourcePlatform: string | null;
};

const REFERRAL_UTM_DIMENSIONS: Array<{
    key: ReferralUtmDimension;
    label: string;
    emptyLabel: string;
}> = [
    { key: 'source', label: 'Source', emptyLabel: 'No UTM source' },
    { key: 'medium', label: 'Medium', emptyLabel: 'No UTM medium' },
    { key: 'campaign', label: 'Campaign', emptyLabel: 'No UTM campaign' },
    { key: 'term', label: 'Term', emptyLabel: 'No UTM term' },
    { key: 'content', label: 'Content', emptyLabel: 'No UTM content' },
    { key: 'campaignId', label: 'Campaign ID', emptyLabel: 'No UTM campaign ID' },
    { key: 'sourcePlatform', label: 'Source platform', emptyLabel: 'No UTM source platform' },
];

const REFERRAL_UTM_DIMENSION_META: Record<ReferralUtmDimension, { label: string; emptyLabel: string }> =
    REFERRAL_UTM_DIMENSIONS.reduce((acc, dimension) => {
        acc[dimension.key] = { label: dimension.label, emptyLabel: dimension.emptyLabel };
        return acc;
    }, {} as Record<ReferralUtmDimension, { label: string; emptyLabel: string }>);

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

function normalizeUtmValue(value: string | null | undefined): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (['none', 'null', 'undefined', '(not set)'].includes(raw.toLowerCase())) return null;
    return raw.length > 64 ? `${raw.slice(0, 61)}...` : raw;
}

function getSessionUtmAttribution(session: RecordingSession): UtmAttribution {
    const metadata = session.metadata;
    return {
        source: normalizeUtmValue(readMetadataStringValue(metadata, ['utm_source', 'webAttributionSource'])),
        medium: normalizeUtmValue(readMetadataStringValue(metadata, ['utm_medium', 'webAttributionMedium'])),
        campaign: normalizeUtmValue(readMetadataStringValue(metadata, ['utm_campaign', 'webAttributionCampaign'])),
        campaignId: normalizeUtmValue(readMetadataStringValue(metadata, ['utm_id', 'webAttributionCampaignId'])),
        term: normalizeUtmValue(readMetadataStringValue(metadata, ['utm_term', 'webAttributionTerm'])),
        content: normalizeUtmValue(readMetadataStringValue(metadata, ['utm_content', 'webAttributionContent'])),
        sourcePlatform: normalizeUtmValue(readMetadataStringValue(metadata, ['utm_source_platform', 'webAttributionSourcePlatform'])),
    };
}

function getUtmRowParts(utm: UtmAttribution, dimension: ReferralUtmDimension): { key: string; source: string; detail: string } {
    const dimensionMeta = REFERRAL_UTM_DIMENSION_META[dimension];
    const selectedValue = utm[dimension];
    const hasAnyUtm = Boolean(utm.source || utm.medium || utm.campaign || utm.campaignId || utm.term || utm.content || utm.sourcePlatform);

    if (!selectedValue) {
        return {
            key: `__no_utm_${dimension}__`,
            source: hasAnyUtm ? dimensionMeta.emptyLabel : NO_UTM_LABEL,
            detail: hasAnyUtm ? `${dimensionMeta.label} was not captured` : 'No campaign parameters captured',
        };
    }

    const detailParts = [
        dimension !== 'campaign' && utm.campaign ? `campaign ${utm.campaign}` : null,
        dimension !== 'campaignId' && utm.campaignId ? `id ${utm.campaignId}` : null,
        dimension !== 'source' && utm.source ? `source ${utm.source}` : null,
        dimension !== 'medium' && utm.medium ? `medium ${utm.medium}` : null,
        dimension !== 'sourcePlatform' && utm.sourcePlatform ? `platform ${utm.sourcePlatform}` : null,
        dimension !== 'content' && utm.content ? `content ${utm.content}` : null,
        dimension !== 'term' && utm.term ? `term ${utm.term}` : null,
    ].filter((part): part is string => Boolean(part));

    return {
        key: `${dimension}:${selectedValue}`,
        source: selectedValue,
        detail: detailParts.join(' / ') || `${dimensionMeta.label} captured`,
    };
}

function formatVersionMarkerLabel(version: string): string {
    return version.length > 6 ? `${version.slice(0, 6)}...` : version;
}

function dateKeyTime(dateKey: string): number | null {
    const time = new Date(`${dateKey}T00:00:00Z`).getTime();
    return Number.isFinite(time) ? time : null;
}

function buildVersionReleaseMarkersForDateKeys(
    versionChartData: VersionChartRow[],
    versionKeys: string[],
    chartDateKeys: string[],
): VersionReleaseMarker[] {
    if (!versionChartData.length || !versionKeys.length || !chartDateKeys.length) return [];

    const chartDateKeySet = new Set(chartDateKeys);
    const visibleVersionRows = versionChartData
        .filter((row) => chartDateKeySet.has(String(row.dateKey || '')))
        .sort((a, b) => String(a.dateKey || '').localeCompare(String(b.dateKey || '')));
    if (visibleVersionRows.length < 2) return [];

    const markers: VersionReleaseMarker[] = [];

    for (const version of versionKeys) {
        const firstVisibleIndex = visibleVersionRows.findIndex((row) => {
            const count = Number(row[version] || 0);
            return Number.isFinite(count) && count > 0;
        });

        if (firstVisibleIndex <= 0) continue;

        const firstVisibleRow = visibleVersionRows[firstVisibleIndex];
        markers.push({
            dateKey: String(firstVisibleRow.dateKey),
            version,
            count: Number(firstVisibleRow[version] || 0),
        });
    }

    return markers
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || (b.count - a.count) || a.version.localeCompare(b.version))
        .slice(0, MAX_VERSION_RELEASE_MARKERS)
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (b.count - a.count) || a.version.localeCompare(b.version));
}

function buildVersionReleaseLineLabel(version: string, index: number) {
    return ({ viewBox }: { viewBox?: ReleaseLabelViewBox }) => {
        const x = typeof viewBox?.x === 'number' ? viewBox.x : NaN;
        const y = typeof viewBox?.y === 'number' ? viewBox.y : NaN;
        const width = typeof viewBox?.width === 'number' ? viewBox.width : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        const text = `v${formatVersionMarkerLabel(version)}`;
        const rowOffset = (index % 3) * 12;
        const textWidth = text.length * 5.8;
        const placeLabelOnRight = Number.isFinite(width) ? x + textWidth + 12 <= width : true;
        const textY = y + 10 + rowOffset;
        const rectX = placeLabelOnRight ? x + 2 : x - textWidth - 8;
        const textX = placeLabelOnRight ? x + 5 : x - textWidth - 5;

        return (
            <g pointerEvents="none" aria-hidden="true">
                <rect
                    x={rectX}
                    y={textY - 8.5}
                    width={textWidth + 6}
                    height={11}
                    rx={2}
                    fill="#ffffff"
                    fillOpacity={0.92}
                    stroke="#334155"
                    strokeWidth={0.85}
                />
                <text x={textX} y={textY} fill="#334155" fontSize={9.5} fontWeight={700}>
                    {text}
                </text>
            </g>
        );
    };
}

function coerceTooltipNumber(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : undefined;
}

function formatTooltipEntry(
    item: VersionAwareTooltipPayloadItem,
    formatter?: VersionAwareTooltipFormatter,
): { name: React.ReactNode; value: React.ReactNode } {
    const name = item.name === undefined ? undefined : String(item.name);
    const value = coerceTooltipNumber(item.value);
    const formatted = formatter ? formatter(value, name) : undefined;

    if (Array.isArray(formatted)) {
        return {
            value: formatted[0],
            name: formatted[1],
        };
    }

    return {
        value: formatted ?? (value === undefined ? String(item.value ?? '0') : formatCompact(value)),
        name: name ?? 'Value',
    };
}

function VersionAwareChartTooltip({
    active,
    label,
    payload,
    releaseMarkers = [],
    formatter,
}: VersionAwareChartTooltipProps) {
    if (!active || label === undefined || label === null) return null;

    const labelKey = String(label);
    const exactReleases = releaseMarkers.filter((marker) => marker.dateKey === labelKey);
    const labelTime = dateKeyTime(labelKey);
    const releases = exactReleases.length > 0 || labelTime === null
        ? exactReleases
        : releaseMarkers.filter((marker) => {
            const markerTime = dateKeyTime(marker.dateKey);
            return markerTime !== null && Math.abs(markerTime - labelTime) <= VERSION_RELEASE_TOOLTIP_WINDOW_MS;
        });
    const entries = (payload || [])
        .filter((item) => item.value !== undefined && item.value !== null)
        .map((item) => ({
            color: item.color,
            ...formatTooltipEntry(item, formatter),
        }));

    if (entries.length === 0 && releases.length === 0) return null;

    return (
        <div className="pointer-events-none max-w-[260px] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
            <div className="mb-1 font-semibold text-slate-800">{formatDateLabel(labelKey)}</div>

            {releases.length > 0 && (
                <div className={entries.length > 0 ? 'mb-2 border-b border-slate-100 pb-2' : ''}>
                    <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">
                        Version introduced
                    </div>
                    <div className="space-y-1">
                        {releases.map((marker) => (
                            <div key={`${marker.version}-${marker.dateKey}`} className="flex items-center gap-1.5">
                                <span className="h-3 border-l border-dashed border-slate-600" />
                                <span className="break-all font-mono font-semibold text-slate-800">v{marker.version}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {entries.length > 0 && (
                <div className="space-y-1">
                    {entries.map((entry, index) => (
                        <div key={`${String(entry.name)}-${index}`} className="flex items-center justify-between gap-4">
                            <span className="flex min-w-0 items-center gap-1.5 text-slate-500">
                                <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: entry.color || '#64748b' }}
                                />
                                <span className="truncate">{entry.name}</span>
                            </span>
                            <span className="font-semibold text-slate-900">{entry.value}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export const GeneralOverview: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { isDemoMode } = useDemoMode();
    const pathPrefix = usePathPrefix();
    const navigate = useNavigate();
    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);
    const customEventSelectionStorageKey = useMemo(
        () => selectedProject?.id ? `${CUSTOM_EVENT_SELECTION_STORAGE_PREFIX}:${selectedProject.id}:${platformLens}` : null,
        [platformLens, selectedProject?.id],
    );

    const [sectionStatus, setSectionStatus] = useState<Record<GeneralSectionKey, LoadStatus>>(
        () => buildGeneralSectionStatuses('idle'),
    );
    const [failedSections, setFailedSections] = useState<string[]>([]);
    const [isSessionsLoading, setIsSessionsLoading] = useState(false);
    const [isTopUsersLoading, setIsTopUsersLoading] = useState(false);
    const [topUsersFromBackend, setTopUsersFromBackend] = useState<TopUserEntry[]>([]);
    const [trends, setTrends] = useState<InsightsTrends | null>(null);
    const [overviewObs, setOverviewObs] = useState<GrowthObservability | null>(null);
    const [deepMetrics, setDeepMetrics] = useState<ObservabilityDeepMetrics | null>(null);
    const [engagementTrends, setEngagementTrends] = useState<UserEngagementTrends | null>(null);
    const [geoSummary, setGeoSummary] = useState<GeoSummary | null>(null);
    const [sessions, setSessions] = useState<RecordingSession[]>([]);
    const [webReferralSessions, setWebReferralSessions] = useState<RecordingSession[]>([]);
    const [isReferralLoading, setIsReferralLoading] = useState(false);
    const [retentionCohortRows, setRetentionCohortRows] = useState<RetentionCohortRow[]>([]);
    const [copiedTopUserKey, setCopiedTopUserKey] = useState<string | null>(null);
    const [copiedPublicKey, setCopiedPublicKey] = useState(false);
    const [copiedDocsPrompt, setCopiedDocsPrompt] = useState(false);
    const [copiedContactEmail, setCopiedContactEmail] = useState(false);
    const [referralSourceMode, setReferralSourceMode] = useState<ReferralSourceMode>('referrer');
    const [referralUtmDimension, setReferralUtmDimension] = useState<ReferralUtmDimension>('source');
    const [selectedCustomEventNames, setSelectedCustomEventNames] = useState<string[]>([]);
    const [customEventSelectionTouched, setCustomEventSelectionTouched] = useState(false);
    const [customEventSearchQuery, setCustomEventSearchQuery] = useState('');
    const [hydratedCustomEventSelectionKey, setHydratedCustomEventSelectionKey] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedProject?.id) {
            setSectionStatus(buildGeneralSectionStatuses('idle'));
            setFailedSections([]);
            setTrends(null);
            setOverviewObs(null);
            setDeepMetrics(null);
            setEngagementTrends(null);
            setGeoSummary(null);
            setRetentionCohortRows([]);
            return;
        }

        let isCancelled = false;
        const normalizedPlatform = platform && platform !== 'all' ? platform : undefined;
        const observabilityRange = timeRange === 'all' ? undefined : timeRange;
        const observabilityMode = normalizedPlatform ? 'full' : 'summary';

        setSectionStatus(buildGeneralSectionStatuses('loading'));
        setFailedSections([]);
        setTrends(null);
        setOverviewObs(null);
        setDeepMetrics(null);
        setEngagementTrends(null);
        setGeoSummary(null);
        setRetentionCohortRows([]);

        const markReady = (key: GeneralSectionKey) => {
            setSectionStatus((current) => ({ ...current, [key]: 'ready' }));
        };
        const markFailed = (key: GeneralSectionKey) => {
            const label = GENERAL_SECTION_LABELS[key];
            setSectionStatus((current) => ({ ...current, [key]: 'error' }));
            setFailedSections((current) => current.includes(label) ? current : [...current, label]);
        };

        getInsightsTrends(selectedProject.id, timeRange, normalizedPlatform)
            .then((data) => {
                if (isCancelled) return;
                setTrends(data || null);
                markReady('trends');
            })
            .catch(() => {
                if (isCancelled) return;
                setTrends(null);
                markFailed('trends');
            });

        getGrowthObservability(selectedProject.id, observabilityRange, observabilityMode, normalizedPlatform)
            .then((data) => {
                if (isCancelled) return;
                setOverviewObs(data || null);
                markReady('observability');
            })
            .catch(() => {
                if (isCancelled) return;
                setOverviewObs(null);
                markFailed('observability');
            });

        getObservabilityDeepMetrics(selectedProject.id, observabilityRange, observabilityMode, normalizedPlatform)
            .then((data) => {
                if (isCancelled) return;
                setDeepMetrics(data || null);
                markReady('deepMetrics');
            })
            .catch(() => {
                if (isCancelled) return;
                setDeepMetrics(null);
                markFailed('deepMetrics');
            });

        getUserEngagementTrends(selectedProject.id, observabilityRange, normalizedPlatform, observabilityMode)
            .then((data) => {
                if (isCancelled) return;
                setEngagementTrends(data || null);
                markReady('engagement');
            })
            .catch(() => {
                if (isCancelled) return;
                setEngagementTrends(null);
                markFailed('engagement');
            });

        getGeoSummary(selectedProject.id, observabilityRange)
            .then((data) => {
                if (isCancelled) return;
                setGeoSummary(data || null);
                markReady('geo');
            })
            .catch(() => {
                if (isCancelled) return;
                setGeoSummary(null);
                markFailed('geo');
            });

        getRetentionCohorts(selectedProject.id, timeRange, normalizedPlatform)
            .then((data) => {
                if (isCancelled) return;
                setRetentionCohortRows(data?.rows || []);
                markReady('retention');
            })
            .catch(() => {
                if (isCancelled) return;
                setRetentionCohortRows([]);
                markFailed('retention');
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (!selectedProject?.id) {
            setSessions([]);
            setIsSessionsLoading(false);
            return;
        }

        let isCancelled = false;
        setIsSessionsLoading(true);
        setSessions([]);

        getDashboardOverviewHeavy(selectedProject.id, timeRange, platform, 'sessions')
            .then((heavyData) => {
                if (isCancelled) return;
                setSessions((heavyData.sessions || []) as RecordingSession[]);
            })
            .catch(() => {
                if (isCancelled) return;
                setSessions([]);
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsSessionsLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (!selectedProject?.id || isDemoMode) {
            setTopUsersFromBackend([]);
            setIsTopUsersLoading(false);
            return;
        }

        let isCancelled = false;
        setIsTopUsersLoading(true);
        setTopUsersFromBackend([]);

        getDashboardOverviewHeavy(selectedProject.id, timeRange, platform, 'topUsers')
            .then((heavyData) => {
                if (isCancelled) return;
                setTopUsersFromBackend(heavyData.topUsers || []);
            })
            .catch(() => {
                if (isCancelled) return;
                setTopUsersFromBackend([]);
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsTopUsersLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [isDemoMode, selectedProject?.id, timeRange, platform]);

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

    const versionChartData = useMemo<VersionChartRow[]>(() => {
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

                const row: VersionChartRow = { dateKey };
                const breakdown = entry.appVersionDauBreakdown || entry.appVersionBreakdown || {};
                for (const version of versions) {
                    row[version] = Number(breakdown[version] || 0);
                }
                return row;
            })
            .filter((row): row is VersionChartRow => Boolean(row));
    }, [trends]);

    const versionKeys = useMemo(() => {
        if (!versionChartData.length) return [];
        return Object.keys(versionChartData[0]).filter((key) => key !== 'dateKey');
    }, [versionChartData]);

    const versionColors = ['#1a73e8', '#5dadec', '#f9a8d4', '#1e8e3e', '#9334e6', '#0f766e'];

    const trendVersionMarkers = useMemo(
        () => buildVersionReleaseMarkersForDateKeys(
            versionChartData,
            versionKeys,
            trendChartData.map((row) => row.dateKey),
        ),
        [trendChartData, versionChartData, versionKeys],
    );

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
        const rowsByKey = new Map<string, ReferralSourceRow>();

        for (const session of webSessions) {
            const referralSource = referralSourceMode === 'referrer' ? getSessionReferralSource(session) : null;
            const parts = referralSourceMode === 'utm'
                ? getUtmRowParts(getSessionUtmAttribution(session), referralUtmDimension)
                : {
                    key: referralSource || DIRECT_REFERRAL_LABEL,
                    source: referralSource || DIRECT_REFERRAL_LABEL,
                    detail: undefined,
                };
            const existing = rowsByKey.get(parts.key);
            if (existing) {
                existing.count += 1;
            } else {
                rowsByKey.set(parts.key, {
                    key: parts.key,
                    source: parts.source,
                    detail: parts.detail,
                    count: 1,
                    share: 0,
                });
            }
        }

        const rows: ReferralSourceRow[] = [...rowsByKey.values()]
            .map((row) => ({
                ...row,
                share: webSessions.length > 0 ? (row.count / webSessions.length) * 100 : 0,
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
    }, [referralSourceMode, referralUtmDimension, webReferralSessions]);
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

    const engagementVersionMarkers = useMemo<VersionReleaseMarker[]>(() => {
        return buildVersionReleaseMarkersForDateKeys(
            versionChartData,
            versionKeys,
            engagementMixChartData.map((row) => row.dateKey),
        );
    }, [engagementMixChartData, versionChartData, versionKeys]);

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
        setCustomEventSearchQuery('');

        if (!customEventSelectionStorageKey || typeof window === 'undefined') {
            setSelectedCustomEventNames([]);
            setCustomEventSelectionTouched(false);
            setHydratedCustomEventSelectionKey(customEventSelectionStorageKey);
            return;
        }

        const storedSelection = parseStoredCustomEventSelection(window.localStorage.getItem(customEventSelectionStorageKey));
        setSelectedCustomEventNames(storedSelection ?? []);
        setCustomEventSelectionTouched(storedSelection !== null);
        setHydratedCustomEventSelectionKey(customEventSelectionStorageKey);
    }, [customEventSelectionStorageKey]);

    useEffect(() => {
        if (hydratedCustomEventSelectionKey !== customEventSelectionStorageKey) return;
        setSelectedCustomEventNames((current) => {
            if (!customEventSelectionTouched) {
                return defaultCustomEventNames;
            }
            return current;
        });
    }, [customEventSelectionStorageKey, customEventSelectionTouched, defaultCustomEventNames, hydratedCustomEventSelectionKey]);

    useEffect(() => {
        if (
            !customEventSelectionStorageKey
            || hydratedCustomEventSelectionKey !== customEventSelectionStorageKey
            || !customEventSelectionTouched
            || typeof window === 'undefined'
        ) {
            return;
        }

        try {
            const selection = Array.from(new Set(selectedCustomEventNames));
            window.localStorage.setItem(customEventSelectionStorageKey, JSON.stringify(selection));
        } catch {
            // Local persistence is a convenience; keep in-memory selection working if storage is blocked.
        }
    }, [
        customEventSelectionStorageKey,
        customEventSelectionTouched,
        hydratedCustomEventSelectionKey,
        selectedCustomEventNames,
    ]);

    const selectedCustomEvents = useMemo(
        () => selectedCustomEventNames.filter((eventName) => customEventNameSet.has(eventName)),
        [selectedCustomEventNames, customEventNameSet],
    );

    const customEventPickerOptions = useMemo(() => {
        const searchTerm = customEventSearchQuery.trim().toLowerCase();
        const selectedIndexByName = new Map(selectedCustomEvents.map((eventName, index) => [eventName, index]));

        return customEvents
            .map((event, index) => ({
                ...event,
                sourceIndex: index,
            }))
            .filter((event) => !searchTerm || event.name.toLowerCase().includes(searchTerm))
            .sort((a, b) => {
                const aSelectedIndex = selectedIndexByName.get(a.name);
                const bSelectedIndex = selectedIndexByName.get(b.name);
                const aIsSelected = aSelectedIndex !== undefined;
                const bIsSelected = bSelectedIndex !== undefined;

                if (aIsSelected && bIsSelected) return aSelectedIndex - bSelectedIndex;
                if (aIsSelected) return -1;
                if (bIsSelected) return 1;
                return a.sourceIndex - b.sourceIndex;
            });
    }, [customEventSearchQuery, customEvents, selectedCustomEvents]);

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

    const customEventVersionMarkers = useMemo(
        () => buildVersionReleaseMarkersForDateKeys(
            versionChartData,
            versionKeys,
            customEventTrendData.map((row) => row.dateKey),
        ),
        [customEventTrendData, versionChartData, versionKeys],
    );

    const handleToggleCustomEvent = useCallback((eventName: string) => {
        setCustomEventSelectionTouched(true);
        setSelectedCustomEventNames((current) => (
            current.includes(eventName)
                ? current.filter((name) => name !== eventName)
                : [...current, eventName]
        ));
    }, []);

    const handleClearCustomEventSelection = useCallback(() => {
        setCustomEventSelectionTouched(true);
        setSelectedCustomEventNames([]);
    }, []);

    const recommendedSessions = useMemo(
        () => isDemoMode ? buildDemoRecommendedSessions(sessions) : buildRecommendedSessions(sessions),
        [isDemoMode, sessions],
    );

    // Prefer backend-aggregated top users (accurate all-window counts).
    // Fall back to session-pool computation only in demo mode.
    const topUsers = useMemo(() => {
        if (isDemoMode) {
            return buildTopUsers(sessions.filter((session) => DEMO_REPLAY_SESSION_ID_SET.has(session.id)));
        }
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
    }, [isDemoMode, topUsersFromBackend, sessions]);

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

    const handleCopyContactEmail = useCallback(async () => {
        try {
            await navigator.clipboard.writeText('contact@rejourney.co');
            setCopiedContactEmail(true);
            window.setTimeout(() => setCopiedContactEmail(false), 1600);
        } catch (error) {
            console.error('Failed to copy developer contact email:', error);
        }
    }, []);

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
            || (!isMobileLens && referralSummary.total > 0)
        );
    }, [trendChartData, overviewObs, deepMetrics, engagementTrends, geoSummary, referralSummary.total, isMobileLens]);

    const isSectionLoading = useCallback(
        (key: GeneralSectionKey) => sectionStatus[key] === 'idle' || sectionStatus[key] === 'loading',
        [sectionStatus],
    );
    const isAnyOverviewSectionPending = useMemo(
        () => GENERAL_SECTION_KEYS.some((key) => sectionStatus[key] === 'idle' || sectionStatus[key] === 'loading'),
        [sectionStatus],
    );
    const isTopUsersSectionLoading = isDemoMode ? isSessionsLoading : isTopUsersLoading;
    const isAnyCardLoading = isAnyOverviewSectionPending
        || isReferralLoading
        || isSessionsLoading
        || isTopUsersSectionLoading;
    const isTrendsLoading = isSectionLoading('trends');
    const isObservabilityLoading = isSectionLoading('observability');
    const isDeepMetricsLoading = isSectionLoading('deepMetrics');
    const isEngagementLoading = isSectionLoading('engagement');
    const isGeoLoading = isSectionLoading('geo');
    const isRetentionLoading = isSectionLoading('retention');
    const isMomentumLoading = isTrendsLoading || isObservabilityLoading || isDeepMetricsLoading;
    const partialError = failedSections.length > 0
        ? `Some widgets unavailable (${failedSections.join(', ')}).`
        : null;
    const showSetupEmptyState = Boolean(selectedProject?.id) && !isAnyCardLoading && !hasData;
    const showDashboardCards = Boolean(selectedProject?.id) && !showSetupEmptyState;

    return (
        <div className="rejourney-general-page min-h-screen bg-[#f8fafd] pb-12 font-sans text-[#202124]">
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

                {partialError && (
                    <div className="border-2 border-black bg-[#f9a8d4] p-4 text-sm font-bold text-black shadow-neo-sm">
                        {partialError}
                    </div>
                )}

                {showSetupEmptyState && (
                    <div className="dashboard-surface overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-sm">
                        <div className="border-b border-[#dadce0] bg-[#e6f4ea] px-4 py-4 sm:px-5">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase text-[#137333]">
                                <Info className="h-4 w-4 shrink-0" aria-hidden />
                                New project setup
                            </div>
                            <h3 className="mt-2 text-lg font-semibold text-[#202124]">No analytics yet - connect your project first</h3>
                            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[#3c4043]">
                                Once your first SDK sends data, this General dashboard will populate automatically.
                                Use these shortcuts to finish setup for Web, React Native, or Swift.
                            </p>
                        </div>

                        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-5">
                            <button
                                type="button"
                                onClick={handleCopyProjectKey}
                                disabled={!selectedProject?.publicKey}
                                className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-center text-xs font-semibold leading-snug text-[#202124] transition-colors hover:border-[#137333] hover:bg-[#f0fdf4] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Copy className="h-4 w-4 shrink-0" />
                                {copiedPublicKey ? 'Public key copied' : 'Copy public key'}
                            </button>

                            <button
                                type="button"
                                onClick={handleCopyIntegrationPrompt}
                                className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-center text-xs font-semibold leading-snug text-[#202124] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
                            >
                                <BookOpen className="h-4 w-4 shrink-0" />
                                {copiedDocsPrompt ? 'AI prompt copied' : 'Copy AI docs prompt'}
                            </button>

                            <a
                                href="/docs/web/getting-started"
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-center text-xs font-semibold leading-snug text-[#1a73e8] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
                            >
                                <ExternalLink className="h-4 w-4 shrink-0" />
                                View Web docs
                            </a>

                            <a
                                href="/docs/reactnative/overview"
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-center text-xs font-semibold leading-snug text-[#1a73e8] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
                            >
                                <ExternalLink className="h-4 w-4 shrink-0" />
                                View React Native docs
                            </a>

                            <a
                                href="/docs/swift/overview"
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-center text-xs font-semibold leading-snug text-[#1a73e8] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
                            >
                                <ExternalLink className="h-4 w-4 shrink-0" />
                                View Swift docs
                            </a>
                        </div>

                        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                            <button
                                type="button"
                                onClick={handleCopyContactEmail}
                                title="Copy developer contact email: contact@rejourney.co"
                                aria-label="Copy developer contact email"
                                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-[#1d4ed8] bg-[#1a73e8] px-4 py-3 text-center text-sm font-bold leading-snug text-white shadow-sm transition-colors hover:border-[#1e40af] hover:bg-[#2563eb] active:bg-[#1d4ed8]"
                            >
                                {copiedContactEmail ? <Check className="h-4 w-4 shrink-0" /> : <Mail className="h-4 w-4 shrink-0" />}
                                <span className="min-w-0">
                                    {copiedContactEmail ? 'Developer email copied' : 'Having an issue? Need a feature? Contact our devs!'}
                                </span>
                            </button>
                        </div>
                    </div>
                )}

                {showDashboardCards && (
                    <>
                        {isMomentumLoading ? (
                            <MomentumCardGhostGrid />
                        ) : momentumCards.length > 0 && (
                            <section>
                                <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                                    {momentumCards.map((card, index) => {
                                        const deltaClass = card.deltaValue === null || card.deltaValue === 0
                                            ? 'text-slate-600'
                                            : (card.positiveIsGood ? card.deltaValue > 0 : card.deltaValue < 0)
                                                ? 'text-emerald-700'
                                                : 'text-rose-700';

                                        return (
                                            <div key={card.label} className="rejourney-kpi-card min-w-0 rounded-xl border border-[#dadce0] bg-white p-4 shadow-none transition-colors hover:border-[#bdc1c6] sm:p-5">
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
                                {isTrendsLoading ? (
                                    <GA4CardGhost title="User activity over time" className="xl:col-span-5" accentClassName="bg-[#67e8f9]" minHeight="210px" />
                                ) : (
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
                                        <LineChart data={trendChartData} margin={{ top: 28, right: 8, left: -20, bottom: 0 }}>
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip
                                                allowEscapeViewBox={VERSION_TOOLTIP_ALLOW_ESCAPE}
                                                position={VERSION_TOOLTIP_POSITION}
                                                wrapperStyle={VERSION_TOOLTIP_WRAPPER_STYLE}
                                                content={<VersionAwareChartTooltip releaseMarkers={trendVersionMarkers} />}
                                            />
                                            <Line type="monotone" dataKey="sessions" stroke="#f9a8d4" strokeWidth={1.75} dot={false} name="Sessions" isAnimationActive={false} />
                                            <Line type="monotone" dataKey="dau" stroke="#1a73e8" strokeWidth={2} dot={false} name="DAU" isAnimationActive={false} />
                                            <Line type="monotone" dataKey="mau" stroke="#34a853" strokeWidth={1.5} dot={false} name="MAU" isAnimationActive={false} />
                                            {trendVersionMarkers.map((marker, index) => (
                                                <ReferenceLine
                                                    key={`activity-version-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#334155"
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.4}
                                                    ifOverflow="extendDomain"
                                                    label={buildVersionReleaseLineLabel(marker.version, index)}
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                                </GA4Card>
                                )}

                                {isTrendsLoading ? (
                                    <GA4CardGhost title="Active users snapshot" className="xl:col-span-3" accentClassName="bg-[#86efac]" minHeight="210px" rows={3} />
                                ) : (
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
                                    {isGeoLoading ? (
                                        <div className="space-y-1.5">
                                            {Array.from({ length: 4 }).map((_, index) => (
                                                <div key={index} className="flex justify-between gap-2">
                                                    <GhostBlock className="h-3 w-20" />
                                                    <GhostBlock className="h-3 w-8" />
                                                </div>
                                            ))}
                                        </div>
                                    ) : topCountries.length > 0 ? topCountries.map((country) => (
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
                                )}

                                <GA4Card
                                    title="Referral sources"
                                    className="xl:col-span-4"
                                    accentClassName="bg-[#f9a8d4]"
                                    action={(
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                            <div className="inline-flex overflow-hidden border border-black bg-white text-[10px] font-black uppercase">
                                                {([
                                                    ['referrer', 'Referrers'],
                                                    ['utm', 'UTM'],
                                                ] as const).map(([mode, label]) => (
                                                    <button
                                                        key={mode}
                                                        type="button"
                                                        aria-pressed={referralSourceMode === mode}
                                                        onClick={() => setReferralSourceMode(mode)}
                                                        className={`min-h-7 px-2.5 transition ${referralSourceMode === mode ? 'bg-black text-white' : 'text-black hover:bg-[#f8fafc]'}`}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                            {referralSourceMode === 'utm' ? (
                                                <div className="relative inline-flex items-center">
                                                    <select
                                                        value={referralUtmDimension}
                                                        onChange={(event) => setReferralUtmDimension(event.target.value as ReferralUtmDimension)}
                                                        aria-label="UTM dimension"
                                                        className="min-h-7 appearance-none border border-black bg-white pl-2.5 pr-7 text-[10px] font-black uppercase text-black outline-none transition hover:bg-[#f8fafc] focus:ring-2 focus:ring-black"
                                                    >
                                                        {REFERRAL_UTM_DIMENSIONS.map((dimension) => (
                                                            <option key={dimension.key} value={dimension.key}>{dimension.label}</option>
                                                        ))}
                                                    </select>
                                                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                                                </div>
                                            ) : null}
                                        </div>
                                    )}
                                >
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
                                            <div key={row.key} className="group min-w-0">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-black bg-[#eef4ff] text-xs font-black uppercase text-black">
                                                        {row.source === DIRECT_REFERRAL_LABEL || row.source.startsWith('No UTM') ? (
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
                                                        {row.detail ? (
                                                            <div className="mt-0.5 truncate text-[10px] font-semibold uppercase text-slate-400" title={row.detail}>
                                                                {row.detail}
                                                            </div>
                                                        ) : null}
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
                                        {referralSourceMode === 'utm'
                                            ? `No web UTM ${REFERRAL_UTM_DIMENSION_META[referralUtmDimension].label.toLowerCase()} observed for this filter.`
                                            : 'No web referral sources observed for this filter.'}
                                    </div>
                                )}
                                </GA4Card>

                                {isTrendsLoading ? (
                                    <GA4CardGhost title="Active users by version" className="xl:col-span-4" accentClassName="bg-[#c4b5fd]" minHeight="210px" rows={3} />
                                ) : (
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
                                )}

                                {isEngagementLoading ? (
                                    <GA4CardGhost title="User engagement mix" className="xl:col-span-8" accentClassName="bg-[#67e8f9]" minHeight="250px" />
                                ) : (
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
                                                <AreaChart data={engagementMixChartData} margin={{ top: 28, right: 8, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                    <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                                    <YAxis tick={{ fontSize: 10 }} />
                                                    <Tooltip
                                                        allowEscapeViewBox={VERSION_TOOLTIP_ALLOW_ESCAPE}
                                                        position={VERSION_TOOLTIP_POSITION}
                                                        wrapperStyle={VERSION_TOOLTIP_WRAPPER_STYLE}
                                                        content={(
                                                            <VersionAwareChartTooltip
                                                                releaseMarkers={engagementVersionMarkers}
                                                                formatter={(value, name) => [formatCompact(value ?? 0), name ?? 'Users']}
                                                            />
                                                        )}
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
                                                    {engagementVersionMarkers.map((marker, index) => (
                                                        <ReferenceLine
                                                            key={`engagement-version-${marker.version}-${marker.dateKey}`}
                                                            x={marker.dateKey}
                                                            stroke="#334155"
                                                            strokeDasharray="4 4"
                                                            strokeWidth={1.4}
                                                            ifOverflow="extendDomain"
                                                            label={buildVersionReleaseLineLabel(marker.version, index)}
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
                                )}
                            </div>

                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                            {isDeepMetricsLoading ? (
                                <GA4CardGhost title="Stability overview" className="xl:col-span-4" accentClassName="bg-[#f9a8d4]" minHeight="120px" rows={3} />
                            ) : (
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
                            )}

                            {isTrendsLoading ? (
                                <GA4CardGhost title="Average engagement time per active user" className="xl:col-span-4" accentClassName="bg-[#67e8f9]" minHeight="160px" rows={2} />
                            ) : (
                            <GA4Card title="Average engagement time per active user" className="xl:col-span-4" accentClassName="bg-[#67e8f9]">
                                <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-3">
                                    <div>
                                        <div className="dashboard-value-lg">{avgEngagementTime}</div>
                                    </div>
                                    <div>
                                        <span className="dashboard-label">Engaged user share</span>
                                        <div className="dashboard-value-md">
                                            {isEngagementLoading ? (
                                                <GhostBlock className="h-7 w-20" />
                                            ) : engagedUserShare === null ? 'N/A' : `${engagedUserShare.toFixed(1)}%`}
                                        </div>
                                    </div>
                                </div>
                                <div className="h-[130px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={engagementChartData} margin={{ top: 28, right: 8, left: -20, bottom: 0 }}>
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip
                                                allowEscapeViewBox={VERSION_TOOLTIP_ALLOW_ESCAPE}
                                                position={VERSION_TOOLTIP_POSITION}
                                                wrapperStyle={VERSION_TOOLTIP_WRAPPER_STYLE}
                                                content={(
                                                    <VersionAwareChartTooltip
                                                        releaseMarkers={trendVersionMarkers}
                                                        formatter={(value) => [formatDuration(value ?? 0), 'Avg engagement']}
                                                    />
                                                )}
                                            />
                                            <Line type="monotone" dataKey="engagementTime" stroke="#1a73e8" strokeWidth={2} dot={false} isAnimationActive={false} />
                                            {trendVersionMarkers.map((marker, index) => (
                                                <ReferenceLine
                                                    key={`avg-engagement-version-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#334155"
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.4}
                                                    ifOverflow="extendDomain"
                                                    label={buildVersionReleaseLineLabel(marker.version, index)}
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </GA4Card>
                            )}

                            {isTrendsLoading ? (
                                <GA4CardGhost title="User retention" className="xl:col-span-4" accentClassName="bg-[#86efac]" minHeight="210px" rows={2} />
                            ) : (
                            <GA4Card title="User retention" className="xl:col-span-4" accentClassName="bg-[#86efac]">
                                <div className="h-[180px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={retentionChartData} margin={{ top: 28, right: 8, left: -20, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                                            <Tooltip
                                                allowEscapeViewBox={VERSION_TOOLTIP_ALLOW_ESCAPE}
                                                position={VERSION_TOOLTIP_POSITION}
                                                wrapperStyle={VERSION_TOOLTIP_WRAPPER_STYLE}
                                                content={(
                                                    <VersionAwareChartTooltip
                                                        releaseMarkers={trendVersionMarkers}
                                                        formatter={(value) => [`${value ?? 0}%`, 'DAU/MAU stickiness']}
                                                    />
                                                )}
                                            />
                                            <Bar dataKey="retention" fill="#1a73e8" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                                            {trendVersionMarkers.map((marker, index) => (
                                                <ReferenceLine
                                                    key={`retention-version-${marker.version}-${marker.dateKey}`}
                                                    x={marker.dateKey}
                                                    stroke="#334155"
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.4}
                                                    ifOverflow="extendDomain"
                                                    label={buildVersionReleaseLineLabel(marker.version, index)}
                                                />
                                            ))}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-1 text-center text-[10px] text-slate-400">
                                    Last {retentionChartData.length} points
                                </div>
                            </GA4Card>
                            )}

                            {isRetentionLoading ? (
                                <GA4CardGhost title="Retention cohorts" className="xl:col-span-12" accentClassName="bg-[#c4b5fd]" minHeight="190px" rows={4} />
                            ) : (
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
                            )}
                            </div>

                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                            {isObservabilityLoading ? (
                                <GA4CardGhost title="Custom Events" className="xl:col-span-5" accentClassName="bg-[#f9a8d4]" minHeight="210px" rows={5} />
                            ) : (
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
                            )}

                            {isObservabilityLoading ? (
                                <GA4CardGhost title="Custom event usage over time" className="xl:col-span-7" accentClassName="bg-[#c4b5fd]" minHeight="300px" rows={4} />
                            ) : (
                            <GA4Card
                                title="Custom event usage over time"
                                className="xl:col-span-7"
                                accentClassName="bg-[#c4b5fd]"
                                action={customEvents.length > 0 ? (
                                    <span className={`border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                        selectedCustomEvents.length > 0
                                            ? 'border-emerald-700 bg-emerald-50 text-emerald-700'
                                            : 'border-[#dadce0] bg-[#f8fafc] text-slate-600'
                                    }`}
                                    >
                                        {selectedCustomEvents.length} selected
                                    </span>
                                ) : null}
                            >
                                {customEvents.length > 0 ? (
                                    <>
                                        <div className="mb-3 space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <label className="relative min-w-[220px] flex-1">
                                                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                                    <input
                                                        type="search"
                                                        value={customEventSearchQuery}
                                                        onChange={(event) => setCustomEventSearchQuery(event.target.value)}
                                                        placeholder="Search events"
                                                        aria-label="Search custom events"
                                                        className="h-7 w-full border border-[#dadce0] bg-white pl-7 pr-8 text-[11px] font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 hover:border-emerald-500 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                                                    />
                                                    {customEventSearchQuery ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setCustomEventSearchQuery('')}
                                                            aria-label="Clear custom event search"
                                                            className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center border border-transparent text-slate-400 transition hover:border-[#dadce0] hover:text-slate-700"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    ) : null}
                                                </label>
                                                <span className="inline-flex h-7 items-center border border-[#dadce0] bg-[#f8fafc] px-2 text-[10px] font-semibold uppercase text-slate-500">
                                                    {customEventPickerOptions.length}/{customEvents.length} events
                                                </span>
                                                {selectedCustomEvents.length > 0 ? (
                                                    <button
                                                        type="button"
                                                        onClick={handleClearCustomEventSelection}
                                                        className="inline-flex h-7 items-center gap-1.5 border border-[#dadce0] bg-white px-2 text-[10px] font-semibold uppercase text-slate-600 transition hover:border-emerald-600 hover:text-emerald-700"
                                                    >
                                                        <X className="h-3 w-3" />
                                                        Clear
                                                    </button>
                                                ) : null}
                                            </div>
                                            <div className="max-h-[82px] overflow-y-auto pr-1">
                                                <div className="flex flex-wrap gap-1.5">
                                                    {customEventPickerOptions.map((event) => {
                                                        const selectedIndex = selectedCustomEvents.indexOf(event.name);
                                                        const isSelected = selectedIndex >= 0;
                                                        const colorIndex = isSelected ? selectedIndex : event.sourceIndex;
                                                        const eventColor = CUSTOM_EVENT_TREND_COLORS[colorIndex % CUSTOM_EVENT_TREND_COLORS.length];
                                                        return (
                                                            <button
                                                                key={event.name}
                                                                type="button"
                                                                aria-pressed={isSelected}
                                                                onClick={() => handleToggleCustomEvent(event.name)}
                                                                className={`inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 border px-2 text-left text-[10px] font-semibold transition-colors ${
                                                                    isSelected
                                                                        ? 'border-emerald-700 bg-emerald-600 text-white'
                                                                        : 'border-[#dadce0] bg-white text-slate-600 hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-800'
                                                                }`}
                                                                title={event.name}
                                                            >
                                                                <span className="flex min-w-0 items-center gap-1.5">
                                                                    <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                                                                        isSelected ? 'border-white/70 bg-emerald-500' : 'border-slate-300 bg-white'
                                                                    }`}
                                                                    >
                                                                        {isSelected ? <Check className="h-2.5 w-2.5 text-white" /> : null}
                                                                    </span>
                                                                    <span
                                                                        className={`h-2 w-2 shrink-0 border ${isSelected ? 'border-white/70' : 'border-black'}`}
                                                                        style={{ backgroundColor: eventColor }}
                                                                    />
                                                                    <span className="max-w-[12rem] truncate sm:max-w-[14rem]">{event.name}</span>
                                                                </span>
                                                                <span className={isSelected ? 'shrink-0 text-emerald-100' : 'shrink-0 text-slate-400'}>
                                                                    {formatCompact(event.count)}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                    {customEventPickerOptions.length === 0 ? (
                                                        <div className="flex h-14 w-full items-center justify-center border border-dashed border-[#dadce0] bg-[#f8fafc] text-xs text-slate-400">
                                                            No matching events.
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>

                                        {customEventTrendData.length > 0 && selectedCustomEvents.length > 0 ? (
                                            <div className="h-[220px]">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={customEventTrendData} margin={{ top: 28, right: 8, left: -20, bottom: 0 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                        <XAxis dataKey="dateKey" tick={{ fontSize: 10 }} tickFormatter={formatDateLabel} minTickGap={40} />
                                                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                                                        <Tooltip
                                                            allowEscapeViewBox={VERSION_TOOLTIP_ALLOW_ESCAPE}
                                                            position={VERSION_TOOLTIP_POSITION}
                                                            wrapperStyle={VERSION_TOOLTIP_WRAPPER_STYLE}
                                                            content={(
                                                                <VersionAwareChartTooltip
                                                                    releaseMarkers={customEventVersionMarkers}
                                                                    formatter={(value, name) => [formatCompact(value ?? 0), name ?? 'Events']}
                                                                />
                                                            )}
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
                                                        {customEventVersionMarkers.map((marker, index) => (
                                                            <ReferenceLine
                                                                key={`custom-event-version-${marker.version}-${marker.dateKey}`}
                                                                x={marker.dateKey}
                                                                stroke="#334155"
                                                                strokeDasharray="4 4"
                                                                strokeWidth={1.4}
                                                                ifOverflow="extendDomain"
                                                                label={buildVersionReleaseLineLabel(marker.version, index)}
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
                            )}
                            </div>

                            <section className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="border-2 border-black bg-[#86efac] px-3 py-1.5 text-base font-extrabold text-black shadow-neo-sm">Top Users</h2>
                                </div>
                                <NeoBadge variant="info" size="sm" className="rounded-none border-black bg-white text-black shadow-neo-sm">
                                    {isTopUsersSectionLoading ? '...' : `${topUsers.length}/20 users`}
                                </NeoBadge>
                            </div>

                            {isTopUsersSectionLoading ? (
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
                                                                    getMiniSessionCoverPhotoUrl(session, isDemoMode),
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
                                    {isSessionsLoading ? '...' : `${recommendedSessions.length} picks`}
                                </NeoBadge>
                            </div>

                            {isSessionsLoading ? (
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
                                                                        getMiniSessionCoverPhotoUrl(rec.session, isDemoMode),
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
