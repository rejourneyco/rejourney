import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    BookOpen,
    ChevronDown,
    ChevronRight,
    Check,
    Copy,
    ExternalLink,
    Globe2,
    Info,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Settings,
    Trash2,
    Unplug,
    Wrench,
    X,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    ComposedChart,
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
    createManualRevenueEntry,
    getDashboardOverviewHeavy,
    getGeoSummary,
    getGrowthObservability,
    getInsightsTrends,
    getObservabilityDeepMetrics,
    getRevenueOverview,
    getRetentionCohorts,
    getSessionsPaginated,
    getUserEngagementTrends,
    configureCustomEventRevenue,
    CustomRevenueEventConfig,
    connectRevenueCatRevenue,
    connectSuperwallRevenue,
    deleteManualRevenueEntry,
    disconnectRevenueSource,
    GeoSummary,
    GrowthObservability,
    InsightsTrends,
    ObservabilityDeepMetrics,
    RevenueOverview,
    RevenueProvider,
    RevenueManualEntry,
    RetentionCohortRow,
    setRevenueSource,
    syncRevenueSource,
    TopUserEntry,
    updateManualRevenueEntry,
    UserEngagementTrends,
} from '~/shared/api/client';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { useSharedPlatformLens, platformLensToSessionPlatform } from '~/shared/hooks/useSharedPlatformLens';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { formatDeviceModel } from '~/shared/lib/deviceModelNames';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { MiniSessionCard } from '~/shared/ui/core/MiniSessionCard';
import { AnimalAvatar, getAnimalAvatarSeed, getAnimalForIdentity } from '~/shared/ui/core/AnimalAvatar';
import { CountryFlag } from '~/shared/ui/core/CountryFlag';
import { buildProjectAIIntegrationPrompt } from '~/shared/constants/aiPrompts';
import { RecordingSession } from '~/shared/types';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
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

const formatCurrencyMinor = (amountMinor: number, currency: string | null | undefined, compact = false): string => {
    const currencyCode = (currency || 'usd').toUpperCase();
    const amount = amountMinor / 100;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode,
            notation: compact ? 'compact' : 'standard',
            maximumFractionDigits: compact ? 1 : 2,
        }).format(amount);
    } catch {
        return `${currencyCode} ${amount.toLocaleString(undefined, {
            maximumFractionDigits: compact ? 1 : 2,
        })}`;
    }
};

const formatManualAmountInput = (amountCents: number): string => {
    const amount = amountCents / 100;
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

const parseManualAmountInput = (value: string): number | null => {
    const normalized = value.trim().replace(/,/g, '');
    if (!normalized || !/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return null;
    return Math.round(amount * 100);
};

const formatRevenueChange = (value: number | null): string => {
    if (value === null || !Number.isFinite(value)) return 'No previous window';
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
};

const formatSyncTime = (value: string | null | undefined): string => {
    if (!value) return 'Not synced yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not synced yet';
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

function buildDemoRevenueOverview(trendRows: TrendChartRow[]): RevenueOverview | null {
    if (!trendRows.length) return null;

    const daily = trendRows.map((row, index) => {
        const grossAmountCents = Math.max(0, Math.round(row.sessions * 260 + row.dau * 35 + index * 120));
        const refundAmountCents = index % 7 === 0 ? Math.round(grossAmountCents * 0.08) : 0;
        const feeAmountCents = Math.round(grossAmountCents * 0.032);
        const netAmountCents = grossAmountCents - refundAmountCents - feeAmountCents;

        return {
            date: row.dateKey,
            currency: 'usd',
            grossAmountCents,
            refundAmountCents,
            feeAmountCents,
            netAmountCents,
            transactionCount: Math.max(1, Math.round(row.sessions / 18)),
            refundCount: refundAmountCents > 0 ? 1 : 0,
            subscriberCount: index % 3 === 0 ? 2 : 1,
            trialCount: index % 4 === 0 ? 3 : 0,
            subscriptionStartCount: index % 3 === 0 ? 2 : 1,
            cancellationCount: index % 8 === 0 ? 1 : 0,
            conversionCount: index % 5 === 0 ? 2 : 1,
            customEventCounts: {},
        };
    });
    const startingRevenueCents = 249900;
    if (daily[0]) {
        daily[0] = {
            ...daily[0],
            grossAmountCents: daily[0].grossAmountCents + startingRevenueCents,
            netAmountCents: daily[0].netAmountCents + startingRevenueCents,
            transactionCount: daily[0].transactionCount + 1,
            customEventCounts: {
                ...daily[0].customEventCounts,
                initial_revenue: 1,
            },
        };
    }

    const summary = daily.reduce(
        (acc, row) => {
            acc.grossAmountCents += row.grossAmountCents;
            acc.refundAmountCents += row.refundAmountCents;
            acc.feeAmountCents += row.feeAmountCents;
            acc.netAmountCents += row.netAmountCents;
            acc.transactionCount += row.transactionCount;
            acc.refundCount += row.refundCount;
            acc.subscriberCount += row.subscriberCount;
            acc.trialCount += row.trialCount;
            acc.subscriptionStartCount += row.subscriptionStartCount;
            acc.cancellationCount += row.cancellationCount;
            acc.conversionCount += row.conversionCount;
            return acc;
        },
        {
            grossAmountCents: 0,
            refundAmountCents: 0,
            feeAmountCents: 0,
            netAmountCents: 0,
            transactionCount: 0,
            refundCount: 0,
            subscriberCount: 0,
            trialCount: 0,
            subscriptionStartCount: 0,
            cancellationCount: 0,
            conversionCount: 0,
        },
    );
    const previousGrossAmountCents = Math.round(summary.grossAmountCents / 1.186);

    return {
        configured: true,
        activeProvider: 'custom_events',
        providers: [
            {
                provider: 'custom_events',
                label: 'Custom events',
                configured: true,
                status: 'connected',
                accountId: 'demo_custom_events',
                accountName: 'Rejourney custom events',
                connectedAt: '2026-05-01T00:00:00.000Z',
                lastSyncStartedAt: null,
                lastSyncCompletedAt: '2026-06-03T08:00:00.000Z',
                lastSyncError: null,
            },
            {
                provider: 'superwall',
                label: 'Superwall',
                configured: true,
                status: 'not_connected',
                accountId: null,
                accountName: null,
                connectedAt: null,
                lastSyncStartedAt: null,
                lastSyncCompletedAt: null,
                lastSyncError: null,
            },
            {
                provider: 'revenuecat',
                label: 'RevenueCat',
                configured: true,
                status: 'not_connected',
                accountId: null,
                accountName: null,
                connectedAt: null,
                lastSyncStartedAt: null,
                lastSyncCompletedAt: null,
                lastSyncError: null,
            },
        ],
        connection: {
            provider: 'custom_events',
            label: 'Custom events',
            configured: true,
            status: 'connected',
            accountId: 'demo_custom_events',
            accountName: 'Rejourney custom events',
            connectedAt: '2026-05-01T00:00:00.000Z',
            lastSyncStartedAt: null,
            lastSyncCompletedAt: '2026-06-03T08:00:00.000Z',
            lastSyncError: null,
            canManage: true,
        },
        customEventConfig: DEFAULT_CUSTOM_REVENUE_CONFIG,
        syncPreview: {
            provider: 'custom_events',
            scannedSessionCount: 240,
            matchedSessionCount: 86,
            matchedEventCount: 112,
            revenueEventCount: 86,
        },
        manualEntries: daily.slice(0, 1).map((row) => ({
            id: 'demo-starting-revenue',
            date: row.date,
            currency: 'usd',
            amountCents: startingRevenueCents,
            transactionCount: 1,
            note: 'Initial revenue before Rejourney tracking',
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-06-03T08:00:00.000Z',
        })),
        currencies: [{ currency: 'usd', grossAmountCents: summary.grossAmountCents }],
        selectedCurrency: 'usd',
        summary: {
            ...summary,
            previousGrossAmountCents,
            grossChangePercent: previousGrossAmountCents > 0
                ? ((summary.grossAmountCents - previousGrossAmountCents) / previousGrossAmountCents) * 100
                : null,
        },
        daily,
    };
}

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

const DEMO_REPLAY_SESSION_ID_SET = new Set(DEMO_REPLAY_SESSION_IDS);

function getAnonymousNickname(session: RecordingSession): string | null {
    const displayName = session.anonymousDisplayName?.trim();
    if (displayName) return displayName;

    const anonymousId = session.anonymousId?.trim();
    if (!anonymousId || anonymousId.toLowerCase() === 'anonymous') return null;
    return anonymousId.length > 22 ? `${anonymousId.slice(0, 22)}...` : anonymousId;
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

type RevenueImpactChartRow = {
    dateKey: string;
    grossAmountCents: number;
    refundAmountCents: number;
    netAmountCents: number;
    transactionCount: number;
    refundCount: number;
    subscriberCount: number;
    trialCount: number;
    subscriptionStartCount: number;
    cancellationCount: number;
    conversionCount: number;
    customEventCounts: Record<string, number>;
};

type RevenueTooltipPayloadItem = {
    payload?: RevenueImpactChartRow;
};

type RevenueCustomEventOption = {
    name: string;
    count: number;
};

const ENGAGEMENT_SEGMENTS: Array<{ key: EngagementSegmentKey; label: string; color: string }> = [
    { key: 'bouncers', label: 'Bouncers', color: '#ef4444' },
    { key: 'casuals', label: 'Casuals', color: '#f9a8d4' },
    { key: 'explorers', label: 'Explorers', color: '#3b82f6' },
    { key: 'loyalists', label: 'Loyalists', color: '#10b981' },
];

const CUSTOM_EVENT_TREND_COLORS = ['#1a73e8', '#1e8e3e', '#9334e6', '#f9a8d4', '#0f766e', '#f59e0b'];

const RETRO_CARD_ACCENTS = ['#67e8f9', '#86efac', '#f9a8d4', '#c4b5fd'];
const DIRECT_REFERRAL_LABEL = 'Direct / none';
const NO_UTM_LABEL = 'No UTM tag';
const CUSTOM_EVENT_SELECTION_STORAGE_PREFIX = 'rejourney.general.customEventSelection';
const REVENUE_IMPACT_COLLAPSED_STORAGE_PREFIX = 'rejourney.general.revenueImpactCollapsed';
const MAX_VERSION_RELEASE_MARKERS = 6;

const REVENUE_PROVIDER_META: Record<RevenueProvider, {
    label: string;
    shortLabel: string;
    description: string;
    logo?: string;
}> = {
    custom_events: {
        label: 'Custom Events',
        shortLabel: 'Custom events',
        description: 'Map Rejourney purchase and lifecycle events.',
        logo: '/rejourneyIcon-removebg-preview.png',
    },
    superwall: {
        label: 'Superwall',
        shortLabel: 'Superwall',
        description: 'Use a scoped read-only Superwall API key.',
        logo: '/brands/superwall/superwall-logo.svg',
    },
    revenuecat: {
        label: 'RevenueCat',
        shortLabel: 'RevenueCat',
        description: 'Sync authoritative RevenueCat v2 revenue charts.',
        logo: '/brands/revenuecat/revenuecat-logo.svg',
    },
};

const DEFAULT_CUSTOM_REVENUE_CONFIG: CustomRevenueEventConfig = {
    revenueEventName: 'purchase_completed',
    revenueAmountProperty: 'amount',
    revenueCurrencyProperty: 'currency',
    defaultCurrency: 'USD',
    amountUnit: 'major',
    refundEventName: '',
    // NOTE: 'subscriberEventName' maps to 'cart_add' funnel transition in researchLake.ts.
    // By default, the Research Lake also contains regex fallback equivalencies for 'product_added_to_cart'
    // and 'added_to_cart' (supporting legacy SDK configurations).
    subscriberEventName: '',
    trialStartedEventName: '',
    subscriptionStartedEventName: '',
    cancellationEventName: '',
    conversionEventName: '',
};

type RevenueProviderStatusView = RevenueOverview['providers'][number];
type RevenueConnectionView = RevenueOverview['connection'];
type RevenueStatus = RevenueConnectionView['status'];

type RevenueActionState = {
    kind:
        | 'select_provider'
        | 'sync'
        | 'connect_superwall'
        | 'connect_revenuecat'
        | 'save_custom_events'
        | 'save_manual'
        | 'delete_manual'
        | 'disconnect';
    provider?: RevenueProvider;
    entryId?: string;
} | null;

type ManualRevenueEntryInput = {
    entryId?: string;
    date: string;
    amountCents: number;
    currency: string;
    transactionCount: number;
    note?: string | null;
};

function fallbackRevenueProviderStatus(provider: RevenueProvider): RevenueProviderStatusView {
    return {
        provider,
        label: REVENUE_PROVIDER_META[provider].shortLabel,
        configured: true,
        status: 'not_connected',
        accountId: null,
        accountName: null,
        connectedAt: null,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSyncError: null,
    };
}

function patchRevenueProviderStatus(
    overview: RevenueOverview | null,
    provider: RevenueProvider,
    patch: Partial<RevenueProviderStatusView>,
    options: { activeProvider?: RevenueProvider | null; updateConnection?: boolean } = {},
): RevenueOverview | null {
    if (!overview) return overview;
    const existing = overview.providers.find((item) => item.provider === provider) ?? fallbackRevenueProviderStatus(provider);
    const nextStatus: RevenueProviderStatusView = {
        ...existing,
        ...patch,
        provider,
        label: existing.label || REVENUE_PROVIDER_META[provider].shortLabel,
        configured: patch.configured ?? existing.configured,
    };
    const providers = overview.providers.some((item) => item.provider === provider)
        ? overview.providers.map((item) => item.provider === provider ? nextStatus : item)
        : [...overview.providers, nextStatus];
    const hasActiveProviderOverride = Object.prototype.hasOwnProperty.call(options, 'activeProvider');
    const activeProvider = hasActiveProviderOverride ? options.activeProvider ?? null : overview.activeProvider;
    const shouldUpdateConnection = options.updateConnection ?? (
        overview.connection.provider === provider
        || overview.activeProvider === provider
        || activeProvider === provider
    );

    return {
        ...overview,
        configured: true,
        activeProvider,
        providers,
        connection: shouldUpdateConnection
            ? {
                ...nextStatus,
                canManage: overview.connection.canManage,
            }
            : overview.connection,
    };
}

function normalizeManualEntryForUi(input: ManualRevenueEntryInput, existing?: RevenueManualEntry | null): RevenueManualEntry {
    const now = new Date().toISOString();
    return {
        id: input.entryId || existing?.id || 'optimistic-starting-revenue',
        date: input.date,
        currency: input.currency.toLowerCase(),
        amountCents: input.amountCents,
        transactionCount: Math.max(1, Math.round(input.transactionCount || 1)),
        note: input.note ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
}

function patchDailyRowForManualEntry(
    rows: RevenueOverview['daily'],
    entry: RevenueManualEntry,
    previousEntry: RevenueManualEntry | null,
): RevenueOverview['daily'] {
    const deltaAmount = entry.amountCents - (previousEntry?.amountCents ?? 0);
    const deltaTransactions = entry.transactionCount - (previousEntry?.transactionCount ?? 0);
    if (deltaAmount === 0 && deltaTransactions === 0) return rows;

    const rowIndex = rows.findIndex((row) => row.date === entry.date && row.currency === entry.currency);
    if (rowIndex === -1) {
        return [
            ...rows,
            {
                date: entry.date,
                currency: entry.currency,
                grossAmountCents: Math.max(entry.amountCents, 0),
                refundAmountCents: entry.amountCents < 0 ? Math.abs(entry.amountCents) : 0,
                feeAmountCents: 0,
                netAmountCents: entry.amountCents,
                transactionCount: entry.transactionCount,
                refundCount: entry.amountCents < 0 ? entry.transactionCount : 0,
                subscriberCount: 0,
                trialCount: 0,
                subscriptionStartCount: 0,
                cancellationCount: 0,
                conversionCount: 0,
                customEventCounts: {},
            },
        ].sort((a, b) => a.date.localeCompare(b.date));
    }

    return rows.map((row, index) => {
        if (index !== rowIndex) return row;
        return {
            ...row,
            grossAmountCents: Math.max(0, row.grossAmountCents + Math.max(deltaAmount, 0)),
            refundAmountCents: Math.max(0, row.refundAmountCents + (deltaAmount < 0 ? Math.abs(deltaAmount) : 0)),
            netAmountCents: row.netAmountCents + deltaAmount,
            transactionCount: Math.max(0, row.transactionCount + deltaTransactions),
        };
    });
}

function patchRevenueManualEntry(
    overview: RevenueOverview | null,
    input: ManualRevenueEntryInput,
): RevenueOverview | null {
    if (!overview) return overview;
    const existing = input.entryId
        ? overview.manualEntries.find((entry) => entry.id === input.entryId) ?? overview.manualEntries[0] ?? null
        : overview.manualEntries[0] ?? null;
    const entry = normalizeManualEntryForUi(input, existing);
    const previousAmount = overview.manualEntries.reduce((sum, item) => sum + item.amountCents, 0);
    const previousTransactions = overview.manualEntries.reduce((sum, item) => sum + item.transactionCount, 0);
    const amountDelta = entry.amountCents - previousAmount;
    const transactionDelta = entry.transactionCount - previousTransactions;
    const selectedCurrency = overview.selectedCurrency ?? entry.currency;
    const currencies = overview.currencies.some((row) => row.currency === entry.currency)
        ? overview.currencies.map((row) => row.currency === entry.currency
            ? { ...row, grossAmountCents: Math.max(0, row.grossAmountCents + amountDelta) }
            : row)
        : [...overview.currencies, { currency: entry.currency, grossAmountCents: Math.max(entry.amountCents, 0) }];

    return patchRevenueProviderStatus({
        ...overview,
        selectedCurrency,
        manualEntries: [entry],
        currencies,
        summary: {
            ...overview.summary,
            grossAmountCents: Math.max(0, overview.summary.grossAmountCents + Math.max(amountDelta, 0)),
            netAmountCents: overview.summary.netAmountCents + amountDelta,
            transactionCount: Math.max(0, overview.summary.transactionCount + transactionDelta),
        },
        daily: patchDailyRowForManualEntry(overview.daily, entry, existing),
    }, 'custom_events', {
        status: 'connected',
        connectedAt: overview.connection.connectedAt ?? new Date().toISOString(),
        lastSyncError: null,
    }, { activeProvider: 'custom_events', updateConnection: true });
}

function removeRevenueManualEntry(
    overview: RevenueOverview | null,
    entryId: string,
): RevenueOverview | null {
    if (!overview) return overview;
    const entry = overview.manualEntries.find((item) => item.id === entryId) ?? overview.manualEntries[0] ?? null;
    if (!entry) return overview;

    return {
        ...overview,
        manualEntries: overview.manualEntries.filter((item) => item.id !== entry.id),
        summary: {
            ...overview.summary,
            grossAmountCents: Math.max(0, overview.summary.grossAmountCents - Math.max(entry.amountCents, 0)),
            netAmountCents: overview.summary.netAmountCents - entry.amountCents,
            transactionCount: Math.max(0, overview.summary.transactionCount - entry.transactionCount),
        },
        daily: overview.daily.map((row) => {
            if (row.date !== entry.date || row.currency !== entry.currency) return row;
            return {
                ...row,
                grossAmountCents: Math.max(0, row.grossAmountCents - Math.max(entry.amountCents, 0)),
                refundAmountCents: Math.max(0, row.refundAmountCents - (entry.amountCents < 0 ? Math.abs(entry.amountCents) : 0)),
                netAmountCents: row.netAmountCents - entry.amountCents,
                transactionCount: Math.max(0, row.transactionCount - entry.transactionCount),
            };
        }),
    };
}

const CUSTOM_REVENUE_OPTIONAL_EVENT_FIELDS = [
    ['refundEventName', 'Refund event'],
    ['subscriberEventName', 'Subscriber event'],
    ['trialStartedEventName', 'Trial started event'],
    ['subscriptionStartedEventName', 'Subscription event'],
    ['cancellationEventName', 'Cancellation event'],
    ['conversionEventName', 'Conversion event'],
] as const;

const VERSION_RELEASE_TOOLTIP_WINDOW_MS = 36 * 60 * 60 * 1000;
const VERSION_TOOLTIP_WRAPPER_STYLE: React.CSSProperties = { zIndex: 40 };

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

function RevenueImpactTooltip({
    active,
    label,
    payload,
    currency,
    releaseMarkers,
}: {
    active?: boolean;
    label?: string | number;
    payload?: RevenueTooltipPayloadItem[];
    currency: string | null;
    releaseMarkers: VersionReleaseMarker[];
}) {
    if (!active || label === undefined || label === null) return null;

    const dateKey = String(label);
    const row = payload?.find((item) => item.payload)?.payload;
    if (!row) return null;

    const dateTime = dateKeyTime(dateKey);
    const nearbyVersions = dateTime === null
        ? releaseMarkers.filter((marker) => marker.dateKey === dateKey)
        : releaseMarkers.filter((marker) => {
            const markerTime = dateKeyTime(marker.dateKey);
            return markerTime !== null && Math.abs(markerTime - dateTime) <= VERSION_RELEASE_TOOLTIP_WINDOW_MS;
        });

    return (
        <div className="pointer-events-none max-w-[280px] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
            <div className="mb-2 font-semibold text-slate-800">{formatDateLabel(dateKey)}</div>
            <div className="space-y-1">
                <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Gross revenue</span>
                    <span className="font-semibold text-slate-950">{formatCurrencyMinor(row.grossAmountCents, currency)}</span>
                </div>
                <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Transactions</span>
                    <span className="font-semibold text-slate-950">{formatCompact(row.transactionCount)}</span>
                </div>
                <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Refunds</span>
                    <span className="font-semibold text-slate-950">{formatCurrencyMinor(row.refundAmountCents, currency)}</span>
                </div>
                <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Net</span>
                    <span className="font-semibold text-slate-950">{formatCurrencyMinor(row.netAmountCents, currency)}</span>
                </div>
                {row.subscriberCount > 0 && (
                    <div className="flex justify-between gap-4">
                        <span className="text-slate-500">Subscribers</span>
                        <span className="font-semibold text-slate-950">{formatCompact(row.subscriberCount)}</span>
                    </div>
                )}
                {row.trialCount > 0 && (
                    <div className="flex justify-between gap-4">
                        <span className="text-slate-500">Trials</span>
                        <span className="font-semibold text-slate-950">{formatCompact(row.trialCount)}</span>
                    </div>
                )}
                {row.cancellationCount > 0 && (
                    <div className="flex justify-between gap-4">
                        <span className="text-slate-500">Cancellations</span>
                        <span className="font-semibold text-slate-950">{formatCompact(row.cancellationCount)}</span>
                    </div>
                )}
            </div>

            {nearbyVersions.length > 0 && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Nearby versions</div>
                    <div className="space-y-1">
                        {nearbyVersions.map((marker) => (
                            <div key={`${marker.version}-${marker.dateKey}`} className="flex items-center justify-between gap-3">
                                <span className="break-all font-mono font-semibold text-slate-800">v{marker.version}</span>
                                <span className="text-slate-500">{formatDateLabel(marker.dateKey)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function dedupeRevenueEventOptions(events: RevenueCustomEventOption[]): RevenueCustomEventOption[] {
    const byName = new Map<string, RevenueCustomEventOption>();
    for (const event of events) {
        const name = event.name.trim();
        if (!name) continue;
        const existing = byName.get(name);
        if (!existing || event.count > existing.count) {
            byName.set(name, { name, count: Math.max(0, event.count || 0) });
        }
    }
    return Array.from(byName.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function pickSuggestedRevenueEventName(events: RevenueCustomEventOption[], patterns: RegExp[], fallbackToFirst = true): string {
    const options = dedupeRevenueEventOptions(events);
    for (const pattern of patterns) {
        const match = options.find((event) => pattern.test(event.name));
        if (match) return match.name;
    }
    return fallbackToFirst ? options[0]?.name || '' : '';
}

function normalizeCustomRevenueFieldName(value: string | null | undefined, fallback: string): string {
    const trimmed = value?.trim();
    return trimmed || fallback;
}

function isLikelyNonRevenueEventName(value: string): boolean {
    return /^(device_info|app_initialized|screen_view|page_view|route_changed|session_started|log|console\.)/i.test(value.trim());
}

function formatJsObjectKey(value: string): string {
    return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
}

function buildCustomRevenueEventSnippet(config: CustomRevenueEventConfig): string {
    const eventName = normalizeCustomRevenueFieldName(config.revenueEventName, 'purchase_completed');
    const amountProperty = normalizeCustomRevenueFieldName(config.revenueAmountProperty, 'amount');
    const currencyProperty = normalizeCustomRevenueFieldName(config.revenueCurrencyProperty, 'currency');
    const currency = normalizeCustomRevenueFieldName(config.defaultCurrency, 'USD').toUpperCase();
    const amount = config.amountUnit === 'minor' ? '2999' : '29.99';

    return [
        `Rejourney.logEvent(${JSON.stringify(eventName)}, {`,
        `  ${formatJsObjectKey(amountProperty)}: ${amount},`,
        `  ${formatJsObjectKey(currencyProperty)}: ${JSON.stringify(currency)}`,
        '});',
    ].join('\n');
}

function buildCustomRevenueAiSetupPrompt(config: CustomRevenueEventConfig, detectedEvents: RevenueCustomEventOption[]): string {
    const purchaseEventName = normalizeCustomRevenueFieldName(config.revenueEventName, 'purchase_completed');
    const recommendedPurchaseEventName = isLikelyNonRevenueEventName(purchaseEventName) ? 'purchase_completed' : purchaseEventName;
    const amountProperty = normalizeCustomRevenueFieldName(config.revenueAmountProperty, 'amount');
    const currencyProperty = normalizeCustomRevenueFieldName(config.revenueCurrencyProperty, 'currency');
    const defaultCurrency = normalizeCustomRevenueFieldName(config.defaultCurrency, 'USD').toUpperCase();
    const amountUnit = config.amountUnit === 'minor' ? 'minor currency units, like cents' : 'major currency units, like dollars';
    const amountExample = config.amountUnit === 'minor' ? '2999' : '29.99';
    const optionalEvents = CUSTOM_REVENUE_OPTIONAL_EVENT_FIELDS
        .map(([key, label]) => {
            const value = normalizeCustomRevenueFieldName(config[key], '');
            return value ? `- ${label}: ${value}` : null;
        })
        .filter((value): value is string => Boolean(value));
    const detectedEventList = detectedEvents.length > 0
        ? detectedEvents.slice(0, 20).map((event) => `- ${event.name} (${event.count} captured)`).join('\n')
        : '- No detected events yet.';
    const webExample = [
        "import { Rejourney } from '@rejourneyco/browser';",
        '',
        'Rejourney.setUserIdentity(currentUser.id);',
        `Rejourney.logEvent(${JSON.stringify(recommendedPurchaseEventName)}, {`,
        `  ${formatJsObjectKey(amountProperty)}: ${amountExample},`,
        `  ${formatJsObjectKey(currencyProperty)}: ${JSON.stringify(defaultCurrency)},`,
        '  transactionId: order.id,',
        '  orderId: order.id,',
        '  productId: item.productId,',
        '  planId: subscription?.planId,',
        '  priceId: subscription?.priceId,',
        '  subscriptionId: subscription?.id,',
        '  paymentProvider: "your_provider",',
        '  platform: "web",',
        '  couponCode: order.couponCode,',
        '  isTrialConversion: Boolean(subscription?.convertedFromTrial),',
        '  isRenewal: Boolean(order.isRenewal)',
        '});',
    ].join('\n');
    const reactNativeExample = [
        "import { Platform } from 'react-native';",
        "import { Rejourney } from '@rejourneyco/react-native';",
        '',
        'Rejourney.setUserIdentity(currentUser.id);',
        `Rejourney.logEvent(${JSON.stringify(recommendedPurchaseEventName)}, {`,
        `  ${formatJsObjectKey(amountProperty)}: ${amountExample},`,
        `  ${formatJsObjectKey(currencyProperty)}: ${JSON.stringify(defaultCurrency)},`,
        '  transactionId: order.id,',
        '  orderId: order.id,',
        '  productId: item.productId,',
        '  planId: subscription?.planId,',
        '  priceId: subscription?.priceId,',
        '  subscriptionId: subscription?.id,',
        '  paymentProvider: "your_provider",',
        '  platform: Platform.OS,',
        '  couponCode: order.couponCode,',
        '  isTrialConversion: Boolean(subscription?.convertedFromTrial),',
        '  isRenewal: Boolean(order.isRenewal)',
        '});',
    ].join('\n');
    const swiftExample = [
        'Rejourney.identify(currentUser.id)',
        `Rejourney.logEvent(${JSON.stringify(recommendedPurchaseEventName)}, properties: [`,
        `    ${JSON.stringify(amountProperty)}: ${amountExample},`,
        `    ${JSON.stringify(currencyProperty)}: ${JSON.stringify(defaultCurrency)},`,
        '    "transactionId": order.id,',
        '    "orderId": order.id,',
        '    "productId": item.productId,',
        '    "planId": subscription?.planId ?? "",',
        '    "priceId": subscription?.priceId ?? "",',
        '    "subscriptionId": subscription?.id ?? "",',
        '    "paymentProvider": "your_provider",',
        '    "platform": "ios",',
        '    "couponCode": order.couponCode ?? "",',
        '    "isTrialConversion": subscription?.convertedFromTrial ?? false,',
        '    "isRenewal": order.isRenewal',
        '])',
    ].join('\n');

    return [
        'You are helping me instrument Rejourney custom revenue and conversion events in my app.',
        '',
        'Goal:',
        '- Implement a complete, future-proof Rejourney event tracking setup for revenue analytics, conversion funnels, per-user attribution, cohort analysis, LTV analysis, refunds, trials, subscriptions, cancellations, and feature-to-revenue correlation.',
        '- Use Rejourney custom events as the source of truth for revenue analytics. Do not send card numbers, raw emails, phone numbers, secrets, access tokens, or other sensitive PII.',
        '',
        'Current Rejourney revenue mapping from the dashboard:',
        `- Purchase/revenue event name: ${purchaseEventName}`,
        `- Amount property: ${amountProperty}`,
        `- Currency property: ${currencyProperty}`,
        `- Default currency: ${defaultCurrency}`,
        `- Amount unit: ${amountUnit}`,
        optionalEvents.length > 0 ? optionalEvents.join('\n') : '- Optional lifecycle events are not mapped yet. Add sensible event names where the app has those lifecycle moments.',
        isLikelyNonRevenueEventName(purchaseEventName)
            ? `- IMPORTANT: ${purchaseEventName} looks like a setup/device/session event, not a money-collected event. Create a dedicated ${recommendedPurchaseEventName} event and update the Rejourney dashboard mapping to use it. Do not overload device_info/app_initialized/screen_view/page_view events with revenue.`
            : '- The purchase/revenue event should fire only when money is actually collected or a renewal is confirmed.',
        '',
        'Expected purchase event shape:',
        isLikelyNonRevenueEventName(purchaseEventName)
            ? buildCustomRevenueEventSnippet({ ...config, revenueEventName: recommendedPurchaseEventName })
            : buildCustomRevenueEventSnippet(config),
        '',
        'Use these platform patterns:',
        '',
        'Web:',
        '```ts',
        webExample,
        '```',
        '',
        'React Native:',
        '```ts',
        reactNativeExample,
        '```',
        '',
        'Swift/iOS:',
        '```swift',
        swiftExample,
        '```',
        '',
        'Detected Rejourney events in this project:',
        detectedEventList,
        '',
        'Implementation requirements:',
        '- Find the app code paths for signup, login, checkout start, purchase success, subscription start, trial start, renewal, refund, cancellation, payment failure, onboarding milestones, paywall exposure, pricing-plan selection, coupon use, entitlement activation, and important product feature usage.',
        '- On login or account creation, set a stable internal user identity before tracking revenue events. For web and React Native use Rejourney.setUserIdentity("internal_user_id"). For iOS/Swift use Rejourney.identify("internal_user_id"). Prefer an internal database ID, not raw email.',
        `- On every successful purchase or renewal, call Rejourney.logEvent(${JSON.stringify(recommendedPurchaseEventName)}, properties) with ${amountProperty}, ${currencyProperty}, a stable transactionId/orderId, productId/sku, planId, priceId if available, subscriptionId if available, paymentProvider, platform, country/region if already available, coupon/discount fields if available, isTrialConversion, isRenewal, and entitlement fields.`,
        '- Make transactionId/orderId stable and idempotent so retries do not create duplicate revenue facts.',
        '- Track refunds with a separate refund event if the app/backend has refund callbacks. Include the original transactionId/orderId, refundId, amount, currency, reason, productId, subscriptionId, and user identity.',
        '- Track lifecycle events for add_to_cart (or product_added_to_cart), trial started, subscription started, cancellation, conversion, payment failed, checkout started, pricing viewed, paywall viewed, plan selected, onboarding completed, key feature used, and activation milestone reached.',
        '- Add session/user metadata when useful for segmentation, such as plan, account type, acquisition campaign, app surface, experiment/variant, locale, and platform. Keep metadata values primitive: strings, numbers, or booleans.',
        '- Ensure events fire on backend-confirmed payment success where possible, not only on client button clicks. If tracking from both client and backend, use unique event names or stable IDs to prevent duplicate revenue.',
        '- Add tests or smoke checks proving purchase success, refund, cancellation, trial, conversion, and login identity events are emitted with the exact property names above.',
        '',
        'Please inspect the app codebase, identify the right files, implement the tracking calls, avoid PII/secrets, and summarize exactly which events and properties were added.',
    ].join('\n');
}

function RevenueEventSelectField({
    label,
    value,
    events,
    onChange,
    required = false,
    placeholder = 'Select event',
    description,
}: {
    label: string;
    value?: string | null;
    events: RevenueCustomEventOption[];
    onChange: (value: string) => void;
    required?: boolean;
    placeholder?: string;
    description?: string;
}) {
    const normalizedValue = value || '';
    const options = useMemo(() => dedupeRevenueEventOptions(events), [events]);
    const hasCurrentCustomValue = Boolean(normalizedValue) && !options.some((event) => event.name === normalizedValue);
    const currentValueLabel = normalizedValue === DEFAULT_CUSTOM_REVENUE_CONFIG.revenueEventName
        ? `${normalizedValue} (AI default)`
        : `${normalizedValue} (custom)`;

    return (
        <label className="min-w-0 space-y-1">
            <span className="dashboard-label">{label}</span>
            <div className="relative">
                <select
                    required={required}
                    value={normalizedValue}
                    onChange={(event) => onChange(event.target.value)}
                    className="h-9 w-full appearance-none border border-[#dadce0] bg-white py-0 pl-2 pr-8 text-sm font-semibold text-slate-800 outline-none transition hover:border-[#1a73e8] hover:bg-[#f8fafc] focus:border-black focus:ring-2 focus:ring-cyan-100"
                >
                    <option value="">{options.length > 0 ? placeholder : 'No captured events yet'}</option>
                    {hasCurrentCustomValue && (
                        <option value={normalizedValue}>{currentValueLabel}</option>
                    )}
                    {options.map((event) => (
                        <option key={event.name} value={event.name}>
                            {event.name} ({formatCompact(event.count)})
                        </option>
                    ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            </div>
            {description && (
                <span className="block text-[11px] font-semibold leading-4 text-slate-500">{description}</span>
            )}
        </label>
    );
}

const RevenueImpactSection: React.FC<{
    revenue: RevenueOverview | null;
    isLoading: boolean;
    error: string | null;
    selectedCurrency: string | null;
    onCurrencyChange: (currency: string | null) => void;
    onSync: (provider: RevenueProvider) => void;
    onDisconnect: (provider: RevenueProvider) => void;
    onSelectProvider: (provider: RevenueProvider) => void;
    onSaveSuperwall: (input: { apiKey: string }) => void;
    onSaveRevenueCat: (input: { apiKey: string; revenueCatProjectId: string }) => void;
    onSaveCustomEvents: (input: typeof DEFAULT_CUSTOM_REVENUE_CONFIG) => void;
    onSaveManualEntry: (input: { entryId?: string; date: string; amountCents: number; currency: string; transactionCount: number; note?: string | null }) => void;
    onDeleteManualEntry: (entryId: string) => void;
    isActionLoading: boolean;
    actionState: RevenueActionState;
    customEvents: RevenueCustomEventOption[];
    chartData: RevenueImpactChartRow[];
    releaseMarkers: VersionReleaseMarker[];
    collapseStorageKey: string;
}> = ({
    revenue,
    isLoading,
    error,
    selectedCurrency,
    onCurrencyChange,
    onSync,
    onDisconnect,
    onSelectProvider,
    onSaveSuperwall,
    onSaveRevenueCat,
    onSaveCustomEvents,
    onSaveManualEntry,
    onDeleteManualEntry,
    isActionLoading,
    actionState,
    customEvents,
    chartData,
    releaseMarkers,
    collapseStorageKey,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        try {
            return window.localStorage.getItem(collapseStorageKey) === '1';
        } catch {
            return false;
        }
    });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [settingsProvider, setSettingsProvider] = useState<RevenueProvider>('custom_events');
    const [superwallApiKey, setSuperwallApiKey] = useState('');
    const [revenueCatApiKey, setRevenueCatApiKey] = useState('');
    const [revenueCatProjectId, setRevenueCatProjectId] = useState('');
    const [customConfig, setCustomConfig] = useState(DEFAULT_CUSTOM_REVENUE_CONFIG);
    const [copiedCustomSetupPrompt, setCopiedCustomSetupPrompt] = useState(false);
    const [isManualFormOpen, setIsManualFormOpen] = useState(false);
    const [editingManualEntryId, setEditingManualEntryId] = useState<string | null>(null);
    const [manualEntryDate, setManualEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [manualEntryAmount, setManualEntryAmount] = useState('');
    const [manualEntryCurrency, setManualEntryCurrency] = useState('usd');
    const [manualEntryTransactionCount, setManualEntryTransactionCount] = useState('1');
    const [manualEntryNote, setManualEntryNote] = useState('');
    const [manualEntryError, setManualEntryError] = useState<string | null>(null);
    const customEventOptions = useMemo(() => dedupeRevenueEventOptions(customEvents), [customEvents]);
    const connection = revenue?.connection;
    const activeProvider = revenue?.activeProvider ?? null;
    const status = connection?.status ?? 'not_connected';
    const canManage = Boolean(connection?.canManage);
    const hasActiveConnection = status === 'connected' || status === 'syncing' || status === 'error';
    const currency = revenue?.selectedCurrency ?? selectedCurrency ?? null;
    const manualEntries = revenue?.manualEntries ?? [];
    const startingRevenueEntry = manualEntries[0] ?? null;
    const startingRevenueAmountCents = manualEntries.reduce((sum, entry) => sum + entry.amountCents, 0);
    const startingRevenueCurrency = (startingRevenueEntry?.currency || currency || 'usd').toUpperCase();
    const startingRevenueDate = startingRevenueEntry?.date || chartData[0]?.dateKey || new Date().toISOString().slice(0, 10);
    const grossChange = revenue?.summary.grossChangePercent ?? null;
    const hasRevenueData = Boolean(
        chartData.length > 0
        || manualEntries.length > 0
        || (revenue?.summary.grossAmountCents ?? 0) > 0
        || (revenue?.summary.refundAmountCents ?? 0) > 0
        || (revenue?.summary.transactionCount ?? 0) > 0
    );
    const showRevenueDataView = hasActiveConnection || hasRevenueData;
    const actionProvider = actionState?.provider ?? null;
    const isActiveProviderAction = Boolean(activeProvider && actionProvider === activeProvider);
    const isSyncPending = actionState?.kind === 'sync' && isActiveProviderAction;
    const isDisconnectPending = actionState?.kind === 'disconnect' && isActiveProviderAction;
    const isSavingSource = actionState?.kind === 'connect_superwall'
        || actionState?.kind === 'connect_revenuecat'
        || actionState?.kind === 'save_custom_events'
        || actionState?.kind === 'select_provider';
    const actionMessage = actionState?.kind === 'sync'
        ? 'Syncing revenue now...'
        : actionState?.kind === 'disconnect'
            ? 'Disconnecting revenue source...'
            : actionState?.kind === 'connect_superwall'
                ? 'Connecting Superwall and starting sync...'
                : actionState?.kind === 'connect_revenuecat'
                    ? 'Connecting RevenueCat and starting sync...'
                : actionState?.kind === 'save_custom_events'
                    ? 'Saving custom event mapping and syncing...'
                    : actionState?.kind === 'save_manual'
                        ? 'Saving starting revenue...'
                        : actionState?.kind === 'delete_manual'
                            ? 'Clearing starting revenue...'
                            : actionState?.kind === 'select_provider'
                                ? 'Changing revenue source...'
                                : null;
    const syncPreview = revenue?.syncPreview ?? null;
    const syncPreviewLabel = syncPreview
        ? `${formatCompact(syncPreview.revenueEventCount)} revenue-shaped events across ${formatCompact(syncPreview.matchedSessionCount)} matching sessions`
        : null;
    const syncScanLabel = syncPreview
        ? `${formatCompact(syncPreview.scannedSessionCount)} total sessions scanned from this project`
        : null;
    const revenueSyncEmptyText = activeProvider === 'custom_events'
        ? 'No synced revenue data yet. Save the mapping and run Sync when your app is sending purchase events.'
        : activeProvider === 'revenuecat'
            ? 'No RevenueCat revenue returned for this range yet. Run Sync to backfill again, or switch to All time.'
            : activeProvider === 'superwall'
                ? 'No Superwall revenue returned for this range yet. Run Sync to backfill again, or switch to All time.'
                : 'No synced revenue data yet. Connect a revenue source and run Sync.';
    const isRevenueSyncInProgress = status === 'syncing'
        || actionState?.kind === 'sync'
        || actionState?.kind === 'connect_superwall'
        || actionState?.kind === 'connect_revenuecat'
        || actionState?.kind === 'save_custom_events';
    const changeClass = grossChange === null || grossChange === 0
        ? 'text-slate-600'
        : grossChange > 0
            ? 'text-emerald-700'
            : 'text-rose-700';

    const statusLabel = isLoading
        ? 'Loading'
        : isDisconnectPending
        ? 'Disconnecting'
        : isSyncPending
            ? 'Syncing'
            : isSavingSource && actionProvider === activeProvider
                ? 'Saving'
        : status === 'syncing'
        ? 'Syncing'
        : status === 'error'
            ? 'Sync error'
            : status === 'disconnected'
                ? 'Disconnected'
                : status === 'connected'
                    ? 'Connected'
                    : 'Not connected';

    const activeProviderMeta = activeProvider ? REVENUE_PROVIDER_META[activeProvider] : null;
    const accountLabel = connection?.accountName || connection?.accountId || activeProviderMeta?.shortLabel || 'Revenue source';
    const statusClass = isLoading
        ? 'border-cyan-300 bg-[#cffafe] text-slate-950'
        : isDisconnectPending
        ? 'border-amber-300 bg-[#fef3c7] text-amber-950'
        : actionMessage
            ? 'border-cyan-300 bg-[#cffafe] text-slate-950'
        : status === 'error'
        ? 'border-rose-300 bg-[#fecaca] text-rose-950'
        : status === 'syncing'
            ? 'border-cyan-300 bg-[#cffafe] text-slate-950'
            : status === 'connected'
                ? 'border-emerald-300 bg-[#dcfce7] text-slate-950'
                : 'border-[#dadce0] bg-[#f8fafc] text-slate-700';
    const revenueBodyId = 'general-revenue-impact-body';
    const providerStatuses = revenue?.providers?.length
        ? revenue.providers
        : (Object.keys(REVENUE_PROVIDER_META) as RevenueProvider[]).map((provider) => ({
            provider,
            label: REVENUE_PROVIDER_META[provider].shortLabel,
            configured: true,
            status: 'not_connected' as const,
            accountId: null,
            accountName: null,
            connectedAt: null,
            lastSyncStartedAt: null,
            lastSyncCompletedAt: null,
            lastSyncError: null,
        }));

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            setIsCollapsed(window.localStorage.getItem(collapseStorageKey) === '1');
        } catch {
            setIsCollapsed(false);
        }
    }, [collapseStorageKey]);

    const handleToggleCollapsed = useCallback(() => {
        setIsCollapsed((current) => {
            const next = !current;
            if (typeof window !== 'undefined') {
                try {
                    window.localStorage.setItem(collapseStorageKey, next ? '1' : '0');
                } catch {
                    // Local persistence is a convenience; keep the in-memory toggle working if storage is blocked.
                }
            }
            return next;
        });
    }, [collapseStorageKey]);

    useEffect(() => {
        if (activeProvider) setSettingsProvider(activeProvider);
    }, [activeProvider]);

    useEffect(() => {
        if (!revenue?.customEventConfig) return;
        const savedRevenueEventName = revenue.customEventConfig.revenueEventName || DEFAULT_CUSTOM_REVENUE_CONFIG.revenueEventName;
        setCustomConfig({
            revenueEventName: isLikelyNonRevenueEventName(savedRevenueEventName)
                ? DEFAULT_CUSTOM_REVENUE_CONFIG.revenueEventName
                : savedRevenueEventName,
            revenueAmountProperty: revenue.customEventConfig.revenueAmountProperty || 'amount',
            revenueCurrencyProperty: revenue.customEventConfig.revenueCurrencyProperty || 'currency',
            defaultCurrency: revenue.customEventConfig.defaultCurrency || DEFAULT_CUSTOM_REVENUE_CONFIG.defaultCurrency,
            amountUnit: revenue.customEventConfig.amountUnit || 'major',
            refundEventName: revenue.customEventConfig.refundEventName || '',
            subscriberEventName: revenue.customEventConfig.subscriberEventName || '',
            trialStartedEventName: revenue.customEventConfig.trialStartedEventName || '',
            subscriptionStartedEventName: revenue.customEventConfig.subscriptionStartedEventName || '',
            cancellationEventName: revenue.customEventConfig.cancellationEventName || '',
            conversionEventName: revenue.customEventConfig.conversionEventName || '',
        });
    }, [revenue?.customEventConfig]);

    useEffect(() => {
        if (settingsProvider !== 'custom_events' || customEventOptions.length === 0) return;

        setCustomConfig((current) => {
            return {
                ...current,
                refundEventName: current.refundEventName || pickSuggestedRevenueEventName(customEventOptions, [/refund/i], false),
                subscriberEventName: current.subscriberEventName || pickSuggestedRevenueEventName(customEventOptions, [/subscriber/i, /subscribed/i], false),
                trialStartedEventName: current.trialStartedEventName || pickSuggestedRevenueEventName(customEventOptions, [/trial/i], false),
                subscriptionStartedEventName: current.subscriptionStartedEventName || pickSuggestedRevenueEventName(customEventOptions, [/subscription[_\s-]*(started|created)/i, /subscribed/i], false),
                cancellationEventName: current.cancellationEventName || pickSuggestedRevenueEventName(customEventOptions, [/cancel/i, /churn/i], false),
                conversionEventName: current.conversionEventName || pickSuggestedRevenueEventName(customEventOptions, [/conversion/i, /signup[_\s-]*completed/i], false),
            };
        });
    }, [customEventOptions, settingsProvider]);

    const getProviderStatus = useCallback((provider: RevenueProvider) => (
        providerStatuses.find((item) => item.provider === provider)
    ), [providerStatuses]);

    const customRevenueAiSetupPrompt = useMemo(
        () => buildCustomRevenueAiSetupPrompt(customConfig, customEventOptions),
        [customConfig, customEventOptions],
    );

    const handleCopyCustomRevenueAiPrompt = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(customRevenueAiSetupPrompt);
            setCopiedCustomSetupPrompt(true);
            window.setTimeout(() => setCopiedCustomSetupPrompt(false), 1600);
        } catch (error) {
            console.error('Failed to copy custom revenue AI setup prompt:', error);
        }
    }, [customRevenueAiSetupPrompt]);

    const handleProviderClick = useCallback((provider: RevenueProvider) => {
        const providerStatus = getProviderStatus(provider);
        const configured = providerStatus?.configured !== false;
        if (!canManage) return;
        if (providerStatus?.status && providerStatus.status !== 'not_connected' && providerStatus.status !== 'disconnected') {
            setIsSettingsOpen(false);
            onSelectProvider(provider);
            return;
        }
        if (!configured) {
            setSettingsProvider(provider);
            setIsSettingsOpen(true);
            return;
        }
        setSettingsProvider(provider);
        setIsSettingsOpen(true);
    }, [canManage, getProviderStatus, onSelectProvider]);

    const resetManualEntryForm = useCallback(() => {
        setEditingManualEntryId(null);
        setManualEntryDate(startingRevenueDate);
        setManualEntryAmount('');
        setManualEntryCurrency(startingRevenueCurrency);
        setManualEntryTransactionCount('1');
        setManualEntryNote('');
        setManualEntryError(null);
    }, [startingRevenueCurrency, startingRevenueDate]);

    const handleOpenManualEntryForm = useCallback((entry?: RevenueManualEntry) => {
        if (entry) {
            setEditingManualEntryId(entry.id);
            setManualEntryDate(entry.date);
            setManualEntryAmount(formatManualAmountInput(entry.amountCents));
            setManualEntryCurrency(entry.currency.toUpperCase());
            setManualEntryTransactionCount(String(Math.max(1, entry.transactionCount || 1)));
            setManualEntryNote(entry.note || '');
        } else {
            setEditingManualEntryId(null);
            setManualEntryDate(startingRevenueDate);
            setManualEntryAmount('');
            setManualEntryCurrency(startingRevenueCurrency);
            setManualEntryTransactionCount('1');
            setManualEntryNote('Initial revenue before Rejourney tracking');
        }
        setManualEntryError(null);
        setIsManualFormOpen(true);
    }, [startingRevenueCurrency, startingRevenueDate]);

    const handleCancelManualEntry = useCallback(() => {
        resetManualEntryForm();
        setIsManualFormOpen(false);
    }, [resetManualEntryForm]);

    const handleSubmitManualEntry = useCallback((event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const amountCents = parseManualAmountInput(manualEntryAmount);
        const transactionCount = Number(manualEntryTransactionCount);
        const normalizedCurrency = manualEntryCurrency.trim().toLowerCase();
        if (!manualEntryDate) {
            setManualEntryError('Choose a revenue date.');
            return;
        }
        if (amountCents === null || amountCents <= 0) {
            setManualEntryError('Enter a starting revenue amount greater than 0, for example 1299.00.');
            return;
        }
        if (!/^[a-z]{3}$/i.test(normalizedCurrency)) {
            setManualEntryError('Use a three-letter currency code like USD.');
            return;
        }
        if (!Number.isFinite(transactionCount) || transactionCount < 1) {
            setManualEntryError('Transaction count must be at least 1.');
            return;
        }

        onSaveManualEntry({
            entryId: editingManualEntryId || undefined,
            date: manualEntryDate,
            amountCents,
            currency: normalizedCurrency,
            transactionCount: Math.round(transactionCount),
            note: manualEntryNote.trim() || null,
        });
        setIsManualFormOpen(false);
        resetManualEntryForm();
    }, [
        editingManualEntryId,
        manualEntryAmount,
        manualEntryCurrency,
        manualEntryDate,
        manualEntryNote,
        manualEntryTransactionCount,
        onSaveManualEntry,
        resetManualEntryForm,
    ]);

    const handleDeleteManualEntry = useCallback((entry: RevenueManualEntry) => {
        const confirmed = window.confirm('Clear the starting revenue baseline?');
        if (!confirmed) return;
        setIsManualFormOpen(false);
        onDeleteManualEntry(entry.id);
    }, [onDeleteManualEntry]);

    const renderProviderMark = (provider: RevenueProvider) => {
        const meta = REVENUE_PROVIDER_META[provider];
        if (meta.logo) {
            return (
                <img
                    src={meta.logo}
                    alt={meta.shortLabel}
                    className={provider === 'custom_events' ? 'h-14 w-14 object-contain' : 'h-auto w-full'}
                />
            );
        }
        return (
            <span className="text-[15px] font-black tracking-tight text-[#202124]">
                {meta.shortLabel}
            </span>
        );
    };

    const renderProviderGrid = (compact = false) => (
        <div className={`grid gap-3 ${compact ? 'md:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-4'}`}>
            {(Object.keys(REVENUE_PROVIDER_META) as RevenueProvider[]).map((provider) => {
                const meta = REVENUE_PROVIDER_META[provider];
                const providerStatus = getProviderStatus(provider);
                const providerConnected = Boolean(providerStatus && providerStatus.status !== 'not_connected' && providerStatus.status !== 'disconnected');
                const selected = activeProvider === provider;
                const configured = providerStatus?.configured !== false;
                const isProviderPending = actionProvider === provider;
                const setupLabel = isProviderPending && actionState?.kind === 'sync'
                    ? 'Syncing'
                    : isProviderPending && actionState?.kind === 'disconnect'
                        ? 'Disconnecting'
                        : isProviderPending && (actionState?.kind === 'connect_superwall' || actionState?.kind === 'connect_revenuecat' || actionState?.kind === 'save_custom_events' || actionState?.kind === 'select_provider')
                            ? 'Saving'
                            : !configured
                    ? 'Unavailable'
                    : providerConnected
                        ? selected ? 'Active' : 'Linked'
                        : 'Set up';
                const setupLabelClass = isProviderPending
                    ? 'border-cyan-300 bg-[#cffafe] text-slate-950'
                    : !configured
                    ? 'border-amber-300 bg-[#fef3c7] text-amber-950'
                    : providerConnected
                        ? 'border-emerald-300 bg-[#dcfce7] text-slate-950'
                        : 'border-[#dadce0] bg-[#f8fafc] text-slate-600';
                const markSurfaceClass = provider === 'superwall'
                    ? 'border-[#111827] bg-[#111827]'
                    : provider === 'revenuecat'
                        ? 'border-[#1f1f47] bg-white'
                    : 'border-[#dadce0] bg-white';
                const markSizeClass = provider === 'custom_events'
                    ? 'w-16'
                    : provider === 'superwall' || provider === 'revenuecat'
                        ? 'w-36'
                        : 'w-24';
                const markHeightClass = provider === 'custom_events' ? 'h-14' : 'h-10';
                const markPaddingClass = provider === 'custom_events' ? 'px-0' : 'px-2';
                return (
                    <button
                        key={provider}
                        type="button"
                        onClick={() => handleProviderClick(provider)}
                        disabled={!canManage || isActionLoading}
                        className={`min-h-[116px] border p-3 text-left transition ${
                            selected
                                ? 'border-[#1a73e8] bg-[#eff6ff]'
                                : 'border-[#dadce0] bg-white hover:border-[#1a73e8] hover:bg-[#f8fafc]'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className={`flex shrink-0 items-center justify-center border ${markPaddingClass} ${markSurfaceClass} ${markSizeClass} ${markHeightClass}`}>
                                {renderProviderMark(provider)}
                            </div>
                            <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${setupLabelClass}`}>
                                {isProviderPending && <RefreshCw className="mr-1 inline h-2.5 w-2.5 animate-spin align-[-1px]" />}
                                {setupLabel}
                            </span>
                        </div>
                        <div className="mt-3 text-xs font-semibold text-[#202124]">{meta.label}</div>
                        <div className="mt-1 text-[11px] font-semibold leading-5 text-slate-500">{meta.description}</div>
                        {!configured && (
                            <div className="mt-2 text-[10px] font-bold uppercase text-amber-700">Deployment setup required</div>
                        )}
                    </button>
                );
            })}
        </div>
    );

    const renderSettingsPanel = (showProviderPicker = true) => {
        const selectedMeta = REVENUE_PROVIDER_META[settingsProvider];
        const customRevenueSnippet = buildCustomRevenueEventSnippet(customConfig);
        const customRevenueAmountExample = customConfig.amountUnit === 'minor' ? '2999' : '29.99';
        const customRevenueAmountField = normalizeCustomRevenueFieldName(customConfig.revenueAmountProperty, 'amount');

        return (
            <div className="mb-4 border border-[#dadce0] bg-[#f8fafc] p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-xs font-bold uppercase text-slate-500">Revenue source</div>
                        <div className="mt-1 text-sm font-semibold text-[#202124]">{selectedMeta.label}</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsSettingsOpen(false)}
                        className="inline-flex h-7 w-7 items-center justify-center border border-[#dadce0] bg-white text-slate-600 transition hover:border-black hover:text-black"
                    >
                        <X className="h-3.5 w-3.5" />
                        <span className="sr-only">Close revenue source settings</span>
                    </button>
                </div>

                {showProviderPicker && renderProviderGrid(true)}

                <div className={`${showProviderPicker ? 'mt-4' : ''} border-t border-[#e8eaed] pt-4`}>
                    {settingsProvider === 'superwall' && (
                        <form
                            className="grid gap-3 md:grid-cols-2"
                            onSubmit={(event) => {
                                event.preventDefault();
                                const apiKey = superwallApiKey;
                                setSuperwallApiKey('');
                                setIsSettingsOpen(false);
                                setIsManualFormOpen(false);
                                onSaveSuperwall({
                                    apiKey,
                                });
                            }}
                        >
                            <div className="md:col-span-2 border border-[#dadce0] bg-white p-3 text-[11px] font-semibold leading-5 text-slate-600">
                                <div className="text-xs font-bold uppercase text-slate-700">Superwall setup checklist</div>
                                <div className="mt-1">
                                    Create a scoped organization API key with projects:read and data:read, then paste it here. Avoid SDK keys, admin keys, unrestricted keys, or keys that can mutate paywalls, products, users, or campaigns.
                                </div>
                                <div className="mt-2">
                                    Rejourney uses projects:read to find the organization ID, then data:read to sync revenue. Restrict project access in Superwall to the project Rejourney should read.
                                </div>
                            </div>
                            <label className="space-y-1 md:col-span-2">
                                <span className="dashboard-label">projects:read + data:read API key</span>
                                <input
                                    value={superwallApiKey}
                                    onChange={(event) => setSuperwallApiKey(event.target.value)}
                                    type="password"
                                    required
                                    className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold outline-none focus:border-black focus:ring-2 focus:ring-cyan-100"
                                />
                                <span className="block text-[11px] font-semibold leading-4 text-slate-500">
                                    Use a secret organization key that starts with sk_.
                                </span>
                            </label>
                            <div className="md:col-span-2">
                                <button
                                    type="submit"
                                    disabled={isActionLoading}
                                    className="inline-flex h-8 items-center gap-1.5 border border-black bg-black px-3 text-[10px] font-black uppercase text-white transition hover:bg-[#1a73e8] disabled:cursor-wait disabled:opacity-70"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                    Connect Superwall
                                </button>
                            </div>
                        </form>
                    )}

                    {settingsProvider === 'revenuecat' && (
                        <form
                            className="grid gap-3 md:grid-cols-2"
                            onSubmit={(event) => {
                                event.preventDefault();
                                const apiKey = revenueCatApiKey;
                                const projectId = revenueCatProjectId;
                                setRevenueCatApiKey('');
                                setRevenueCatProjectId('');
                                setIsSettingsOpen(false);
                                setIsManualFormOpen(false);
                                onSaveRevenueCat({
                                    apiKey,
                                    revenueCatProjectId: projectId,
                                });
                            }}
                        >
                            <div className="md:col-span-2 border border-[#dadce0] bg-white p-3 text-[11px] font-semibold leading-5 text-slate-600">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-xs font-bold uppercase text-slate-700">RevenueCat setup checklist</div>
                                    <a
                                        href="https://www.revenuecat.com/docs/api-v2"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-[#576cdb] hover:text-black"
                                    >
                                        API v2 docs
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
                                <div className="mt-1">
                                    Create a RevenueCat V2 key with charts_metrics:overview:read and charts_metrics:charts:read, then paste it with the RevenueCat project ID.
                                </div>
                                <div className="mt-2">
                                    Rejourney validates overview access first, then syncs the revenue chart as daily revenue rows. Do not use SDK public keys, OAuth tokens, or write-enabled customer/project permissions.
                                </div>
                            </div>
                            <label className="space-y-1">
                                <span className="dashboard-label">RevenueCat project ID</span>
                                <input
                                    value={revenueCatProjectId}
                                    onChange={(event) => setRevenueCatProjectId(event.target.value)}
                                    type="text"
                                    required
                                    placeholder="proj..."
                                    className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold outline-none placeholder:text-slate-400 focus:border-black focus:ring-2 focus:ring-cyan-100"
                                />
                                <span className="block text-[11px] font-semibold leading-4 text-slate-500">
                                    Find it in RevenueCat Project settings or the RevenueCat API URL.
                                </span>
                            </label>
                            <label className="space-y-1 md:col-span-2">
                                <span className="dashboard-label">V2 charts_metrics:overview:read + charts_metrics:charts:read API key</span>
                                <input
                                    value={revenueCatApiKey}
                                    onChange={(event) => setRevenueCatApiKey(event.target.value)}
                                    type="password"
                                    required
                                    placeholder="sk_..."
                                    className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold outline-none placeholder:text-slate-400 focus:border-black focus:ring-2 focus:ring-cyan-100"
                                />
                                <span className="block text-[11px] font-semibold leading-4 text-slate-500">
                                    Use a server-side secret key only; it stays encrypted in Rejourney.
                                </span>
                            </label>
                            <div className="md:col-span-2">
                                <button
                                    type="submit"
                                    disabled={isActionLoading}
                                    className="inline-flex h-8 items-center gap-1.5 border border-black bg-black px-3 text-[10px] font-black uppercase text-white transition hover:bg-[#576cdb] disabled:cursor-wait disabled:opacity-70"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                    Connect RevenueCat
                                </button>
                            </div>
                        </form>
                    )}

                    {settingsProvider === 'custom_events' && (
                        <form
                            className="space-y-4"
                            onSubmit={(event) => {
                                event.preventDefault();
                                setIsSettingsOpen(false);
                                setIsManualFormOpen(false);
                                onSaveCustomEvents(customConfig);
                            }}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <div className="text-xs font-bold uppercase text-slate-500">Custom revenue mapping</div>
                                    <div className="mt-1 text-xs font-semibold text-slate-500">
                                        Match the purchase event from your SDK docs example to the fields below.
                                    </div>
                                </div>
                                <span className="border border-[#dadce0] bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                                    {customEventOptions.length} detected
                                </span>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                                <div className="space-y-3">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <RevenueEventSelectField
                                            label="Purchase event"
                                            value={customConfig.revenueEventName}
                                            onChange={(value) => setCustomConfig((current) => ({ ...current, revenueEventName: value }))}
                                            events={customEventOptions}
                                            required
                                            placeholder="Select purchase event"
                                            description="Defaults to the AI setup prompt. Change this only if your app already emits a different money-collected event."
                                        />
                                        <label className="space-y-1">
                                            <span className="dashboard-label">Amount property</span>
                                            <input
                                                value={customConfig.revenueAmountProperty}
                                                onChange={(event) => setCustomConfig((current) => ({ ...current, revenueAmountProperty: event.target.value }))}
                                                required
                                                placeholder="amount"
                                                className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold outline-none placeholder:text-slate-400 focus:border-black focus:ring-2 focus:ring-cyan-100"
                                            />
                                            <span className="block text-[11px] font-semibold leading-4 text-slate-500">
                                                The numeric property on that event, usually amount.
                                            </span>
                                        </label>
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-3">
                                    <label className="space-y-1">
                                        <span className="dashboard-label">Currency property</span>
                                        <input
                                            value={customConfig.revenueCurrencyProperty}
                                            onChange={(event) => setCustomConfig((current) => ({ ...current, revenueCurrencyProperty: event.target.value }))}
                                            required
                                            placeholder="currency"
                                            className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold outline-none placeholder:text-slate-400 focus:border-black focus:ring-2 focus:ring-cyan-100"
                                        />
                                        <span className="block text-[11px] font-semibold leading-4 text-slate-500">
                                            Leave as currency if your event sends USD, EUR, etc.
                                        </span>
                                    </label>
                                    <label className="space-y-1">
                                        <span className="dashboard-label">Default currency</span>
                                        <input
                                            value={customConfig.defaultCurrency}
                                            onChange={(event) => setCustomConfig((current) => ({ ...current, defaultCurrency: event.target.value }))}
                                            required
                                            placeholder="usd"
                                            className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold uppercase outline-none placeholder:text-slate-400 focus:border-black focus:ring-2 focus:ring-cyan-100"
                                        />
                                        <span className="block text-[11px] font-semibold leading-4 text-slate-500">
                                            Used when the event has no currency property.
                                        </span>
                                    </label>
                                    <label className="space-y-1">
                                        <span className="dashboard-label">Amount unit</span>
                                        <div className="relative">
                                            <select
                                                value={customConfig.amountUnit}
                                                onChange={(event) => setCustomConfig((current) => ({ ...current, amountUnit: event.target.value === 'minor' ? 'minor' : 'major' }))}
                                                className="h-9 w-full appearance-none border border-[#dadce0] bg-white py-0 pl-2 pr-8 text-sm font-semibold outline-none focus:border-black focus:ring-2 focus:ring-cyan-100"
                                            >
                                                <option value="major">Dollars (29.99)</option>
                                                <option value="minor">Cents (2999)</option>
                                            </select>
                                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                                        </div>
                                        <span className="block text-[11px] font-semibold leading-4 text-slate-500">
                                            Use dollars for 29.99, cents for 2999.
                                        </span>
                                    </label>
                                    </div>
                                </div>

                                <div className="border border-[#dadce0] bg-white p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-xs font-bold uppercase text-slate-500">Expected event shape</div>
                                    </div>
                                    <div className="mt-2 border border-[#1a73e8] bg-[#eff6ff] p-2">
                                        <div className="text-[11px] font-bold uppercase text-[#174ea6]">Need help wiring this into your app?</div>
                                        <div className="mt-1 text-[11px] font-semibold leading-5 text-slate-600">
                                            Copy a setup prompt for an AI coding tool. It includes Web, React Native, and Swift examples plus purchase, refund, trial, subscription, cancellation, and per-user conversion events.
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleCopyCustomRevenueAiPrompt}
                                            className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 border border-[#1a73e8] bg-[#1a73e8] px-3 text-[10px] font-black uppercase text-white transition hover:border-black hover:bg-black disabled:cursor-wait disabled:opacity-70"
                                            title="Copy a setup prompt for AI coding tools"
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                            {copiedCustomSetupPrompt ? 'Prompt copied' : 'Copy setup prompt for Web, React Native, Swift'}
                                        </button>
                                    </div>
                                    <pre className="mt-2 overflow-x-auto whitespace-pre rounded-none border border-[#e8eaed] bg-[#f8fafc] p-3 font-mono text-[11px] font-semibold leading-5 text-slate-800">
                                        {customRevenueSnippet}
                                    </pre>
                                    <div className="mt-2 text-[11px] font-semibold leading-5 text-slate-500">
                                        Revenue reads {customRevenueAmountField} from event properties or payload. With the selected unit, the example amount is {customRevenueAmountExample}.
                                    </div>
                                </div>
                            </div>

                            <details className="border-t border-[#e8eaed] pt-3">
                                <summary className="cursor-pointer select-none text-xs font-bold uppercase text-slate-500">
                                    Optional refund and lifecycle counters
                                </summary>
                                <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                    {CUSTOM_REVENUE_OPTIONAL_EVENT_FIELDS.map(([key, label]) => (
                                        <RevenueEventSelectField
                                            key={key}
                                            label={label}
                                            value={customConfig[key] || ''}
                                            onChange={(value) => setCustomConfig((current) => ({ ...current, [key]: value }))}
                                            events={customEventOptions}
                                            placeholder="Not tracked"
                                        />
                                    ))}
                                </div>
                            </details>

                            <div className="border border-[#dadce0] bg-white px-3 py-2 text-[11px] font-semibold leading-5 text-slate-600">
                                Matching is case-insensitive for event names. Property names must match your SDK event payload exactly.
                            </div>

                            <div>
                                <button
                                    type="submit"
                                    disabled={isActionLoading}
                                    className="inline-flex h-8 items-center gap-1.5 border border-black bg-black px-3 text-[10px] font-black uppercase text-white transition hover:bg-[#1a73e8] disabled:cursor-wait disabled:opacity-70"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                    Save revenue mapping
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        );
    };

    const renderManualRevenuePanel = () => {
        if (!canManage && manualEntries.length === 0) return null;

        return (
            <div className="border-t border-[#e8eaed] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
                    <div className="min-w-0">
                        <span className="font-bold uppercase text-slate-600">Starting revenue</span>
                        <span className="mx-2 text-slate-300">/</span>
                        {startingRevenueEntry ? (
                            <span className="text-slate-700">
                                {formatCurrencyMinor(startingRevenueAmountCents, startingRevenueCurrency)}
                                <span className="ml-1 text-slate-400">baseline before Rejourney tracking</span>
                            </span>
                        ) : (
                            <span>Add one baseline amount if you already had revenue before tracking.</span>
                        )}
                    </div>
                    {canManage && (
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => handleOpenManualEntryForm(startingRevenueEntry ?? undefined)}
                                disabled={isActionLoading}
                                className="inline-flex h-7 items-center gap-1 border border-[#dadce0] bg-white px-2 text-[10px] font-black uppercase text-slate-700 transition hover:border-black hover:text-black disabled:cursor-wait disabled:opacity-70"
                            >
                                {startingRevenueEntry ? <Pencil className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                                {startingRevenueEntry ? 'Adjust' : 'Set'}
                            </button>
                            {startingRevenueEntry && (
                                <button
                                    type="button"
                                    onClick={() => handleDeleteManualEntry(startingRevenueEntry)}
                                    disabled={isActionLoading}
                                    className="inline-flex h-7 items-center gap-1 border border-transparent bg-white px-2 text-[10px] font-black uppercase text-slate-400 transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-wait disabled:opacity-70"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    Clear
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {isManualFormOpen && canManage && (
                    <form className="mt-3 grid gap-3 border border-[#dadce0] bg-[#f8fafc] p-3 md:grid-cols-[minmax(0,1fr)_120px] lg:grid-cols-[minmax(0,220px)_120px_minmax(0,1fr)_auto]" onSubmit={handleSubmitManualEntry}>
                        <label className="space-y-1">
                            <span className="dashboard-label">Starting revenue</span>
                            <input
                                value={manualEntryAmount}
                                onChange={(event) => setManualEntryAmount(event.target.value)}
                                placeholder="1299.00"
                                inputMode="decimal"
                                required
                                className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold outline-none placeholder:text-slate-400 focus:border-black focus:ring-2 focus:ring-cyan-100"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="dashboard-label">Currency</span>
                            <input
                                value={manualEntryCurrency}
                                onChange={(event) => setManualEntryCurrency(event.target.value.toUpperCase())}
                                maxLength={3}
                                required
                                className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold uppercase outline-none focus:border-black focus:ring-2 focus:ring-cyan-100"
                            />
                        </label>
                        <label className="space-y-1 md:col-span-2 lg:col-span-1">
                            <span className="dashboard-label">Note</span>
                            <input
                                value={manualEntryNote}
                                onChange={(event) => setManualEntryNote(event.target.value)}
                                placeholder="Initial revenue before Rejourney tracking"
                                className="h-9 w-full border border-[#dadce0] bg-white px-2 text-sm font-semibold outline-none placeholder:text-slate-400 focus:border-black focus:ring-2 focus:ring-cyan-100"
                            />
                        </label>
                        {manualEntryError && (
                            <div className="border border-rose-300 bg-[#fecaca] px-3 py-2 text-xs font-bold text-rose-950 md:col-span-2 lg:col-span-4">
                                {manualEntryError}
                            </div>
                        )}
                        <div className="flex flex-wrap items-end gap-2 md:col-span-2 lg:col-span-1">
                            <button
                                type="submit"
                                disabled={isActionLoading}
                                className="inline-flex h-8 items-center gap-1.5 border border-black bg-black px-3 text-[10px] font-black uppercase text-white transition hover:bg-[#1a73e8] disabled:cursor-wait disabled:opacity-70"
                            >
                                <Check className="h-3.5 w-3.5" />
                                Save baseline
                            </button>
                            <button
                                type="button"
                                onClick={handleCancelManualEntry}
                                className="inline-flex h-8 items-center gap-1.5 border border-[#dadce0] bg-white px-3 text-[10px] font-black uppercase text-slate-700 transition hover:border-black hover:text-black"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                )}
            </div>
        );
    };

    return (
        <section className="rejourney-general-card flex min-w-0 flex-col border border-[#dadce0] bg-white shadow-none">
            <div className="h-1 bg-[#67e8f9] rounded-t-[7px]" />
            <div className="flex min-h-0 flex-col p-4 sm:p-5">
                <div
                    className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${isCollapsed ? '' : 'mb-4 border-b border-[#e8eaed] pb-3'}`}
                >
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="min-w-0 break-words text-[15px] font-medium text-[#202124] underline decoration-dotted decoration-[#bdc1c6] underline-offset-4">
                                Revenue impact
                            </h2>
                            {activeProviderMeta && (
                                <span className="border border-[#dadce0] bg-[#f8fafc] px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                                    {activeProviderMeta.shortLabel}
                                </span>
                            )}
                            <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase leading-none ${statusClass}`}>
                                {statusLabel}
                            </span>
                        </div>
                        {showRevenueDataView && (
                            <div className="mt-1 truncate text-[11px] font-semibold text-slate-500" title={accountLabel}>
                                {accountLabel}
                            </div>
                        )}
                    </div>

                    <div
                        className="flex w-full shrink-0 flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {hasActiveConnection && activeProvider && (
                            <>
                                {revenue?.currencies && revenue.currencies.length > 1 && (
                                    <select
                                        value={currency ?? ''}
                                        onChange={(event) => onCurrencyChange(event.target.value || null)}
                                        aria-label="Revenue currency"
                                        className="min-h-7 border border-black bg-white px-2 text-[10px] font-black uppercase text-black outline-none transition hover:bg-[#f8fafc] focus:ring-2 focus:ring-black"
                                    >
                                        {revenue.currencies.map((row) => (
                                            <option key={row.currency} value={row.currency}>
                                                {row.currency.toUpperCase()}
                                            </option>
                                        ))}
                                    </select>
                                )}

                                {canManage && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsSettingsOpen(false);
                                                setIsManualFormOpen(false);
                                                onSync(activeProvider);
                                            }}
                                            disabled={isActionLoading || status === 'syncing' || isSyncPending}
                                            className="inline-flex min-h-7 items-center gap-1.5 border border-black bg-white px-2.5 text-[10px] font-black uppercase text-black transition hover:bg-[#ecfeff] disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <RefreshCw className={`h-3.5 w-3.5 ${status === 'syncing' || isSyncPending ? 'animate-spin' : ''}`} />
                                            {status === 'syncing' || isSyncPending ? 'Syncing' : 'Sync'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsSettingsOpen(false);
                                                setIsManualFormOpen(false);
                                                onDisconnect(activeProvider);
                                            }}
                                            disabled={isActionLoading || isDisconnectPending}
                                            className="inline-flex min-h-7 items-center gap-1.5 border border-black bg-white px-2.5 text-[10px] font-black uppercase text-black transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {isDisconnectPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                                            {isDisconnectPending ? 'Disconnecting' : 'Disconnect'}
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                        {canManage && (
                            <button
                                type="button"
                                onClick={() => setIsSettingsOpen((current) => !current)}
                                aria-pressed={isSettingsOpen}
                                title="Revenue source settings"
                                className="inline-flex h-7 w-7 items-center justify-center border border-black bg-white text-black transition hover:bg-[#ecfeff]"
                            >
                                <Settings className="h-3.5 w-3.5" aria-hidden />
                                <span className="sr-only">Revenue source settings</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleToggleCollapsed}
                            aria-expanded={!isCollapsed}
                            aria-controls={revenueBodyId}
                            title={isCollapsed ? 'Expand revenue impact' : 'Collapse revenue impact'}
                            className="inline-flex h-7 w-7 items-center justify-center border border-black bg-white text-black transition hover:bg-[#ecfeff]"
                        >
                            <ChevronDown className={`h-4 w-4 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} aria-hidden />
                            <span className="sr-only">{isCollapsed ? 'Expand revenue impact' : 'Collapse revenue impact'}</span>
                        </button>
                    </div>
                </div>

                {!isCollapsed && (
                    <div id={revenueBodyId}>
                        {isLoading ? (
                            <div aria-busy="true">
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                                    {Array.from({ length: 6 }).map((_, index) => (
                                        <div key={`revenue-kpi-ghost-${index}`} className="space-y-2">
                                            <GhostBlock className="h-3 w-24" />
                                            <GhostBlock className="h-7 w-28" />
                                        </div>
                                    ))}
                                </div>
                                <GhostBlock className="mt-4 h-[260px]" />
                                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#e8eaed] pt-3">
                                    <GhostBlock className="h-3 w-72 max-w-full" />
                                    <GhostBlock className="h-7 w-20" />
                                </div>
                            </div>
                        ) : error ? (
                            <div className="border-2 border-black bg-[#fecaca] px-3 py-2 text-sm font-bold text-black">
                                {error}
                            </div>
                        ) : !showRevenueDataView ? (
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold text-[#202124]">Revenue tracking is not connected</div>
                                        <div className="mt-1 text-xs font-semibold text-slate-500">
                                            {canManage ? 'Choose one source for the General revenue chart.' : 'Ask an admin to connect revenue tracking.'}
                                        </div>
                                    </div>
                                </div>
                                {canManage ? renderProviderGrid() : null}
                                {isSettingsOpen && canManage ? renderSettingsPanel(false) : null}
                                {renderManualRevenuePanel()}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {actionMessage && (
                                    <div className="flex items-center gap-2 border border-cyan-300 bg-[#cffafe] px-3 py-2 text-xs font-bold text-slate-950" aria-live="polite">
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        {actionMessage}
                                    </div>
                                )}
                                {isSettingsOpen && canManage && renderSettingsPanel()}

                                <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-[#e8eaed] pb-4 sm:grid-cols-3 lg:grid-cols-6">
                                    <div className="col-span-2 min-w-0 sm:col-span-1">
                                        <span className="dashboard-label">Gross revenue</span>
                                        <div className="mt-1 whitespace-nowrap text-2xl font-medium leading-tight text-[#202124]">
                                            {formatCurrencyMinor(revenue?.summary.grossAmountCents ?? 0, currency)}
                                        </div>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="dashboard-label">Change</span>
                                        <div className={`mt-1 break-words text-[1.35rem] font-medium leading-tight ${changeClass}`}>
                                            {formatRevenueChange(grossChange)}
                                        </div>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="dashboard-label">Transactions</span>
                                        <div className="dashboard-value-md mt-1">{formatCompact(revenue?.summary.transactionCount ?? 0)}</div>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="dashboard-label">Refunds</span>
                                        <div className="dashboard-value-md mt-1 break-words">
                                            {formatCurrencyMinor(revenue?.summary.refundAmountCents ?? 0, currency)}
                                        </div>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="dashboard-label">Subscribers</span>
                                        <div className="dashboard-value-md mt-1">{formatCompact(revenue?.summary.subscriberCount ?? 0)}</div>
                                    </div>
                                    <div className="min-w-0">
                                        <span className="dashboard-label">Synced</span>
                                        <div className="mt-1 break-words text-sm font-semibold text-[#202124]">
                                            {formatSyncTime(revenue?.connection.lastSyncCompletedAt ?? revenue?.connection.lastSyncStartedAt)}
                                        </div>
                                    </div>
                                </div>

                                {status === 'syncing' && (
                                    <div className="border border-cyan-300 bg-[#cffafe] px-3 py-2 text-xs font-bold text-slate-950">
                                        Revenue sync is running in the background. You can refresh, switch pages, or leave this page; the import will continue.
                                        {syncPreviewLabel && (
                                            <span className="mt-1 block text-slate-700">{syncPreviewLabel}. {syncScanLabel}.</span>
                                        )}
                                    </div>
                                )}

                                {status === 'disconnected' && (
                                    <div className="border border-amber-300 bg-[#fef3c7] px-3 py-2 text-xs font-bold text-amber-950">
                                        Revenue source is disconnected. Historical revenue remains visible.
                                    </div>
                                )}

                                {status === 'error' && revenue?.connection.lastSyncError && (
                                    <div className="border-2 border-black bg-[#fecaca] px-3 py-2 text-sm font-bold text-black">
                                        {revenue.connection.lastSyncError}
                                    </div>
                                )}

                                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="text-sm font-semibold text-[#202124] underline decoration-dotted decoration-[#bdc1c6] underline-offset-4">Revenue trend</span>
                                        {currency && (
                                            <span className="border border-[#dadce0] bg-[#f8fafc] px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                                                {currency}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                                        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#1a73e8]" /> Gross</span>
                                        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#34a853]" /> Net</span>
                                        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#f9a8d4]" /> Refunds</span>
                                    </div>
                                </div>

                                <div className="h-[260px] sm:h-[310px]">
                                    {chartData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={chartData} margin={{ top: 28, right: 8, left: -4, bottom: 0 }}>
                                                <CartesianGrid stroke="#edf0f3" strokeDasharray="3 3" vertical={false} />
                                                <XAxis
                                                    dataKey="dateKey"
                                                    tick={{ fontSize: 10 }}
                                                    tickFormatter={formatDateLabel}
                                                    minTickGap={40}
                                                    tickLine={false}
                                                />
                                                <YAxis
                                                    tick={{ fontSize: 10 }}
                                                    width={64}
                                                    tickFormatter={(value) => formatCurrencyMinor(Number(value), currency, true)}
                                                    tickLine={false}
                                                />
                                                <Tooltip
                                                    wrapperStyle={VERSION_TOOLTIP_WRAPPER_STYLE}
                                                    cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                                                    content={<RevenueImpactTooltip currency={currency} releaseMarkers={releaseMarkers} />}
                                                />
                                                <Bar dataKey="refundAmountCents" name="Refunds" fill="#f9a8d4" barSize={8} isAnimationActive={false} />
                                                <Area
                                                    type="monotone"
                                                    dataKey="grossAmountCents"
                                                    name="Gross revenue"
                                                    stroke="#1a73e8"
                                                    fill="#dbeafe"
                                                    strokeWidth={2.4}
                                                    dot={false}
                                                    activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2, fill: '#1a73e8' }}
                                                    isAnimationActive={false}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="netAmountCents"
                                                    name="Net"
                                                    stroke="#34a853"
                                                    strokeWidth={2}
                                                    dot={false}
                                                    activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2, fill: '#34a853' }}
                                                    isAnimationActive={false}
                                                />
                                                {releaseMarkers.map((marker, index) => (
                                                    <ReferenceLine
                                                        key={`revenue-version-${marker.version}-${marker.dateKey}`}
                                                        x={marker.dateKey}
                                                        stroke="#334155"
                                                        strokeDasharray="4 4"
                                                        strokeWidth={1.4}
                                                        ifOverflow="extendDomain"
                                                        label={buildVersionReleaseLineLabel(marker.version, index)}
                                                    />
                                                ))}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    ) : isRevenueSyncInProgress ? (
                                        <div className="flex h-full items-center justify-center border-2 border-dashed border-cyan-300 bg-[#ecfeff] p-4 text-center">
                                            <div className="max-w-lg">
                                                <RefreshCw className="mx-auto h-6 w-6 animate-spin text-[#1a73e8]" />
                                                <div className="mt-3 text-sm font-bold text-slate-950">Syncing revenue data</div>
                                                <div className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                                                    {syncPreviewLabel || (activeProvider === 'custom_events'
                                                        ? 'Looking for mapped purchase events in your sessions.'
                                                        : 'Backfilling provider revenue rows.')}
                                                </div>
                                                {syncScanLabel && (
                                                    <div className="mt-1 text-[11px] font-semibold text-slate-500">{syncScanLabel}.</div>
                                                )}
                                                <div className="mt-2 text-[11px] font-bold text-slate-700">
                                                    Safe to refresh, switch projects, or leave this page. Sync continues in the background.
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex h-full items-center justify-center border-2 border-dashed border-[#dadce0] bg-[#f8fafc] p-4 text-center text-sm font-semibold text-slate-500">
                                            {revenueSyncEmptyText}
                                        </div>
                                    )}
                                </div>

                                {renderManualRevenuePanel()}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
};

export const GeneralOverview: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { isDemoMode } = useDemoMode();
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const pathPrefix = usePathPrefix();
    const navigate = useNavigate();
    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(selectedProject?.id);
    const { platformLens } = useSharedPlatformLens(selectedProject?.id, selectedProject?.platforms);
    const platform = platformLensToSessionPlatform(platformLens);
    const customEventSelectionStorageKey = useMemo(
        () => selectedProject?.id ? `${CUSTOM_EVENT_SELECTION_STORAGE_PREFIX}:${selectedProject.id}:${platformLens}` : null,
        [platformLens, selectedProject?.id],
    );
    const revenueImpactCollapsedStorageKey = useMemo(
        () => `${REVENUE_IMPACT_COLLAPSED_STORAGE_PREFIX}:${selectedProject?.id || 'global'}`,
        [selectedProject?.id],
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
    const [revenueOverview, setRevenue] = useState<RevenueOverview | null>(null);
    const [isRevenueLoading, setIsRevenueLoading] = useState(false);
    const [revenueOverviewError, setRevenueError] = useState<string | null>(null);
    const [revenueOverviewCurrency, setRevenueCurrency] = useState<string | null>(null);
    const [revenueActionState, setRevenueActionState] = useState<RevenueActionState>(null);
    const isRevenueActionLoading = revenueActionState !== null;
    const [copiedTopUserKey, setCopiedTopUserKey] = useState<string | null>(null);
    const [copiedDocsPrompt, setCopiedDocsPrompt] = useState(false);
    const [referralSourceMode, setReferralSourceMode] = useState<ReferralSourceMode>('referrer');
    const [referralUtmDimension, setReferralUtmDimension] = useState<ReferralUtmDimension>('source');
    const [selectedCustomEventNames, setSelectedCustomEventNames] = useState<string[]>([]);
    const [customEventSelectionTouched, setCustomEventSelectionTouched] = useState(false);
    const [customEventSearchQuery, setCustomEventSearchQuery] = useState('');
    const [hydratedCustomEventSelectionKey, setHydratedCustomEventSelectionKey] = useState<string | null>(null);
    const overviewDataScopeRef = useRef<string | null>(null);
    const sessionDataScopeRef = useRef<string | null>(null);
    const topUsersDataScopeRef = useRef<string | null>(null);
    const referralDataScopeRef = useRef<string | null>(null);

    useEffect(() => {
        setRevenueCurrency(null);
    }, [selectedProject?.id]);

    const loadRevenue = useCallback(async (options: { showLoading?: boolean } = {}) => {
        const showLoading = options.showLoading ?? true;
        if (!selectedProject?.id || isDemoMode) {
            setRevenue(null);
            setRevenueError(null);
            setIsRevenueLoading(false);
            return;
        }

        if (showLoading) setIsRevenueLoading(true);
        setRevenueError(null);
        try {
            const data = await getRevenueOverview(selectedProject.id, timeRange, revenueOverviewCurrency);
            setRevenue(data);
        } catch (error) {
            setRevenue(null);
            setRevenueError(error instanceof Error ? error.message : 'Unable to load revenue.');
        } finally {
            setIsRevenueLoading(false);
        }
    }, [isDemoMode, selectedProject?.id, timeRange, revenueOverviewCurrency]);

    useEffect(() => {
        let isCancelled = false;

        if (!selectedProject?.id || isDemoMode) {
            setRevenue(null);
            setRevenueError(null);
            setIsRevenueLoading(false);
            return;
        }

        setIsRevenueLoading(true);
        setRevenueError(null);

        getRevenueOverview(selectedProject.id, timeRange, revenueOverviewCurrency)
            .then((data) => {
                if (isCancelled) return;
                setRevenue(data);
            })
            .catch((error) => {
                if (isCancelled) return;
                setRevenue(null);
                setRevenueError(error instanceof Error ? error.message : 'Unable to load revenue.');
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsRevenueLoading(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [isDemoMode, manualRefreshVersion, selectedProject?.id, timeRange, revenueOverviewCurrency]);

    useEffect(() => {
        if (!selectedProject?.id || isDemoMode || revenueOverview?.connection.status !== 'syncing') return;
        let isPolling = false;
        const interval = window.setInterval(() => {
            if (isPolling) return;
            isPolling = true;
            void loadRevenue({ showLoading: false }).finally(() => {
                isPolling = false;
            });
        }, 2500);
        return () => window.clearInterval(interval);
    }, [isDemoMode, loadRevenue, revenueOverview?.connection.status, selectedProject?.id]);

    useEffect(() => {
        if (!selectedProject?.id) {
            overviewDataScopeRef.current = null;
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
        const dataScope = `${selectedProject.id}:${timeRange}:${normalizedPlatform ?? 'all'}`;
        const shouldClearCurrentData = overviewDataScopeRef.current !== dataScope;
        overviewDataScopeRef.current = dataScope;

        setSectionStatus(buildGeneralSectionStatuses('loading'));
        setFailedSections([]);
        if (shouldClearCurrentData) {
            setTrends(null);
            setOverviewObs(null);
            setDeepMetrics(null);
            setEngagementTrends(null);
            setGeoSummary(null);
            setRetentionCohortRows([]);
        }

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
    }, [manualRefreshVersion, selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (!selectedProject?.id) {
            sessionDataScopeRef.current = null;
            setSessions([]);
            setIsSessionsLoading(false);
            return;
        }

        let isCancelled = false;
        const dataScope = `${selectedProject.id}:${timeRange}:${platform ?? 'all'}`;
        const shouldClearCurrentData = sessionDataScopeRef.current !== dataScope;
        sessionDataScopeRef.current = dataScope;
        setIsSessionsLoading(true);
        if (shouldClearCurrentData) {
            setSessions([]);
        }

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
    }, [manualRefreshVersion, selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (!selectedProject?.id || isDemoMode) {
            topUsersDataScopeRef.current = null;
            setTopUsersFromBackend([]);
            setIsTopUsersLoading(false);
            return;
        }

        let isCancelled = false;
        const dataScope = `${selectedProject.id}:${timeRange}:${platform ?? 'all'}`;
        const shouldClearCurrentData = topUsersDataScopeRef.current !== dataScope;
        topUsersDataScopeRef.current = dataScope;
        setIsTopUsersLoading(true);
        if (shouldClearCurrentData) {
            setTopUsersFromBackend([]);
        }

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
    }, [isDemoMode, manualRefreshVersion, selectedProject?.id, timeRange, platform]);

    useEffect(() => {
        if (!selectedProject?.id) {
            referralDataScopeRef.current = null;
            setIsReferralLoading(false);
            setWebReferralSessions([]);
            return;
        }
        if (platform === 'mobile') {
            referralDataScopeRef.current = null;
            setIsReferralLoading(false);
            setWebReferralSessions([]);
            return;
        }

        let isCancelled = false;
        const dataScope = `${selectedProject.id}:${timeRange}:${platform ?? 'all'}`;
        const shouldClearCurrentData = referralDataScopeRef.current !== dataScope;
        referralDataScopeRef.current = dataScope;
        setIsReferralLoading(true);
        if (shouldClearCurrentData) {
            setWebReferralSessions([]);
        }

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
    }, [manualRefreshVersion, selectedProject?.id, timeRange, platform]);

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

    const demoRevenue = useMemo(
        () => isDemoMode ? buildDemoRevenueOverview(trendChartData) : null,
        [isDemoMode, trendChartData],
    );

    const displayRevenue = isDemoMode ? demoRevenue : revenueOverview;

    const revenueChartData = useMemo<RevenueImpactChartRow[]>(() => {
        if (!displayRevenue?.daily?.length) return [];
        const startingRevenueByDate = new Map<string, { amountCents: number; transactionCount: number }>();
        for (const entry of displayRevenue.manualEntries || []) {
            if (entry.amountCents <= 0) continue;
            const current = startingRevenueByDate.get(entry.date) ?? { amountCents: 0, transactionCount: 0 };
            current.amountCents += entry.amountCents;
            current.transactionCount += Math.max(1, entry.transactionCount || 1);
            startingRevenueByDate.set(entry.date, current);
        }

        return displayRevenue.daily
            .map((row) => {
                const startingRevenue = startingRevenueByDate.get(row.date);
                const startingAmountCents = startingRevenue?.amountCents ?? 0;
                const startingTransactionCount = startingRevenue?.transactionCount ?? 0;

                return {
                    dateKey: row.date,
                    grossAmountCents: Math.max(0, Number(row.grossAmountCents || 0) - startingAmountCents),
                    refundAmountCents: Number(row.refundAmountCents || 0),
                    netAmountCents: Number(row.netAmountCents || 0) - startingAmountCents,
                    transactionCount: Math.max(0, Number(row.transactionCount || 0) - startingTransactionCount),
                    refundCount: Number(row.refundCount || 0),
                    subscriberCount: Number(row.subscriberCount || 0),
                    trialCount: Number(row.trialCount || 0),
                    subscriptionStartCount: Number(row.subscriptionStartCount || 0),
                    cancellationCount: Number(row.cancellationCount || 0),
                    conversionCount: Number(row.conversionCount || 0),
                    customEventCounts: row.customEventCounts || {},
                };
            })
            .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }, [displayRevenue]);

    const revenueVersionMarkers = useMemo(
        () => buildVersionReleaseMarkersForDateKeys(
            versionChartData,
            versionKeys,
            revenueChartData.map((row) => row.dateKey),
        ),
        [revenueChartData, versionChartData, versionKeys],
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

    const handleSelectRevenueProvider = useCallback(async (provider: RevenueProvider) => {
        if (!selectedProject?.id) return;
        if (isDemoMode) return;
        const previousRevenue = revenueOverview;
        const now = new Date().toISOString();
        setRevenueActionState({ kind: 'select_provider', provider });
        setRevenueError(null);
        setRevenue((current) => patchRevenueProviderStatus(current, provider, {
            status: 'connected',
            connectedAt: now,
            lastSyncError: null,
        }, { activeProvider: provider, updateConnection: true }));
        try {
            await setRevenueSource(selectedProject.id, provider);
            await loadRevenue();
        } catch (error) {
            setRevenue(previousRevenue);
            setRevenueError(error instanceof Error ? error.message : 'Unable to change revenue source.');
        } finally {
            setRevenueActionState(null);
        }
    }, [isDemoMode, loadRevenue, revenueOverview, selectedProject?.id]);

    const handleSyncRevenue = useCallback(async (provider: RevenueProvider) => {
        if (!selectedProject?.id) return;
        if (isDemoMode) return;
        const previousRevenue = revenueOverview;
        const now = new Date().toISOString();
        setRevenueActionState({ kind: 'sync', provider });
        setRevenueError(null);
        setRevenue((current) => patchRevenueProviderStatus(current, provider, {
            status: 'syncing',
            lastSyncStartedAt: now,
            lastSyncError: null,
        }, { activeProvider: provider, updateConnection: true }));
        try {
            await syncRevenueSource(selectedProject.id, provider);
            await loadRevenue();
        } catch (error) {
            setRevenue(previousRevenue);
            setRevenueError(error instanceof Error ? error.message : 'Unable to sync revenue.');
        } finally {
            setRevenueActionState(null);
        }
    }, [isDemoMode, loadRevenue, revenueOverview, selectedProject?.id]);

    const handleSaveSuperwallRevenue = useCallback(async (input: { apiKey: string }) => {
        if (!selectedProject?.id) return;
        if (isDemoMode) return;
        const previousRevenue = revenueOverview;
        const now = new Date().toISOString();
        setRevenueActionState({ kind: 'connect_superwall', provider: 'superwall' });
        setRevenueError(null);
        setRevenue((current) => patchRevenueProviderStatus(current, 'superwall', {
            status: 'syncing',
            accountId: null,
            accountName: 'Superwall',
            connectedAt: now,
            lastSyncStartedAt: now,
            lastSyncError: null,
        }, { activeProvider: 'superwall', updateConnection: true }));
        try {
            await connectSuperwallRevenue(selectedProject.id, input);
            await loadRevenue();
        } catch (error) {
            setRevenue(previousRevenue);
            setRevenueError(error instanceof Error ? error.message : 'Unable to connect Superwall revenue.');
        } finally {
            setRevenueActionState(null);
        }
    }, [isDemoMode, loadRevenue, revenueOverview, selectedProject?.id]);

    const handleSaveRevenueCatRevenue = useCallback(async (input: { apiKey: string; revenueCatProjectId: string }) => {
        if (!selectedProject?.id) return;
        if (isDemoMode) return;
        const previousRevenue = revenueOverview;
        const now = new Date().toISOString();
        setRevenueActionState({ kind: 'connect_revenuecat', provider: 'revenuecat' });
        setRevenueError(null);
        setRevenue((current) => patchRevenueProviderStatus(current, 'revenuecat', {
            status: 'syncing',
            accountId: input.revenueCatProjectId,
            accountName: 'RevenueCat',
            connectedAt: now,
            lastSyncStartedAt: now,
            lastSyncError: null,
        }, { activeProvider: 'revenuecat', updateConnection: true }));
        try {
            await connectRevenueCatRevenue(selectedProject.id, input);
            await loadRevenue();
        } catch (error) {
            setRevenue(previousRevenue);
            setRevenueError(error instanceof Error ? error.message : 'Unable to connect RevenueCat revenue.');
        } finally {
            setRevenueActionState(null);
        }
    }, [isDemoMode, loadRevenue, revenueOverview, selectedProject?.id]);

    const handleSaveCustomEventRevenue = useCallback(async (input: typeof DEFAULT_CUSTOM_REVENUE_CONFIG) => {
        if (!selectedProject?.id) return;
        if (isDemoMode) return;
        const previousRevenue = revenueOverview;
        const now = new Date().toISOString();
        setRevenueActionState({ kind: 'save_custom_events', provider: 'custom_events' });
        setRevenueError(null);
        setRevenue((current) => {
            const patched = patchRevenueProviderStatus(current, 'custom_events', {
                status: 'syncing',
                accountId: 'custom_events',
                accountName: 'Rejourney custom events',
                connectedAt: now,
                lastSyncStartedAt: now,
                lastSyncError: null,
            }, { activeProvider: 'custom_events', updateConnection: true });
            return patched ? { ...patched, customEventConfig: input } : patched;
        });
        try {
            await configureCustomEventRevenue(selectedProject.id, input);
            await loadRevenue();
        } catch (error) {
            setRevenue(previousRevenue);
            setRevenueError(error instanceof Error ? error.message : 'Unable to configure custom event revenue.');
        } finally {
            setRevenueActionState(null);
        }
    }, [isDemoMode, loadRevenue, revenueOverview, selectedProject?.id]);

    const handleSaveManualRevenueEntry = useCallback(async (input: ManualRevenueEntryInput) => {
        if (!selectedProject?.id) return;
        if (isDemoMode) return;
        const previousRevenue = revenueOverview;
        setRevenueActionState({ kind: 'save_manual', provider: 'custom_events', entryId: input.entryId });
        setRevenueError(null);
        setRevenue((current) => patchRevenueManualEntry(current, input));
        try {
            const payload = {
                date: input.date,
                amountCents: input.amountCents,
                currency: input.currency,
                transactionCount: input.transactionCount,
                note: input.note ?? null,
            };
            if (input.entryId) {
                const result = await updateManualRevenueEntry(selectedProject.id, input.entryId, payload);
                setRevenue((current) => current ? { ...current, manualEntries: [result.entry] } : current);
            } else {
                const result = await createManualRevenueEntry(selectedProject.id, payload);
                setRevenue((current) => current ? { ...current, manualEntries: [result.entry] } : current);
            }
            await loadRevenue();
        } catch (error) {
            setRevenue(previousRevenue);
            setRevenueError(error instanceof Error ? error.message : 'Unable to save historical revenue.');
        } finally {
            setRevenueActionState(null);
        }
    }, [isDemoMode, loadRevenue, revenueOverview, selectedProject?.id]);

    const handleDeleteManualRevenueEntry = useCallback(async (entryId: string) => {
        if (!selectedProject?.id) return;
        if (isDemoMode) return;
        const previousRevenue = revenueOverview;
        setRevenueActionState({ kind: 'delete_manual', provider: 'custom_events', entryId });
        setRevenueError(null);
        setRevenue((current) => removeRevenueManualEntry(current, entryId));
        try {
            await deleteManualRevenueEntry(selectedProject.id, entryId);
            await loadRevenue();
        } catch (error) {
            setRevenue(previousRevenue);
            setRevenueError(error instanceof Error ? error.message : 'Unable to delete historical revenue.');
        } finally {
            setRevenueActionState(null);
        }
    }, [isDemoMode, loadRevenue, revenueOverview, selectedProject?.id]);

    const handleDisconnectRevenue = useCallback(async (provider: RevenueProvider) => {
        if (!selectedProject?.id) return;
        if (isDemoMode) return;
        const confirmed = window.confirm(`Disconnect ${REVENUE_PROVIDER_META[provider].shortLabel} revenue for this project? Historical synced revenue will stay visible.`);
        if (!confirmed) return;

        const previousRevenue = revenueOverview;
        setRevenueActionState({ kind: 'disconnect', provider });
        setRevenueError(null);
        setRevenue((current) => patchRevenueProviderStatus(current, provider, {
            status: 'disconnected',
            lastSyncError: null,
        }, { activeProvider: provider, updateConnection: true }));
        try {
            await disconnectRevenueSource(selectedProject.id, provider);
            await loadRevenue();
        } catch (error) {
            setRevenue(previousRevenue);
            setRevenueError(error instanceof Error ? error.message : 'Unable to disconnect revenue.');
        } finally {
            setRevenueActionState(null);
        }
    }, [isDemoMode, loadRevenue, revenueOverview, selectedProject?.id]);

    const hasAnalyticsData = useMemo(() => {
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
    const areAllOverviewSectionsPending = useMemo(
        () => GENERAL_SECTION_KEYS.every((key) => sectionStatus[key] === 'idle' || sectionStatus[key] === 'loading'),
        [sectionStatus],
    );
    const isTopUsersSectionLoading = isDemoMode ? isSessionsLoading : isTopUsersLoading;
    const isRevenueImpactLoading = Boolean(selectedProject?.id) && !isDemoMode && isRevenueLoading && !revenueOverview;
    const isAnyAnalyticsCardLoading = isAnyOverviewSectionPending
        || isReferralLoading
        || isSessionsLoading
        || isTopUsersSectionLoading
        || isRevenueImpactLoading;
    const isTrendsLoading = isSectionLoading('trends');
    const isObservabilityLoading = isSectionLoading('observability');
    const isDeepMetricsLoading = isSectionLoading('deepMetrics');
    const isEngagementLoading = isSectionLoading('engagement');
    const isGeoLoading = isSectionLoading('geo');
    const isRetentionLoading = isSectionLoading('retention');
    const hasRevenuePartialIssue = Boolean(selectedProject?.id && !isDemoMode && revenueOverviewError);
    const partialSections = hasRevenuePartialIssue
        ? [...failedSections, 'revenue impact']
        : failedSections;
    const hasPartialIssues = partialSections.length > 0;
    const partialError = hasPartialIssues
        ? `Some widgets unavailable (${partialSections.join(', ')}).`
        : null;
    const showSetupEmptyState = Boolean(selectedProject?.id) && !isAnyAnalyticsCardLoading && !hasAnalyticsData && !hasPartialIssues;
    const showDashboardCards = Boolean(selectedProject?.id) && !showSetupEmptyState;
    const showRevenueImpact = Boolean(selectedProject?.id) && (hasAnalyticsData || isRevenueImpactLoading || hasRevenuePartialIssue || Boolean(displayRevenue));
    const hasLoadedAnyGeneralSurface = hasAnalyticsData
        || Boolean(displayRevenue)
        || sessions.length > 0
        || topUsersFromBackend.length > 0
        || retentionCohortRows.length > 0;
    const showFullGeneralGhost = Boolean(selectedProject?.id)
        && !isDemoMode
        && !hasLoadedAnyGeneralSurface
        && !hasPartialIssues
        && areAllOverviewSectionsPending
        && (isRevenueLoading || isAnyAnalyticsCardLoading);

    if (showFullGeneralGhost) {
        return <DashboardGhostLoader variant="general" />;
    }

    return (
        <div className="rejourney-general-page min-h-screen bg-[#f8fafd] pb-12 font-sans text-[#202124]">
            <DashboardPageHeader
                title="General"
                {...dashboardPageHeaderProps('general')}
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

                {showRevenueImpact && (
                    <RevenueImpactSection
                        revenue={displayRevenue}
                        isLoading={isRevenueImpactLoading}
                        error={isDemoMode ? null : revenueOverviewError}
                        selectedCurrency={revenueOverviewCurrency}
                        onCurrencyChange={setRevenueCurrency}
                        onSync={handleSyncRevenue}
                        onDisconnect={handleDisconnectRevenue}
                        onSelectProvider={handleSelectRevenueProvider}
                        onSaveSuperwall={handleSaveSuperwallRevenue}
                        onSaveRevenueCat={handleSaveRevenueCatRevenue}
                        onSaveCustomEvents={handleSaveCustomEventRevenue}
                        onSaveManualEntry={handleSaveManualRevenueEntry}
                        onDeleteManualEntry={handleDeleteManualRevenueEntry}
                        isActionLoading={isRevenueActionLoading}
                        actionState={revenueActionState}
                        customEvents={customEvents}
                        chartData={revenueChartData}
                        releaseMarkers={revenueVersionMarkers}
                        collapseStorageKey={revenueImpactCollapsedStorageKey}
                    />
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
                                Open the guided setup page to invite teammates, create a handoff, or copy the AI prompt.
                            </p>
                        </div>

                        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[1.1fr,0.9fr,0.8fr]">
                            <Link
                                to={`${pathPrefix}/setup`}
                                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[#1d4ed8] bg-[#1a73e8] px-4 py-3 text-center text-sm font-bold leading-snug !text-white shadow-sm transition-colors hover:border-[#1e40af] hover:bg-[#2563eb]"
                                style={{ color: '#ffffff' }}
                            >
                                <Wrench className="h-4 w-4 shrink-0 text-white" aria-hidden />
                                <span className="text-white">Open setup wizard</span>
                            </Link>
                            <button
                                type="button"
                                onClick={handleCopyIntegrationPrompt}
                                className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-3 text-center text-sm font-semibold leading-snug text-[#202124] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
                            >
                                <BookOpen className="h-4 w-4 shrink-0" />
                                {copiedDocsPrompt ? 'AI prompt copied' : 'Copy AI prompt'}
                            </button>
                            <a
                                href="/docs"
                                target="_blank"
                                rel="noreferrer"
                                className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white px-4 py-3 text-center text-sm font-semibold leading-snug text-[#1a73e8] transition-colors hover:border-[#1a73e8] hover:bg-[#eef4ff]"
                            >
                                <ExternalLink className="h-4 w-4 shrink-0" />
                                Docs
                            </a>
                        </div>
                    </div>
                )}

                {showDashboardCards && (
                    <>
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
                                    <Link to={`${pathPrefix}/geo`} className="text-[11px] font-bold text-[#2563eb] transition-colors hover:text-black">
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
                                    <Link to={`${pathPrefix}/devices`} className="text-[11px] font-bold text-[#2563eb] transition-colors hover:text-black">
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
                                            <Link to={`${pathPrefix}/journeys`} className="text-[11px] font-bold text-[#2563eb] transition-colors hover:text-black">
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
                                        const animalAvatarSeed = getAnimalAvatarSeed(session);
                                        const animalAvatar = getAnimalForIdentity(session);
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
                                                            <AnimalAvatar animal={animalAvatar} seed={animalAvatarSeed} size={32} neutral />
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
                                                            <CountryFlag countryCode={geoDisplay.countryCode} countryLabel={geoDisplay.countryLabel} decorative />
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

                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default GeneralOverview;
