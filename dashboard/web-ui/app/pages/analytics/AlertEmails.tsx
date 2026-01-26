import React, { useState, useEffect, useCallback } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { Bell, UserPlus, X, Check, AlertTriangle, Clock, Mail, Info, AlertOctagon, Terminal, Activity, ChevronRight, Search, ChevronLeft } from 'lucide-react';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { Link } from 'react-router';

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
      relative w-12 h-6 border-2 border-black rounded-full transition-colors duration-200
      ${enabled ? 'bg-green-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]' : 'bg-slate-200'}
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:translate-y-px active:shadow-none'}
    `}
    >
        <div
            className={`
        absolute top-0.5 left-0.5 w-4 h-4 bg-white border-2 border-black rounded-full transition-transform duration-200
        ${enabled ? 'translate-x-6' : 'translate-x-0'}
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
            className={`transition-all ${enabled ? 'border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'opacity-70 grayscale-[0.5] border-slate-200 hover:opacity-100 hover:grayscale-0'}`}
            disablePadding
        >
            <div className={`p-4 ${enabled ? 'bg-white' : 'bg-slate-50/50'}`}>
                <div className="flex items-start justify-between mb-4">
                    <div className={`p-3 border-2 border-black rounded-xl bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${variant.icon}`}>
                        {icon}
                    </div>
                    <Toggle enabled={enabled} onChange={onChange} />
                </div>
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <h4 className="font-black text-black text-sm uppercase tracking-tight">{title}</h4>
                        {recommended && (
                            <NeoBadge variant="success" size="sm" className="px-1 py-0 border border-black transform -rotate-1">
                                TOP
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
            const [settingsData, recipientsData, membersData] = await Promise.all([
                getAlertSettings(selectedProject.id),
                getAlertRecipients(selectedProject.id),
                getAvailableRecipients(selectedProject.id),
            ]);
            setSettings(settingsData);
            setRecipients(recipientsData);
            setAvailableMembers(membersData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load settings');
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
        <div className="p-8 space-y-8 animate-fade-in max-w-[1200px] mx-auto pb-12 font-sans bg-white">
            {/* Header */}
            <div className="sticky top-0 z-50 bg-white border-b-4 border-black">
                <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-[1800px] mx-auto w-full">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-red-500 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg">
                            <Mail className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                                Alert Settings
                            </h1>
                            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                <div className="h-3 w-1 bg-red-500"></div>
                                Configure real-time notifications for critical events
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden lg:flex items-center gap-2 mr-4 bg-slate-50 border-2 border-slate-200 px-3 py-1 rounded-md">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                            <span className="text-[10px] font-black uppercase text-slate-400">System Ready</span>
                        </div>
                    </div>
                </div>
            </div>{error && (
                <div className="bg-red-400 border-4 border-black p-4 text-sm text-black font-bold shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto hover:scale-110 transition-transform">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Recipients Section */}
            <NeoCard
                className="border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
                disablePadding
            >
                <div className="px-6 py-5 border-b-2 border-black flex items-center justify-between bg-slate-50">
                    <div>
                        <h2 className="font-black text-black text-xl uppercase tracking-tight">Alert Recipients</h2>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Up to 5 team members can receive alerts</p>
                    </div>
                    {recipients.length < 5 && (
                        <NeoButton
                            onClick={() => setShowAddRecipient(true)}
                            variant="primary"
                            size="sm"
                            leftIcon={<UserPlus className="w-4 h-4" />}
                            className="shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)]"
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
                            <p className="font-black text-slate-400 uppercase tracking-tighter text-xl">No recipients configured</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Add team members to receive email alerts</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {recipients.map((recipient) => (
                                <div
                                    key={recipient.id}
                                    className="flex items-center justify-between p-4 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group"
                                >
                                    <div className="flex items-center gap-4">
                                        {recipient.avatarUrl ? (
                                            <img src={recipient.avatarUrl} alt="" className="w-12 h-12 border-2 border-black rounded-full" />
                                        ) : (
                                            <div className="w-12 h-12 border-2 border-black rounded-full bg-indigo-500 flex items-center justify-center text-white font-black text-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                {(recipient.displayName || recipient.email)[0].toUpperCase()}
                                            </div>
                                        )}
                                        <div>
                                            <p className="font-black text-black uppercase text-sm leading-tight">
                                                {recipient.displayName || recipient.email}
                                            </p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{recipient.email}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRemoveRecipient(recipient.userId)}
                                        className="p-2 border-2 border-transparent hover:border-black hover:bg-red-500 hover:text-white transition-all group-hover:block"
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
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <NeoCard className="w-full max-w-md border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]" disablePadding>
                            <div className="px-6 py-5 border-b-4 border-black flex items-center justify-between bg-yellow-400">
                                <h3 className="font-black text-black uppercase tracking-tight text-lg">Add Alert Recipient</h3>
                                <button onClick={() => setShowAddRecipient(false)} className="p-1 border-2 border-black bg-white hover:bg-red-500 hover:text-white transition-colors">
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
                                    <div className="space-y-3">
                                        {nonRecipientMembers.map((member) => (
                                            <button
                                                key={member.userId}
                                                onClick={() => handleAddRecipient(member.userId)}
                                                className="w-full flex items-center justify-between p-4 border-2 border-black hover:bg-indigo-50 transition-all hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group"
                                            >
                                                <div className="flex items-center gap-4">
                                                    {member.avatarUrl ? (
                                                        <img src={member.avatarUrl} alt="" className="w-10 h-10 border-2 border-black rounded-full" />
                                                    ) : (
                                                        <div className="w-10 h-10 border-2 border-black rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-black text-sm">
                                                            {(member.displayName || member.email)[0].toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="text-left font-sans">
                                                        <p className="font-black text-black text-sm uppercase">
                                                            {member.displayName || member.email}
                                                        </p>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{member.role}</p>
                                                    </div>
                                                </div>
                                                <div className="p-2 border-2 border-black bg-white group-hover:bg-indigo-500 group-hover:text-white transition-colors">
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
                    <h2 className="font-black text-black text-2xl uppercase tracking-tighter">Alert Triggers</h2>
                    <div className="h-[2px] flex-1 bg-black"></div>
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
            <div className="bg-white border-4 border-black p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-start gap-4">
                <div className="p-2 border-2 border-black bg-indigo-500 rounded-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <Info className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h3 className="font-black text-black uppercase tracking-tight text-lg mb-2">Sync & Rate Limits</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="flex items-start gap-3">
                            <ChevronRight className="w-4 h-4 text-indigo-500 mt-0.5" />
                            <p className="text-xs font-bold text-slate-600 uppercase">Duplicate alerts suppressed for 1hr</p>
                        </div>
                        <div className="flex items-start gap-3">
                            <ChevronRight className="w-4 h-4 text-indigo-500 mt-0.5" />
                            <p className="text-xs font-bold text-slate-600 uppercase">Max 20 emails per project / day</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Email Log Section */}
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <h2 className="font-black text-black text-2xl uppercase tracking-tighter">Email Log</h2>
                    <div className="h-[2px] flex-1 bg-black"></div>
                </div>

                <NeoCard className="border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]" disablePadding>
                    {/* Search & Filter Bar */}
                    <div className="px-6 py-4 border-b-2 border-black bg-slate-50 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                        <div className="relative flex-1 max-w-md group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black group-focus-within:text-indigo-600 transition-colors" />
                            <input
                                type="text"
                                value={emailLogSearch}
                                onChange={(e) => setEmailLogSearch(e.target.value)}
                                placeholder="SEARCH EMAILS..."
                                className="w-full pl-10 pr-4 py-2 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-lg font-bold text-sm uppercase placeholder:text-slate-400 focus:outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all"
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Type:</span>
                            <select
                                value={emailLogTypeFilter}
                                onChange={(e) => setEmailLogTypeFilter(e.target.value)}
                                className="text-xs font-bold uppercase px-3 py-2 border-2 border-black rounded bg-white cursor-pointer hover:bg-slate-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all"
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
                        <table className="w-full text-left font-mono text-xs">
                            <thead className="bg-slate-100 border-b-2 border-black font-black uppercase text-black">
                                <tr>
                                    <th className="p-4">Sent At</th>
                                    <th className="p-4">Type</th>
                                    <th className="p-4">Recipient</th>
                                    <th className="p-4">Subject</th>
                                    <th className="p-4 text-center">Status</th>
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
                                            <p className="font-black text-slate-400 uppercase tracking-tighter text-lg">No emails sent yet</p>
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
                                            <tr key={log.id} className="hover:bg-slate-50 transition-colors group">
                                                <td className="p-4 whitespace-nowrap">
                                                    <div className="font-bold text-black">
                                                        {new Date(log.sentAt).toLocaleDateString()}
                                                    </div>
                                                    <div className="text-[10px] text-slate-500">
                                                        {new Date(log.sentAt).toLocaleTimeString()}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-2.5 h-2.5 rounded-full ${typeColors[log.alertType] || 'bg-slate-400'} border border-black`} />
                                                        <span className="font-bold uppercase text-black">
                                                            {typeLabels[log.alertType] || log.alertType}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="font-bold text-black">
                                                        {log.recipientName || log.recipientEmail}
                                                    </div>
                                                    {log.recipientName && (
                                                        <div className="text-[10px] text-slate-500">{log.recipientEmail}</div>
                                                    )}
                                                </td>
                                                <td className="p-4 max-w-xs">
                                                    <div className="font-bold text-black truncate" title={log.subject}>
                                                        {log.subject}
                                                    </div>
                                                    {log.issueId && (
                                                        <Link 
                                                            to={`/issues/${log.issueId}`}
                                                            className="text-[10px] text-indigo-600 hover:underline font-bold uppercase"
                                                        >
                                                            View Issue →
                                                        </Link>
                                                    )}
                                                </td>
                                                <td className="p-4 text-center">
                                                    {log.status === 'sent' ? (
                                                        <NeoBadge variant="success" size="sm" className="border border-black">
                                                            Sent
                                                        </NeoBadge>
                                                    ) : log.status === 'failed' ? (
                                                        <span title={log.errorMessage || 'Email delivery failed'}>
                                                            <NeoBadge variant="danger" size="sm" className="border border-black">
                                                                Failed
                                                            </NeoBadge>
                                                        </span>
                                                    ) : (
                                                        <NeoBadge variant="warning" size="sm" className="border border-black">
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
                        <div className="px-6 py-4 border-t-2 border-black bg-slate-50 flex items-center justify-between">
                            <div className="text-xs font-bold text-slate-500 uppercase">
                                Page {emailLogPagination.page} of {emailLogPagination.totalPages} • {emailLogPagination.total} total emails
                            </div>
                            <div className="flex items-center gap-2">
                                <NeoButton
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => loadEmailLogs(emailLogPagination.page - 1)}
                                    disabled={emailLogPagination.page <= 1}
                                    leftIcon={<ChevronLeft className="w-4 h-4" />}
                                >
                                    Prev
                                </NeoButton>
                                <NeoButton
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => loadEmailLogs(emailLogPagination.page + 1)}
                                    disabled={emailLogPagination.page >= emailLogPagination.totalPages}
                                    rightIcon={<ChevronRight className="w-4 h-4" />}
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
