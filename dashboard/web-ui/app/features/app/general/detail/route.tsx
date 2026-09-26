import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import {
    ArrowLeft,
    Play,
    Smartphone,
    Copy,
    Check,
    AlertTriangle,
    AlertOctagon,
    Zap,
    Bug,
    Activity,
    Clock,
    Users,
    Calendar,
    ChevronRight,
    ExternalLink,
    Download,
    Info,
    Loader2
} from 'lucide-react';
import { PageHeader } from '~/shell/components/layout/PageHeader';
import { api, IssueDetail as IssueDetailType } from '~/shared/api/client';
import { IssueSession } from '~/shared/types';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { dashboardButtonClass, dashboardChipClass } from '~/shared/ui/core/dashboardStyles';
import { MiniSessionCard } from '~/shared/ui/core/MiniSessionCard';
import { formatLastSeen } from '~/shared/lib/formatDates';
import { formatDeviceModel } from '~/shared/lib/deviceModelNames';

export const IssueDetail: React.FC = () => {
    const { issueId } = useParams<{ issueId: string }>();
    const { projects } = useSessionData();
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();

    const [issue, setIssue] = useState<IssueDetailType | null>(null);
    const [sessions, setSessions] = useState<IssueSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [partialError, setPartialError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const currentProject = issue ? projects.find(p => p.id === issue.projectId) : null;

    useEffect(() => {
        if (!issueId) return;

        const fetchIssue = async () => {
            setLoading(true);
            setError(null);
            setPartialError(null);
            try {
                const [issueData, sessionsData] = await Promise.allSettled([
                    api.getIssue(issueId),
                    api.getIssueSessions(issueId, 6)
                ]);

                if (issueData.status === 'fulfilled') {
                    setIssue(issueData.value);
                } else {
                    console.error("Failed to load issue details:", issueData.reason);
                    setIssue(null);
                    setSessions([]);
                    setError("Failed to load issue details. It might be deleted or you don't have access.");
                    return;
                }

                if (sessionsData.status === 'fulfilled') {
                    setSessions(sessionsData.value.sessions || []);
                } else {
                    setSessions([]);
                    setPartialError('Related sessions could not be loaded. Core issue details are still available.');
                }
            } catch (err: unknown) {
                console.error("Failed to load issue details:", err);
                setIssue(null);
                setSessions([]);
                setError("Failed to load issue details. It might be deleted or you don't have access.");
            } finally {
                setLoading(false);
            }
        };

        fetchIssue();
    }, [issueId, manualRefreshVersion]);

    const handleCopyStack = () => {
        const stackText = issue?.sampleStackTrace || '';
        navigator.clipboard.writeText(stackText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownloadStack = () => {
        const stackText = issue?.sampleStackTrace || '';
        const blob = new Blob([stackText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `issue-trace-${issue?.id || 'unknown'}-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getIssueTypeIcon = (type: string) => {
        switch (type) {
            case 'error': return <Bug className="w-8 h-8" />;
            case 'crash': return <AlertOctagon className="w-8 h-8" />;
            case 'anr': return <Clock className="w-8 h-8" />;
            case 'rage_tap': return <Activity className="w-8 h-8" />;
            default: return <AlertTriangle className="w-8 h-8" />;
        }
    };

    const getIssueTypeLabel = (type: string) => {
        switch (type) {
            case 'error': return 'Error';
            case 'crash': return 'Crash';
            case 'anr': return 'ANR';
            case 'rage_tap': return 'Rage Tap';
            case 'api_latency': return 'API Latency';
            case 'ux_friction': return 'UX Friction';
            case 'performance': return 'Performance';
            default: return type;
        }
    };

    const getIssueTypeColor = (type: string) => {
        switch (type) {
            case 'error': return 'bg-rose-500';
            case 'crash': return 'bg-red-500';
            case 'anr': return 'bg-purple-500';
            case 'rage_tap': return 'bg-pink-500';
            default: return 'bg-slate-500';
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center">
                <div className="flex items-center gap-2 text-sm text-[#5f6368]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading issue...
                </div>
            </div>
        );
    }

    if (error || !issue) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4">
                <div className="flex max-w-lg items-start gap-2 border border-[#f6aea9] bg-[#fce8e6] px-4 py-3 text-sm text-[#a50e0e]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error || 'Issue not found'}
                </div>
                <NeoButton variant="secondary" onClick={() => navigate(`${pathPrefix}/general`)} leftIcon={<ArrowLeft />}>
                    Back to General
                </NeoButton>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 font-sans sm:p-6">
            <div className="max-w-[1800px] mx-auto space-y-6">
                {/* Navigation */}
                <button
                    onClick={() => navigate(`${pathPrefix}/general`)}
                    className="inline-flex items-center gap-2 text-sm font-medium text-[#5f6368] transition-colors hover:text-[#202124]"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to General
                </button>
                {/* Header */}
                <PageHeader
                    icon={
                        issue.issueType === 'error' ? Bug :
                            issue.issueType === 'crash' ? AlertOctagon :
                                issue.issueType === 'anr' ? Clock :
                                    issue.issueType === 'rage_tap' ? Activity :
                                        AlertTriangle
                    }
                    title={issue.title}
                    subtitle={issue.subtitle || issue.shortId || undefined}
                    badge={{
                        label: issue.status,
                        variant: issue.status === 'resolved' ? 'success' : issue.status === 'ongoing' ? 'warning' : 'danger'
                    }}
                    actions={
                        issue.sampleSessionId && (
                            <button
                                onClick={() => navigate(`${pathPrefix}/sessions/${issue.sampleSessionId}`)}
                                className={dashboardButtonClass('primary', 'md')}
                            >
                                <Play className="w-4 h-4" /> Replay session
                            </button>
                        )
                    }
                    iconClassName={
                        issue.issueType === 'error' ? 'text-rose-500' :
                            issue.issueType === 'crash' ? 'text-red-500' :
                                issue.issueType === 'anr' ? 'text-purple-500' :
                                    issue.issueType === 'rage_tap' ? 'text-pink-500' :
                                        'text-slate-500'
                    }
                />

                {partialError && (
                    <div className="border border-[#f6aea9] bg-[#fce8e6] px-4 py-3 text-sm text-[#a50e0e]">
                        {partialError}
                    </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <NeoCard variant="flat" disablePadding className="p-4">
                        <div className="mb-2 flex items-center gap-2 text-[#5f6368]">
                            <Activity size={14} />
                            <span className="text-xs font-medium">Events</span>
                        </div>
                        <div className="text-2xl font-normal tabular-nums text-[#202124]">{issue.eventCount.toLocaleString()}</div>
                    </NeoCard>

                    <NeoCard variant="flat" disablePadding className="p-4">
                        <div className="mb-2 flex items-center gap-2 text-[#5f6368]">
                            <Users size={14} />
                            <span className="text-xs font-medium">Users</span>
                        </div>
                        <div className="text-2xl font-normal tabular-nums text-[#202124]">{issue.userCount.toLocaleString()}</div>
                    </NeoCard>

                    <NeoCard variant="flat" disablePadding className="p-4">
                        <div className="mb-2 flex items-center gap-2 text-[#5f6368]">
                            <Calendar size={14} />
                            <span className="text-xs font-medium">First seen</span>
                        </div>
                        <div className="text-sm font-medium tabular-nums text-[#202124]">{new Date(issue.firstSeen).toLocaleDateString()}</div>
                    </NeoCard>

                    <NeoCard variant="flat" disablePadding className="p-4">
                        <div className="mb-2 flex items-center gap-2 text-[#5f6368]">
                            <Clock size={14} />
                            <span className="text-xs font-medium">Last seen</span>
                        </div>
                        <div className="text-sm font-medium text-[#202124]">{formatLastSeen(issue.lastSeen)}</div>
                    </NeoCard>
                </div>

                {/* Stack Trace - Prominent Display for Crash/Error/ANR */}
                {(issue.issueType === 'crash' || issue.issueType === 'error' || issue.issueType === 'anr') && issue.sampleStackTrace && (
                    <div>
                        <div className="border border-[#dadce0] bg-white p-4 sm:p-6">
                            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[#e8eaed] pb-4">
                                <div className="mr-auto flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-[#5f6368]" />
                                    <h2 className="text-[15px] font-medium text-[#202124]">
                                        {issue.issueType === 'anr' ? 'Main thread state' : 'Stack trace'}
                                    </h2>
                                </div>
                                <button
                                    onClick={handleCopyStack}
                                    className={dashboardButtonClass('secondary', 'sm')}
                                >
                                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                    {copied ? 'Copied' : 'Copy trace'}
                                </button>
                                <button
                                    onClick={handleDownloadStack}
                                    className={dashboardButtonClass('secondary', 'sm')}
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Download trace
                                </button>
                            </div>

                            <div className="min-h-[400px] overflow-x-auto whitespace-pre border border-[#e8eaed] bg-[#f8fafd] p-4 font-mono text-xs leading-relaxed text-[#202124]">
                                {issue.sampleStackTrace || "No stack trace available for this issue."}
                            </div>

                            <div className="mt-4 flex items-start gap-3 border border-[#d2e3fc] bg-[#e8f0fe] p-4 text-sm text-[#1967d2]">
                                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                                <p>
                                    {issue.issueType === 'anr'
                                        ? 'This trace represents the state of the main thread when the freeze happened. Synchronous operations blocking the main thread will appear here.'
                                        : 'This stack trace shows the execution path at the moment of the crash. Highlighted frames indicate your application code.'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left Column - Details */}
                    <div className="space-y-6">
                        {/* Affected Devices & Versions */}
                        <NeoCard variant="flat">
                            <h3 className="mb-4 text-[15px] font-medium text-[#202124]">Diagnostic context</h3>

                            <div className="grid grid-cols-2 gap-6">
                                {/* Affected Devices */}
                                <div>
                                    <h4 className="mb-3 text-xs font-medium text-[#5f6368]">Affected devices</h4>
                                    <div className="space-y-2">
                                        {issue.affectedDevices && Object.keys(issue.affectedDevices).length > 0 ? (
                                            Object.entries(issue.affectedDevices)
                                                .sort(([, a], [, b]) => b - a)
                                                .slice(0, 5)
                                                .map(([device, count]) => (
                                                    <div key={device} className="flex items-center justify-between gap-2 text-sm">
                                                        <span className="max-w-[120px] truncate text-[#3c4043]">{device}</span>
                                                        <span className={`${dashboardChipClass('neutral')} tabular-nums`}>{count}</span>
                                                    </div>
                                                ))
                                        ) : (
                                            <span className="text-xs text-[#5f6368]">No device data</span>
                                        )}
                                    </div>
                                </div>

                                {/* Affected Versions */}
                                <div>
                                    <h4 className="mb-3 text-xs font-medium text-[#5f6368]">Affected versions</h4>
                                    <div className="space-y-2">
                                        {issue.affectedVersions && Object.keys(issue.affectedVersions).length > 0 ? (
                                            Object.entries(issue.affectedVersions)
                                                .sort(([, a], [, b]) => b - a)
                                                .slice(0, 5)
                                                .map(([version, count]) => (
                                                    <div key={version} className="flex items-center justify-between gap-2 text-sm">
                                                        <span className="text-[#3c4043]">{version}</span>
                                                        <span className={`${dashboardChipClass('neutral')} tabular-nums`}>{count}</span>
                                                    </div>
                                                ))
                                        ) : (
                                            <span className="text-xs text-[#5f6368]">No version data</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </NeoCard>

                        {/* Sample Device Info */}
                        {(issue.sampleDeviceModel || issue.sampleOsVersion || issue.sampleAppVersion) && (
                            <NeoCard variant="flat">
                                <h3 className="mb-4 text-[15px] font-medium text-[#202124]">Sample device</h3>
                                <div className="flex items-center gap-3">
                                    <Smartphone size={24} className="text-[#5f6368]" />
                                    <div>
                                        <p className="font-medium text-[#202124]" title={issue.sampleDeviceModel || undefined}>
                                            {formatDeviceModel(issue.sampleDeviceModel)}
                                        </p>
                                        <p className="text-sm text-[#5f6368]">
                                            {issue.sampleOsVersion && `OS ${issue.sampleOsVersion}`}
                                            {issue.sampleOsVersion && issue.sampleAppVersion && ' • '}
                                            {issue.sampleAppVersion && `App v${issue.sampleAppVersion}`}
                                        </p>
                                    </div>
                                </div>
                            </NeoCard>
                        )}
                    </div>

                    {/* Right Column - Sessions & Events */}
                    <div className="space-y-6">
                        {/* Related Sessions */}
                        <NeoCard variant="flat">
                            <h3 className="mb-4 text-[15px] font-medium text-[#202124]">Related sessions</h3>

                            {sessions.length > 0 ? (
                                <div className="flex gap-4 overflow-x-auto pb-4">
                                    {sessions.map((session) => (
                                        <MiniSessionCard
                                            key={session.id}
                                            session={session}
                                            onClick={() => navigate(`${pathPrefix}/sessions/${session.id}`)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="py-8 text-center text-[#5f6368]">
                                    <Play size={32} className="mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">No sessions available</p>
                                </div>
                            )}
                        </NeoCard>

                        {/* Recent Events */}
                        {issue.recentEvents && issue.recentEvents.length > 0 && (
                            <NeoCard variant="flat">
                                <h3 className="mb-4 text-[15px] font-medium text-[#202124]">Recent occurrences</h3>

                                <div className="space-y-3 max-h-96 overflow-y-auto">
                                    {issue.recentEvents.map((event) => (
                                        <div
                                            key={event.id}
                                            className="flex items-center justify-between border border-[#e8eaed] bg-white p-3 transition-colors hover:bg-[#f8fafd]"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs tabular-nums text-[#5f6368]">
                                                        {new Date(event.timestamp).toLocaleString()}
                                                    </span>
                                                    {event.deviceModel && (
                                                        <span className="text-xs font-medium text-[#3c4043]" title={event.deviceModel}>
                                                            {formatDeviceModel(event.deviceModel)}
                                                        </span>
                                                    )}
                                                </div>
                                                {event.screenName && (
                                                    <p className="truncate text-sm text-[#3c4043]">
                                                        on {event.screenName}
                                                    </p>
                                                )}
                                            </div>
                                            {event.sessionId && (
                                                <button
                                                    onClick={() => navigate(`${pathPrefix}/sessions/${event.sessionId}`)}
                                                    className="inline-flex items-center gap-1 text-xs font-medium text-[#1a73e8] hover:text-[#1765cc]"
                                                >
                                                    <Play size={12} fill="currentColor" /> View
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </NeoCard>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default IssueDetail;
