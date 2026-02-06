import React, { useState, useMemo, useEffect } from 'react';
import { useSessionData } from '../../context/SessionContext';
import {
    AlertOctagon,
    ChevronDown,
    ChevronUp,
    Smartphone,
    Play,
    Search,
    Bug,
    AlertTriangle,
    ArrowRight,
    ExternalLink,
    Activity,
    Sparkles,
    ChevronRight,
    Loader
} from 'lucide-react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { ModernPhoneFrame } from '../../components/ui/ModernPhoneFrame';
import { MiniSessionCard } from '../../components/ui/MiniSessionCard';
import { formatLastSeen, formatAge } from '../../utils/formatDates';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { api } from '../../services/api';

export const CrashesList: React.FC = () => {
    const { sessions, isLoading, selectedProject } = useSessionData();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();

    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [searchQuery, setSearchQuery] = useState('');
    const [crashDetails, setCrashDetails] = useState<Record<string, any>>({});


    // Filter sessions by selected project
    const projectSessions = useMemo(() => {
        if (!selectedProject?.id) return sessions;
        return sessions.filter(s => (s as any).projectId === selectedProject.id || (s as any).appId === selectedProject.id);
    }, [sessions, selectedProject?.id]);

    // Filter sessions by time range
    const filteredSessions = useMemo(() => {
        if (timeRange === 'all') return projectSessions;
        const now = new Date();
        const cutoff = new Date();
        let days: number;
        switch (timeRange) {
            case '24h': days = 1; break;
            case '7d': days = 7; break;
            case '30d': days = 30; break;
            case '90d': days = 90; break;
            default: days = 30;
        }
        cutoff.setDate(now.getDate() - days);
        return projectSessions.filter(s => new Date(s.startedAt) >= cutoff);
    }, [projectSessions, timeRange]);

    // Scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const crashGroups = useMemo(() => {
        const groups: Record<string, {
            name: string;
            count: number;
            users: Set<string>;
            firstSeen: string;
            lastOccurred: string;
            affectedDevices: Record<string, number>;
            affectedVersions: Record<string, number>;
            sampleSessionId: string;
            sampleCrashId?: string;
        }> = {};

        filteredSessions.forEach(s => {
            if ((s.crashCount || 0) > 0) {
                const lastScreen = (s.screensVisited && s.screensVisited.length > 0)
                    ? s.screensVisited[s.screensVisited.length - 1]
                    : 'Unknown Screen';
                const crashName = `Crash in ${lastScreen}`;
                const key = crashName;

                if (!groups[key]) {
                    groups[key] = {
                        name: crashName,
                        count: 0,
                        users: new Set(),
                        firstSeen: s.startedAt,
                        lastOccurred: s.startedAt,
                        affectedDevices: {},
                        affectedVersions: {},
                        sampleSessionId: s.id
                    };
                }

                const group = groups[key];
                group.count += s.crashCount || 1;
                group.users.add(s.userId || s.deviceId || s.id);

                if (new Date(s.startedAt) > new Date(group.lastOccurred)) {
                    group.lastOccurred = s.startedAt;
                    group.sampleSessionId = s.id;
                }
                if (new Date(s.startedAt) < new Date(group.firstSeen)) {
                    group.firstSeen = s.startedAt;
                }

                const device = s.deviceModel || 'Unknown';
                group.affectedDevices[device] = (group.affectedDevices[device] || 0) + 1;

                const version = s.appVersion || 'Unknown';
                group.affectedVersions[version] = (group.affectedVersions[version] || 0) + 1;
            }
        });

        return Object.values(groups).sort((a, b) => b.count - a.count);
    }, [filteredSessions]);

    // Filter crash groups by search query
    const filteredCrashGroups = useMemo(() => {
        if (!searchQuery.trim()) return crashGroups;
        const query = searchQuery.toLowerCase();
        return crashGroups.filter(group =>
            group.name.toLowerCase().includes(query) ||
            Object.keys(group.affectedDevices).some(d => d.toLowerCase().includes(query)) ||
            Object.keys(group.affectedVersions).some(v => v.toLowerCase().includes(query))
        );
    }, [crashGroups, searchQuery]);

    // Handle Deep Linking (focusId)
    const focusId = searchParams.get('focusId');
    useEffect(() => {
        if (focusId && !isLoading && crashGroups.length > 0) {
            // Find group by name (assuming focusId is the title)
            const targetGroup = crashGroups.find(g => g.name === focusId);
            if (targetGroup) {
                setExpandedGroup(targetGroup.name);
                setTimeout(() => {
                    const el = document.getElementById(`crash-group-${targetGroup.name}`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 100);
            }
        }
    }, [focusId, isLoading, crashGroups]);

    // Fetch crash details when a group is expanded
    useEffect(() => {
        if (!expandedGroup || !selectedProject?.id) return;

        const group = crashGroups.find(g => g.name === expandedGroup);
        if (!group || crashDetails[expandedGroup]) return;

        // Fetch crashes for this project to find the one matching our sample session
        const fetchCrashForGroup = async () => {
            try {
                const { crashes } = await api.getCrashes(selectedProject.id, 1, 100);
                // Find crash from the sample session
                const matchingCrash = crashes.find((c: any) => c.sessionId === group.sampleSessionId);
                if (matchingCrash) {
                    // Fetch full details including stack trace
                    const fullCrash = await api.getCrash(selectedProject.id, matchingCrash.id);
                    setCrashDetails(prev => ({ ...prev, [expandedGroup]: fullCrash }));
                }
            } catch (err) {
                console.error('Failed to fetch crash details:', err);
            }
        };

        fetchCrashForGroup();
    }, [expandedGroup, selectedProject?.id, crashGroups, crashDetails]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-white">
                <div className="text-2xl font-black uppercase tracking-tighter animate-pulse">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white flex flex-col font-sans text-black">
            {/* Neo Header */}
            <div className="sticky top-0 z-50 bg-white border-b-4 border-black">
                <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-[1800px] mx-auto w-full">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-red-500 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg">
                            <Bug className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                                Crash Reports
                            </h1>
                            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                <div className="h-3 w-1 bg-red-500"></div>
                                Critical failures & runtime exceptions
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Search */}
                        <div className="relative max-w-xs w-full hidden md:block group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black group-focus-within:text-red-600 transition-colors" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="SEARCH CRASHES..."
                                className="w-full pl-10 pr-4 py-2 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-lg font-bold text-sm uppercase placeholder:text-slate-400 focus:outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all"
                            />
                        </div>
                        <TimeFilter value={timeRange} onChange={setTimeRange} />
                    </div>
                </div>
            </div>

            {/* Feed */}
            <div className="flex-1 max-w-full mx-auto w-full">
                {/* Table Header */}
                <div className="sticky top-[73px] z-40 bg-white border-b-2 border-black px-6">
                    <div className="flex items-center py-2 text-[10px] font-black text-black uppercase tracking-wider gap-4">
                        <div className="w-8 flex-shrink-0"></div>
                        <div className="flex-1 min-w-0">Issue</div>
                        <div className="hidden md:block w-20 text-right">Last Seen</div>
                        <div className="hidden md:block w-16 text-right">Age</div>
                        <div className="w-16 text-right">Events</div>
                        <div className="w-16 text-right">Users</div>
                        <div className="w-10"></div>
                    </div>
                </div>

                <div className="bg-white">
                    {filteredCrashGroups.length === 0 && !isLoading && (
                        <div className="py-16 text-center text-slate-400">
                            <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-bold">No crashes detected</p>
                            <p className="text-sm">Your application appears stable for this time period</p>
                        </div>
                    )}

                    {filteredCrashGroups.map((group) => {
                        const isExpanded = expandedGroup === group.name;

                        return (
                            <div
                                key={group.name}
                                id={`crash-group-${group.name}`}
                                className={`border-b border-slate-100 transition-all ${isExpanded ? 'bg-slate-50/50' : 'hover:bg-slate-50/50'}`}
                            >
                                {/* Row */}
                                <div
                                    className="flex items-center py-4 px-6 gap-4 cursor-pointer group/row transition-colors"
                                    onClick={() => setExpandedGroup(isExpanded ? null : group.name)}
                                >
                                    {/* Status Dot */}
                                    <div className="w-8 flex-shrink-0 flex justify-center">
                                        <div className={`w-3 h-3 border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${isExpanded ? 'bg-red-500' : 'bg-red-500'}`} />
                                    </div>

                                    {/* Issue Info */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-black text-sm text-black truncate mb-1">
                                            {group.name}
                                        </h3>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                                            Affecting {Object.keys(group.affectedDevices).length} Device Models
                                        </div>
                                    </div>

                                    {/* Last Seen */}
                                    <div className="hidden md:block w-20 text-right group-hover/row:translate-x-[-4px] transition-transform">
                                        <span className="text-xs font-bold text-black">{formatLastSeen(group.lastOccurred)}</span>
                                    </div>

                                    {/* Age */}
                                    <div className="hidden md:block w-16 text-right">
                                        <span className="text-xs font-bold text-slate-500">{formatAge(group.firstSeen)}</span>
                                    </div>

                                    {/* Events */}
                                    <div className="w-16 text-right">
                                        <span className="text-sm font-black text-black font-mono bg-red-100 border border-red-300 px-1 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                            {group.count >= 1000 ? (group.count / 1000).toFixed(1) + 'k' : group.count}
                                        </span>
                                    </div>

                                    {/* Users */}
                                    <div className="w-16 text-right">
                                        <span className="text-sm font-black text-black font-mono bg-indigo-100 border border-indigo-300 px-1 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                            {group.users.size >= 1000 ? (group.users.size / 1000).toFixed(1) + 'k' : group.users.size}
                                        </span>
                                    </div>

                                    {/* Expand Toggle */}
                                    <div className="w-10 flex justify-end">
                                        <div className={`w-8 h-8 flex items-center justify-center border-2 border-transparent transition-all ${isExpanded ? 'bg-black text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] rotate-180' : 'text-slate-400 group-hover/row:border-black group-hover/row:bg-white group-hover/row:text-black group-hover/row:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                            }`}>
                                            <ChevronDown size={16} />
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Section */}
                                {isExpanded && (
                                    <div className="px-6 py-8 bg-slate-50/80 border-t border-slate-100">
                                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">

                                            {/* LEFT: Stack Trace & Details */}
                                            <div className="lg:col-span-8 space-y-6">
                                                <div>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h4 className="text-[10px] font-black text-black uppercase tracking-widest flex items-center gap-2">
                                                            <Activity size={12} className="text-red-500" /> Stack Trace Preview
                                                        </h4>
                                                    </div>

                                                    <NeoCard variant="flat" className="p-0 overflow-hidden !bg-slate-900 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                                        {!crashDetails[group.name] ? (
                                                            <div className="p-8 text-center text-slate-500">
                                                                <Loader size={24} className="animate-spin mx-auto mb-2" />
                                                                Loading preview...
                                                            </div>
                                                        ) : crashDetails[group.name]?.stackTrace ? (
                                                            <div className="p-6 font-mono text-xs text-green-400 overflow-x-auto whitespace-pre leading-relaxed">
                                                                {crashDetails[group.name].stackTrace.split('\n').slice(0, 10).join('\n')}
                                                                {crashDetails[group.name].stackTrace.split('\n').length > 10 && (
                                                                    <div className="mt-4 pt-4 border-t border-slate-700 text-slate-500 text-[10px] italic">
                                                                        ... clipping for preview ...
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="p-8 text-center text-slate-500">
                                                                No stack trace captured.
                                                            </div>
                                                        )}
                                                    </NeoCard>

                                                    <div className="mt-4">
                                                        <NeoButton
                                                            variant="primary"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (crashDetails[group.name]) {
                                                                    navigate(`${pathPrefix}/stability/crashes/${selectedProject?.id}/${crashDetails[group.name].id}`);
                                                                }
                                                            }}
                                                            rightIcon={<ChevronRight size={14} />}
                                                        >
                                                            Analyze Root Cause
                                                        </NeoButton>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">First Seen</div>
                                                        <div className="text-sm font-black text-black">{new Date(group.firstSeen).toLocaleDateString()}</div>
                                                    </div>
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Last Seen</div>
                                                        <div className="text-sm font-black text-black">{formatLastSeen(group.lastOccurred)}</div>
                                                    </div>
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Environment</div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <NeoBadge variant="neutral" size="sm">{Object.keys(group.affectedDevices)[0] || 'Unknown'}</NeoBadge>
                                                            <NeoBadge variant="info" size="sm">v{Object.keys(group.affectedVersions)[0] || '?'}</NeoBadge>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* RIGHT: Visual Context */}
                                            <div className="lg:col-span-4 space-y-6">
                                                <div>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h4 className="text-[10px] font-black text-black uppercase tracking-widest flex items-center gap-2">
                                                            <Play size={12} className="text-indigo-500" /> Evidence Sample
                                                        </h4>
                                                    </div>

                                                    <NeoCard variant="flat" className="flex justify-center items-center py-6 bg-slate-100 border-2 border-black !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="transform hover:scale-105 transition-transform duration-500">
                                                            <MiniSessionCard
                                                                session={{
                                                                    id: group.sampleSessionId,
                                                                    deviceModel: Object.keys(group.affectedDevices)[0] || 'Sample Device',
                                                                    createdAt: group.lastOccurred
                                                                }}
                                                                onClick={() => navigate(`${pathPrefix}/sessions/${group.sampleSessionId}`)}
                                                            />
                                                        </div>
                                                    </NeoCard>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default CrashesList;
