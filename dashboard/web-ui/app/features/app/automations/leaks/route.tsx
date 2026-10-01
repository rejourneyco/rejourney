import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	AlertCircle,
    Bell,
	BookOpen,
	CalendarClock,
	CheckCircle2,
	FileText,
	Github,
	History,
	Inbox,
	Loader2,
    Play,
	RefreshCw,
    Search,
    Settings,
    SlidersHorizontal,
    SquareArrowOutUpRight,
    Trash2,
    UserPlus,
    Wrench,
    X,
    XCircle,
} from 'lucide-react';
import { Link, useLocation } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import {
    getGithubInstallUrl,
    getGithubLinkStatus,
    getLeak,
    getLeakContextRaw,
    getLeakRunHistory,
    getLeaks,
    requestLeakContext,
    updateLeak,
    type GithubLinkStatus,
    type LeakDetail,
    type LeakRunHistoryItem,
    type LeakRunHistoryResponse,
    type LeakSessionReference,
    type LeakStatus,
    type LeakSummary,
} from '~/shared/api/client';
import { contextCanBeCopied, measuredAffectedPercent } from './presentation';
import { isIssueDetectionUiEnabled } from '~/shared/config/runtimeEnv';
import { buildProjectAIIntegrationPrompt } from '~/shared/constants/aiPrompts';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { AnimalAvatar, getAnimalAvatarSeed, getAnimalForIdentity } from '~/shared/ui/core/AnimalAvatar';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { Modal } from '~/shared/ui/core/Modal';
import {
    dashboardButtonClass,
    dashboardChipClass,
    dashboardFieldClass,
    dashboardLabelClass,
    dashboardSelectedClass,
    type DashboardButtonVariant,
    type DashboardChipTone,
} from '~/shared/ui/core/dashboardStyles';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';
import { projectHasRecentData } from '~/features/app/setup/setupUtils';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';

const GITHUB_LINK_STATUS_STORAGE_PREFIX = 'rejourney.issueDetection.githubLinkStatus';
const ISSUE_SCAN_WINDOW_HOURS = 24;
const ISSUE_SCAN_DAILY_SESSION_CAP = 150;
type AffectedFilter = 'all' | 'high' | 'medium' | 'low';

interface LeakAlertSettings {
    leakScanAlertsEnabled: boolean;
}

interface LeakAlertRecipient {
    id: string;
    userId: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
}

interface LeakAlertTeamMember {
    userId: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
    isRecipient: boolean;
}

export function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    if (!isIssueDetectionUiEnabled(url.pathname)) {
        throw new Response('Not found', { status: 404 });
    }
    return null;
}

export const meta = () => [
    { title: 'Leaks - Rejourney' },
    { name: 'robots', content: 'noindex' },
];

function formatIssueType(issueType: string): string {
    return issueType.replace(/_/g, ' ');
}

function estimateAffectedPercent(leak: LeakSummary): number | null {
    return measuredAffectedPercent(leak);
}

function formatCountLabel(value: number, singular: string, plural = `${singular}s`): string {
    const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    return `${safe} ${safe === 1 ? singular : plural}`;
}

function formatPercentLabel(percent: number): string {
    return percent < 10 && !Number.isInteger(percent) ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

function estimatedAffectedUsers(leak: LeakSummary): number | null {
    const estimate = leak.estimatedAffectedUsersCount;
    if (typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0) return Math.round(estimate);
    return leak.affectedUsersCount > 0 ? leak.affectedUsersCount : null;
}

function hasSampleAffectedEstimate(leak: LeakSummary): boolean {
    return Boolean(
        leak.affectedEstimateBasis &&
        leak.affectedEstimateBasis !== 'observed_only' &&
        typeof leak.estimatedAffectedUsersCount === 'number' &&
        leak.estimatedAffectedUsersCount > 0
    );
}

function affectedUsersLabel(leak: LeakSummary): string {
    const users = estimatedAffectedUsers(leak);
    if (users === null) return 'Users unknown';
    return `${hasSampleAffectedEstimate(leak) ? '~' : ''}${formatCountLabel(users, 'user')}`;
}

function affectedUsersDetailLabel(leak: LeakSummary): string {
    const users = estimatedAffectedUsers(leak);
    if (users === null) return 'Affected users unknown';
    const prefix = hasSampleAffectedEstimate(leak) ? 'Estimated ~' : '';
    return `${prefix}${formatCountLabel(users, 'affected user')}`;
}

function affectedEstimateSampleLabel(leak: LeakSummary): string | null {
    const sampleSize = leak.affectedEstimateSampleSize;
    const totalSessions = leak.affectedEstimateTotalSessions;
    if (
        !sampleSize ||
        !totalSessions ||
        leak.affectedEstimateBasis === 'observed_only' ||
        sampleSize >= totalSessions
    ) {
        return null;
    }
    return `Sample ${formatCompactNumber(sampleSize)} / ${formatCompactNumber(totalSessions)} sessions`;
}

function affectedBadgeLabel(leak: LeakSummary, percent: number | null): string {
    if (percent !== null) return `Est. affected ${formatPercentLabel(percent)}`;
    const users = estimatedAffectedUsers(leak);
    return users === null ? 'Users unknown' : `${hasSampleAffectedEstimate(leak) ? 'Est. ' : 'Observed '}${formatCountLabel(users, 'user')}`;
}

// Only a measured population percentage supports a prevalence color.
function affectedPercentTone(percent: number | null): DashboardChipTone {
    if (percent === null) return 'neutral';
    if (percent >= 75) return 'danger';
    if (percent >= 50) return 'warning';
    return 'neutral';
}

function affectedFilterMatches(leak: LeakSummary, filter: AffectedFilter): boolean {
    if (filter === 'all') return true;
    const users = leak.affectedUsersCount;
    if (!users || users <= 0) return false;
    if (filter === 'high') return users >= 10;
    if (filter === 'medium') return users >= 3 && users < 10;
    return users < 3;
}

function affectedFilterLabel(filter: AffectedFilter): string {
    if (filter === 'high') return '10+ observed users';
    if (filter === 'medium') return '3–9 observed users';
    if (filter === 'low') return '1–2 observed users';
    return 'All signals';
}

function getBrowserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local timezone';
    } catch {
        return 'your local timezone';
    }
}

function formatLocalDateTime(date: Date, timeZone: string): string {
    try {
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone,
        }).format(date);
    } catch {
        return date.toLocaleString();
    }
}

function formatLocalTime(date: Date, timeZone: string): string {
    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            timeZone,
            timeZoneName: 'short',
        }).format(date);
    } catch {
        return date.toLocaleTimeString();
    }
}

function getLeakScanTiming() {
    const timeZone = getBrowserTimeZone();
    const nextScanReference = new Date();
    nextScanReference.setUTCHours(3, 0, 0, 0);

    return {
        timeZone,
        localScanLabel: formatLocalTime(nextScanReference, timeZone),
    };
}

function formatCompactNumber(value: number | null | undefined): string {
    const safe = Number.isFinite(value) ? Number(value) : 0;
    return new Intl.NumberFormat(undefined, { notation: safe >= 10000 ? 'compact' : 'standard' }).format(safe);
}

function formatBadgeCount(value: number | null | undefined): string | null {
    if (!Number.isFinite(value)) return null;
    const count = Number(value);
    if (count <= 0) return null;
    return count > 99 ? '99+' : String(count);
}

function formatDurationMs(value: number | null | undefined): string {
    if (!Number.isFinite(value) || Number(value) <= 0) return 'Still running';
    const totalSeconds = Math.max(1, Math.round(Number(value) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}s`;
    if (seconds === 0) return `${minutes}m`;
    return `${minutes}m ${seconds}s`;
}

function parseDateValue(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimeValue(value: string | null | undefined, timeZone: string): string {
    const date = parseDateValue(value);
    return date ? formatLocalDateTime(date, timeZone) : 'Not finished';
}

function humanizeToken(value: string): string {
    return value
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/, (letter) => letter.toUpperCase());
}

function formatRunTrigger(trigger: string): string {
    if (trigger === 'admin_scan' || trigger === 'scheduled_scan') return 'Nightly scan';
    if (trigger === 'manual_scan') return 'Manual scan';
    return humanizeToken(trigger || 'scan');
}

function runStatusMeta(status: string): { className: string; label: string } {
    const normalized = status.toLowerCase();
    if (normalized === 'success' || normalized === 'succeeded') {
        return { label: 'Completed', className: dashboardChipClass('success') };
    }
    if (normalized === 'running') {
        return { label: 'Running', className: dashboardChipClass('info') };
    }
    if (normalized === 'failed') {
        return { label: 'Failed', className: dashboardChipClass('danger') };
    }
    return { label: humanizeToken(status || 'unknown'), className: dashboardChipClass('neutral') };
}

function formatEmailStatus(run: LeakRunHistoryItem): { className: string; label: string; detail: string } {
    const status = run.email?.status;
    if (status === 'sent') {
        const recipients = run.email.recipientCount ?? 0;
        return {
            label: 'Email sent',
            detail: recipients > 0 ? `${recipients} recipient${recipients === 1 ? '' : 's'}` : 'Digest recorded as sent',
            className: dashboardChipClass('success'),
        };
    }
    if (status === 'skipped') {
        const reason = run.email?.reason === 'no_admitted_sessions'
            ? 'No sessions were admitted for analysis.'
            : run.email?.reason === 'no_issues'
                ? 'No inbox issues were created, so no email was sent.'
                : 'Digest was skipped for this run.';
        return { label: 'No email', detail: reason, className: dashboardChipClass('neutral') };
    }
    if (status === 'unknown') {
        return {
            label: 'Email unknown',
            detail: 'Issue-detection found inbox issues, but delivery is verified in Rejourney alert history.',
            className: dashboardChipClass('warning'),
        };
    }
    return {
        label: 'Not recorded',
        detail: 'This run did not include a delivery audit.',
        className: dashboardChipClass('neutral'),
    };
}

function getRunPrimaryExplanation(run: LeakRunHistoryItem): string {
    if (run.visibleIssues > 0) {
        return `${formatCompactNumber(run.visibleIssues)} inbox issue${run.visibleIssues === 1 ? '' : 's'} visible after this run.`;
    }
    if (run.problemsFound > 0) {
        return 'Problems were found, but they did not repeat enough to become inbox issues.';
    }
    if (run.admittedSessions > 0) {
        return 'Sessions were analyzed, but no leak problems were detected.';
    }
    if (run.sessionsScanned > 0) {
        return 'Sessions were considered, but none passed the admission gate.';
    }
    return 'No replay-ready sessions matched this run.';
}

function formatSettingValue(value: string | number | boolean | null | undefined, suffix = ''): string {
    if (value === null || value === undefined || value === '') return 'Auto';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return `${value}${suffix}`;
}

function objectEntriesSorted(record: Record<string, number> | null | undefined): Array<[string, number]> {
    return Object.entries(record ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function formatReadableScope(sourceGlobs: string[] | null | undefined): { label: string; extraCount: number } {
    const globs = (sourceGlobs ?? []).map((glob) => glob.trim()).filter(Boolean);
    if (globs.length === 0 || globs.some((glob) => glob === '**' || glob === '**/*')) {
        return { label: 'Whole repository', extraCount: 0 };
    }

    const labels = globs.map((glob) => {
        const withoutRecursive = glob.replace(/\/\*\*$/u, '').replace(/\*\*$/u, '');
        return withoutRecursive || glob;
    });

    return {
        label: labels.slice(0, 3).join(', '),
        extraCount: Math.max(labels.length - 3, 0),
    };
}

function githubStatusStorageKey(projectId: string): string {
    return `${GITHUB_LINK_STATUS_STORAGE_PREFIX}:${projectId}`;
}

function isGithubInstallationState(value: unknown): value is GithubLinkStatus['installationState'] {
    return value === 'active' || value === 'suspended' || value === 'revoked' || value === 'none';
}

function readGithubLinkStatusCache(projectId: string): GithubLinkStatus | null {
    if (!projectId || typeof window === 'undefined') return null;
    try {
        const raw = window.sessionStorage.getItem(githubStatusStorageKey(projectId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<GithubLinkStatus>;
        if (typeof parsed.linked !== 'boolean' || !isGithubInstallationState(parsed.installationState)) return null;

        return {
            linked: parsed.linked,
            installationId: typeof parsed.installationId === 'number' ? parsed.installationId : null,
            repo: parsed.repo ?? null,
            sourceGlobs: Array.isArray(parsed.sourceGlobs) ? parsed.sourceGlobs : null,
            installationState: parsed.installationState,
            linkedAt: typeof parsed.linkedAt === 'string' ? parsed.linkedAt : null,
        };
    } catch {
        return null;
    }
}

function saveGithubLinkStatusCache(projectId: string, status: GithubLinkStatus) {
    if (!projectId || typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(githubStatusStorageKey(projectId), JSON.stringify(status));
    } catch {
        // Ignore storage failures; the live status request still drives the UI.
    }
}

function getAlertHeaders(includeBody = false): HeadersInit {
    const headers: HeadersInit = {};
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (includeBody) headers['Content-Type'] = 'application/json';
    return headers;
}

async function getLeakAlertSettings(projectId: string): Promise<LeakAlertSettings> {
    const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-settings`, {
        credentials: 'include',
        headers: getAlertHeaders(),
    });
    if (!response.ok) throw new Error('Failed to load leak alert settings');
    const data = await response.json();
    return {
        leakScanAlertsEnabled: data.settings?.leakScanAlertsEnabled ?? true,
    };
}

async function updateLeakAlertSettings(projectId: string, settings: Partial<LeakAlertSettings>): Promise<LeakAlertSettings> {
    const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: getAlertHeaders(true),
        body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error('Failed to save leak alert settings');
    const data = await response.json();
    return {
        leakScanAlertsEnabled: data.settings?.leakScanAlertsEnabled ?? true,
    };
}

async function getLeakAlertRecipients(projectId: string): Promise<LeakAlertRecipient[]> {
    const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-recipients`, {
        credentials: 'include',
        headers: getAlertHeaders(),
    });
    if (!response.ok) throw new Error('Failed to load alert recipients');
    const data = await response.json();
    return data.recipients;
}

async function getLeakAlertTeamMembers(projectId: string): Promise<LeakAlertTeamMember[]> {
    const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/available-recipients`, {
        credentials: 'include',
        headers: getAlertHeaders(),
    });
    if (!response.ok) throw new Error('Failed to load team members');
    const data = await response.json();
    return data.members;
}

async function addLeakAlertRecipient(projectId: string, userId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-recipients`, {
        method: 'POST',
        credentials: 'include',
        headers: getAlertHeaders(true),
        body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add alert recipient');
    }
}

async function removeLeakAlertRecipient(projectId: string, userId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-recipients/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAlertHeaders(),
    });
    if (!response.ok) throw new Error('Failed to remove alert recipient');
}

async function writeClipboardText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Fall back to the textarea path below.
    }

    if (typeof document === 'undefined') return false;

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
    } catch {
        return false;
    }
}

function filterLeaks(leaks: LeakSummary[], search: string): LeakSummary[] {
    const normalizedSearch = search.trim().toLowerCase();
    return leaks.filter((leak) => {
        if (!normalizedSearch) return true;
        return [
            leak.title,
            leak.whyItMatters,
            leak.issueType,
            leak.shortId,
            ...leak.topSignals,
        ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
    });
}

type LeakEvidenceItem = {
    label?: string | null;
    summary?: string | null;
};

type CompatibleLeakEvidenceGroup = LeakDetail['evidenceGroups'][number] & {
    items?: Array<LeakEvidenceItem | null | undefined> | null;
};

function getEvidenceSummaries(group: LeakDetail['evidenceGroups'][number]): string[] {
    const compatibleGroup = group as CompatibleLeakEvidenceGroup;
    const signals = Array.isArray(compatibleGroup.signals) ? compatibleGroup.signals : [];
    const items = Array.isArray(compatibleGroup.items) ? compatibleGroup.items : [];

    return [...signals, ...items]
        .map((item) => item?.summary || item?.label || '')
        .filter(Boolean);
}

function getLeakSessionId(session: LeakSessionReference): string {
    return session.id || session.sessionId || '';
}

function getSessionUuidLabel(sessionId: string | null | undefined): string {
    const trimmed = (sessionId || '').trim();
    if (!trimmed) return 'Unknown replay';
    const parts = trimmed.split('_').filter(Boolean);
    return parts[parts.length - 1] || trimmed;
}

function PaneButton({
    children,
    className = '',
    disabled,
    icon,
    onClick,
    variant = 'secondary',
}: {
    children: React.ReactNode;
    className?: string;
    disabled?: boolean;
    icon?: React.ReactNode;
    onClick?: () => void;
    variant?: DashboardButtonVariant;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`${dashboardButtonClass(variant, 'md')} ${className}`}
        >
            {icon}
            {children}
        </button>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h3 className="text-sm font-medium leading-5 text-[#202124]">{children}</h3>;
}

function LeakReplayLink({
    pathPrefix,
    session,
}: {
    pathPrefix: string;
    session: LeakSessionReference;
}) {
    const sessionId = getLeakSessionId(session);
    const avatarIdentity = { id: sessionId || session.replayUrl || 'unknown-replay' };
    const replayAnimalSeed = getAnimalAvatarSeed(avatarIdentity);
    const replayAnimal = getAnimalForIdentity(avatarIdentity);
    const sessionUuid = getSessionUuidLabel(sessionId);

    return (
        <Link
            to={session.replayUrl || (sessionId ? `${pathPrefix}/sessions/${sessionId}` : `${pathPrefix}/sessions`)}
            className="flex min-w-0 items-center justify-between gap-3 rounded-none border border-[#dadce0] bg-white px-3 py-2 text-sm font-medium text-[#1a73e8] transition-colors hover:bg-[#f1f3f4]"
            title={`Open replay ${sessionUuid}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <AnimalAvatar
                    animal={replayAnimal}
                    seed={replayAnimalSeed}
                    size={24}
                    neutral
                />
                <span className="min-w-0 truncate font-mono" title={sessionUuid}>
                    {sessionUuid}
                </span>
            </span>
            <Play className="h-4 w-4 shrink-0" />
        </Link>
    );
}

function LeakRow({
    active,
    leak,
    onSelect,
}: {
    active: boolean;
    leak: LeakSummary;
    onSelect: () => void;
}) {
    const leadLabel = leak.status === 'ready' || leak.status === 'resolved' || leak.status === 'budget_exhausted'
        ? 'Why it matters:'
        : 'Split from group:';
    const affectedPercent = estimateAffectedPercent(leak);

    return (
        <button
            type="button"
            onClick={onSelect}
            className={`block w-full border-b border-[#e8eaed] px-4 py-3 text-left transition-colors sm:px-5 ${
                active ? dashboardSelectedClass : 'bg-white hover:bg-[#f1f3f4]'
            }`}
        >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_128px]">
                <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium leading-5 text-[#202124]">
                            {leak.title}
                        </span>
                    </div>
                    <p className="mt-1 line-clamp-2 pr-2 text-xs leading-5 text-[#5f6368]">
                        <span className="font-medium text-[#3c4043]">
                            {leadLabel}
                        </span>{' '}
                        {leak.whyItMatters}
                    </p>
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium tabular-nums text-[#5f6368]">
                        <span>{formatCountLabel(leak.affectedSessionsCount, 'session')}</span>
                        <span className="truncate">{leak.finding ? leak.finding.category === 'defect' ? 'Defect' : 'Usability opportunity' : formatIssueType(leak.issueType)}</span>
                        {leak.finding ? <span>{leak.finding.verifiedOccurrences} verified sessions</span> : null}
                    </div>
                </div>
                <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                    <span className={`${dashboardChipClass(affectedPercentTone(affectedPercent))} tabular-nums`}>
                        {affectedBadgeLabel(leak, affectedPercent)}
                    </span>
                    <span className="text-[11px] font-medium tabular-nums text-[#5f6368]">{affectedUsersLabel(leak)}</span>
                </div>
            </div>
        </button>
    );
}

function NoIssuesDetectedState() {
    const timing = useMemo(() => getLeakScanTiming(), []);

    return (
        <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-none bg-[#f1f3f4]">
                <Inbox className="h-7 w-7 text-[#80868b]" aria-hidden />
            </span>
            <div className="max-w-xs">
                <p className="text-sm font-medium text-[#202124]">Your inbox is empty</p>
                <p className="mt-1.5 text-sm font-medium leading-6 text-[#5f6368]">
                    Scans run daily around {timing.localScanLabel}. Issues appear here once Rejourney groups problems across sessions.
                </p>
            </div>
        </div>
    );
}

function GithubRepositorySettings({
    status,
    loading,
    setupHref,
    installBusy,
    installError,
    onInstall,
    timeZone,
}: {
    status: GithubLinkStatus | null;
    loading: boolean;
    setupHref: string;
    installBusy: boolean;
    installError: string | null;
    onInstall: () => void;
    timeZone: string;
}) {
    const repo = status?.repo ?? null;
    const linked = Boolean(status?.linked && status.installationState === 'active');
    const needsAttention = Boolean(status?.linked && status.installationState !== 'active' && status.installationState !== 'none');
    const repoName = repo ? `${repo.owner}/${repo.repo}` : 'No repository connected';
    const linkedAtDate = status?.linkedAt ? new Date(status.linkedAt) : null;
    const linkedAtLabel = linkedAtDate && !Number.isNaN(linkedAtDate.getTime())
        ? formatLocalDateTime(linkedAtDate, timeZone)
        : null;
    const readableScope = formatReadableScope(status?.sourceGlobs);
    const stateLabel = loading
        ? 'Checking'
        : linked
            ? 'Connected'
            : needsAttention
                ? 'Needs attention'
                : 'Not connected';
    const stateClassName = dashboardChipClass(linked
        ? 'success'
        : needsAttention
            ? 'warning'
            : 'neutral');

    return (
        <div className="px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Github className="h-4 w-4 text-[#5f6368]" />
                        <h3 className="text-sm font-medium text-[#202124]">
                            GitHub repository <span className="font-normal text-[#5f6368]">(optional)</span>
                        </h3>
                    </div>
                    <p className="mt-0.5 text-xs font-medium leading-5 text-[#5f6368]">
                        Add exact source locations and code-specific fix plans to future leak context.
                    </p>
                </div>
                <span className={`${stateClassName} shrink-0 self-start`}>
                    {stateLabel}
                </span>
            </div>

            {loading ? (
                <div className="mt-4 flex h-12 items-center border-t border-[#e8eaed] text-sm font-medium text-[#5f6368]">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking GitHub repository
                </div>
            ) : (
                <div className="mt-4 border-t border-[#e8eaed] pt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[#202124]">{repoName}</p>
                            {repo ? (
                                <>
                                    <p className="mt-1 text-xs font-medium leading-5 text-[#5f6368]">
                                        {[
                                            repo.defaultBranch ? `Branch ${repo.defaultBranch}` : null,
                                            repo.private ? 'Private repo' : 'Public repo',
                                            linkedAtLabel ? `Linked ${linkedAtLabel}` : null,
                                        ].filter(Boolean).join(' · ')}
                                    </p>
                                    <p className="mt-1 text-xs font-medium leading-5 text-[#5f6368]">
                                        Readable scope:{' '}
                                        <span className="font-medium text-[#202124]">
                                            {readableScope.label}{readableScope.extraCount > 0 ? `, +${readableScope.extraCount} more` : ''}
                                        </span>
                                    </p>
                                </>
                            ) : (
                                <p className="mt-1 text-xs font-medium leading-5 text-[#5f6368]">
                                    Leak detection and evidence context continue without a repository.
                                </p>
                            )}
                        </div>
                        <Link
                            to={setupHref}
                            className={`${dashboardButtonClass('primary', 'md')} !text-white`}
                            style={{ color: '#ffffff' }}
                        >
                            <Settings className="h-4 w-4 text-white" />
                            <span className="text-white">{repo ? 'Change repository' : 'Connect repository'}</span>
                        </Link>
                    </div>

                    {installError && (
                        <p className="mt-3 rounded-none border border-[#f6aea9] bg-[#fce8e6] px-3 py-2 text-xs font-medium text-[#a50e0e]">
                            {installError}
                        </p>
                    )}

                    {!linked && (
                        <button
                            type="button"
                            onClick={onInstall}
                            disabled={installBusy}
                            className={`mt-3 ${dashboardButtonClass('secondary', 'md')}`}
                        >
                            {installBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <SquareArrowOutUpRight className="h-4 w-4" />
                            )}
                            {needsAttention ? 'Reauthorize GitHub App' : 'Install or update GitHub App'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function RunMetric({
    label,
    value,
    tone = 'default',
}: {
    label: string;
    value: string | number;
    tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
    const toneClass = tone === 'good'
        ? 'text-[#137333]'
        : tone === 'warn'
            ? 'text-[#b06000]'
            : tone === 'bad'
                ? 'text-[#c5221f]'
                : 'text-[#202124]';

    return (
        <div className="min-w-0 border-b border-[#e8eaed] py-3">
            <p className={`text-lg font-medium tabular-nums ${toneClass}`}>{value}</p>
            <p className={`mt-0.5 ${dashboardLabelClass}`}>{label}</p>
        </div>
    );
}

function RunHistoryModal({
    error,
    history,
    isOpen,
    loading,
    onClose,
    onRefresh,
    timeZone,
    localScanLabel,
}: {
    error: string | null;
    history: LeakRunHistoryResponse | null;
    isOpen: boolean;
    loading: boolean;
    onClose: () => void;
    onRefresh: () => void;
    timeZone: string;
    localScanLabel: string;
}) {
    const runs = history?.runs ?? [];
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const selectedRun = runs.find((run) => run.id === selectedRunId) || runs[0] || null;

    useEffect(() => {
        if (!isOpen) return;
        if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
            setSelectedRunId(runs[0]?.id || null);
        }
    }, [isOpen, runs, selectedRunId]);

    const totalRuns = history?.stats.total ?? runs.length;
    const selectedStatus = selectedRun ? runStatusMeta(selectedRun.status) : null;
    const selectedEmail = selectedRun ? formatEmailStatus(selectedRun) : null;
    const latestRunLabel = history?.stats.lastRunAt ? formatDateTimeValue(history.stats.lastRunAt, timeZone) : 'No runs yet';
    const lastSuccessLabel = history?.stats.lastSuccessAt ? formatDateTimeValue(history.stats.lastSuccessAt, timeZone) : 'No completed scans yet';
    const unavailableMessage = history?.unavailableReason === 'run_history_endpoint_not_deployed'
        ? 'Run history needs the latest issue-detection edge deploy before it can read scan audit rows.'
        : history?.unavailableReason === 'issue_detection_service_unavailable'
            ? 'Issue detection is currently unavailable, so run history cannot be loaded.'
            : null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Run history"
            size="xl"
            variant="modern"
            bodyClassName="p-0"
            panelClassName="max-w-[1120px]"
        >
            <div className="bg-white">
                <div className="border-b border-[#e8eaed] px-5 py-4 sm:px-6">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium text-[#202124]">
                                <CalendarClock className="h-4 w-4 text-[#5f6368]" />
                                Daily leak scans run around {localScanLabel}
                            </div>
                            <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-[#5f6368]">
                                Rejourney scans replay-ready sessions, admits the highest-value sessions for deeper analysis, then promotes repeated problems into inbox issues. New issues usually appear a few minutes after the run starts.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onRefresh}
                            disabled={loading}
                            className={dashboardButtonClass('secondary', 'md')}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Refresh
                        </button>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="border-y border-[#e8eaed] py-3">
                            <p className="text-lg font-medium tabular-nums text-[#202124]">{formatCompactNumber(totalRuns)}</p>
                            <p className={`mt-0.5 ${dashboardLabelClass}`}>Runs recorded</p>
                        </div>
                        <div className="border-y border-[#e8eaed] py-3">
                            <p className="truncate text-sm font-medium tabular-nums text-[#202124]">{latestRunLabel}</p>
                            <p className={`mt-0.5 ${dashboardLabelClass}`}>Latest run</p>
                        </div>
                        <div className="border-y border-[#e8eaed] py-3">
                            <p className="truncate text-sm font-medium tabular-nums text-[#202124]">{lastSuccessLabel}</p>
                            <p className={`mt-0.5 ${dashboardLabelClass}`}>Last completed</p>
                        </div>
                    </div>
                </div>

                {unavailableMessage && (
                    <div className="mx-5 mt-4 rounded-none bg-[#fef7e0] px-3 py-2 text-sm font-medium text-[#b06000] sm:mx-6">
                        {unavailableMessage}
                    </div>
                )}

                {error && (
                    <div className="mx-5 mt-4 rounded-none border border-[#f6aea9] bg-[#fce8e6] px-3 py-2 text-sm font-medium text-[#a50e0e] sm:mx-6">
                        {error}
                    </div>
                )}

                {loading && runs.length === 0 ? (
                    <div className="flex h-72 items-center justify-center text-sm font-medium text-[#5f6368]">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading run history
                    </div>
                ) : runs.length === 0 ? (
                    <div className="flex h-72 flex-col items-center justify-center px-6 text-center">
                        <History className="h-9 w-9 text-[#80868b]" />
                        <p className="mt-3 text-sm font-medium text-[#202124]">
                            {unavailableMessage ? 'Run history is not connected yet' : 'No scans recorded yet'}
                        </p>
                        <p className="mt-1 max-w-sm text-sm font-medium leading-6 text-[#5f6368]">
                            {unavailableMessage || 'The next scheduled scan should appear here after it starts.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid min-h-[520px] lg:grid-cols-[360px_minmax(0,1fr)]">
                        <div className="border-b border-[#e8eaed] lg:border-b-0 lg:border-r">
                            <div className="max-h-[520px] overflow-y-auto">
                                {runs.map((run) => {
                                    const status = runStatusMeta(run.status);
                                    const active = selectedRun?.id === run.id;
                                    return (
                                        <button
                                            key={run.id}
                                            type="button"
                                            onClick={() => setSelectedRunId(run.id)}
                                            className={`block w-full border-b border-[#e8eaed] px-5 py-4 text-left transition-colors ${
                                                active ? dashboardSelectedClass : 'bg-white hover:bg-[#f1f3f4]'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium tabular-nums text-[#202124]">
                                                        {formatDateTimeValue(run.startedAt, timeZone)}
                                                    </p>
                                                    <p className="mt-1 text-xs font-medium leading-5 text-[#5f6368]">
                                                        {getRunPrimaryExplanation(run)}
                                                    </p>
                                                </div>
                                                <span className={`${status.className} shrink-0`}>
                                                    {status.label}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium tabular-nums text-[#5f6368]">
                                                <span>{formatCompactNumber(run.sessionsScanned)} scanned</span>
                                                <span>{formatCompactNumber(run.admittedSessions)} admitted</span>
                                                <span>{formatCompactNumber(run.visibleIssues)} issues</span>
                                                <span>{formatDurationMs(run.durationMs)}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {selectedRun && selectedStatus && selectedEmail && (
                            <div className="max-h-[520px] overflow-y-auto px-5 py-4 sm:px-6">
                                <div className="flex flex-col gap-3 border-b border-[#e8eaed] pb-4 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={selectedStatus.className}>
                                                {selectedStatus.label}
                                            </span>
                                            <span className={selectedEmail.className}>
                                                {selectedEmail.label}
                                            </span>
                                        </div>
                                        <h3 className="mt-3 text-lg font-medium text-[#202124]">
                                            {formatRunTrigger(selectedRun.trigger)}
                                        </h3>
                                        <p className="mt-1 font-mono text-xs text-[#5f6368]">
                                            {selectedRun.id}
                                        </p>
                                    </div>
                                    <div className="text-left sm:text-right">
                                        <p className="text-sm font-medium tabular-nums text-[#202124]">{formatDateTimeValue(selectedRun.startedAt, timeZone)}</p>
                                        <p className="mt-1 text-xs font-medium tabular-nums text-[#5f6368]">Duration {formatDurationMs(selectedRun.durationMs)}</p>
                                    </div>
                                </div>

                                <div className="grid gap-x-5 sm:grid-cols-3">
                                    <RunMetric label="Scanned" value={formatCompactNumber(selectedRun.sessionsScanned)} />
                                    <RunMetric label="Admitted" value={formatCompactNumber(selectedRun.admittedSessions)} tone={selectedRun.admittedSessions > 0 ? 'good' : 'default'} />
                                    <RunMetric label="Skipped" value={formatCompactNumber(selectedRun.skippedSessions)} />
                                    <RunMetric label="Problems" value={formatCompactNumber(selectedRun.problemsFound)} tone={selectedRun.problemsFound > 0 ? 'warn' : 'default'} />
                                    <RunMetric label="Inbox issues" value={formatCompactNumber(selectedRun.visibleIssues)} tone={selectedRun.visibleIssues > 0 ? 'good' : 'default'} />
                                    <RunMetric label="Warnings" value={formatCompactNumber(selectedRun.warningCount)} tone={selectedRun.warningCount > 0 ? 'warn' : 'default'} />
                                </div>

                                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                                    <section>
                                        <h4 className={dashboardLabelClass}>What happened</h4>
                                        <div className="mt-2 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                                            {(selectedRun.notes.length ? selectedRun.notes : [getRunPrimaryExplanation(selectedRun)]).map((note) => (
                                                <p key={note} className="py-2.5 text-sm font-medium leading-6 text-[#3c4043]">
                                                    {note}
                                                </p>
                                            ))}
                                        </div>
                                    </section>

                                    <section>
                                        <h4 className={dashboardLabelClass}>Digest email</h4>
                                        <div className="mt-2 border-y border-[#e8eaed] py-3">
                                            <p className="text-sm font-medium text-[#202124]">{selectedEmail.label}</p>
                                            <p className="mt-1 text-sm font-medium leading-6 text-[#5f6368]">{selectedEmail.detail}</p>
                                            {selectedRun.email?.sentAt && (
                                                <p className="mt-1 text-xs font-medium tabular-nums text-[#5f6368]">
                                                    Sent {formatDateTimeValue(selectedRun.email.sentAt, timeZone)}
                                                </p>
                                            )}
                                        </div>
                                    </section>
                                </div>

                                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                                    <section>
                                        <h4 className={dashboardLabelClass}>Scan settings</h4>
                                        <dl className="mt-2 grid grid-cols-2 gap-x-4 border-y border-[#e8eaed] py-2 text-sm">
                                            <dt className="py-1.5 font-medium text-[#5f6368]">Dry run</dt>
                                            <dd className="py-1.5 text-right font-medium tabular-nums text-[#202124]">{formatSettingValue(selectedRun.settings?.dryRun)}</dd>
                                            <dt className="py-1.5 font-medium text-[#5f6368]">Window</dt>
                                            <dd className="py-1.5 text-right font-medium tabular-nums text-[#202124]">{formatSettingValue(selectedRun.settings?.lookbackHours, 'h')}</dd>
                                            <dt className="py-1.5 font-medium text-[#5f6368]">Daily cap</dt>
                                            <dd className="py-1.5 text-right font-medium tabular-nums text-[#202124]">{formatSettingValue(selectedRun.settings?.dailyCap)}</dd>
                                            <dt className="py-1.5 font-medium text-[#5f6368]">Admission</dt>
                                            <dd className="py-1.5 text-right font-medium tabular-nums text-[#202124]">{formatSettingValue(selectedRun.settings?.topPercent, '%')}</dd>
                                            <dt className="py-1.5 font-medium text-[#5f6368]">SPA gate</dt>
                                            <dd className="py-1.5 text-right font-medium tabular-nums text-[#202124]">{formatSettingValue(selectedRun.settings?.spaGate)}</dd>
                                            <dt className="py-1.5 font-medium text-[#5f6368]">Promotion threshold</dt>
                                            <dd className="py-1.5 text-right font-medium tabular-nums text-[#202124]">{formatSettingValue(selectedRun.settings?.adaptivePromotionThreshold)}</dd>
                                            <dt className="py-1.5 font-medium text-[#5f6368]">Analyzed for promotion</dt>
                                            <dd className="py-1.5 text-right font-medium tabular-nums text-[#202124]">{formatSettingValue(selectedRun.settings?.adaptivePromotionAnalyzedSessions)}</dd>
                                        </dl>
                                    </section>

                                    <section>
                                        <h4 className={dashboardLabelClass}>Decision breakdown</h4>
                                        <div className="mt-2 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                                            {objectEntriesSorted(selectedRun.decisionBreakdown).length === 0 ? (
                                                <p className="py-3 text-sm font-medium text-[#5f6368]">No decision rows were recorded.</p>
                                            ) : objectEntriesSorted(selectedRun.decisionBreakdown).map(([key, value]) => (
                                                <div key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
                                                    <span className="font-medium text-[#5f6368]">{humanizeToken(key)}</span>
                                                    <span className="font-medium tabular-nums text-[#202124]">{formatCompactNumber(value)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                </div>

                                <section className="mt-5">
                                    <h4 className={dashboardLabelClass}>Analysis breakdown</h4>
                                    <div className="mt-2 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                                        {objectEntriesSorted(selectedRun.analysisBreakdown).length === 0 ? (
                                            <p className="py-3 text-sm font-medium text-[#5f6368]">No per-session analysis rows were attached to this run.</p>
                                        ) : objectEntriesSorted(selectedRun.analysisBreakdown).map(([key, value]) => (
                                            <div key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
                                                <span className="font-medium text-[#5f6368]">{humanizeToken(key)}</span>
                                                <span className="font-medium tabular-nums text-[#202124]">{formatCompactNumber(value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                {selectedRun.errors.length > 0 && (
                                    <section className="mt-5">
                                        <h4 className={dashboardLabelClass}>Warnings and errors</h4>
                                        <div className="mt-2 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                                            {selectedRun.errors.map((item, index) => (
                                                <div key={`${item.message}-${index}`} className="py-2.5">
                                                    <p className="text-sm font-medium text-[#c5221f]">
                                                        {item.stage ? humanizeToken(item.stage) : 'Warning'}
                                                        {item.sessionId ? ` · ${item.sessionId}` : ''}
                                                    </p>
                                                    <p className="mt-0.5 text-sm font-medium leading-6 text-[#5f6368]">{item.message}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export const Leaks: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { isDemoMode } = useDemoMode();
    const pathPrefix = usePathPrefix();
    const location = useLocation();
    const projectId = selectedProject?.id || (isDemoMode ? 'demo-project-001' : '');
    const [leaks, setLeaks] = useState<LeakSummary[]>([]);
    const [selectedLeakId, setSelectedLeakId] = useState<string | null>(null);
    const [selectedLeak, setSelectedLeak] = useState<LeakDetail | null>(null);
    const [search, setSearch] = useState('');
    const [affectedFilter, setAffectedFilter] = useState<AffectedFilter>('all');
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isDetailLoading, setIsDetailLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [handoffStatus, setHandoffStatus] = useState<string | null>(null);
    const [isGeneratingContext, setIsGeneratingContext] = useState(false);
    const [showLeakAlertSettings, setShowLeakAlertSettings] = useState(false);
    const [showRunHistory, setShowRunHistory] = useState(false);
    const [runHistory, setRunHistory] = useState<LeakRunHistoryResponse | null>(null);
    const [runHistoryLoading, setRunHistoryLoading] = useState(false);
    const [runHistoryError, setRunHistoryError] = useState<string | null>(null);
    const [leakAlertSettings, setLeakAlertSettings] = useState<LeakAlertSettings>({ leakScanAlertsEnabled: true });
    const [leakAlertRecipients, setLeakAlertRecipients] = useState<LeakAlertRecipient[]>([]);
    const [leakAlertMembers, setLeakAlertMembers] = useState<LeakAlertTeamMember[]>([]);
    const [leakAlertLoading, setLeakAlertLoading] = useState(false);
    const [leakAlertSaving, setLeakAlertSaving] = useState(false);
    const [leakAlertError, setLeakAlertError] = useState<string | null>(null);
    const [copiedSetupPrompt, setCopiedSetupPrompt] = useState(false);
    const [linkStatus, setLinkStatus] = useState<GithubLinkStatus | null>(() => readGithubLinkStatusCache(projectId));
    const [linkLoading, setLinkLoading] = useState(false);
    const [installBusy, setInstallBusy] = useState(false);
    const [installError, setInstallError] = useState<string | null>(null);
    const copiedResetTimerRef = useRef<number | null>(null);
    const runHistoryRequestRef = useRef(0);
    const setupPrompt = useMemo(() => (
        selectedProject ? buildProjectAIIntegrationPrompt(selectedProject) : ''
    ), [selectedProject]);
    const selectedProjectHasRecentData = useMemo(
        () => projectHasRecentData(selectedProject),
        [selectedProject],
    );
    const clearCopiedFeedback = useCallback(() => {
        if (copiedResetTimerRef.current !== null) {
            window.clearTimeout(copiedResetTimerRef.current);
            copiedResetTimerRef.current = null;
        }
        setCopied(false);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const settingsTarget = params.get('settings');
        if (settingsTarget === 'leak-alerts' || settingsTarget === 'leak-settings' || settingsTarget === 'github') {
            setShowLeakAlertSettings(true);
        }
    }, [location.search]);

    const loadLeakAlertSettings = useCallback(async () => {
        if (!projectId || isDemoMode) return;
        setLeakAlertLoading(true);
        setLeakAlertError(null);
        try {
            const [settings, recipients, members] = await Promise.all([
                getLeakAlertSettings(projectId),
                getLeakAlertRecipients(projectId),
                getLeakAlertTeamMembers(projectId),
            ]);
            setLeakAlertSettings(settings);
            setLeakAlertRecipients(recipients);
            setLeakAlertMembers(members);
        } catch (err) {
            setLeakAlertError(err instanceof Error ? err.message : 'Failed to load leak alert settings');
        } finally {
            setLeakAlertLoading(false);
        }
    }, [isDemoMode, projectId]);

    const loadRunHistory = useCallback(async () => {
        if (!projectId) return;
        const requestId = ++runHistoryRequestRef.current;
        setRunHistoryLoading(true);
        setRunHistoryError(null);
        try {
            const next = await getLeakRunHistory(projectId, 12);
            if (requestId === runHistoryRequestRef.current) setRunHistory(next);
        } catch (err) {
            if (requestId === runHistoryRequestRef.current) {
                setRunHistoryError(err instanceof Error ? err.message : 'Failed to load run history');
            }
        } finally {
            if (requestId === runHistoryRequestRef.current) setRunHistoryLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (!showLeakAlertSettings) return;
        void loadLeakAlertSettings();
    }, [loadLeakAlertSettings, showLeakAlertSettings]);

    useEffect(() => {
        ++runHistoryRequestRef.current;
        setRunHistory(null);
        setRunHistoryError(null);
        setRunHistoryLoading(false);
        return () => { ++runHistoryRequestRef.current; };
    }, [projectId]);

    useEffect(() => {
        if (!showRunHistory) return;
        void loadRunHistory();
    }, [loadRunHistory, showRunHistory]);

    const toggleLeakScanAlerts = async (enabled: boolean) => {
        if (!projectId || isDemoMode) return;
        setLeakAlertSaving(true);
        setLeakAlertError(null);
        try {
            const next = await updateLeakAlertSettings(projectId, { leakScanAlertsEnabled: enabled });
            setLeakAlertSettings(next);
        } catch (err) {
            setLeakAlertError(err instanceof Error ? err.message : 'Failed to save leak alert settings');
        } finally {
            setLeakAlertSaving(false);
        }
    };

    const handleAddLeakAlertRecipient = async (userId: string) => {
        if (!projectId || isDemoMode) return;
        setLeakAlertSaving(true);
        setLeakAlertError(null);
        try {
            await addLeakAlertRecipient(projectId, userId);
            await loadLeakAlertSettings();
        } catch (err) {
            setLeakAlertError(err instanceof Error ? err.message : 'Failed to add recipient');
        } finally {
            setLeakAlertSaving(false);
        }
    };

    const handleRemoveLeakAlertRecipient = async (userId: string) => {
        if (!projectId || isDemoMode) return;
        setLeakAlertSaving(true);
        setLeakAlertError(null);
        try {
            await removeLeakAlertRecipient(projectId, userId);
            await loadLeakAlertSettings();
        } catch (err) {
            setLeakAlertError(err instanceof Error ? err.message : 'Failed to remove recipient');
        } finally {
            setLeakAlertSaving(false);
        }
    };

    const showCopiedFeedback = useCallback((message: string) => {
        setCopied(true);
        setHandoffStatus(message);

        if (copiedResetTimerRef.current !== null) {
            window.clearTimeout(copiedResetTimerRef.current);
        }

        copiedResetTimerRef.current = window.setTimeout(() => {
            setCopied(false);
            copiedResetTimerRef.current = null;
        }, 3200);
    }, []);

    useEffect(() => () => {
        if (copiedResetTimerRef.current !== null) {
            window.clearTimeout(copiedResetTimerRef.current);
        }
    }, []);

    useEffect(() => {
        if (!showLeakAlertSettings) return;
        if (!projectId) {
            setLinkStatus(null);
            setLinkLoading(false);
            return;
        }
        let cancelled = false;
        const cachedStatus = readGithubLinkStatusCache(projectId);
        setLinkStatus(cachedStatus);
        setLinkLoading(true);
        getGithubLinkStatus(projectId)
            .then((status) => {
                if (!cancelled) {
                    setLinkStatus(status);
                    saveGithubLinkStatusCache(projectId, status);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setLinkStatus(cachedStatus);
                }
            })
            .finally(() => {
                if (!cancelled) setLinkLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, showLeakAlertSettings]);

    const startInstall = async () => {
        if (!projectId) return;
        setInstallBusy(true);
        setInstallError(null);
        try {
            const { installUrl } = await getGithubInstallUrl(projectId);
            window.location.href = installUrl;
        } catch (err) {
            setInstallError(err instanceof Error ? err.message : 'Could not start the GitHub App install');
            setInstallBusy(false);
        }
    };

    useEffect(() => {
        clearCopiedFeedback();
        setHandoffStatus(null);
    }, [clearCopiedFeedback, selectedLeakId]);

    useEffect(() => {
        if (!projectId) {
            setLeaks([]);
            setSelectedLeakId(null);
            setError(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setError(null);
        getLeaks({ projectId, view: 'inbox' })
            .then((response) => {
                if (cancelled) return;
                setLeaks(response.leaks || []);
                // Empty inboxes need history to distinguish setup from a clean scan.
                // Start it only after the list returns, without delaying the inbox.
                if (!response.leaks?.length) void loadRunHistory();
                setSelectedLeakId((current) =>
                    response.leaks?.some((leak) => leak.id === current) ? current : response.leaks?.[0]?.id || null
                );
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'Issue detection is not available');
                setLeaks([]);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [loadRunHistory, projectId]);

    useEffect(() => {
        if (!selectedLeakId) {
            setSelectedLeak(null);
            return;
        }

        let cancelled = false;
        setSelectedLeak(null);
        setIsDetailLoading(true);
        getLeak(selectedLeakId, { view: 'stored' })
            .then(async (detail) => {
                if (cancelled) return;
                setSelectedLeak(detail);
                setIsDetailLoading(false);
                // Original evidence and diagnostics enrich the already visible panel.
                try {
                    const enriched = await getLeak(selectedLeakId);
                    if (!cancelled) setSelectedLeak(enriched);
                } catch { /* Stored details and copyable context remain usable. */ }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Issue detection is not available');
                    setSelectedLeak(null);
                }
            })
            .finally(() => {
                if (!cancelled) setIsDetailLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedLeakId]);

    const filteredLeaks = useMemo(
        () => filterLeaks(leaks, search).filter((leak) => affectedFilterMatches(leak, affectedFilter)),
        [affectedFilter, leaks, search],
    );
    const activeLeak = selectedLeakId ? (selectedLeak?.id === selectedLeakId ? selectedLeak : null) || leaks.find((leak) => leak.id === selectedLeakId) || null : null;
    const topEvidenceSummary = selectedLeak?.evidenceGroups
        ?.flatMap((group) => getEvidenceSummaries(group))
        .slice(0, 2)
        .join(' ');

    const getActiveMarkdown = async (): Promise<string | null> => {
        if (!activeLeak) return null;
        return selectedLeak?.contextMarkdown || await getLeakContextRaw(activeLeak.id) || null;
    };

    const copyContext = async (): Promise<boolean> => {
        if (!activeLeak) return false;
        const markdown = await getActiveMarkdown();
        if (!markdown) return false;

        const copiedToClipboard = await writeClipboardText(markdown);
        if (copiedToClipboard) {
            showCopiedFeedback('Markdown copied to clipboard.');
        } else {
            clearCopiedFeedback();
            setHandoffStatus('Could not copy automatically. Select the markdown below and copy it manually.');
        }

        return copiedToClipboard;
    };

    const generateContext = async () => {
        if (!activeLeak) return;
        setIsGeneratingContext(true);
        setHandoffStatus(null);
        try {
            const updated = await requestLeakContext(activeLeak.id);
            const {
                evidenceGroups: _evidenceGroups,
                sessions: _sessions,
                contextMarkdown: _contextMarkdown,
                contextMarkdownUrl: _contextMarkdownUrl,
                ...updatedSummary
            } = updated;
            setSelectedLeak(updated);
            setLeaks((items) => items.map((item) => item.id === updated.id ? { ...item, ...updatedSummary } : item));
            setHandoffStatus(updated.contextStatus === 'ready'
                ? 'Context is ready.'
                : 'Context generation started. Refresh this issue in a moment.');
        } catch (err) {
            setHandoffStatus(err instanceof Error ? err.message : 'Could not generate markdown context.');
        } finally {
            setIsGeneratingContext(false);
        }
    };

    const markStatus = async (status: LeakStatus) => {
        if (!activeLeak) return;
        const updated = await updateLeak(activeLeak.id, { status });
        setSelectedLeak(updated);
        setLeaks((items) => items.map((item) => item.id === activeLeak.id ? { ...item, status: updated.status } : item));
    };

    const applyAffectedFilter = (filter: AffectedFilter) => {
        const nextLeaks = filterLeaks(leaks, search).filter((leak) => affectedFilterMatches(leak, filter));
        setAffectedFilter(filter);
        setIsFilterOpen(false);
        if (!selectedLeakId || !nextLeaks.some((leak) => leak.id === selectedLeakId)) {
            setSelectedLeakId(nextLeaks[0]?.id || null);
        }
    };

    const handleCopySetupPrompt = async () => {
        if (!setupPrompt) return;
        const copiedToClipboard = await writeClipboardText(setupPrompt);
        if (!copiedToClipboard) return;
        setCopiedSetupPrompt(true);
        window.setTimeout(() => setCopiedSetupPrompt(false), 1800);
    };

    const handoffReady = contextCanBeCopied(activeLeak);
    const canGenerateContext = Boolean(
        activeLeak &&
            activeLeak.status !== 'budget_exhausted' &&
            !handoffReady &&
            activeLeak.contextStatus !== 'researching' &&
            activeLeak.contextStatus !== 'running',
    );
    const handoffMessage = !activeLeak
        ? ''
        : activeLeak.status === 'budget_exhausted'
            ? 'Budget guard paused analysis. The signal stays in this inbox until the next analysis window.'
            : handoffReady
                ? 'Context is ready. Copy it into your coding assistant.'
                : activeLeak.contextStatus === 'researching' || activeLeak.contextStatus === 'running'
                    ? 'Research is running. You can review the evidence now, then use the markdown handoff when it is ready.'
                    : activeLeak.contextStatus === 'failed'
                        ? 'Context generation failed. Retry it to copy the context.'
                        : 'Context has not been generated yet. Generate it to copy the context.';
    const runHistoryCount = runHistory?.stats.total ?? runHistory?.runs.length ?? 0;
    const hasRunHistory = runHistoryCount > 0;
    const runHistoryKnown = Boolean(runHistory || runHistoryError);
    const showSetupEmptyState = Boolean(selectedProject?.id) && !isDemoMode && !isLoading && !selectedProjectHasRecentData && !hasRunHistory && runHistoryKnown && leaks.length === 0;
    const githubSetupHref = `${pathPrefix}/settings/${encodeURIComponent(projectId)}/github`;
    const hasSignalViewFilter = search.trim().length > 0 || affectedFilter !== 'all';
    const showNoIssuesDetectedState = !showSetupEmptyState && !isLoading && !error && leaks.length === 0 && !hasSignalViewFilter;
    const showFilteredEmptyState = !showSetupEmptyState && !showNoIssuesDetectedState && !isLoading && !error && filteredLeaks.length === 0;
    const loadingSignalsLabel = 'Loading signals';
    const copyButtonClassName = 'w-full sm:w-auto sm:min-w-[152px]';
    const copyButtonIcon = copied
        ? <CheckCircle2 className="h-4 w-4" />
        : <FileText className="h-4 w-4" />;
    const leakAlertAvailableMembers = useMemo(
        () => leakAlertMembers.filter((member) => !member.isRecipient),
        [leakAlertMembers],
    );
    const leakScanTiming = useMemo(() => getLeakScanTiming(), []);
    const runHistoryBadge = formatBadgeCount(runHistory?.stats.total ?? runHistory?.runs.length ?? 0);

    return (
        <div className="rejourney-general-page flex h-full min-h-0 flex-col overflow-hidden bg-[#f8fafd] font-sans text-[#202124]">
            <div className="shrink-0">
                <DashboardPageHeader
                    title="Leaks"
                    {...dashboardPageHeaderProps('leaks')}
                >
                    <button
                        type="button"
                        onClick={() => {
                            setShowRunHistory(true);
                            void loadRunHistory();
                        }}
                        className={dashboardButtonClass('secondary', 'sm')}
                    >
                        <History className="h-4 w-4" />
                        Run history
                        {runHistoryBadge && (
                            <span className={`${dashboardChipClass('neutral')} ml-0.5 min-w-5 justify-center tabular-nums`}>
                                {runHistoryBadge}
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setShowLeakAlertSettings(true);
                        }}
                        className={dashboardButtonClass('secondary', 'sm')}
                    >
                        <Settings className="h-4 w-4" />
                        Settings
                    </button>
                </DashboardPageHeader>
            </div>

            <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
                <div className={`grid min-h-0 min-w-0 w-full flex-1 bg-white shadow-none ${activeLeak ? 'lg:grid-cols-[360px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
                    <section className={`flex min-h-[420px] min-w-0 flex-col bg-white sm:min-h-[560px] lg:min-h-0 ${activeLeak ? 'hidden lg:flex lg:border-r lg:border-[#dadce0]' : ''}`}>
                        <div className="border-b border-[#dadce0] bg-white px-4 py-4 sm:px-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="truncate text-[15px] font-medium leading-6 text-[#202124]">
                                        Signals <span className="tabular-nums">({leaks.length})</span>
                                    </h2>
                                    <p className="mt-0.5 text-xs leading-5 text-[#5f6368]">
                                        Observed affected users
                                    </p>
                                </div>
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setIsFilterOpen((open) => !open)}
                                        className={`mt-1 inline-flex h-8 w-8 items-center justify-center rounded-none border transition-colors ${affectedFilter === 'all' ? 'border-transparent text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]' : 'border-[#d2e3fc] bg-[#e8f0fe] text-[#1967d2]'}`}
                                        aria-label="Filter signals"
                                        aria-expanded={isFilterOpen}
                                    >
                                        <SlidersHorizontal className="h-4 w-4" />
                                    </button>
                                    {isFilterOpen && (
                                        <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-none border border-[#dadce0] bg-white py-1 shadow-[0_4px_16px_rgba(60,64,67,0.2)]">
                                            {(['all', 'high', 'medium', 'low'] as const).map((filter) => (
                                                <button
                                                    key={filter}
                                                    type="button"
                                                    onClick={() => applyAffectedFilter(filter)}
                                                    className={`block w-full rounded-none px-3 py-2 text-left text-sm transition-colors ${affectedFilter === filter ? dashboardSelectedClass : 'text-[#3c4043] hover:bg-[#f1f3f4]'}`}
                                                >
                                                    {affectedFilterLabel(filter)}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <label className="mt-3 flex h-9 min-w-0 items-center gap-2 rounded-none border border-[#dadce0] bg-white px-3 transition-colors focus-within:border-[#1a73e8] focus-within:ring-2 focus-within:ring-[#1a73e8]/20">
                                <Search className="h-4 w-4 shrink-0 text-[#5f6368]" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search signals"
                                    className="min-w-0 flex-1 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#80868b]"
                                />
                            </label>
                            {affectedFilter !== 'all' && (
                                <div className="mt-2 flex items-center gap-2">
                                    <span className={dashboardChipClass('info')}>
                                        {affectedFilterLabel(affectedFilter)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => applyAffectedFilter('all')}
                                        className="text-xs font-medium text-[#1a73e8] hover:underline"
                                    >
                                        Clear
                                    </button>
                                </div>
                            )}
                        </div>

                            <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
                                {isLoading && (
                                    <div className="flex h-56 items-center justify-center text-sm font-medium text-[#5f6368]">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {loadingSignalsLabel}
                                    </div>
                                )}
                            {!isLoading && error && !showSetupEmptyState && (
                                <div className="m-5 rounded-none border border-[#f6aea9] bg-[#fce8e6] p-4 text-sm font-medium text-[#a50e0e]">
                                    Issue detection is not configured.
                                </div>
                            )}
                            {showSetupEmptyState && (
                                <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
                                    <span className="flex h-14 w-14 items-center justify-center rounded-none bg-[#f1f3f4]">
                                        <Wrench className="h-7 w-7 text-[#5f6368]" aria-hidden />
                                    </span>
                                    <div className="max-w-xs">
                                        <p className="text-sm font-medium text-[#202124]">Finish setting up your project</p>
                                        <p className="mt-1.5 text-sm font-medium leading-6 text-[#5f6368]">
                                            Issues appear here once the SDK sends sessions. Complete setup to get started.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap justify-center gap-2">
                                        <Link
                                            to={`${pathPrefix}/setup`}
                                            className={`${dashboardButtonClass('primary', 'md')} !text-white`}
                                        >
                                            <Wrench className="h-4 w-4" />
                                            Open setup
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => void handleCopySetupPrompt()}
                                            className={dashboardButtonClass('secondary', 'md')}
                                        >
                                            <BookOpen className="h-4 w-4" />
                                            {copiedSetupPrompt ? 'Copied' : 'Copy AI prompt'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {showNoIssuesDetectedState && (
                                <NoIssuesDetectedState />
                            )}
                            {showFilteredEmptyState && (
                                <div className="flex h-56 flex-col items-center justify-center px-6 text-center text-sm font-medium text-[#5f6368]">
                                    <CheckCircle2 className="mb-3 h-8 w-8 text-[#80868b]" />
                                    No signals match this view.
                                </div>
                            )}
                            {filteredLeaks.map((leak) => (
                                <LeakRow
                                    key={leak.id}
                                    active={leak.id === selectedLeakId}
                                    leak={leak}
                                    onSelect={() => setSelectedLeakId(leak.id)}
                                />
                            ))}
                        </div>
                    </section>

                    {activeLeak && (
                        <section className="flex min-h-[420px] min-w-0 flex-col bg-white sm:min-h-[560px] lg:min-h-0">
                            <div className="border-b border-[#dadce0] bg-white px-4 py-4 sm:px-5">
                                <div className="flex items-start justify-between gap-4">
                                    <h2 className="max-w-[760px] text-lg font-medium leading-7 text-[#202124]">
                                        {activeLeak.title}
                                    </h2>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedLeakId(null);
                                            setSelectedLeak(null);
                                        }}
                                        className="mt-0.5 shrink-0 rounded-none p-1.5 text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124]"
                                        aria-label="Close signal detail"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>

                                <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
                                    {handoffReady ? (
                                        <PaneButton
                                            icon={copyButtonIcon}
                                            onClick={copyContext}
                                            disabled={isGeneratingContext}
                                            className={copyButtonClassName}
                                            variant="primary"
                                        >
                                            {copied ? 'Copied to clipboard' : 'Copy context'}
                                        </PaneButton>
                                    ) : (
                                        <PaneButton
                                            icon={isGeneratingContext ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                            onClick={() => void generateContext()}
                                            disabled={!canGenerateContext || isGeneratingContext}
                                            className="w-full sm:w-auto"
                                            variant="primary"
                                        >
                                            {isGeneratingContext
                                                ? 'Generating...'
                                                : activeLeak.contextStatus === 'failed'
                                                    ? 'Retry context'
                                                    : 'Generate context'}
                                        </PaneButton>
                                    )}
                                </div>

                                <p className="mt-4 max-w-3xl text-sm font-medium leading-6 text-[#5f6368]">
                                    {handoffMessage}
                                </p>
                                {handoffStatus && (
                                    <div
                                        role={copied ? 'status' : undefined}
                                        aria-live={copied ? 'polite' : undefined}
                                        className={`mt-3 flex max-w-3xl items-center gap-2 text-xs font-medium leading-5 ${
                                            copied
                                                ? 'rounded-none bg-[#e6f4ea] px-3 py-2 text-[#137333]'
                                                : 'text-[#3c4043]'
                                        }`}
                                    >
                                        {copied && <CheckCircle2 className="h-4 w-4 shrink-0 text-[#137333]" />}
                                        <span>{handoffStatus}</span>
                                    </div>
                                )}
                            </div>

                            <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
                                {isDetailLoading ? (
                                    <div className="flex h-56 items-center justify-center text-sm font-medium text-[#5f6368]">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading context
                                    </div>
                                ) : (
                                    <>
                                        <section className="border-b border-[#dadce0] px-4 py-4 sm:px-5">
                                            <p className="text-base font-medium leading-7 text-[#5f6368]">
                                                Split from group: {formatIssueType(activeLeak.issueType)}
                                            </p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                                                    {formatCountLabel(activeLeak.affectedSessionsCount, 'occurrence')}
                                                </span>
                                                <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                                                    {affectedUsersDetailLabel(activeLeak)}
                                                </span>
                                                {affectedEstimateSampleLabel(activeLeak) && (
                                                    <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                                                        {affectedEstimateSampleLabel(activeLeak)}
                                                    </span>
                                                )}
                                            </div>
                                        </section>

                                        <section className="border-b border-[#dadce0] px-4 py-4 sm:px-5">
                                            <SectionTitle>Signals ({Math.max(activeLeak.topSignals.length, activeLeak.affectedSessionsCount)})</SectionTitle>
                                            <div className="mt-3 grid grid-cols-[42px_minmax(0,1fr)] overflow-hidden border border-[#dadce0] bg-white">
                                                <div className="flex items-center justify-center border-r border-[#dadce0] bg-[#f8fafd] text-[#5f6368]">
                                                    <AlertCircle className="h-4 w-4" />
                                                </div>
                                                <div className="flex flex-wrap gap-2 p-3">
                                                    {activeLeak.topSignals.map((signal) => (
                                                        <span
                                                            key={signal}
                                                            className={`${dashboardChipClass('neutral')} font-mono`}
                                                        >
                                                            {signal}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </section>

                                        <section className="border-b border-[#dadce0] px-4 py-5 sm:px-5">
                                            <p className="max-w-[760px] text-sm font-medium leading-8 text-[#5f6368]">
                                                {activeLeak.finding?.observedDeviation || activeLeak.whyItMatters} {activeLeak.finding ? '' : topEvidenceSummary || ''}
                                            </p>
                                        </section>

                                        {activeLeak.finding ? (
                                            <section className="border-b border-[#dadce0] px-4 py-4 sm:px-5">
                                                <SectionTitle>{activeLeak.finding.category === 'defect' ? 'Verified defect' : 'Usability opportunity'}</SectionTitle>
                                                <dl className="mt-3 grid gap-3 text-sm leading-6 text-[#5f6368]">
                                                    {[
                                                        ['Attempted action', activeLeak.finding.attemptedAction],
                                                        ['Expected outcome', activeLeak.finding.expectedBehavior],
                                                        ['Before', activeLeak.finding.beforeEvidence],
                                                        ['Observed outcome', activeLeak.finding.afterEvidence],
                                                        ['Counterevidence', activeLeak.finding.counterEvidence || 'None observed in this episode'],
                                                        ['Recovery', activeLeak.finding.recovery === 'recovered' ? 'The same action subsequently succeeded' : activeLeak.finding.recovery === 'not_recovered' ? 'No recovery observed in the covered episode' : 'Unknown'],
                                                    ].map(([label, text]) => <div key={label}><dt className="font-medium text-[#202124]">{label}</dt><dd>{text}</dd></div>)}
                                                </dl>
                                                <p className="mt-3 text-xs text-[#5f6368]">Verified in {activeLeak.finding.verifiedOccurrences} independent sessions. Coverage: {activeLeak.finding.coverage}.{activeLeak.finding.extraSteps > 0 ? ` ${activeLeak.finding.extraSteps} extra steps observed.` : ''}</p>
                                                <Link className={`${dashboardButtonClass('secondary', 'md')} mt-3`} to={`${pathPrefix}/sessions/${encodeURIComponent(activeLeak.finding.replay.sessionId)}?seekToTimestamp=${activeLeak.finding.replay.startMs}`}>
                                                    <Play className="h-4 w-4" /> View the evidence ({Math.ceil((activeLeak.finding.replay.endMs-activeLeak.finding.replay.startMs)/1000)}s window)
                                                </Link>
                                            </section>
                                        ) : null}

                                        {selectedLeak?.sessions?.length ? (
                                            <section className="border-b border-[#dadce0] px-4 py-4 sm:px-5">
                                                <SectionTitle>Replays</SectionTitle>
                                                <div className="mt-3 grid gap-2 xl:grid-cols-2">
                                                    {selectedLeak.sessions.map((session) => (
                                                        <LeakReplayLink
                                                            key={getLeakSessionId(session) || session.replayUrl || 'unknown-replay'}
                                                            pathPrefix={pathPrefix}
                                                            session={session}
                                                        />
                                                    ))}
                                                </div>
                                            </section>
                                        ) : null}

                                        <section className="border-b border-[#dadce0] px-4 py-4 sm:px-5">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <SectionTitle>Markdown context</SectionTitle>
                                                <div className="flex flex-wrap gap-2">
                                                    {handoffReady ? (
                                                        <PaneButton
                                                            icon={copyButtonIcon}
                                                            onClick={copyContext}
                                                            disabled={isGeneratingContext}
                                                            className={copyButtonClassName}
                                                            variant="primary"
                                                        >
                                                            {copied ? 'Copied to clipboard' : 'Copy context'}
                                                        </PaneButton>
                                                    ) : (
                                                        <PaneButton
                                                            icon={isGeneratingContext ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                                            onClick={() => void generateContext()}
                                                            disabled={!canGenerateContext || isGeneratingContext}
                                                            variant="primary"
                                                        >
                                                            {isGeneratingContext
                                                                ? 'Generating...'
                                                                : activeLeak.contextStatus === 'failed'
                                                                    ? 'Retry context'
                                                                    : 'Generate context'}
                                                        </PaneButton>
                                                    )}
                                                </div>
                                            </div>
                                            <pre className="mt-3 max-h-[380px] overflow-auto whitespace-pre-wrap break-words rounded-none border border-[#dadce0] bg-[#f8fafd] p-4 font-mono text-xs leading-6 text-[#3c4043]">
                                                {selectedLeak?.contextMarkdown || 'Markdown context is not ready yet.'}
                                            </pre>
                                        </section>

                                        <div className="flex flex-wrap justify-end gap-2 px-4 py-4 sm:px-5">
                                            <PaneButton icon={<XCircle className="h-4 w-4" />} onClick={() => markStatus('ignored')}>
                                                Ignore
                                            </PaneButton>
                                            <PaneButton icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => markStatus('resolved')}>
                                                Mark resolved
                                            </PaneButton>
                                        </div>
                                    </>
                                )}
                            </div>
                        </section>
                    )}
                </div>
            </div>

            {copied && (
                <div
                    role="status"
                    aria-live="polite"
                    className="fixed bottom-5 right-5 z-[1200] flex max-w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-none bg-[#202124] px-4 py-3 text-sm font-medium text-white shadow-[0_3px_10px_rgba(60,64,67,0.3)]"
                >
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-white" />
                    <div>
                        <p className="text-white">Markdown copied to clipboard</p>
                        <p className="mt-0.5 text-xs font-normal text-[#bdc1c6]">Ready for the issue handoff.</p>
                    </div>
                </div>
            )}

            <RunHistoryModal
                error={runHistoryError}
                history={runHistory}
                isOpen={showRunHistory}
                loading={runHistoryLoading}
                onClose={() => setShowRunHistory(false)}
                onRefresh={() => void loadRunHistory()}
                timeZone={leakScanTiming.timeZone}
                localScanLabel={leakScanTiming.localScanLabel}
            />

            <Modal
                isOpen={showLeakAlertSettings}
                onClose={() => setShowLeakAlertSettings(false)}
                title="Leak settings"
                size="md"
                variant="modern"
                bodyClassName="p-0"
            >
                <div className="divide-y divide-[#e8eaed] bg-white">
                    <GithubRepositorySettings
                        status={linkStatus}
                        loading={linkLoading && !linkStatus}
                        setupHref={githubSetupHref}
                        installBusy={installBusy}
                        installError={installError}
                        onInstall={() => void startInstall()}
                        timeZone={leakScanTiming.timeZone}
                    />

                    <div className="px-5 py-4 sm:px-6">
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <Bell className="h-4 w-4 text-[#5f6368]" />
                                    <p className="text-sm font-medium text-[#202124]">Daily digest email</p>
                                </div>
                                <p className="mt-0.5 text-xs font-medium leading-5 text-[#5f6368]">
                                    Sent after each scan that finds new issues. Scans run around {leakScanTiming.localScanLabel}.
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <span className={`text-xs font-medium ${leakAlertSettings.leakScanAlertsEnabled ? 'text-[#1967d2]' : 'text-[#5f6368]'}`}>
                                    {leakAlertSettings.leakScanAlertsEnabled ? 'On' : 'Off'}
                                </span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={leakAlertSettings.leakScanAlertsEnabled}
                                    aria-label="Receive leak scan digest emails"
                                    disabled={leakAlertLoading || leakAlertSaving || isDemoMode}
                                    onClick={() => void toggleLeakScanAlerts(!leakAlertSettings.leakScanAlertsEnabled)}
                                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-none border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                                        leakAlertSettings.leakScanAlertsEnabled
                                            ? 'border-[#1a73e8] bg-[#1a73e8]'
                                            : 'border-[#dadce0] bg-[#e8eaed]'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none absolute left-[3px] top-[3px] h-5 w-5 rounded-none bg-white ring-1 ring-[#dadce0] transition-transform ${
                                            leakAlertSettings.leakScanAlertsEnabled ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="px-5 py-4 sm:px-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                                <h3 className="text-sm font-medium text-[#202124]">Recipients</h3>
                                <p className="mt-0.5 text-xs font-medium leading-5 text-[#5f6368]">
                                    Add team members who should receive the daily digest.
                                </p>
                            </div>
                            <span className={`${dashboardChipClass('neutral')} shrink-0 self-start tabular-nums`}>
                                {leakAlertRecipients.length} / 5 recipients
                            </span>
                        </div>

                        {leakAlertRecipients.length < 5 && leakAlertAvailableMembers.length > 0 && (
                            <div className="mt-4 border-t border-[#e8eaed] pt-3">
                                <div className={`flex items-center gap-1.5 ${dashboardLabelClass}`}>
                                    <UserPlus className="h-3.5 w-3.5" />
                                    Add recipient
                                </div>
                                <div className="mt-2 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                                    {leakAlertAvailableMembers.map((member) => (
                                        <button
                                            key={member.userId}
                                            type="button"
                                            disabled={leakAlertSaving || leakAlertLoading}
                                            onClick={() => void handleAddLeakAlertRecipient(member.userId)}
                                            className="group flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-[#f1f3f4] disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <span className="flex min-w-0 items-center gap-2.5">
                                                {member.avatarUrl ? (
                                                    <img src={member.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-none border border-[#dadce0] object-cover" />
                                                ) : (
                                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-[#e8f0fe] text-xs font-medium text-[#1967d2]">
                                                        {(member.displayName || member.email)[0].toUpperCase()}
                                                    </span>
                                                )}
                                                <span className="min-w-0">
                                                    <span className="block truncate text-sm font-medium text-[#202124]">{member.displayName || member.email}</span>
                                                    {member.displayName && member.displayName !== member.email && (
                                                        <span className="block truncate text-xs font-medium text-[#5f6368]">{member.email}</span>
                                                    )}
                                                </span>
                                            </span>
                                            <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-none border border-[#1a73e8] bg-[#1a73e8] px-2.5 text-xs font-medium text-white transition-colors group-hover:border-[#1765cc] group-hover:bg-[#1765cc]">
                                                <UserPlus className="h-3.5 w-3.5" />
                                                Add
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {leakAlertError && (
                            <div className="mt-3 rounded-none border border-[#f6aea9] bg-[#fce8e6] px-3 py-2 text-xs font-medium text-[#a50e0e]">
                                {leakAlertError}
                            </div>
                        )}

                        {leakAlertLoading ? (
                            <div className="flex h-24 items-center justify-center text-sm font-medium text-[#5f6368]">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Loading…
                            </div>
                        ) : leakAlertRecipients.length === 0 ? (
                            <div className="mt-4 border-y border-dashed border-[#dadce0] px-4 py-6 text-center">
                                <p className="text-sm font-medium text-[#3c4043]">No recipients yet</p>
                                <p className="mt-1 text-xs font-medium text-[#5f6368]">Add a team member above to receive digests.</p>
                            </div>
                        ) : (
                            <div className="mt-4 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                                {leakAlertRecipients.map((recipient) => (
                                    <div key={recipient.id} className="flex items-center justify-between gap-3 py-3">
                                        <div className="flex min-w-0 items-center gap-3">
                                            {recipient.avatarUrl ? (
                                                <img src={recipient.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-none border border-[#dadce0] object-cover" />
                                            ) : (
                                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none bg-[#e8f0fe] text-sm font-medium text-[#1967d2]">
                                                    {(recipient.displayName || recipient.email)[0].toUpperCase()}
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-[#202124]">{recipient.displayName || recipient.email}</p>
                                                {recipient.displayName && recipient.displayName !== recipient.email && (
                                                    <p className="truncate text-xs font-medium text-[#5f6368]">{recipient.email}</p>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={leakAlertSaving}
                                            onClick={() => void handleRemoveLeakAlertRecipient(recipient.userId)}
                                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-none border border-[#dadce0] bg-white px-3 text-xs font-medium text-[#3c4043] transition-colors hover:border-[#f6aea9] hover:bg-[#fce8e6] hover:text-[#a50e0e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Remove
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </Modal>


        </div>
    );
}

export default Leaks;
