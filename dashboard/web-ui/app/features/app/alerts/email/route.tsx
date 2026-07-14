import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
    Activity,
    AlertOctagon,
    AlertTriangle,
    Check,
    ChevronLeft,
    ChevronRight,
    Clock,
    Filter,
    Info,
    Mail,
    Plus,
    RotateCcw,
    Search,
    SlidersHorizontal,
    Terminal,
    Trash2,
    UserPlus,
    Users,
    X,
    Zap,
} from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { SettingsLayout } from '~/shell/components/layout/SettingsLayout';
import { Modal } from '~/shared/ui/core/Modal';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { DashboardGhostLoader, useInitialDashboardLoad } from '~/shared/ui/core/DashboardGhostLoader';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { API_BASE_URL, getCsrfToken } from '~/shared/config/appConfig';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';

type EmailRuleAlertType = 'crash' | 'anr' | 'error_spike' | 'api_degradation';
type EmailRuleMetric = 'affected_users' | 'duration_ms' | 'percent_increase' | 'latency_ms';
type EmailRuleOperator = 'gt' | 'gte' | 'lt' | 'lte';
type EmailRuleSeverity = 'critical' | 'high' | 'watch';
type EmailRuleSource = 'default' | 'custom';

interface EmailAlertRule {
    id: string;
    name: string;
    description?: string;
    alertType: EmailRuleAlertType;
    metric: EmailRuleMetric;
    operator: EmailRuleOperator;
    threshold: number;
    windowMinutes: number;
    severity: EmailRuleSeverity;
    enabled: boolean;
    source: EmailRuleSource;
    updatedAt: string;
}

interface AlertSettings {
    id: string;
    projectId: string;
    crashAlertsEnabled: boolean;
    anrAlertsEnabled: boolean;
    errorSpikeAlertsEnabled: boolean;
    apiDegradationAlertsEnabled: boolean;
    errorSpikeThresholdPercent: number;
    apiDegradationThresholdPercent: number;
    apiLatencyThresholdMs: number;
    emailRules: EmailAlertRule[];
}

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

const DEFAULT_RULE_UPDATED_AT = '2026-01-01T00:00:00.000Z';

const EVENT_META: Record<EmailRuleAlertType, {
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    accent: string;
    badgeVariant: 'danger' | 'anr' | 'warning' | 'info';
}> = {
    crash: {
        label: 'Crash',
        shortLabel: 'Crash',
        icon: <AlertOctagon className="h-4 w-4" />,
        accent: 'bg-[#fb7185]',
        badgeVariant: 'danger',
    },
    anr: {
        label: 'ANR Freeze',
        shortLabel: 'ANR',
        icon: <Clock className="h-4 w-4" />,
        accent: 'bg-[#c4b5fd]',
        badgeVariant: 'anr',
    },
    error_spike: {
        label: 'Error Spike',
        shortLabel: 'Errors',
        icon: <Terminal className="h-4 w-4" />,
        accent: 'bg-[#f9a8d4]',
        badgeVariant: 'warning',
    },
    api_degradation: {
        label: 'API Degradation',
        shortLabel: 'API',
        icon: <Activity className="h-4 w-4" />,
        accent: 'bg-[#67e8f9]',
        badgeVariant: 'info',
    },
};

const EMAIL_LOG_META: Record<string, { shortLabel: string; accent: string }> = {
    crash: { shortLabel: EVENT_META.crash.shortLabel, accent: EVENT_META.crash.accent },
    anr: { shortLabel: EVENT_META.anr.shortLabel, accent: EVENT_META.anr.accent },
    error_spike: { shortLabel: EVENT_META.error_spike.shortLabel, accent: EVENT_META.error_spike.accent },
    api_degradation: { shortLabel: EVENT_META.api_degradation.shortLabel, accent: EVENT_META.api_degradation.accent },
    leak_scan: { shortLabel: 'Leak Scan', accent: 'bg-[#86efac]' },
};

const METRIC_LABELS: Record<EmailRuleMetric, string> = {
    affected_users: 'Affected users',
    duration_ms: 'Freeze duration',
    percent_increase: 'Percent increase',
    latency_ms: 'Latency',
};

const METRICS_BY_EVENT: Record<EmailRuleAlertType, EmailRuleMetric[]> = {
    crash: ['affected_users'],
    anr: ['duration_ms', 'affected_users'],
    error_spike: ['percent_increase'],
    api_degradation: ['percent_increase', 'latency_ms'],
};

const OPERATOR_WORDS: Record<EmailRuleOperator, string> = {
    gt: 'more than',
    gte: 'at least',
    lt: 'less than',
    lte: 'at most',
};

const SEVERITY_VARIANTS: Record<EmailRuleSeverity, 'danger' | 'warning' | 'info'> = {
    critical: 'danger',
    high: 'warning',
    watch: 'info',
};

function getHeaders(includeBody = false): HeadersInit {
    const headers: HeadersInit = {};
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (includeBody) headers['Content-Type'] = 'application/json';
    return headers;
}

async function getAlertSettings(projectId: string): Promise<AlertSettings> {
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-settings`, {
        credentials: 'include',
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch alert settings');
    const data = await res.json();
    return data.settings;
}

async function updateAlertSettings(projectId: string, settings: Partial<AlertSettings>): Promise<AlertSettings> {
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/alert-settings`, {
        method: 'PUT',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Failed to update alert settings');
    const data = await res.json();
    return data.settings;
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

function buildDefaultRules(settings: Partial<AlertSettings> = {}): EmailAlertRule[] {
    const crashEnabled = settings.crashAlertsEnabled ?? true;
    const anrEnabled = settings.anrAlertsEnabled ?? true;
    const errorSpikeEnabled = settings.errorSpikeAlertsEnabled ?? true;
    const apiEnabled = settings.apiDegradationAlertsEnabled ?? true;

    return [
        {
            id: 'default-crash-impact',
            name: 'Crash impact',
            description: 'New crash groups affecting at least one user.',
            alertType: 'crash',
            metric: 'affected_users',
            operator: 'gte',
            threshold: 1,
            windowMinutes: 60,
            severity: 'critical',
            enabled: crashEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_UPDATED_AT,
        },
        {
            id: 'default-anr-freeze',
            name: 'ANR freeze',
            description: 'Application freezes lasting two seconds or longer.',
            alertType: 'anr',
            metric: 'duration_ms',
            operator: 'gte',
            threshold: 2000,
            windowMinutes: 60,
            severity: 'high',
            enabled: anrEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_UPDATED_AT,
        },
        {
            id: 'default-error-spike',
            name: 'Error spike',
            description: 'Error rate increases beyond the project threshold.',
            alertType: 'error_spike',
            metric: 'percent_increase',
            operator: 'gte',
            threshold: settings.errorSpikeThresholdPercent ?? 50,
            windowMinutes: 60,
            severity: 'high',
            enabled: errorSpikeEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_UPDATED_AT,
        },
        {
            id: 'default-api-degradation',
            name: 'API degradation',
            description: 'Endpoint latency is at least twice the recent baseline.',
            alertType: 'api_degradation',
            metric: 'percent_increase',
            operator: 'gte',
            threshold: settings.apiDegradationThresholdPercent ?? 100,
            windowMinutes: 60,
            severity: 'high',
            enabled: apiEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_UPDATED_AT,
        },
        {
            id: 'default-api-latency',
            name: 'Slow API ceiling',
            description: 'Current endpoint latency exceeds the absolute ceiling.',
            alertType: 'api_degradation',
            metric: 'latency_ms',
            operator: 'gte',
            threshold: settings.apiLatencyThresholdMs ?? 3000,
            windowMinutes: 60,
            severity: 'watch',
            enabled: apiEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_UPDATED_AT,
        },
    ];
}

function hydrateRules(settings: AlertSettings | null): EmailAlertRule[] {
    const rawRules = settings?.emailRules;
    if (Array.isArray(rawRules) && rawRules.length > 0) {
        return rawRules.map((rule) => ({
            ...rule,
            threshold: Number(rule.threshold) || 0,
            windowMinutes: Number(rule.windowMinutes) || 60,
            updatedAt: rule.updatedAt || new Date().toISOString(),
        }));
    }

    return buildDefaultRules(settings ?? {});
}

function deriveAlertSettingsPatch(rules: EmailAlertRule[], settings: AlertSettings | null): Partial<AlertSettings> {
    const hasEnabled = (alertType: EmailRuleAlertType) => rules.some((rule) => rule.alertType === alertType && rule.enabled);
    const findThreshold = (id: string, fallback: number) => {
        const rule = rules.find((candidate) => candidate.id === id);
        return Math.round(Number(rule?.threshold ?? fallback));
    };

    return {
        emailRules: rules.map((rule) => ({
            ...rule,
            threshold: Number(rule.threshold) || 0,
            windowMinutes: Math.max(5, Math.round(Number(rule.windowMinutes) || 60)),
        })),
        crashAlertsEnabled: hasEnabled('crash'),
        anrAlertsEnabled: hasEnabled('anr'),
        errorSpikeAlertsEnabled: hasEnabled('error_spike'),
        apiDegradationAlertsEnabled: hasEnabled('api_degradation'),
        errorSpikeThresholdPercent: findThreshold('default-error-spike', settings?.errorSpikeThresholdPercent ?? 50),
        apiDegradationThresholdPercent: findThreshold('default-api-degradation', settings?.apiDegradationThresholdPercent ?? 100),
        apiLatencyThresholdMs: findThreshold('default-api-latency', settings?.apiLatencyThresholdMs ?? 3000),
    };
}

function thresholdInputValue(rule: Pick<EmailAlertRule, 'metric' | 'threshold'>): number {
    if (rule.metric === 'duration_ms') {
        return Number((rule.threshold / 1000).toFixed(1));
    }
    return rule.threshold;
}

function thresholdFromInput(metric: EmailRuleMetric, value: number): number {
    if (metric === 'duration_ms') {
        return Math.round(value * 1000);
    }
    return value;
}

function thresholdUnitLabel(metric: EmailRuleMetric): string {
    if (metric === 'duration_ms') return 'sec';
    if (metric === 'latency_ms') return 'ms';
    if (metric === 'percent_increase') return '%';
    return 'users';
}

function formatThresholdForHumans(rule: Pick<EmailAlertRule, 'metric' | 'threshold'>): string {
    if (rule.metric === 'duration_ms') {
        const seconds = rule.threshold / 1000;
        return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} seconds`;
    }
    if (rule.metric === 'latency_ms') return `${rule.threshold.toLocaleString()} ms`;
    if (rule.metric === 'percent_increase') return `${rule.threshold.toLocaleString()}%`;
    return `${rule.threshold.toLocaleString()} ${rule.threshold === 1 ? 'user' : 'users'}`;
}

function ruleTriggerSentence(rule: EmailAlertRule): string {
    const operator = OPERATOR_WORDS[rule.operator];
    const value = formatThresholdForHumans(rule);

    if (rule.metric === 'affected_users') {
        return `Email when ${operator} ${value} are affected.`;
    }
    if (rule.metric === 'duration_ms') {
        return `Email when a freeze lasts ${operator} ${value}.`;
    }
    if (rule.metric === 'percent_increase' && rule.alertType === 'api_degradation') {
        return `Email when API latency is ${operator} ${value} higher than baseline.`;
    }
    if (rule.metric === 'percent_increase') {
        return `Email when errors are ${operator} ${value} higher than baseline.`;
    }
    return `Email when API latency reaches ${operator} ${value}.`;
}

function ruleNumberHelp(rule: Pick<EmailAlertRule, 'metric'>): string {
    switch (rule.metric) {
        case 'affected_users':
            return '1 means any affected user. Raise it to wait for broader impact.';
        case 'duration_ms':
            return 'Shown in seconds. 2 seconds catches freezes users can feel.';
        case 'percent_increase':
            return '50% means half again above baseline. 100% means double.';
        case 'latency_ms':
            return 'Measured in milliseconds. 3000 ms is 3 seconds.';
        default:
            return '';
    }
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
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <h2 className="text-sm font-semibold text-black">{title}</h2>
                <p className="mt-1 max-w-2xl text-xs font-medium leading-5 text-slate-500">{description}</p>
            </div>
            {action}
        </div>
        <div className="divide-y divide-slate-100 bg-white">
            {children}
        </div>
    </section>
);

interface SettingRowProps {
    title: React.ReactNode;
    description?: React.ReactNode;
    children: React.ReactNode;
}

const SettingRow: React.FC<SettingRowProps> = ({ title, description, children }) => (
    <div className="project-settings-row grid gap-4 px-5 py-4 lg:grid-cols-[minmax(220px,0.62fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
            {typeof title === 'string' ? <h3 className="text-sm font-semibold text-slate-950">{title}</h3> : title}
            {description && (
                <div className="mt-1 max-w-md text-xs font-medium leading-5 text-slate-500">
                    {description}
                </div>
            )}
        </div>
        <div className="min-w-0">
            {children}
        </div>
    </div>
);

interface SwitchControlProps {
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    label: string;
}

const SwitchControl: React.FC<SwitchControlProps> = ({ checked, disabled, onChange, label }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`project-settings-switch ${checked ? 'project-settings-switch-on' : ''}`}
    >
        <span />
    </button>
);

interface RuleDraft {
    name: string;
    alertType: EmailRuleAlertType;
    metric: EmailRuleMetric;
    operator: EmailRuleOperator;
    threshold: number;
    windowMinutes: number;
    severity: EmailRuleSeverity;
    description: string;
}

const createEmptyRuleDraft = (): RuleDraft => ({
    name: '',
    alertType: 'crash',
    metric: 'affected_users',
    operator: 'gte',
    threshold: 1,
    windowMinutes: 60,
    severity: 'high',
    description: '',
});

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
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const pathPrefix = usePathPrefix();
    const location = useLocation();
    const leakScanTiming = useMemo(() => getLeakScanLocalTime(), []);

    const navItems = [
        { href: '#recipients', label: 'Email Recipients' },
        { href: '#rules', label: 'Alert Rules' },
        { href: '#logs', label: 'Delivery Logs' },
    ];
    const activeSectionHref = navItems.some((item) => item.href === location.hash)
        ? location.hash
        : navItems[0]?.href;

    const [settings, setSettings] = useState<AlertSettings | null>(null);
    const [rules, setRules] = useState<EmailAlertRule[]>([]);
    const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
    const [availableMembers, setAvailableMembers] = useState<TeamMember[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRulesDirty, setIsRulesDirty] = useState(false);
    const [showAddRecipient, setShowAddRecipient] = useState(false);
    const [showComposer, setShowComposer] = useState(false);
    const [ruleDraft, setRuleDraft] = useState<RuleDraft>(() => createEmptyRuleDraft());
    const [error, setError] = useState<string | null>(null);

    const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
    const [emailLogPagination, setEmailLogPagination] = useState<EmailLogPagination>({ page: 1, limit: 15, total: 0, totalPages: 0 });
    const [emailLogSearch, setEmailLogSearch] = useState('');
    const [emailLogTypeFilter, setEmailLogTypeFilter] = useState('all');
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    const loadEmailLogs = useCallback(async (page = 1) => {
        if (!selectedProject?.id) return;
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
    }, [selectedProject?.id, emailLogSearch, emailLogTypeFilter]);

    const loadData = useCallback(async () => {
        if (!selectedProject?.id) {
            setIsLoading(false);
            setSettings(null);
            setRules([]);
            setRecipients([]);
            setAvailableMembers([]);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const [settingsData, recipientsData, membersData] = await Promise.allSettled([
                getAlertSettings(selectedProject.id),
                getAlertRecipients(selectedProject.id),
                getAvailableRecipients(selectedProject.id),
            ]);

            const failedSections: string[] = [];

            if (settingsData.status === 'fulfilled') {
                setSettings(settingsData.value);
                setRules(hydrateRules(settingsData.value));
                setIsRulesDirty(false);
            } else {
                failedSections.push('rules');
                setSettings(null);
                setRules(buildDefaultRules());
            }

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
    }, [manualRefreshVersion, selectedProject?.id]);

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

    const markRulesDirty = (nextRules: EmailAlertRule[]) => {
        setRules(nextRules);
        setIsRulesDirty(true);
    };

    const handleRuleUpdate = (ruleId: string, patch: Partial<EmailAlertRule>) => {
        markRulesDirty(rules.map((rule) => (
            rule.id === ruleId
                ? { ...rule, ...patch, updatedAt: new Date().toISOString() }
                : rule
        )));
    };

    const handleDeleteRule = (ruleId: string) => {
        markRulesDirty(rules.filter((rule) => rule.id !== ruleId || rule.source === 'default'));
    };

    const handleSaveRules = async () => {
        if (!selectedProject?.id) return;
        setIsSaving(true);
        setError(null);
        try {
            const updated = await updateAlertSettings(selectedProject.id, deriveAlertSettingsPatch(rules, settings));
            setSettings(updated);
            setRules(hydrateRules(updated));
            setIsRulesDirty(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save email rules');
        } finally {
            setIsSaving(false);
        }
    };

    const handleResetDefaults = () => {
        markRulesDirty(buildDefaultRules(settings ?? {}));
    };

    const handleAddRule = () => {
        const trimmedName = ruleDraft.name.trim();
        if (!trimmedName) {
            setError('Rule name is required.');
            return;
        }

        const nextRule: EmailAlertRule = {
            id: `custom-${Date.now()}`,
            name: trimmedName,
            description: ruleDraft.description.trim() || undefined,
            alertType: ruleDraft.alertType,
            metric: ruleDraft.metric,
            operator: ruleDraft.operator,
            threshold: Number(ruleDraft.threshold) || 0,
            windowMinutes: Math.max(5, Math.round(Number(ruleDraft.windowMinutes) || 60)),
            severity: ruleDraft.severity,
            enabled: true,
            source: 'custom',
            updatedAt: new Date().toISOString(),
        };

        markRulesDirty([...rules, nextRule]);
        setRuleDraft(createEmptyRuleDraft());
        setShowComposer(false);
        setError(null);
    };

    const handleDraftAlertTypeChange = (alertType: EmailRuleAlertType) => {
        const metric = METRICS_BY_EVENT[alertType][0];
        setRuleDraft((current) => ({
            ...current,
            alertType,
            metric,
            threshold: metric === 'percent_increase' ? 50 : metric === 'duration_ms' ? 2000 : metric === 'latency_ms' ? 3000 : 1,
        }));
    };

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
        const activeRules = rules.filter((rule) => rule.enabled).length;
        const sentLogs = emailLogs.filter((log) => log.status === 'sent').length;
        const failedLogs = emailLogs.filter((log) => log.status !== 'sent').length;
        return { activeRules, sentLogs, failedLogs };
    }, [rules, emailLogs]);

    const rulesByEvent = useMemo(() => {
        return rules.reduce<Record<EmailRuleAlertType, EmailAlertRule[]>>((acc, rule) => {
            acc[rule.alertType].push(rule);
            return acc;
        }, {
            crash: [],
            anr: [],
            error_spike: [],
            api_degradation: [],
        });
    }, [rules]);

    const shouldShowInitialGhost = useInitialDashboardLoad(isLoading);

    if (shouldShowInitialGhost) {
        return <DashboardGhostLoader variant="alerts" />;
    }

    return (
        <SettingsLayout
            {...dashboardPageHeaderProps('emails')}
            className="rejourney-settings-page rejourney-alerts-page rejourney-project-settings-page"
            title="Email Alerts"
            description="Choose which signals send email and who receives them"
            headerAction={
                <div className="flex flex-wrap items-center gap-2">
                    {isRulesDirty && (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                            Unsaved changes
                        </span>
                    )}
                    <NeoButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleResetDefaults}
                        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                    >
                        Reset defaults
                    </NeoButton>
                    <NeoButton
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleSaveRules}
                        disabled={!isRulesDirty || isSaving}
                        isLoading={isSaving}
                        leftIcon={<Check className="h-3.5 w-3.5" />}
                    >
                        Save changes
                    </NeoButton>
                </div>
            }
        >
            <div className="project-settings-console grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="project-settings-rail" aria-label="Alerts settings navigation">
                    <div className="project-settings-rail-header">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sections</p>
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
                    {error && (
                        <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                            <AlertTriangle className="h-5 w-5 shrink-0" />
                            <span className="min-w-0 flex-1">{error}</span>
                            <button type="button" onClick={() => setError(null)} className="rounded-md p-1 hover:bg-white">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    )}

                    <div className="dashboard-surface overflow-hidden border border-[#dadce0] bg-white">
                        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#1a73e8]">
                                    <Mail className="h-4 w-4" />
                                    Looking for Leaks Alerts?
                                </div>
                                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-900">
                                    Leak Scan Today digests are configured from the Leaks inbox, where Marlin shows the issues that triggered the email.
                                </p>
                                <p className="mt-1 max-w-2xl text-xs font-medium leading-5 text-slate-500">
                                    Scans run around 3:00 AM UTC, about {leakScanTiming.localScanLabel} in {leakScanTiming.timeZone}. Issues usually begin appearing a few minutes after the run starts.
                                </p>
                            </div>
                            <Link
                                to={`${pathPrefix}/leaks?settings=leak-alerts`}
                                className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-[#1a73e8] bg-[#1a73e8] px-3 text-sm font-semibold text-white transition-colors hover:border-[#1e40af] hover:bg-[#2563eb]"
                            >
                                Open leak alert settings
                            </Link>
                        </div>
                    </div>

                    {/* SECTION 1: RECIPIENTS */}
                    <SettingsSection
                        id="recipients"
                        title="Email Recipients"
                        description="Choose which team members receive alert emails when rules are triggered."
                        action={
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-semibold text-slate-500">{recipients.length} / 5 members</span>
                                {recipients.length < 5 && (
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
                            <div className="py-8 text-center bg-white">
                                <Mail className="mx-auto h-8 w-8 text-slate-300" />
                                <p className="mt-3 text-sm font-semibold text-slate-600">No recipients configured yet</p>
                                <p className="mt-1 text-xs font-medium text-slate-500">Alert emails will not be delivered until a recipient is added.</p>
                            </div>
                        ) : (
                            recipients.map((recipient) => (
                                <div key={recipient.id} className="flex items-center justify-between px-5 py-4 hover:bg-[#fbfdff]">
                                    <div className="flex items-center gap-3">
                                        {recipient.avatarUrl ? (
                                            <img src={recipient.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover" />
                                        ) : (
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                                                {(recipient.displayName || recipient.email)[0].toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{recipient.displayName || recipient.email}</p>
                                            <p className="truncate text-xs font-medium text-slate-500">{recipient.email}</p>
                                        </div>
                                    </div>
                                    <NeoButton
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleRemoveRecipient(recipient.userId)}
                                        leftIcon={<Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-rose-600" />}
                                    >
                                        Remove
                                    </NeoButton>
                                </div>
                            ))
                        )}
                    </SettingsSection>

                    {/* SECTION 2: RULES */}
                    <SettingsSection
                        id="rules"
                        title="Alert Rules"
                        description="Define thresholds for crashes, ANR freezes, error spikes, and API degradation."
                        action={
                            <NeoButton
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={() => setShowComposer(true)}
                                leftIcon={<Plus className="h-3.5 w-3.5" />}
                            >
                                Add rule
                            </NeoButton>
                        }
                    >
                        {rules.map((rule) => {
                            const meta = EVENT_META[rule.alertType];
                            return (
                                <SettingRow
                                    key={rule.id}
                                    title={
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-sm font-semibold text-slate-900">{rule.name}</h3>
                                            <NeoBadge variant={meta.badgeVariant} size="sm">{meta.shortLabel}</NeoBadge>
                                            {rule.source === 'custom' && (
                                                <NeoBadge variant="info" size="sm">Custom</NeoBadge>
                                            )}
                                        </div>
                                    }
                                    description={
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium text-slate-700">{ruleTriggerSentence(rule)}</p>
                                            <p className="text-xs font-medium text-slate-400">{ruleNumberHelp(rule)}</p>
                                        </div>
                                    }
                                >
                                    <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap lg:justify-end">
                                        <div className="w-full sm:w-[130px] shrink-0">
                                            <select
                                                value={rule.operator}
                                                onChange={(event) => handleRuleUpdate(rule.id, { operator: event.target.value as EmailRuleOperator })}
                                                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                            >
                                                {(Object.keys(OPERATOR_WORDS) as EmailRuleOperator[]).map((operator) => (
                                                    <option key={operator} value={operator}>{OPERATOR_WORDS[operator]}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex h-9 w-full sm:w-[150px] shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
                                            <input
                                                type="number"
                                                min={0}
                                                step={rule.metric === 'duration_ms' ? 0.5 : 1}
                                                value={thresholdInputValue(rule)}
                                                onChange={(event) => handleRuleUpdate(rule.id, { threshold: thresholdFromInput(rule.metric, Number(event.target.value)) })}
                                                className="min-w-0 flex-1 border-0 bg-transparent px-3 text-xs font-semibold outline-none"
                                            />
                                            <span className="flex items-center border-l border-slate-100 bg-[#f8fafd] px-2.5 text-[10px] font-bold text-slate-500 uppercase">
                                                {thresholdUnitLabel(rule.metric)}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-3 ml-auto shrink-0 sm:ml-0">
                                            <SwitchControl
                                                label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`}
                                                checked={rule.enabled}
                                                onChange={(enabled) => handleRuleUpdate(rule.id, { enabled })}
                                            />
                                            {rule.source === 'custom' && (
                                                <button
                                                    type="button"
                                                    aria-label={`Delete ${rule.name}`}
                                                    onClick={() => handleDeleteRule(rule.id)}
                                                    className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </SettingRow>
                            );
                        })}
                    </SettingsSection>


                    {/* SECTION 4: DELIVERY LOGS */}
                    <SettingsSection
                        id="logs"
                        title="Delivery Logs"
                        description="Review recent alert email delivery status and recipients."
                        action={
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                {summary.sentLogs} delivered
                            </span>
                        }
                    >
                        <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
                            <div className="relative w-full md:max-w-md">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={emailLogSearch}
                                    onChange={(event) => setEmailLogSearch(event.target.value)}
                                    placeholder="Filter logs by recipient or subject"
                                    className="h-9 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-xs font-semibold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <select
                                value={emailLogTypeFilter}
                                onChange={(event) => setEmailLogTypeFilter(event.target.value)}
                                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="all">All Types</option>
                                <option value="crash">Crashes</option>
                                <option value="anr">ANRs</option>
                                <option value="error_spike">Error Spikes</option>
                                <option value="api_degradation">API Degradation</option>
                                <option value="leak_scan">Leak Scans</option>
                            </select>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[820px] text-left text-sm">
                                <thead className="border-b border-[#dadce0] bg-[#f8fafd] text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    <tr>
                                        <th className="px-5 py-3 font-bold">Time</th>
                                        <th className="px-5 py-3 font-bold">Class</th>
                                        <th className="px-5 py-3 font-bold">Recipient</th>
                                        <th className="px-5 py-3 font-bold">Subject</th>
                                        <th className="px-5 py-3 text-right font-bold">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#edf0f3] bg-white">
                                    {isLoadingLogs ? (
                                        <tr>
                                            <td colSpan={5} className="p-10 text-center text-sm font-semibold text-slate-400 bg-white">
                                                Loading email logs...
                                            </td>
                                        </tr>
                                    ) : emailLogs.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="p-12 text-center bg-white">
                                                <Mail className="mx-auto mb-3 h-10 w-10 text-slate-200" />
                                                <p className="text-sm font-semibold text-slate-500">No emails sent yet</p>
                                                <p className="mt-1 text-xs font-medium text-slate-400">Alert emails will appear here after a rule matches.</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        emailLogs.map((log) => {
                                            const sentAt = formatSentAt(log.sentAt);
                                            const meta = EMAIL_LOG_META[log.alertType] ?? EMAIL_LOG_META.crash;
                                            return (
                                                <tr key={log.id} className="transition-colors hover:bg-[#f8fafc]">
                                                    <td className="px-5 py-3.5 whitespace-nowrap">
                                                        <div className="font-semibold text-slate-900">{sentAt.date}</div>
                                                        <div className="text-xs font-medium text-slate-400">{sentAt.time}</div>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`h-2.5 w-2.5 rounded-full ${meta.accent}`} />
                                                            <span className="font-semibold text-slate-800">{meta.shortLabel}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <div className="font-semibold text-slate-900">{log.recipientName || log.recipientEmail}</div>
                                                        {log.recipientName && (
                                                            <div className="text-xs font-medium text-slate-400">{log.recipientEmail}</div>
                                                        )}
                                                    </td>
                                                    <td className="max-w-sm px-5 py-3.5">
                                                        <div className="truncate font-medium text-slate-700" title={log.subject}>{log.subject}</div>
                                                        {log.issueId && (
                                                            <Link
                                                                to={`${pathPrefix}/general/${log.issueId}`}
                                                                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                                                            >
                                                                View issue
                                                            </Link>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3.5 text-right">
                                                        {log.status === 'sent' ? (
                                                            <NeoBadge variant="success" size="sm" className="shadow-none">Delivered</NeoBadge>
                                                        ) : log.status === 'failed' ? (
                                                            <span title={log.errorMessage || 'Email delivery failed'}>
                                                                <NeoBadge variant="danger" size="sm" className="shadow-none">Failed</NeoBadge>
                                                            </span>
                                                        ) : (
                                                            <NeoBadge variant="warning" size="sm" className="shadow-none">Bounced</NeoBadge>
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
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-[#f8fafd] px-5 py-4">
                                <div className="text-xs font-medium text-slate-500">
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
                title="Add Recipient"
                size="sm"
            >
                <div className="space-y-4 py-2">
                    <p className="text-xs font-medium text-slate-500">
                        Choose a team member to receive matched alert emails.
                    </p>
                    {nonRecipientMembers.length === 0 ? (
                        <div className="py-8 text-center">
                            <Check className="mx-auto mb-3 h-9 w-9 text-emerald-500" />
                            <p className="font-semibold text-slate-900">Everyone is already included.</p>
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                            {nonRecipientMembers.map((member) => (
                                <button
                                    type="button"
                                    key={member.userId}
                                    onClick={() => handleAddRecipient(member.userId)}
                                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left hover:bg-[#f8fafd] transition-colors"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        {member.avatarUrl ? (
                                            <img src={member.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover" />
                                        ) : (
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                                                {(member.displayName || member.email)[0].toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{member.displayName || member.email}</p>
                                            <p className="truncate text-xs font-medium text-slate-500">{member.role}</p>
                                        </div>
                                    </div>
                                    <UserPlus className="h-4 w-4 shrink-0 text-slate-400" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </Modal>

            {/* Add Custom Rule Modal */}
            <Modal
                isOpen={showComposer}
                onClose={() => setShowComposer(false)}
                title="Add Custom Alert Rule"
                size="md"
                footer={
                    <div className="flex gap-2">
                        <NeoButton
                            type="button"
                            variant="secondary"
                            onClick={() => setShowComposer(false)}
                        >
                            Cancel
                        </NeoButton>
                        <NeoButton
                            type="button"
                            variant="primary"
                            leftIcon={<Zap className="h-4 w-4" />}
                            onClick={handleAddRule}
                        >
                            Add rule
                        </NeoButton>
                    </div>
                }
            >
                <div className="space-y-4 py-2">
                    <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-500">Rule name</span>
                        <input
                            value={ruleDraft.name}
                            onChange={(event) => setRuleDraft((current) => ({ ...current, name: event.target.value }))}
                            placeholder="e.g. Production crash surge"
                            className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500">Alert type</span>
                            <select
                                value={ruleDraft.alertType}
                                onChange={(event) => handleDraftAlertTypeChange(event.target.value as EmailRuleAlertType)}
                                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            >
                                {(Object.keys(EVENT_META) as EmailRuleAlertType[]).map((alertType) => (
                                    <option key={alertType} value={alertType}>{EVENT_META[alertType].label}</option>
                                ))}
                            </select>
                        </label>

                        <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500">Measure</span>
                            <select
                                value={ruleDraft.metric}
                                onChange={(event) => setRuleDraft((current) => ({ ...current, metric: event.target.value as EmailRuleMetric }))}
                                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            >
                                {METRICS_BY_EVENT[ruleDraft.alertType].map((metric) => (
                                    <option key={metric} value={metric}>{METRIC_LABELS[metric]}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500">Trigger</span>
                            <select
                                value={ruleDraft.operator}
                                onChange={(event) => setRuleDraft((current) => ({ ...current, operator: event.target.value as EmailRuleOperator }))}
                                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            >
                                {(Object.keys(OPERATOR_WORDS) as EmailRuleOperator[]).map((operator) => (
                                    <option key={operator} value={operator}>{OPERATOR_WORDS[operator]}</option>
                                ))}
                            </select>
                        </label>

                        <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500">Threshold</span>
                            <div className="flex h-9 overflow-hidden rounded-md border border-slate-200 bg-white focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
                                <input
                                    type="number"
                                    min={0}
                                    step={ruleDraft.metric === 'duration_ms' ? 0.5 : 1}
                                    value={thresholdInputValue(ruleDraft)}
                                    onChange={(event) => setRuleDraft((current) => ({
                                        ...current,
                                        threshold: thresholdFromInput(current.metric, Number(event.target.value)),
                                    }))}
                                    className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-semibold outline-none"
                                />
                                <span className="flex items-center border-l border-slate-100 bg-[#f8fafd] px-3 text-xs font-semibold text-slate-500 uppercase">
                                    {thresholdUnitLabel(ruleDraft.metric)}
                                </span>
                            </div>
                        </label>
                    </div>

                    <p className="text-xs font-medium text-slate-500 bg-blue-50/50 p-2.5 rounded-md border border-blue-100 flex items-start gap-2">
                        <Info className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />
                        <span>{ruleNumberHelp(ruleDraft) || "Custom rule matching defined parameters."}</span>
                    </p>
                </div>
            </Modal>
        </SettingsLayout>
    );
};

export default AlertEmails;
