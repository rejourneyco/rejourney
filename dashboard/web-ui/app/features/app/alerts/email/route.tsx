import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
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
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
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

const Toggle: React.FC<{
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
    label: string;
}> = ({ enabled, onChange, disabled, label }) => (
    <button
        type="button"
        aria-label={label}
        aria-pressed={enabled}
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`relative h-6 w-11 rounded-full border transition-colors ${enabled ? 'border-[#14532d] bg-[#166534]' : 'border-slate-300 bg-slate-100'} ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-[#15803d]'}`}
    >
        <span
            className={`absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full border bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5 border-[#14532d]' : 'translate-x-0 border-slate-300'}`}
        />
    </button>
);

const SectionHeading: React.FC<{
    icon: React.ReactNode;
    title: string;
    eyebrow?: string;
    action?: React.ReactNode;
}> = ({ icon, title, eyebrow, action }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eaed] bg-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#dadce0] bg-[#f8fafd] text-[#1a73e8]">
                {icon}
            </div>
            <div className="min-w-0">
                {eyebrow && <div className="text-[11px] font-semibold uppercase text-slate-500">{eyebrow}</div>}
                <h2 className="truncate text-base font-semibold text-[#202124]">{title}</h2>
            </div>
        </div>
        {action}
    </div>
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

export const AlertEmails: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
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
    }, [selectedProject?.id]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (selectedProject?.id) {
            loadEmailLogs(1);
        }
    }, [selectedProject?.id, emailLogTypeFilter, loadEmailLogs]);

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

    if (isLoading) {
        return <DashboardGhostLoader variant="alerts" />;
    }

    return (
        <div className="firebase-alerts-page min-h-screen animate-fade-in bg-[#f8fafd] pb-10 font-sans text-[#202124]">
            <DashboardPageHeader
                title="Email Alerts"
                subtitle="Choose which signals send email and who receives them"
                icon={<Mail className="h-6 w-6" />}
                iconColor="bg-[#f4f4f5]"
            >
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
            </DashboardPageHeader>

            <div className="mx-auto max-w-[1360px] space-y-5 px-3 py-5 sm:px-6">
                {error && (
                    <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <span className="min-w-0 flex-1">{error}</span>
                        <button type="button" onClick={() => setError(null)} className="rounded-md p-1 hover:bg-white">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                )}

                <section className="dashboard-surface p-5">
                    <div className="grid gap-4 md:grid-cols-3">
                        {[
                            {
                                label: 'Rules turned on',
                                value: `${summary.activeRules}/${rules.length || 0}`,
                                helper: 'Only enabled rules can send email.',
                            },
                            {
                                label: 'People receiving email',
                                value: `${recipients.length}/5`,
                                helper: 'Recipients are team members on this project.',
                            },
                            {
                                label: 'Delivery issues shown',
                                value: summary.failedLogs,
                                helper: 'Failed or bounced emails in the current log view.',
                            },
                        ].map((item) => (
                            <div key={item.label} className="rounded-lg border border-[#e8eaed] bg-[#f8fafd] p-4">
                                <div className="text-xs font-semibold uppercase text-slate-500">{item.label}</div>
                                <div className="mt-2 text-2xl font-semibold text-[#202124]">{item.value}</div>
                                <p className="mt-1 text-xs font-medium text-slate-500">{item.helper}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                    <section className="dashboard-surface overflow-hidden">
                        <SectionHeading
                            icon={<SlidersHorizontal className="h-5 w-5" />}
                            eyebrow="Alert rules"
                            title="When should Rejourney send email?"
                            action={(
                                <button
                                    type="button"
                                    onClick={() => setShowComposer((open) => !open)}
                                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dadce0] bg-white px-3 text-sm font-semibold text-[#202124] hover:bg-[#f8fafd]"
                                >
                                    {showComposer ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                    {showComposer ? 'Close' : 'Add rule'}
                                </button>
                            )}
                        />

                        <div className="border-b border-[#e8eaed] bg-blue-50/60 px-5 py-3">
                            <div className="flex gap-2 text-sm text-blue-900">
                                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                                <p className="font-medium">
                                    Rule numbers are thresholds. A rule sends email only when the signal reaches that number, then duplicate emails are suppressed for one hour.
                                </p>
                            </div>
                        </div>

                        <div className="divide-y divide-[#e8eaed]">
                            {(Object.keys(EVENT_META) as EmailRuleAlertType[]).map((alertType) => {
                                const meta = EVENT_META[alertType];
                                const eventRules = rulesByEvent[alertType];
                                return (
                                    <div key={alertType} className="bg-white">
                                        <div className="flex items-center justify-between gap-3 bg-[#f8fafd] px-5 py-3">
                                            <div className="flex items-center gap-3">
                                                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${meta.accent} text-[#202124]`}>
                                                    {meta.icon}
                                                </span>
                                                <div>
                                                    <div className="text-sm font-semibold text-[#202124]">{meta.label}</div>
                                                    <div className="text-xs font-medium text-slate-500">
                                                        {eventRules.filter((rule) => rule.enabled).length} of {eventRules.length} rules on
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="divide-y divide-[#edf0f3]">
                                            {eventRules.map((rule) => (
                                                <div key={rule.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_300px_auto] lg:items-center">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <h3 className="text-sm font-semibold text-[#202124]">{rule.name}</h3>
                                                            <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${rule.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                                                {rule.enabled ? 'On' : 'Off'}
                                                            </span>
                                                            {rule.source === 'custom' && (
                                                                <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                                                    Custom
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="mt-1 text-sm font-medium text-slate-700">{ruleTriggerSentence(rule)}</p>
                                                        <p className="mt-1 text-xs font-medium text-slate-500">{ruleNumberHelp(rule)}</p>
                                                    </div>

                                                    <div className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)] lg:grid-cols-[108px_minmax(0,1fr)]">
                                                        <label className="block">
                                                            <span className="mb-1 block text-xs font-semibold text-slate-500">Trigger</span>
                                                            <select
                                                                value={rule.operator}
                                                                onChange={(event) => handleRuleUpdate(rule.id, { operator: event.target.value as EmailRuleOperator })}
                                                                className="h-10 w-full rounded-md border border-[#dadce0] bg-white px-2 text-sm font-medium outline-none"
                                                            >
                                                                {(Object.keys(OPERATOR_WORDS) as EmailRuleOperator[]).map((operator) => (
                                                                    <option key={operator} value={operator}>{OPERATOR_WORDS[operator]}</option>
                                                                ))}
                                                            </select>
                                                        </label>
                                                        <label className="block">
                                                            <span className="mb-1 block text-xs font-semibold text-slate-500">Threshold</span>
                                                            <div className="flex h-10 overflow-hidden rounded-md border border-[#dadce0] bg-white">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    step={rule.metric === 'duration_ms' ? 0.5 : 1}
                                                                    value={thresholdInputValue(rule)}
                                                                    onChange={(event) => handleRuleUpdate(rule.id, { threshold: thresholdFromInput(rule.metric, Number(event.target.value)) })}
                                                                    className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-semibold outline-none"
                                                                />
                                                                <span className="flex items-center border-l border-[#e8eaed] bg-[#f8fafd] px-3 text-xs font-semibold text-slate-500">
                                                                    {thresholdUnitLabel(rule.metric)}
                                                                </span>
                                                            </div>
                                                        </label>
                                                    </div>

                                                    <div className="flex items-center justify-between gap-2 lg:justify-end">
                                                        <Toggle
                                                            label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`}
                                                            enabled={rule.enabled}
                                                            onChange={(enabled) => handleRuleUpdate(rule.id, { enabled })}
                                                        />
                                                        {rule.source === 'custom' && (
                                                            <button
                                                                type="button"
                                                                aria-label={`Delete ${rule.name}`}
                                                                onClick={() => handleDeleteRule(rule.id)}
                                                                className="flex h-9 w-9 items-center justify-center rounded-md border border-[#dadce0] bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <aside className="space-y-5">
                        <section className="dashboard-surface overflow-hidden">
                            <SectionHeading icon={<Users className="h-5 w-5" />} eyebrow="Recipients" title="Who gets emails?" />
                            <div className="space-y-3 p-5">
                                {recipients.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-slate-300 bg-[#f8fafd] p-5 text-center">
                                        <Mail className="mx-auto h-8 w-8 text-slate-300" />
                                        <p className="mt-3 text-sm font-semibold text-slate-600">No recipients yet</p>
                                        <p className="mt-1 text-xs font-medium text-slate-500">Add a team member before alerts can be delivered.</p>
                                    </div>
                                ) : (
                                    recipients.map((recipient) => (
                                        <div key={recipient.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[#e8eaed] bg-white p-3">
                                            <div className="flex min-w-0 items-center gap-3">
                                                {recipient.avatarUrl ? (
                                                    <img src={recipient.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-[#dadce0] object-cover" />
                                                ) : (
                                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                                                        {(recipient.displayName || recipient.email)[0].toUpperCase()}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-semibold text-[#202124]">{recipient.displayName || recipient.email}</p>
                                                    <p className="truncate text-xs font-medium text-slate-500">{recipient.email}</p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                aria-label={`Remove ${recipient.displayName || recipient.email}`}
                                                onClick={() => handleRemoveRecipient(recipient.userId)}
                                                className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))
                                )}
                                {recipients.length < 5 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAddRecipient(true)}
                                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[#dadce0] bg-white text-sm font-semibold text-[#202124] hover:bg-[#f8fafd]"
                                    >
                                        <UserPlus className="h-4 w-4" />
                                        Add recipient
                                    </button>
                                )}
                            </div>
                        </section>

                        <section className="dashboard-surface overflow-hidden">
                            <SectionHeading icon={<Filter className="h-5 w-5" />} eyebrow="Guardrails" title="Noise controls" />
                            <div className="space-y-3 p-5 text-sm">
                                <div className="rounded-lg border border-[#e8eaed] bg-[#f8fafd] p-3">
                                    <div className="font-semibold text-[#202124]">Same issue cooldown</div>
                                    <p className="mt-1 text-xs font-medium text-slate-500">Duplicate emails for the same issue are held for 1 hour.</p>
                                </div>
                                <div className="rounded-lg border border-[#e8eaed] bg-[#f8fafd] p-3">
                                    <div className="font-semibold text-[#202124]">Project daily cap</div>
                                    <p className="mt-1 text-xs font-medium text-slate-500">A project sends at most 20 alert emails per day.</p>
                                </div>
                            </div>
                        </section>
                    </aside>
                </div>

                {showComposer && (
                    <section className="dashboard-surface overflow-hidden">
                        <SectionHeading icon={<Plus className="h-5 w-5" />} eyebrow="Custom rule" title="Add a rule" />
                        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(220px,1fr)_180px_180px_160px] lg:items-end">
                            <label className="block">
                                <span className="mb-1 block text-xs font-semibold text-slate-500">Rule name</span>
                                <input
                                    value={ruleDraft.name}
                                    onChange={(event) => setRuleDraft((current) => ({ ...current, name: event.target.value }))}
                                    placeholder="Production crash surge"
                                    className="h-10 w-full rounded-md border border-[#dadce0] bg-white px-3 text-sm font-medium outline-none"
                                />
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs font-semibold text-slate-500">Alert type</span>
                                <select
                                    value={ruleDraft.alertType}
                                    onChange={(event) => handleDraftAlertTypeChange(event.target.value as EmailRuleAlertType)}
                                    className="h-10 w-full rounded-md border border-[#dadce0] bg-white px-3 text-sm font-medium outline-none"
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
                                    className="h-10 w-full rounded-md border border-[#dadce0] bg-white px-3 text-sm font-medium outline-none"
                                >
                                    {METRICS_BY_EVENT[ruleDraft.alertType].map((metric) => (
                                        <option key={metric} value={metric}>{METRIC_LABELS[metric]}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs font-semibold text-slate-500">Threshold</span>
                                <div className="flex h-10 overflow-hidden rounded-md border border-[#dadce0] bg-white">
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
                                    <span className="flex items-center border-l border-[#e8eaed] bg-[#f8fafd] px-3 text-xs font-semibold text-slate-500">
                                        {thresholdUnitLabel(ruleDraft.metric)}
                                    </span>
                                </div>
                            </label>
                            <div className="lg:col-span-3">
                                <p className="text-xs font-medium text-slate-500">{ruleNumberHelp(ruleDraft)}</p>
                            </div>
                            <NeoButton
                                type="button"
                                variant="primary"
                                leftIcon={<Zap className="h-4 w-4" />}
                                onClick={handleAddRule}
                            >
                                Add rule
                            </NeoButton>
                        </div>
                    </section>
                )}

                {showAddRecipient && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
                        <div className="dashboard-surface w-full max-w-md overflow-hidden bg-white">
                            <div className="flex items-center justify-between border-b border-[#e8eaed] px-5 py-4">
                                <div>
                                    <h3 className="text-base font-semibold text-[#202124]">Add recipient</h3>
                                    <p className="mt-1 text-xs font-medium text-slate-500">Choose a team member to receive matched alert emails.</p>
                                </div>
                                <button type="button" onClick={() => setShowAddRecipient(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="max-h-[62vh] overflow-y-auto bg-white p-5">
                                {nonRecipientMembers.length === 0 ? (
                                    <div className="py-8 text-center">
                                        <Check className="mx-auto mb-3 h-9 w-9 text-emerald-500" />
                                        <p className="font-semibold text-[#202124]">Everyone is already included.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {nonRecipientMembers.map((member) => (
                                            <button
                                                type="button"
                                                key={member.userId}
                                                onClick={() => handleAddRecipient(member.userId)}
                                                className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#e8eaed] bg-white p-3 text-left hover:bg-[#f8fafd]"
                                            >
                                                <div className="flex min-w-0 items-center gap-3">
                                                    {member.avatarUrl ? (
                                                        <img src={member.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-[#dadce0] object-cover" />
                                                    ) : (
                                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                                                            {(member.displayName || member.email)[0].toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-semibold text-[#202124]">{member.displayName || member.email}</p>
                                                        <p className="truncate text-xs font-medium text-slate-500">{member.role}</p>
                                                    </div>
                                                </div>
                                                <UserPlus className="h-4 w-4 shrink-0 text-slate-500" />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <section className="dashboard-surface overflow-hidden">
                    <SectionHeading
                        icon={<Mail className="h-5 w-5" />}
                        eyebrow="History"
                        title="Delivery Logs"
                        action={(
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                {summary.sentLogs} delivered
                            </span>
                        )}
                    />

                    <div className="flex flex-col gap-3 border-b border-[#e8eaed] bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="relative w-full md:max-w-md">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={emailLogSearch}
                                onChange={(event) => setEmailLogSearch(event.target.value)}
                                placeholder="Filter logs"
                                className="h-10 w-full rounded-md border border-[#dadce0] bg-white pl-10 pr-3 text-sm font-medium outline-none"
                            />
                        </div>
                        <select
                            value={emailLogTypeFilter}
                            onChange={(event) => setEmailLogTypeFilter(event.target.value)}
                            className="h-10 rounded-md border border-[#dadce0] bg-white px-3 text-sm font-medium outline-none"
                        >
                            <option value="all">All Types</option>
                            <option value="crash">Crashes</option>
                            <option value="anr">ANRs</option>
                            <option value="error_spike">Error Spikes</option>
                            <option value="api_degradation">API Degradation</option>
                        </select>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[820px] text-left text-sm">
                            <thead className="border-b border-[#e8eaed] bg-[#f8fafd] text-xs font-semibold uppercase text-slate-500">
                                <tr>
                                    <th className="p-4">Time</th>
                                    <th className="p-4">Class</th>
                                    <th className="p-4">Recipient</th>
                                    <th className="p-4">Subject</th>
                                    <th className="p-4 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#edf0f3]">
                                {isLoadingLogs ? (
                                    <tr>
                                        <td colSpan={5} className="p-10 text-center text-sm font-semibold text-slate-400">
                                            Loading email logs
                                        </td>
                                    </tr>
                                ) : emailLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="p-12 text-center">
                                            <Mail className="mx-auto mb-3 h-10 w-10 text-slate-200" />
                                            <p className="text-base font-semibold text-slate-500">No emails sent yet</p>
                                            <p className="mt-1 text-xs font-medium text-slate-400">Alert emails will appear here after a rule matches.</p>
                                        </td>
                                    </tr>
                                ) : (
                                    emailLogs.map((log) => {
                                        const sentAt = formatSentAt(log.sentAt);
                                        const meta = EVENT_META[(log.alertType as EmailRuleAlertType)] ?? EVENT_META.crash;
                                        return (
                                            <tr key={log.id} className="transition-colors hover:bg-[#f8fafc]">
                                                <td className="p-4 whitespace-nowrap">
                                                    <div className="font-semibold text-slate-900">{sentAt.date}</div>
                                                    <div className="text-xs font-medium text-slate-400">{sentAt.time}</div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`h-2.5 w-2.5 rounded-full ${meta.accent}`} />
                                                        <span className="font-semibold text-slate-800">{meta.shortLabel}</span>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="font-semibold text-slate-900">{log.recipientName || log.recipientEmail}</div>
                                                    {log.recipientName && (
                                                        <div className="text-xs font-medium text-slate-500">{log.recipientEmail}</div>
                                                    )}
                                                </td>
                                                <td className="max-w-sm p-4">
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
                                                <td className="p-4 text-right">
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
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8eaed] bg-white px-5 py-4">
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
                </section>
            </div>
        </div>
    );
};

export default AlertEmails;
