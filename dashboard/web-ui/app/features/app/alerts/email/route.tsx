import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
    AlertTriangle,
    Check,
    ChevronLeft,
    ChevronRight,
    Info,
    Mail,
    Search,
    Trash2,
    UserPlus,
    X,
} from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import {
    dashboardButtonClass,
    dashboardCardClass,
    dashboardChipClass,
    dashboardFieldClass,
    dashboardLabelClass,
    dashboardSectionTitleClass,
} from '~/shared/ui/core/dashboardStyles';
import { SettingsLayout } from '~/shell/components/layout/SettingsLayout';
import { Modal } from '~/shared/ui/core/Modal';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { DashboardGhostLoader, useInitialDashboardLoad } from '~/shared/ui/core/DashboardGhostLoader';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { useAuth } from '~/shared/providers/AuthContext';
import { isIssueDetectionUiEnabled } from '~/shared/config/runtimeEnv';
import { shouldShowIssueDetectionUi } from '~/shared/config/issueDetectionAccess';

interface AlertRecipient {
    id: string;
    userId: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
}

interface TeamMember {
    userId: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
    isRecipient: boolean;
}

interface EmailLog {
    id: string;
    recipientEmail: string;
    recipientName: string | null;
    alertType: string;
    subject: string;
    issueTitle: string | null;
    issueId: string | null;
    status: 'sent' | 'failed' | 'bounced';
    errorMessage: string | null;
    sentAt: string;
}

interface EmailLogPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

const EMAIL_LOG_META: Record<string, { shortLabel: string; accent: string }> = {
    stability_digest: { shortLabel: 'Stability trends', accent: 'bg-[#d93025]' },
    crash: { shortLabel: 'Crash', accent: 'bg-[#d93025]' },
    anr: { shortLabel: 'ANR', accent: 'bg-[#9334e6]' },
    error_spike: { shortLabel: 'Errors', accent: 'bg-[#e37400]' },
    api_degradation: { shortLabel: 'API', accent: 'bg-[#1a73e8]' },
    leak_scan: { shortLabel: 'Leak scan', accent: 'bg-[#188038]' },
};

// Team roles arrive as enum values such as "billing_admin"; show them in sentence case.
function formatRoleLabel(role: string): string {
    const words = role.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function getHeaders(includeBody = false): HeadersInit {
    const headers: HeadersInit = {};
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (includeBody) headers['Content-Type'] = 'application/json';
    return headers;
}

async function getAlertRecipients(projectId: string): Promise<AlertRecipient[]> {
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-recipients`, {
        credentials: 'include',
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch recipients');
    const data = await res.json();
    return data.recipients;
}

async function getAvailableRecipients(projectId: string): Promise<TeamMember[]> {
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/available-recipients`, {
        credentials: 'include',
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch team members');
    const data = await res.json();
    return data.members;
}

async function addAlertRecipient(projectId: string, userId: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-recipients`, {
        method: 'POST',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add recipient');
    }
}

async function removeAlertRecipient(projectId: string, userId: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-recipients/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to remove recipient');
}

async function getEmailLogs(
    projectId: string,
    options: { search?: string; alertType?: string; page?: number; limit?: number } = {},
): Promise<{ logs: EmailLog[]; pagination: EmailLogPagination }> {
    const params = new URLSearchParams();
    if (options.search) params.set('search', options.search);
    if (options.alertType && options.alertType !== 'all') params.set('alertType', options.alertType);
    if (options.page) params.set('page', String(options.page));
    if (options.limit) params.set('limit', String(options.limit));

    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/email-logs?${params}`, {
        credentials: 'include',
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch email logs');
    return res.json();
}

function formatSentAt(value: string): { date: string; time: string } {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return { date: 'Unknown', time: '' };
    }
    return {
        date: date.toLocaleDateString(),
        time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
}

interface SettingsSectionProps {
    id: string;
    title: string;
    description: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
    id,
    title,
    description,
    action,
    children,
}) => (
    <section id={id} className="project-settings-section dashboard-surface scroll-mt-24 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-[#e8eaed] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <h2 className={dashboardSectionTitleClass}>{title}</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-[#5f6368]">{description}</p>
            </div>
            {action}
        </div>
        <div className="divide-y divide-[#e8eaed] bg-white">
            {children}
        </div>
    </section>
);

function getBrowserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local timezone';
    } catch {
        return 'your local timezone';
    }
}

function getLeakScanLocalTime() {
    const timeZone = getBrowserTimeZone();
    const scanReference = new Date();
    scanReference.setUTCHours(3, 0, 0, 0);

    try {
        return {
            timeZone,
            localScanLabel: new Intl.DateTimeFormat(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                timeZone,
                timeZoneName: 'short',
            }).format(scanReference),
        };
    } catch {
        return {
            timeZone,
            localScanLabel: scanReference.toLocaleTimeString(),
        };
    }
}

export const AlertEmails: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { user } = useAuth();
    // Demo projects have no alert endpoints; show an empty, neutral page instead of load errors.
    const { isDemoMode } = useDemoMode();
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const pathPrefix = usePathPrefix();
    const location = useLocation();
    const leakScanTiming = useMemo(() => getLeakScanLocalTime(), []);
    const showIssueDetectionUi = shouldShowIssueDetectionUi({
        featureEnabled: isIssueDetectionUiEnabled(location.pathname),
        isDemoMode: pathPrefix === '/demo',
        isSelfHosted: Boolean(user?.isSelfHosted),
    });

    const navItems = [
        { href: '#recipients', label: 'Email recipients' },
        { href: '#logs', label: 'Delivery logs' },
    ];
    const activeSectionHref = navItems.some((item) => item.href === location.hash)
        ? location.hash
        : navItems[0]?.href;

    const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
    const [availableMembers, setAvailableMembers] = useState<TeamMember[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddRecipient, setShowAddRecipient] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
    const [emailLogPagination, setEmailLogPagination] = useState<EmailLogPagination>({ page: 1, limit: 15, total: 0, totalPages: 0 });
    const [emailLogSearch, setEmailLogSearch] = useState('');
    const [emailLogTypeFilter, setEmailLogTypeFilter] = useState('all');
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    const loadEmailLogs = useCallback(async (page = 1) => {
        if (!selectedProject?.id || isDemoMode) return;
        setIsLoadingLogs(true);
        try {
            const result = await getEmailLogs(selectedProject.id, {
                search: emailLogSearch,
                alertType: emailLogTypeFilter,
                page,
                limit: 15,
            });
            setEmailLogs(result.logs);
            setEmailLogPagination(result.pagination);
        } catch (err) {
            console.error('Failed to load email logs:', err);
        } finally {
            setIsLoadingLogs(false);
        }
    }, [selectedProject?.id, emailLogSearch, emailLogTypeFilter, isDemoMode]);

    const loadData = useCallback(async () => {
        if (!selectedProject?.id || isDemoMode) {
            setIsLoading(false);
            setRecipients([]);
            setAvailableMembers([]);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const [recipientsData, membersData] = await Promise.allSettled([
                getAlertRecipients(selectedProject.id),
                getAvailableRecipients(selectedProject.id),
            ]);

            const failedSections: string[] = [];

            if (recipientsData.status === 'fulfilled') {
                setRecipients(recipientsData.value);
            } else {
                failedSections.push('recipients');
                setRecipients([]);
            }

            if (membersData.status === 'fulfilled') {
                setAvailableMembers(membersData.value);
            } else {
                failedSections.push('team members');
                setAvailableMembers([]);
            }

            if (failedSections.length > 0) {
                setError(`Some email alert data failed to load: ${failedSections.join(', ')}.`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load email alerts');
        } finally {
            setIsLoading(false);
        }
    }, [manualRefreshVersion, selectedProject?.id, isDemoMode]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (selectedProject?.id) {
            loadEmailLogs(1);
        }
    }, [manualRefreshVersion, selectedProject?.id, emailLogTypeFilter, loadEmailLogs]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (selectedProject?.id) {
                loadEmailLogs(1);
            }
        }, 300);
        return () => window.clearTimeout(timer);
    }, [emailLogSearch, selectedProject?.id, loadEmailLogs]);

    const handleAddRecipient = async (userId: string) => {
        if (!selectedProject?.id) return;
        try {
            await addAlertRecipient(selectedProject.id, userId);
            await loadData();
            setShowAddRecipient(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add recipient');
        }
    };

    const handleRemoveRecipient = async (userId: string) => {
        if (!selectedProject?.id) return;
        try {
            await removeAlertRecipient(selectedProject.id, userId);
            setRecipients((prev) => prev.filter((recipient) => recipient.userId !== userId));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to remove recipient');
        }
    };

    const nonRecipientMembers = useMemo(
        () => availableMembers.filter((member) => !member.isRecipient),
        [availableMembers],
    );

    const summary = useMemo(() => {
        const sentLogs = emailLogs.filter((log) => log.status === 'sent').length;
        const failedLogs = emailLogs.filter((log) => log.status !== 'sent').length;
        return { sentLogs, failedLogs };
    }, [emailLogs]);

    const shouldShowInitialGhost = useInitialDashboardLoad(isLoading);

    if (shouldShowInitialGhost) {
        return <DashboardGhostLoader variant="alerts" />;
    }

    return (
        <SettingsLayout
            {...dashboardPageHeaderProps('emails')}
            className="rejourney-settings-page rejourney-alerts-page rejourney-project-settings-page"
            title="Email alerts"
            description="Manage digest recipients and review recent delivery"
        >
            <div className="project-settings-console grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="project-settings-rail" aria-label="Alerts settings navigation">
                    <div className="project-settings-rail-header">
                        <p className={dashboardLabelClass}>Sections</p>
                    </div>
                    <nav className="project-settings-rail-nav" aria-label="Alerts settings sections">
                        {navItems.map((item) => (
                            <a
                                key={item.href}
                                href={item.href}
                                aria-current={activeSectionHref === item.href ? 'true' : undefined}
                                className="project-settings-rail-item"
                            >
                                <span className="project-settings-rail-marker" />
                                <span className="truncate">{item.label}</span>
                            </a>
                        ))}
                    </nav>
                </aside>

                <div className="min-w-0 space-y-5">
                    {isDemoMode && (
                        <div className="flex items-start gap-3 border border-[#d2e3fc] bg-[#e8f0fe] p-4 text-[#1967d2]">
                            <Info className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                                <div className="text-sm font-medium">Email alerts aren't available in the demo</div>
                                <div className="mt-0.5 text-sm">Recipients and delivery logs appear here for your own projects.</div>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center gap-3 border border-[#f6aea9] bg-[#fce8e6] p-4 text-sm text-[#a50e0e]">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-[#d93025]" />
                            <span className="min-w-0 flex-1">{error}</span>
                            <button type="button" onClick={() => setError(null)} className="rounded-none p-1 transition-colors hover:bg-[#fad2cf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40" aria-label="Dismiss error">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    )}

                    {showIssueDetectionUi && <div className={`${dashboardCardClass} overflow-hidden`}>
                        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm font-medium text-[#1a73e8]">
                                    <Mail className="h-4 w-4" />
                                    Looking for leak alerts?
                                </div>
                                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3c4043]">
                                    Leak Scan Today digests are configured from the Leaks inbox, where Marlin shows the issues that triggered the email.
                                </p>
                                <p className="mt-1 max-w-2xl text-xs leading-5 text-[#5f6368]">
                                    Scans run around 3:00 AM UTC, about {leakScanTiming.localScanLabel} in {leakScanTiming.timeZone}. Issues usually begin appearing a few minutes after the run starts.
                                </p>
                            </div>
                            <Link
                                to={`${pathPrefix}/leaks?settings=leak-alerts`}
                                className={dashboardButtonClass('primary', 'md')}
                            >
                                Open leak alert settings
                            </Link>
                        </div>
                    </div>}

                    {/* SECTION 1: RECIPIENTS */}
                    <SettingsSection
                        id="recipients"
                        title="Email recipients"
                        description={showIssueDetectionUi
                            ? "Choose which team members receive rising stability and leak-scan digests."
                            : "Choose which team members receive rising stability digests."}
                        action={
                            <div className="flex items-center gap-3">
                                <span className="text-xs tabular-nums text-[#5f6368]">{recipients.length} / 5 members</span>
                                {recipients.length < 5 && !isDemoMode && (
                                    <NeoButton
                                        type="button"
                                        variant="primary"
                                        size="sm"
                                        onClick={() => setShowAddRecipient(true)}
                                        leftIcon={<UserPlus className="h-3.5 w-3.5" />}
                                    >
                                        Add recipient
                                    </NeoButton>
                                )}
                            </div>
                        }
                    >
                        {recipients.length === 0 ? (
                            <div className="bg-white py-8 text-center">
                                <Mail className="mx-auto h-8 w-8 text-[#bdc1c6]" />
                                <p className="mt-3 text-sm font-medium text-[#3c4043]">No recipients configured yet</p>
                                <p className="mt-1 text-xs text-[#5f6368]">Alert emails will not be delivered until a recipient is added.</p>
                            </div>
                        ) : (
                            recipients.map((recipient) => (
                                <div key={recipient.id} className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-[#f8fafd]">
                                    <div className="flex min-w-0 items-center gap-3">
                                        {recipient.avatarUrl ? (
                                            <img src={recipient.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-none border border-[#dadce0] object-cover" />
                                        ) : (
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none bg-[#e8f0fe] text-sm font-medium text-[#1967d2]">
                                                {(recipient.displayName || recipient.email)[0].toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-[#202124]">{recipient.displayName || recipient.email}</p>
                                            <p className="truncate text-xs text-[#5f6368]">{recipient.email}</p>
                                        </div>
                                    </div>
                                    <NeoButton
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleRemoveRecipient(recipient.userId)}
                                        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                                    >
                                        Remove
                                    </NeoButton>
                                </div>
                            ))
                        )}
                    </SettingsSection>

                    {/* SECTION 2: DELIVERY LOGS */}
                    <SettingsSection
                        id="logs"
                        title="Delivery logs"
                        description="Review recent alert email delivery status and recipients."
                        action={
                            <span className={`${dashboardChipClass('neutral')} shrink-0 self-start tabular-nums sm:self-auto`}>
                                {summary.sentLogs} delivered
                            </span>
                        }
                    >
                        <div className="flex flex-col gap-3 border-b border-[#e8eaed] bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
                            <div className="relative w-full md:max-w-md">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5f6368]" />
                                <input
                                    type="text"
                                    value={emailLogSearch}
                                    onChange={(event) => setEmailLogSearch(event.target.value)}
                                    placeholder="Filter logs by recipient or subject"
                                    aria-label="Filter logs by recipient or subject"
                                    className={`${dashboardFieldClass} pl-10`}
                                />
                            </div>
                            <select
                                value={emailLogTypeFilter}
                                onChange={(event) => setEmailLogTypeFilter(event.target.value)}
                                aria-label="Filter by alert type"
                                className="h-9 rounded-none border border-[#dadce0] bg-white px-3 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/20"
                            >
                                <option value="all">All types</option>
                                <option value="stability_digest">Stability trends</option>
                                {showIssueDetectionUi && <option value="leak_scan">Leak scans</option>}
                                <option value="crash">Historical crashes</option>
                                <option value="anr">Historical ANRs</option>
                                <option value="error_spike">Historical error spikes</option>
                                <option value="api_degradation">Historical API degradation</option>
                            </select>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[820px] text-left text-sm">
                                <thead className="border-b border-[#dadce0] bg-[#f8fafd] text-[11px] font-medium uppercase text-[#5f6368]">
                                    <tr>
                                        <th className="px-5 py-3 font-medium">Time</th>
                                        <th className="px-5 py-3 font-medium">Class</th>
                                        <th className="px-5 py-3 font-medium">Recipient</th>
                                        <th className="px-5 py-3 font-medium">Subject</th>
                                        <th className="px-5 py-3 text-right font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#e8eaed] bg-white">
                                    {isLoadingLogs ? (
                                        <tr>
                                            <td colSpan={5} className="bg-white p-10 text-center text-sm text-[#5f6368]">
                                                Loading email logs...
                                            </td>
                                        </tr>
                                    ) : emailLogs.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="bg-white p-12 text-center">
                                                <Mail className="mx-auto mb-3 h-10 w-10 text-[#dadce0]" />
                                                <p className="text-sm font-medium text-[#3c4043]">No emails sent yet</p>
                                                <p className="mt-1 text-xs text-[#5f6368]">
                                                    {showIssueDetectionUi
                                                        ? 'Stability and leak-scan digests will appear here after delivery.'
                                                        : 'Stability digests will appear here after delivery.'}
                                                </p>
                                            </td>
                                        </tr>
                                    ) : (
                                        emailLogs.map((log) => {
                                            const sentAt = formatSentAt(log.sentAt);
                                            const meta = EMAIL_LOG_META[log.alertType] ?? EMAIL_LOG_META.crash;
                                            return (
                                                <tr key={log.id} className="transition-colors hover:bg-[#f8fafd]">
                                                    <td className="whitespace-nowrap px-5 py-3.5">
                                                        <div className="font-medium tabular-nums text-[#202124]">{sentAt.date}</div>
                                                        <div className="text-xs tabular-nums text-[#5f6368]">{sentAt.time}</div>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.accent}`} />
                                                            <span className="font-medium text-[#3c4043]">{meta.shortLabel}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <div className="font-medium text-[#202124]">{log.recipientName || log.recipientEmail}</div>
                                                        {log.recipientName && (
                                                            <div className="text-xs text-[#5f6368]">{log.recipientEmail}</div>
                                                        )}
                                                    </td>
                                                    <td className="max-w-sm px-5 py-3.5">
                                                        <div className="truncate text-[#3c4043]" title={log.subject}>{log.subject}</div>
                                                        {log.issueId && (
                                                            <Link
                                                                to={`${pathPrefix}/general/${log.issueId}`}
                                                                className="text-xs font-medium text-[#1a73e8] hover:text-[#1765cc] hover:underline"
                                                            >
                                                                View issue
                                                            </Link>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3.5 text-right">
                                                        {log.status === 'sent' ? (
                                                            <NeoBadge variant="success" size="sm">Delivered</NeoBadge>
                                                        ) : log.status === 'failed' ? (
                                                            <span title={log.errorMessage || 'Email delivery failed'}>
                                                                <NeoBadge variant="danger" size="sm">Failed</NeoBadge>
                                                            </span>
                                                        ) : (
                                                            <NeoBadge variant="warning" size="sm">Bounced</NeoBadge>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {emailLogPagination.totalPages > 1 && (
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8eaed] bg-[#f8fafd] px-5 py-4">
                                <div className="text-xs tabular-nums text-[#5f6368]">
                                    Page {emailLogPagination.page} / {emailLogPagination.totalPages} | Total {emailLogPagination.total}
                                </div>
                                <div className="flex items-center gap-2">
                                    <NeoButton
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => loadEmailLogs(emailLogPagination.page - 1)}
                                        disabled={emailLogPagination.page <= 1}
                                        leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
                                    >
                                        Previous
                                    </NeoButton>
                                    <NeoButton
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => loadEmailLogs(emailLogPagination.page + 1)}
                                        disabled={emailLogPagination.page >= emailLogPagination.totalPages}
                                        rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
                                    >
                                        Next
                                    </NeoButton>
                                </div>
                            </div>
                        )}
                    </SettingsSection>
                </div>
            </div>

            {/* Add Recipient Modal */}
            <Modal
                isOpen={showAddRecipient}
                onClose={() => setShowAddRecipient(false)}
                title="Add recipient"
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-sm text-[#5f6368]">
                        {showIssueDetectionUi
                            ? 'Choose a team member to receive stability and leak-scan digests.'
                            : 'Choose a team member to receive stability digests.'}
                    </p>
                    {nonRecipientMembers.length === 0 ? (
                        <div className="py-8 text-center">
                            <Check className="mx-auto mb-3 h-8 w-8 text-[#188038]" />
                            <p className="text-sm font-medium text-[#202124]">Everyone is already included.</p>
                        </div>
                    ) : (
                        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                            {nonRecipientMembers.map((member) => (
                                <button
                                    type="button"
                                    key={member.userId}
                                    onClick={() => handleAddRecipient(member.userId)}
                                    className="flex w-full items-center justify-between gap-3 rounded-none border border-[#dadce0] bg-white p-3 text-left transition-colors hover:bg-[#f8fafd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        {member.avatarUrl ? (
                                            <img src={member.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-none border border-[#dadce0] object-cover" />
                                        ) : (
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none bg-[#e8f0fe] text-sm font-medium text-[#1967d2]">
                                                {(member.displayName || member.email)[0].toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-[#202124]">{member.displayName || member.email}</p>
                                            <p className="truncate text-xs text-[#5f6368]">{formatRoleLabel(member.role)}</p>
                                        </div>
                                    </div>
                                    <UserPlus className="h-4 w-4 shrink-0 text-[#5f6368]" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </Modal>
        </SettingsLayout>
    );
};

export default AlertEmails;
