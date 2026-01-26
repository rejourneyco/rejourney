import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useSessionData } from '../../context/SessionContext';
import { usePathPrefix } from '../../hooks/usePathPrefix';
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
    ExternalLink
} from 'lucide-react';
import { api, IssueDetail as IssueDetailType } from '../../services/api';
import { IssueSession } from '../../types';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { MiniSessionCard } from '../../components/ui/MiniSessionCard';
import { formatLastSeen } from '../../utils/formatDates';

export const IssueDetail: React.FC = () => {
    const { issueId } = useParams<{ issueId: string }>();
    const { projects } = useSessionData();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();

    const [issue, setIssue] = useState<IssueDetailType | null>(null);
    const [sessions, setSessions] = useState<IssueSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const currentProject = issue ? projects.find(p => p.id === issue.projectId) : null;

    useEffect(() => {
        if (!issueId) return;

        const fetchIssue = async () => {
            setLoading(true);
            try {
                const [issueData, sessionsData] = await Promise.all([
                    api.getIssue(issueId),
                    api.getIssueSessions(issueId, 6)
                ]);
                setIssue(issueData);
                setSessions(sessionsData.sessions || []);
            } catch (err: any) {
                console.error("Failed to load issue details:", err);
                setError("Failed to load issue details. It might be deleted or you don't have access.");
            } finally {
                setLoading(false);
            }
        };

        fetchIssue();
    }, [issueId]);

    const handleCopyStack = () => {
        const stackText = issue?.sampleStackTrace || '';
        navigator.clipboard.writeText(stackText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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
            case 'error': return 'bg-amber-500';
            case 'crash': return 'bg-red-500';
            case 'anr': return 'bg-purple-500';
            case 'rage_tap': return 'bg-pink-500';
            default: return 'bg-slate-500';
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <div className="text-2xl font-black uppercase animate-pulse">Loading Issue...</div>
            </div>
        );
    }

    if (error || !issue) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6">
                <AlertTriangle className="w-16 h-16 text-red-500" />
                <div className="text-xl font-black text-red-600 uppercase">{error || 'Issue not found'}</div>
                <NeoButton onClick={() => navigate(`${pathPrefix}/issues`)}>
                    <ArrowLeft size={16} className="mr-2" /> Back to Issues
                </NeoButton>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6 md:p-12 font-sans">
            <div className="max-w-[1800px] mx-auto space-y-8">
                {/* Navigation */}
                <button
                    onClick={() => navigate(`${pathPrefix}/issues`)}
                    className="flex items-center gap-2 text-sm font-black uppercase text-slate-500 hover:text-black transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to Issues
                </button>

                {/* Header */}
                <div className="bg-white border-2 border-black p-8 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex items-start gap-6">
                            <div className={`w-16 h-16 ${getIssueTypeColor(issue.issueType)} text-white border-2 border-black flex items-center justify-center shrink-0 shadow-[4px_4px_0_0_rgba(0,0,0,1)]`}>
                                {getIssueTypeIcon(issue.issueType)}
                            </div>
                            <div>
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                    <h1 className="text-3xl md:text-4xl font-black uppercase text-slate-900 tracking-tight leading-none">
                                        {issue.title}
                                    </h1>
                                    <NeoBadge variant={issue.status === 'resolved' ? 'success' : issue.status === 'ongoing' ? 'warning' : 'danger'}>
                                        {issue.status}
                                    </NeoBadge>
                                </div>
                                {issue.subtitle && (
                                    <p className="text-lg md:text-xl font-bold text-slate-600 font-mono border-l-4 border-slate-200 pl-4 py-1">
                                        {issue.subtitle}
                                    </p>
                                )}
                                {issue.shortId && (
                                    <p className="text-sm font-mono text-slate-500 mt-2">{issue.shortId}</p>
                                )}
                            </div>
                        </div>

                        {issue.sampleSessionId && (
                            <div className="flex flex-col items-end gap-3 shrink-0">
                                <button
                                    onClick={() => navigate(`${pathPrefix}/sessions/${issue.sampleSessionId}`)}
                                    className="flex items-center gap-2 px-6 py-3 bg-black text-white font-black uppercase hover:bg-slate-800 transition-colors shadow-[4px_4px_0_0_rgba(200,200,200,1)] hover:shadow-[4px_4px_0_0_rgba(0,0,0,0)] hover:translate-x-[2px] hover:translate-y-[2px]"
                                >
                                    <Play className="w-4 h-4" /> Replay Session
                                </button>
                            </div>
                        )}
                    </div>
                </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <NeoCard variant="flat" className="p-4 border-2 border-black">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                        <Activity size={14} />
                        <span className="text-xs font-bold uppercase">Events</span>
                    </div>
                    <div className="text-2xl font-black">{issue.eventCount.toLocaleString()}</div>
                </NeoCard>

                <NeoCard variant="flat" className="p-4 border-2 border-black">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                        <Users size={14} />
                        <span className="text-xs font-bold uppercase">Users</span>
                    </div>
                    <div className="text-2xl font-black">{issue.userCount.toLocaleString()}</div>
                </NeoCard>

                <NeoCard variant="flat" className="p-4 border-2 border-black">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                        <Calendar size={14} />
                        <span className="text-xs font-bold uppercase">First Seen</span>
                    </div>
                    <div className="text-sm font-bold">{new Date(issue.firstSeen).toLocaleDateString()}</div>
                </NeoCard>

                <NeoCard variant="flat" className="p-4 border-2 border-black">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                        <Clock size={14} />
                        <span className="text-xs font-bold uppercase">Last Seen</span>
                    </div>
                    <div className="text-sm font-bold">{formatLastSeen(issue.lastSeen)}</div>
                </NeoCard>
            </div>

            {/* Stack Trace - Prominent Display for Crash/Error/ANR */}
            {(issue.issueType === 'crash' || issue.issueType === 'error' || issue.issueType === 'anr') && issue.sampleStackTrace && (
                <div className="mb-8">
                    <div className="bg-white border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] p-6">
                        <div className="flex items-center justify-between mb-4 border-b-2 border-slate-100 pb-4">
                            <div className="flex items-center gap-2">
                                <Activity className="w-5 h-5 text-black" />
                                <h2 className="text-xl font-black uppercase text-slate-900">
                                    {issue.issueType === 'anr' ? 'Main Thread State' : 'Stack Trace'}
                                </h2>
                            </div>
                            <button
                                onClick={handleCopyStack}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs font-black uppercase border-2 border-slate-200 hover:border-black hover:bg-slate-50 transition-all"
                            >
                                {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                                {copied ? 'Copied to Clipboard' : 'Copy Trace'}
                            </button>
                        </div>

                        <div className="bg-slate-900 text-green-400 p-6 font-mono text-xs overflow-x-auto whitespace-pre border-2 border-black shadow-inner min-h-[400px] leading-relaxed">
                            {issue.sampleStackTrace || "No stack trace available for this issue."}
                        </div>

                        <div className={`mt-4 p-4 border-2 text-sm font-bold flex items-start gap-3 ${
                            issue.issueType === 'crash' ? 'bg-amber-50 border-amber-200 text-amber-900' :
                            issue.issueType === 'error' ? 'bg-amber-50 border-amber-200 text-amber-900' :
                            'bg-purple-50 border-purple-200 text-purple-900'
                        }`}>
                            <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" />
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column - Details */}
                <div className="space-y-6">
                    {/* Affected Devices & Versions */}
                    <NeoCard variant="flat" className="p-6 border-2 border-black">
                        <h3 className="text-sm font-black uppercase tracking-wider mb-4">Diagnostic Context</h3>

                        <div className="grid grid-cols-2 gap-6">
                            {/* Affected Devices */}
                            <div>
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Affected Devices</h4>
                                <div className="space-y-2">
                                    {issue.affectedDevices && Object.keys(issue.affectedDevices).length > 0 ? (
                                        Object.entries(issue.affectedDevices)
                                            .sort(([, a], [, b]) => b - a)
                                            .slice(0, 5)
                                            .map(([device, count]) => (
                                                <div key={device} className="flex justify-between items-center text-sm">
                                                    <span className="font-medium truncate max-w-[120px]">{device}</span>
                                                    <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 border border-black">{count}</span>
                                                </div>
                                            ))
                                    ) : (
                                        <span className="text-xs text-slate-400">No device data</span>
                                    )}
                                </div>
                            </div>

                            {/* Affected Versions */}
                            <div>
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Affected Versions</h4>
                                <div className="space-y-2">
                                    {issue.affectedVersions && Object.keys(issue.affectedVersions).length > 0 ? (
                                        Object.entries(issue.affectedVersions)
                                            .sort(([, a], [, b]) => b - a)
                                            .slice(0, 5)
                                            .map(([version, count]) => (
                                                <div key={version} className="flex justify-between items-center text-sm">
                                                    <span className="font-medium">{version}</span>
                                                    <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 border border-black">{count}</span>
                                                </div>
                                            ))
                                    ) : (
                                        <span className="text-xs text-slate-400">No version data</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </NeoCard>

                    {/* Sample Device Info */}
                    {(issue.sampleDeviceModel || issue.sampleOsVersion || issue.sampleAppVersion) && (
                        <NeoCard variant="flat" className="p-6 border-2 border-black">
                            <h3 className="text-sm font-black uppercase tracking-wider mb-4">Sample Device</h3>
                            <div className="flex items-center gap-3">
                                <Smartphone size={24} className="text-slate-400" />
                                <div>
                                    <p className="font-bold">{issue.sampleDeviceModel || 'Unknown Device'}</p>
                                    <p className="text-sm text-slate-500">
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
                    <NeoCard variant="flat" className="p-6 border-2 border-black">
                        <h3 className="text-sm font-black uppercase tracking-wider mb-4">Related Sessions</h3>

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
                            <div className="text-center py-8 text-slate-400">
                                <Play size={32} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm font-bold">No sessions available</p>
                            </div>
                        )}
                    </NeoCard>

                    {/* Recent Events */}
                    {issue.recentEvents && issue.recentEvents.length > 0 && (
                        <NeoCard variant="flat" className="p-6 border-2 border-black">
                            <h3 className="text-sm font-black uppercase tracking-wider mb-4">Recent Occurrences</h3>

                            <div className="space-y-3 max-h-96 overflow-y-auto">
                                {issue.recentEvents.map((event) => (
                                    <div
                                        key={event.id}
                                        className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono text-slate-500">
                                                    {new Date(event.timestamp).toLocaleString()}
                                                </span>
                                                {event.deviceModel && (
                                                    <span className="text-xs font-bold text-slate-600">
                                                        {event.deviceModel}
                                                    </span>
                                                )}
                                            </div>
                                            {event.screenName && (
                                                <p className="text-sm text-slate-600 truncate">
                                                    on {event.screenName}
                                                </p>
                                            )}
                                        </div>
                                        {event.sessionId && (
                                            <button
                                                onClick={() => navigate(`${pathPrefix}/sessions/${event.sessionId}`)}
                                                className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800"
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
