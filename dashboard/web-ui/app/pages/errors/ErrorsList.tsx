import React, { useState, useMemo, useEffect } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { useDemoMode } from '../../context/DemoModeContext';
import {
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    Search,
    Play,
    ExternalLink,
    ArrowRight,
    ChevronRight,
    Activity,
    Bug
} from 'lucide-react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { api, JSError } from '../../services/api';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { ModernPhoneFrame } from '../../components/ui/ModernPhoneFrame';
import { MiniSessionCard } from '../../components/ui/MiniSessionCard';
import { formatLastSeen, formatAge } from '../../utils/formatDates';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { StackTraceModal } from '../../components/ui/StackTraceModal';


interface ErrorGroup {
    fingerprint: string;
    errorName: string;
    message: string;
    count: number;
    users: Set<string>;
    firstSeen: string;
    lastOccurred: string;
    affectedDevices: Record<string, number>;
    affectedVersions: Record<string, number>;
    sampleError: JSError;
    screens: Set<string>;
}

export const ErrorsList: React.FC = () => {
    const { selectedProject, isLoading: contextLoading } = useSessionData();
    const { isDemoMode } = useDemoMode();
    const currentProject = selectedProject;
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();

    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [searchQuery, setSearchQuery] = useState('');

    const [errors, setErrors] = useState<JSError[]>([]);
    const [loading, setLoading] = useState(true);
    const [stackTraceModal, setStackTraceModal] = useState<{ isOpen: boolean; fingerprint: string | null }>({ isOpen: false, fingerprint: null });

    useEffect(() => {
        // In demo mode, we can call API with a dummy ID - the API service returns demo data
        if (!isDemoMode && !currentProject) return;

        const fetchErrors = async () => {
            setLoading(true);
            try {
                const data = await api.getErrors(currentProject?.id || 'demo');
                setErrors(data.errors || []);
            } catch (err) {
                console.error('Failed to fetch errors:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchErrors();
    }, [currentProject, isDemoMode]);

    // Scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    // Filter errors by time range
    const filteredErrors = useMemo(() => {
        if (timeRange === 'all') return errors;
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
        return errors.filter(e => new Date(e.timestamp) >= cutoff);
    }, [errors, timeRange]);

    // Group errors by fingerprint (errorName + message)
    const errorGroups = useMemo(() => {
        const groups: Record<string, ErrorGroup> = {};

        filteredErrors.forEach(error => {
            const fingerprint = `${error.errorName}:${error.message.slice(0, 100)}`;

            if (!groups[fingerprint]) {
                groups[fingerprint] = {
                    fingerprint,
                    errorName: error.errorName,
                    message: error.message,
                    count: 0,
                    users: new Set(),
                    firstSeen: error.timestamp,
                    lastOccurred: error.timestamp,
                    affectedDevices: {},
                    affectedVersions: {},
                    sampleError: error,
                    screens: new Set(),
                };
            }

            const group = groups[fingerprint];
            group.count++;
            group.users.add(error.sessionId || 'unknown');

            if (new Date(error.timestamp) > new Date(group.lastOccurred)) {
                group.lastOccurred = error.timestamp;
                group.sampleError = error;
            }
            if (new Date(error.timestamp) < new Date(group.firstSeen)) {
                group.firstSeen = error.timestamp;
            }

            const device = error.deviceModel || 'Unknown';
            group.affectedDevices[device] = (group.affectedDevices[device] || 0) + 1;

            const version = error.appVersion || 'Unknown';
            group.affectedVersions[version] = (group.affectedVersions[version] || 0) + 1;

            if (error.screenName) {
                group.screens.add(error.screenName);
            }
        });

        return Object.values(groups).sort((a, b) => b.count - a.count);
    }, [filteredErrors]);

    // Filter groups by search query
    const filteredGroups = useMemo(() => {
        if (!searchQuery.trim()) return errorGroups;
        const query = searchQuery.toLowerCase();
        return errorGroups.filter(group =>
            group.errorName.toLowerCase().includes(query) ||
            group.message.toLowerCase().includes(query) ||
            Array.from(group.screens).some(s => s.toLowerCase().includes(query))
        );
    }, [errorGroups, searchQuery]);

    // Handle Deep Linking (focusId)
    const focusId = searchParams.get('focusId');
    useEffect(() => {
        if (focusId && !loading && errorGroups.length > 0) {
            const targetGroup = errorGroups.find(g =>
                g.fingerprint === focusId ||
                g.errorName === focusId ||
                g.errorName.toLowerCase() === focusId.toLowerCase()
            );

            if (targetGroup) {
                setExpandedGroup(targetGroup.fingerprint);
                setTimeout(() => {
                    const el = document.getElementById(`error-group-${targetGroup.fingerprint}`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 100);
            }
        }
    }, [focusId, loading, errorGroups]);

    if (loading || contextLoading) {
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
                        <div className="p-3 bg-amber-500 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg">
                            <Bug className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                                Errors
                            </h1>
                            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                <div className="h-3 w-1 bg-amber-500"></div>
                                Caught exceptions & swallowed errors
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Search */}
                        <div className="relative max-w-xs w-full hidden md:block group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black group-focus-within:text-amber-600 transition-colors" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="SEARCH ERRORS..."
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
                <div className="sticky top-[90px] z-40 bg-white border-b-2 border-black px-6">
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
                    {filteredGroups.length === 0 && !loading && (
                        <div className="py-16 text-center text-slate-400">
                            <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-bold">No errors found</p>
                            <p className="text-sm">Errors will appear here when they are detected</p>
                        </div>
                    )}

                    {filteredGroups.map((group) => {
                        const isExpanded = expandedGroup === group.fingerprint;

                        return (
                            <div
                                key={group.fingerprint}
                                id={`error-group-${group.fingerprint}`}
                                className={`border-b border-slate-100 transition-all ${isExpanded ? 'bg-slate-50/50' : 'hover:bg-slate-50/50'}`}
                            >
                                {/* Row */}
                                <div
                                    className="flex items-center py-4 px-6 gap-4 cursor-pointer group/row transition-colors"
                                    onClick={() => setExpandedGroup(isExpanded ? null : group.fingerprint)}
                                >
                                    {/* Status Dot */}
                                    <div className="w-8 flex-shrink-0 flex justify-center">
                                        <div className={`w-3 h-3 border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${isExpanded ? 'bg-amber-500' : 'bg-amber-500'}`} />
                                    </div>

                                    {/* Issue Info */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-black text-sm text-black truncate mb-1">
                                            {group.errorName}
                                        </h3>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-tight truncate max-w-[600px]">
                                            {group.message}
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
                                        <span className="text-sm font-black text-black font-mono bg-amber-100 border border-amber-300 px-1 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
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
                                            <div className="lg:col-span-12 xl:col-span-8 space-y-8">
                                                <div>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                            <Activity size={12} className="text-amber-500" /> Stack Trace Preview
                                                        </h4>
                                                        <NeoButton
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigate(`${pathPrefix}/stability/errors/${currentProject?.id}/${group.sampleError.id}`);
                                                            }}
                                                        >
                                                            Full Resolution <ExternalLink size={10} className="ml-1" />
                                                        </NeoButton>
                                                    </div>

                                                    {group.sampleError.stack ? (
                                                        <NeoCard variant="flat" className="!bg-slate-900 border-2 border-black !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden group/stack p-0">
                                                            <div className="bg-slate-800/50 px-4 py-2 border-b-2 border-black flex justify-between items-center">
                                                                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Main Thread Snapshot</span>
                                                                <div className="flex gap-1.5">
                                                                    <div className="w-2 h-2 rounded-full bg-slate-700" />
                                                                    <div className="w-2 h-2 rounded-full bg-slate-700" />
                                                                    <div className="w-2 h-2 rounded-full bg-slate-700" />
                                                                </div>
                                                            </div>
                                                            <div className="p-5 font-mono text-[11px] text-slate-300 leading-relaxed overflow-x-auto whitespace-pre custom-scrollbar max-h-80">
                                                                {group.sampleError.stack.split('\n').slice(0, 12).join('\n')}
                                                                {group.sampleError.stack.split('\n').length > 12 && (
                                                                    <div className="mt-4 pt-4 border-t border-slate-800 text-slate-500 italic flex items-center justify-between">
                                                                        <span>... and {group.sampleError.stack.split('\n').length - 12} more lines</span>
                                                                        <NeoButton
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="text-amber-400 hover:text-amber-300 hover:bg-slate-800"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setStackTraceModal({ isOpen: true, fingerprint: group.fingerprint });
                                                                            }}
                                                                        >
                                                                            View Full Trace
                                                                        </NeoButton>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </NeoCard>
                                                    ) : (
                                                        <NeoCard variant="flat" className="p-8 bg-white border-2 border-black !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-center">
                                                            <div className="text-slate-500 mb-2 flex justify-center"><AlertTriangle size={32} /></div>
                                                            <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">No stack trace trace sample found for this issue.</p>
                                                        </NeoCard>
                                                    )}
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">First Seen</div>
                                                        <div className="text-sm font-black text-black">{new Date(group.firstSeen).toLocaleDateString()}</div>
                                                    </div>
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Last Seen</div>
                                                        <div className="text-sm font-black text-black">{formatLastSeen(group.lastOccurred)}</div>
                                                    </div>
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] md:col-span-2 lg:col-span-1">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Environment</div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <NeoBadge variant="neutral" size="sm">{Object.keys(group.affectedDevices)[0] || 'Unknown SDK'}</NeoBadge>
                                                            <NeoBadge variant="info" size="sm">v{Object.keys(group.affectedVersions)[0] || '?'}</NeoBadge>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* RIGHT: Visual Context */}
                                            <div className="lg:col-span-12 xl:col-span-4 space-y-8">
                                                <div>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                            <Play size={12} className="text-indigo-500" /> Evidence Sample
                                                        </h4>
                                                        <NeoButton
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (group.sampleError.sessionId) navigate(`${pathPrefix}/sessions/${group.sampleError.sessionId}`);
                                                            }}
                                                        >
                                                            Play Session <ChevronRight size={10} className="ml-1" />
                                                        </NeoButton>
                                                    </div>

                                                    <NeoCard variant="flat" className="flex justify-center items-center py-6 bg-slate-100 border-2 border-black !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="transform hover:scale-105 transition-transform duration-500">
                                                            <MiniSessionCard
                                                                session={{
                                                                    id: group.sampleError.sessionId || '',
                                                                    deviceModel: group.sampleError.deviceModel || undefined,
                                                                    createdAt: group.sampleError.timestamp
                                                                }}
                                                                onClick={() => group.sampleError.sessionId && navigate(`${pathPrefix}/sessions/${group.sampleError.sessionId}`)}
                                                            />
                                                        </div>
                                                    </NeoCard>
                                                </div>

                                                <NeoCard variant="flat" className="!bg-indigo-600 p-5 text-indigo-50 !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] border-2 border-black">
                                                    <h5 className="font-bold text-sm mb-2 uppercase tracking-wide">Impact Analysis</h5>
                                                    <p className="text-xs leading-relaxed text-indigo-100 mb-4">
                                                        This error occurred <span className="text-white font-bold">{group.count} times</span> across <span className="text-white font-bold">{group.users.size} users</span> in the selected timeframe.
                                                    </p>
                                                    <NeoButton
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => group.sampleError.sessionId && navigate(`${pathPrefix}/sessions/${group.sampleError.sessionId}`)}
                                                    >
                                                        Review Timeline <Play size={10} fill="currentColor" className="ml-1" />
                                                    </NeoButton>
                                                </NeoCard>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Stack Trace Modal */}
            {stackTraceModal.fingerprint && (() => {
                const group = errorGroups.find(g => g.fingerprint === stackTraceModal.fingerprint);
                if (!group?.sampleError?.stack) return null;
                return (
                    <StackTraceModal
                        isOpen={stackTraceModal.isOpen}
                        onClose={() => setStackTraceModal({ isOpen: false, fingerprint: null })}
                        title={group.errorName}
                        subtitle={group.message}
                        stackTrace={group.sampleError.stack}
                        issueType="error"
                        sessionId={group.sampleError.sessionId || undefined}
                        onViewReplay={() => {
                            if (group.sampleError.sessionId) {
                                navigate(`${pathPrefix}/sessions/${group.sampleError.sessionId}`);
                            }
                        }}
                    />
                );
            })()}
        </div>
    );
};

export default ErrorsList;
