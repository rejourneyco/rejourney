import React, { useState, useEffect, useCallback } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { Bell, UserPlus, X, Check, AlertTriangle, Clock, Mail, Info, AlertOctagon, Terminal, Activity, ChevronRight, Search, ChevronLeft } from 'lucide-react';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { Link } from 'react-router';
import { usePathPrefix } from '../../hooks/usePathPrefix';

// Alert settings types
interface AlertSettings {
    id: string;
    projectId: string;
    crashAlertsEnabled: boolean;
    anrAlertsEnabled: boolean;
    errorSpikeAlertsEnabled: boolean;
    apiDegradationAlertsEnabled: boolean;
    errorSpikeThresholdPercent: number;
    apiLatencyThresholdMs: number;
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

// Import centralized config
import { API_BASE_URL, getCsrfToken } from '../../config';

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
    options: { search?: string; alertType?: string; page?: number; limit?: number } = {}
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

// Toggle component - Neo style
const Toggle: React.FC<{
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
}> = ({ enabled, onChange, disabled }) => (
    <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`
      relative w-11 h-6 border border-slate-300 rounded-full transition-colors duration-200
      ${enabled ? 'bg-emerald-400' : 'bg-slate-200'}
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-slate-400'}
    `}
    >
        <div
            className={`
        absolute top-0.5 left-0.5 w-[18px] h-[18px] bg-white border border-slate-300 rounded-full transition-transform duration-200 shadow-sm
        ${enabled ? 'translate-x-[20px]' : 'translate-x-0'}
      `}
        />
    </button>
);

// Alert type card
const AlertTypeCard: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    color: string;
    recommended?: boolean;
}> = ({ icon, title, description, enabled, onChange, color, recommended }) => {
    const colorVariants: Record<string, any> = {
        red: { badge: 'danger', icon: 'text-red-500' },
        amber: { badge: 'warning', icon: 'text-amber-500' },
        indigo: { badge: 'info', icon: 'text-indigo-500' },
        blue: { badge: 'info', icon: 'text-blue-500' },
    };

    const variant = colorVariants[color] || { badge: 'neutral', icon: 'text-slate-500' };

    return (
        <NeoCard
            className={`transition-all ${enabled ? 'border-slate-300 shadow-sm' : 'opacity-70 grayscale-[0.5] border-slate-200 hover:opacity-100 hover:grayscale-0'}`}
            disablePadding
        >
            <div className={`p-5 ${enabled ? 'bg-white' : 'bg-slate-50/50'}`}>
                <div className="flex items-start justify-between mb-4">
                    <div className={`p-2.5 bg-slate-50 rounded-xl border border-slate-100 ${variant.icon}`}>
                        {icon}
                    </div>
                    <Toggle enabled={enabled} onChange={onChange} />
                </div>
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900 text-sm tracking-tight">{title}</h4>
                        {recommended && (
                            <NeoBadge variant="success" size="sm" className="px-1.5 py-0 border-none rounded-full text-[9px]">
                                RECOMMENDED
                            </NeoBadge>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">{description}</p>
                </div>
            </div>
        </NeoCard>
    );
};

export const AlertEmails: React.FC = () => {
    const { selectedProject } = useSessionData();
    const pathPrefix = usePathPrefix();
    const [settings, setSettings] = useState<AlertSettings | null>(null);
    const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
    const [availableMembers, setAvailableMembers] = useState<TeamMember[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [showAddRecipient, setShowAddRecipient] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Email log state
    const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
    const [emailLogPagination, setEmailLogPagination] = useState<EmailLogPagination>({ page: 1, limit: 15, total: 0, totalPages: 0 });
    const [emailLogSearch, setEmailLogSearch] = useState('');
    const [emailLogTypeFilter, setEmailLogTypeFilter] = useState('all');
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    useEffect(() => {
        if (!selectedProject?.id) return;
        loadData();
    }, [selectedProject?.id]);

    // Load email logs when filters change
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

    useEffect(() => {
        if (selectedProject?.id) {
            loadEmailLogs(1);
        }
    }, [selectedProject?.id, emailLogTypeFilter]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (selectedProject?.id) {
                loadEmailLogs(1);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [emailLogSearch]);

    const loadData = async () => {
        if (!selectedProject?.id) return;
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
            } else {
                failedSections.push('alert rules');
                setSettings(null);
            }

            if (recipientsData.status === 'fulfilled') {
                setRecipients(recipientsData.value);
            } else {
                failedSections.push('recipient list');
                setRecipients([]);
            }

            if (membersData.status === 'fulfilled') {
                setAvailableMembers(membersData.value);
            } else {
                failedSections.push('team members');
                setAvailableMembers([]);
            }

            if (failedSections.length > 0) {
                setError(`Some alert settings data failed to load (${failedSections.join(', ')}).`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load alert settings');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSettingChange = async (key: keyof AlertSettings, value: boolean | number) => {
        if (!selectedProject?.id || !settings) return;
        setIsSaving(true);
        try {
            const updated = await updateAlertSettings(selectedProject.id, { [key]: value });
            setSettings(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setIsSaving(false);
        }
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
            setRecipients(prev => prev.filter(r => r.userId !== userId));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to remove recipient');
        }
    };

    if (isLoading) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[50vh]">
                <div className="text-sm text-slate-500 font-mono animate-pulse">LOADING ALERT SETTINGS...</div>
            </div>
        );
    }

    const nonRecipientMembers = availableMembers.filter(m => !m.isRecipient);

    return (
        <div className="p-8 space-y-8 animate-fade-in max-w-[1200px] mx-auto pb-12 font-sans bg-slate-50">
            {/* Header */}
            <div className="sticky top-0 z-50 bg-white">
                <DashboardPageHeader
                    title="Alert Settings"
                    subtitle="Configure real-time notifications for critical events"
                    icon={<Mail className="w-6 h-6" />}
                    iconColor="bg-red-500"
                >
                    <div className="hidden lg:flex items-center gap-2 mr-4 bg-slate-50 border-2 border-slate-200 px-3 py-1 rounded-md">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                        <span className="text-[10px] font-bold uppercase text-slate-400">System Ready</span>
                    </div>
                </DashboardPageHeader>
            </div>
            {error && (
                <div className="bg-red-50 border border-red-200 p-4 text-sm text-red-900 rounded-xl flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto hover:opacity-70 transition-opacity">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Recipients Section */}
            <NeoCard
                className="border border-slate-200 shadow-sm"
                disablePadding
            >
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h2 className="font-bold text-slate-900 text-lg tracking-tight">Alert Recipients</h2>
                        <p className="text-xs font-medium text-slate-500 mt-1">Designate who receives real-time notifications</p>
                    </div>
                    {recipients.length < 5 && (
                        <NeoButton
                            onClick={() => setShowAddRecipient(true)}
                            variant="primary"
                            size="sm"
                            leftIcon={<UserPlus className="w-4 h-4" />}
                        >
                            ADD RECIPIENT
                        </NeoButton>
                    )}
                </div>

                <div className="p-6">
                    {recipients.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-slate-100 border-2 border-slate-200 border-dashed rounded-full flex items-center justify-center mx-auto mb-4">
                                <Mail className="w-8 h-8 text-slate-300" />
                            </div>
                            <p className="font-bold text-slate-400 uppercase tracking-tighter text-xl">No recipients configured</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Add team members to receive email alerts</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {recipients.map((recipient) => (
                                <div
                                    key={recipient.id}
                                    className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors group"
                                >
                                    <div className="flex items-center gap-4">
                                        {recipient.avatarUrl ? (
                                            <img src={recipient.avatarUrl} alt="" className="w-12 h-12 border border-slate-200 rounded-full" />
                                        ) : (
                                            <div className="w-12 h-12 border border-slate-200 rounded-full bg-slate-50 flex items-center justify-center text-slate-600 font-bold text-lg">
                                                {(recipient.displayName || recipient.email)[0].toUpperCase()}
                                            </div>
                                        )}
                                        <div>
                                            <p className="font-bold text-slate-900 text-sm leading-tight">
                                                {recipient.displayName || recipient.email}
                                            </p>
                                            <p className="text-xs font-medium text-slate-400">{recipient.email}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRemoveRecipient(recipient.userId)}
                                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Add recipient modal */}
                {showAddRecipient && (
                    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
                        <NeoCard className="w-full max-w-md border border-slate-200 shadow-xl overflow-hidden" disablePadding>
                            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white text-slate-900">
                                <h3 className="font-bold tracking-tight text-lg">Add Alert Recipient</h3>
                                <button onClick={() => setShowAddRecipient(false)} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 max-h-[60vh] overflow-y-auto bg-white">
                                {nonRecipientMembers.length === 0 ? (
                                    <div className="text-center py-8">
                                        <Check className="w-12 h-12 text-green-500 mx-auto mb-2" />
                                        <p className="font-bold text-slate-900">Everyone is added!</p>
                                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">All team members are already recipients</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {nonRecipientMembers.map((member) => (
                                            <button
                                                key={member.userId}
                                                onClick={() => handleAddRecipient(member.userId)}
                                                className="w-full flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:bg-slate-50 transition-all group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    {member.avatarUrl ? (
                                                        <img src={member.avatarUrl} alt="" className="w-10 h-10 border border-slate-200 rounded-full" />
                                                    ) : (
                                                        <div className="w-10 h-10 border border-slate-200 rounded-full bg-slate-50 flex items-center justify-center text-slate-500 font-bold text-sm">
                                                            {(member.displayName || member.email)[0].toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="text-left font-sans">
                                                        <p className="font-bold text-slate-900 text-sm">
                                                            {member.displayName || member.email}
                                                        </p>
                                                        <p className="text-[11px] font-medium text-slate-400">{member.role}</p>
                                                    </div>
                                                </div>
                                                <div className="p-2 text-slate-400 group-hover:text-indigo-600 transition-colors">
                                                    <UserPlus className="w-4 h-4" />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </NeoCard>
                    </div>
                )}
            </NeoCard>

            {/* Alert Types Section */}
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <h2 className="font-bold text-slate-900 text-lg tracking-tight">Alert Triggers</h2>
                    <div className="h-px flex-1 bg-slate-200"></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <AlertTypeCard
                        icon={<AlertOctagon className="w-6 h-6" />}
                        title="Crash Alerts"
                        description="Notification when new crash types are detected"
                        enabled={settings?.crashAlertsEnabled ?? true}
                        onChange={(val) => handleSettingChange('crashAlertsEnabled', val)}
                        color="red"
                        recommended
                    />
                    <AlertTypeCard
                        icon={<Clock className="w-6 h-6" />}
                        title="ANR Alerts"
                        description="Notification for app freezes (ANRs)"
                        enabled={settings?.anrAlertsEnabled ?? true}
                        onChange={(val) => handleSettingChange('anrAlertsEnabled', val)}
                        color="amber"
                        recommended
                    />
                    <AlertTypeCard
                        icon={<Terminal className="w-6 h-6" />}
                        title="Error Spikes"
                        description="Notification for significant error rate increases"
                        enabled={settings?.errorSpikeAlertsEnabled ?? true}
                        onChange={(val) => handleSettingChange('errorSpikeAlertsEnabled', val)}
                        color="indigo"
                        recommended
                    />
                    <AlertTypeCard
                        icon={<Activity className="w-6 h-6" />}
                        title="API Status"
                        description="Notification when API thresholds are exceeded"
                        enabled={settings?.apiDegradationAlertsEnabled ?? true}
                        onChange={(val) => handleSettingChange('apiDegradationAlertsEnabled', val)}
                        color="blue"
                        recommended
                    />
                </div>
            </div>

            {/* Rate Limiting Info */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex items-start gap-5">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                    <Info className="w-6 h-6" />
                </div>
                <div>
                    <h3 className="font-bold text-slate-900 tracking-tight text-base mb-1.5">Notification Policies</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="flex items-start gap-2.5">
                            <ChevronRight className="w-3.5 h-3.5 text-indigo-500 mt-1" />
                            <p className="text-xs font-medium text-slate-600">Duplicate alerts suppressed for 1 hour window</p>
                        </div>
                        <div className="flex items-start gap-2.5">
                            <ChevronRight className="w-3.5 h-3.5 text-indigo-500 mt-1" />
                            <p className="text-xs font-medium text-slate-600">Daily limit: 20 alert emails per project</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Email Log Section */}
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <h2 className="font-bold text-slate-900 text-lg tracking-tight">Delivery Logs</h2>
                    <div className="h-px flex-1 bg-slate-200"></div>
                </div>

                <NeoCard className="border border-slate-200 shadow-sm" disablePadding>
                    {/* Search & Filter Bar */}
                    <div className="px-6 py-4 border-b border-slate-100 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                        <div className="relative flex-1 max-w-md group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
                            <input
                                type="text"
                                value={emailLogSearch}
                                onChange={(e) => setEmailLogSearch(e.target.value)}
                                placeholder="Filter logs..."
                                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-200 focus:border-indigo-400 transition-all shadow-sm"
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-slate-400">Type:</span>
                            <select
                                value={emailLogTypeFilter}
                                onChange={(e) => setEmailLogTypeFilter(e.target.value)}
                                className="text-xs font-bold uppercase px-3 py-2 border border-slate-200 rounded-lg bg-white cursor-pointer hover:bg-slate-50 transition-all outline-none focus:ring-1 focus:ring-indigo-200"
                            >
                                <option value="all">All Types</option>
                                <option value="crash">Crashes</option>
                                <option value="anr">ANRs</option>
                                <option value="error_spike">Error Spikes</option>
                                <option value="api_degradation">API Degradation</option>
                            </select>
                        </div>
                    </div>

                    {/* Log Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 border-b border-slate-100 font-bold uppercase text-slate-500 text-[10px] tracking-wider">
                                <tr>
                                    <th className="p-4">Timestamp</th>
                                    <th className="p-4">Alert Class</th>
                                    <th className="p-4">Recipient</th>
                                    <th className="p-4">Information</th>
                                    <th className="p-4 text-right">Delivery</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {isLoadingLogs ? (
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center">
                                            <div className="text-sm font-bold text-slate-400 uppercase animate-pulse">Loading email logs...</div>
                                        </td>
                                    </tr>
                                ) : emailLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="p-12 text-center">
                                            <Mail className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                                            <p className="font-bold text-slate-400 uppercase tracking-tighter text-lg">No emails sent yet</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Emails will appear here when alerts are triggered</p>
                                        </td>
                                    </tr>
                                ) : (
                                    emailLogs.map((log) => {
                                        const typeColors: Record<string, string> = {
                                            crash: 'bg-red-500',
                                            anr: 'bg-amber-500',
                                            error_spike: 'bg-indigo-500',
                                            api_degradation: 'bg-blue-500',
                                        };
                                        const typeLabels: Record<string, string> = {
                                            crash: 'Crash',
                                            anr: 'ANR',
                                            error_spike: 'Error Spike',
                                            api_degradation: 'API',
                                        };
                                        return (
                                            <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group text-sm">
                                                <td className="p-4 whitespace-nowrap">
                                                    <div className="font-bold text-slate-900">
                                                        {new Date(log.sentAt).toLocaleDateString()}
                                                    </div>
                                                    <div className="text-[10px] font-medium text-slate-400">
                                                        {new Date(log.sentAt).toLocaleTimeString()}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-2 h-2 rounded-full ${typeColors[log.alertType] || 'bg-slate-300'}`} />
                                                        <span className="font-bold text-slate-700">
                                                            {typeLabels[log.alertType] || log.alertType}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="font-bold text-slate-900">
                                                        {log.recipientName || log.recipientEmail}
                                                    </div>
                                                    {log.recipientName && (
                                                        <div className="text-[10px] font-medium text-slate-400">{log.recipientEmail}</div>
                                                    )}
                                                </td>
                                                <td className="p-4 max-w-xs">
                                                    <div className="font-bold text-slate-700 truncate" title={log.subject}>
                                                        {log.subject}
                                                    </div>
                                                    {log.issueId && (
                                                        <Link
                                                            to={`${pathPrefix}/general/${log.issueId}`}
                                                            className="text-[10px] text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider"
                                                        >
                                                            View Issue →
                                                        </Link>
                                                    )}
                                                </td>
                                                <td className="p-4 text-right">
                                                    {log.status === 'sent' ? (
                                                        <NeoBadge variant="success" size="sm" className="border-none shadow-none rounded-full px-2.5">
                                                            Delivered
                                                        </NeoBadge>
                                                    ) : log.status === 'failed' ? (
                                                        <span title={log.errorMessage || 'Email delivery failed'}>
                                                            <NeoBadge variant="danger" size="sm" className="border-none shadow-none rounded-full px-2.5">
                                                                Failed
                                                            </NeoBadge>
                                                        </span>
                                                    ) : (
                                                        <NeoBadge variant="warning" size="sm" className="border-none shadow-none rounded-full px-2.5">
                                                            Bounced
                                                        </NeoBadge>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {emailLogPagination.totalPages > 1 && (
                        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Page {emailLogPagination.page} / {emailLogPagination.totalPages} • Total: {emailLogPagination.total}
                            </div>
                            <div className="flex items-center gap-2">
                                <NeoButton
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => loadEmailLogs(emailLogPagination.page - 1)}
                                    disabled={emailLogPagination.page <= 1}
                                    leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                                    className="h-8 text-[10px] rounded-lg border-slate-200 shadow-none px-3"
                                >
                                    Previous
                                </NeoButton>
                                <NeoButton
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => loadEmailLogs(emailLogPagination.page + 1)}
                                    disabled={emailLogPagination.page >= emailLogPagination.totalPages}
                                    rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                                    className="h-8 text-[10px] rounded-lg border-slate-200 shadow-none px-3"
                                >
                                    Next
                                </NeoButton>
                            </div>
                        </div>
                    )}
                </NeoCard>
            </div>
        </div>
    );
};
