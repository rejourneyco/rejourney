import React, { useState, useEffect, useMemo } from 'react';
import { useSessionData } from '../../context/SessionContext';
import { useDemoMode } from '../../context/DemoModeContext';
import {
    AlertOctagon,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    Smartphone,
    Play,
    Search,
    Clock,
    AlertTriangle,
    ExternalLink,
    Check,
    Copy,
    Activity
} from 'lucide-react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import { api, ANRRecord } from '../../services/api';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { ModernPhoneFrame } from '../../components/ui/ModernPhoneFrame';
import { MiniSessionCard } from '../../components/ui/MiniSessionCard';
import { formatLastSeen } from '../../utils/formatDates';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { StackTraceModal } from '../../components/ui/StackTraceModal';

export const ANRsList: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { isDemoMode } = useDemoMode();
    const currentProject = selectedProject;
    const navigate = useNavigate();
    const pathPrefix = usePathPrefix();
    const [searchParams] = useSearchParams();

    const [anrs, setAnrs] = useState<ANRRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedAnr, setExpandedAnr] = useState<string | null>(null);
    const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [stackTraceModal, setStackTraceModal] = useState<{ isOpen: boolean; anrId: string | null }>({ isOpen: false, anrId: null });

    useEffect(() => {
        const fetchAnrs = async () => {
            // In demo mode, we can call API with a dummy ID - the API service returns demo data
            if (!isDemoMode && !currentProject?.id) return;
            setIsLoading(true);
            try {
                const data = await api.getANRs(currentProject?.id || 'demo', { timeRange });
                setAnrs(data.anrs || []);
            } catch (error) {
                console.error('Failed to fetch ANRs:', error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchAnrs();
    }, [currentProject?.id, timeRange, isDemoMode]);

    // Scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    // Filter by search query
    const searchedAnrs = useMemo(() => {
        if (!searchQuery.trim()) return anrs;
        const query = searchQuery.toLowerCase();
        return anrs.filter(anr =>
            anr.threadState?.toLowerCase().includes(query) ||
            anr.deviceMetadata?.deviceModel?.toLowerCase().includes(query) ||
            anr.deviceMetadata?.appVersion?.toLowerCase().includes(query) ||
            anr.id.toLowerCase().includes(query)
        );
    }, [anrs, searchQuery]);

    // Handle Deep Linking with Retry
    const focusId = searchParams.get('focusId');
    useEffect(() => {
        if (!focusId || isLoading || anrs.length === 0) return;

        const targetAnr = anrs.find(a => a.id === focusId);
        if (!targetAnr) return;

        setExpandedAnr(targetAnr.id);

        // Retry logic to ensure DOM is ready
        let attempts = 0;
        const scrollInterval = setInterval(() => {
            const el = document.getElementById(`anr-item-${targetAnr.id}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                clearInterval(scrollInterval);
            }
            attempts++;
            if (attempts > 5) clearInterval(scrollInterval); // Stop after 500ms
        }, 100);

        return () => clearInterval(scrollInterval);
    }, [focusId, isLoading, anrs]);

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const getStackPreview = (threadState: string | null): string => {
        if (!threadState) return 'No stack trace available';
        const lines = threadState.split('\n').filter(l => l.trim());
        return lines.slice(0, 3).join('\n');
    };

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
                        <div className="p-3 bg-purple-500 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg">
                            <Clock className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-black text-black tracking-tighter uppercase mb-0.5">
                                ANRs
                            </h1>
                            <div className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-widest pl-0.5">
                                <div className="h-3 w-1 bg-purple-500"></div>
                                App Not Responding events
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Search */}
                        <div className="relative max-w-xs w-full hidden md:block group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black group-focus-within:text-purple-600 transition-colors" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="SEARCH ANRS..."
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
                        <div className="w-16 text-right">Events</div>
                        <div className="w-16 text-right">Users</div>
                        <div className="w-10"></div>
                    </div>
                </div>

                <div className="bg-white">
                    {searchedAnrs.length === 0 && !isLoading && (
                        <div className="py-16 text-center text-slate-400">
                            <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-bold">No ANRs detected</p>
                            <p className="text-sm">Great job! Your app main thread is responsive.</p>
                        </div>
                    )}

                    {searchedAnrs.map((anr) => {
                        const isExpanded = expandedAnr === anr.id;

                        return (
                            <div
                                key={anr.id}
                                id={`anr-item-${anr.id}`}
                                className={`border-b border-slate-100 transition-all ${isExpanded ? 'bg-slate-50/50' : 'hover:bg-slate-50/50'}`}
                            >
                                {/* Row */}
                                <div
                                    className="flex items-center py-4 px-6 gap-4 cursor-pointer group/row transition-colors"
                                    onClick={() => setExpandedAnr(isExpanded ? null : anr.id)}
                                >
                                    {/* Status Dot */}
                                    <div className="w-8 flex-shrink-0 flex justify-center">
                                        <div className={`w-3 h-3 border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${isExpanded ? 'bg-purple-500' : 'bg-purple-500'}`} />
                                    </div>

                                    {/* Issue Info */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-black text-sm text-black truncate mb-1">
                                            ANR Issue: {anr.durationMs}ms Freeze
                                        </h3>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                                            {anr.deviceMetadata?.deviceModel && (
                                                <span className="border-r-2 border-slate-300 pr-2 mr-2">
                                                    {anr.deviceMetadata.deviceModel}
                                                </span>
                                            )}
                                            {anr.deviceMetadata?.appVersion && (
                                                <span>v{anr.deviceMetadata.appVersion}</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Last Seen */}
                                    <div className="hidden md:block w-20 text-right group-hover/row:translate-x-[-4px] transition-transform">
                                        <span className="text-xs font-bold text-black">{formatLastSeen(anr.timestamp)}</span>
                                    </div>

                                    {/* Events */}
                                    <div className="w-16 text-right">
                                        <span className="text-sm font-black text-black font-mono bg-purple-100 border border-purple-300 px-1 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                            {anr.occurrenceCount}
                                        </span>
                                    </div>

                                    {/* Users */}
                                    <div className="w-16 text-right">
                                        <span className="text-sm font-black text-black font-mono bg-indigo-100 border border-indigo-300 px-1 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                            {anr.userCount >= 1000 ? (anr.userCount / 1000).toFixed(1) + 'k' : anr.userCount}
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

                                            {/* LEFT: Thread State snippet */}
                                            <div className="lg:col-span-12 xl:col-span-8 space-y-8">
                                                <div>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                            <Activity size={12} className="text-purple-500" /> Main Thread Halted
                                                        </h4>
                                                        {anr.threadState && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    copyToClipboard(anr.threadState!, anr.id);
                                                                }}
                                                                className="text-[10px] font-extrabold text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1 uppercase tracking-wider"
                                                            >
                                                                {copiedId === anr.id ? (
                                                                    <>
                                                                        <Check size={10} className="text-emerald-600" /> Copied
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Copy size={10} /> Full Trace
                                                                    </>
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>

                                                    <NeoCard variant="flat" className="p-0 overflow-hidden !bg-slate-900 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="bg-slate-800/50 px-4 py-2 border-b-2 border-black flex justify-between items-center">
                                                            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Freeze Snapshot ({anr.durationMs}ms)</span>
                                                            <div className="flex gap-1.5">
                                                                <div className="w-2 h-2 rounded-full bg-slate-700" />
                                                                <div className="w-2 h-2 rounded-full bg-slate-700" />
                                                                <div className="w-2 h-2 rounded-full bg-slate-700" />
                                                            </div>
                                                        </div>
                                                        <div className="p-5 font-mono text-[11px] text-purple-300 leading-relaxed overflow-x-auto whitespace-pre custom-scrollbar max-h-80">
                                                            {getStackPreview(anr.threadState)}
                                                        </div>
                                                    </NeoCard>

                                                    <div className="mt-4 flex items-center gap-3">
                                                        <NeoButton
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => navigate(`${pathPrefix}/stability/anrs/${currentProject?.id}/${anr.id}`)}
                                                        >
                                                            Inspect full thread dump <ExternalLink size={10} className="ml-1" />
                                                        </NeoButton>
                                                        {anr.threadState && (
                                                            <NeoButton
                                                                variant="primary"
                                                                size="sm"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setStackTraceModal({ isOpen: true, anrId: anr.id });
                                                                }}
                                                            >
                                                                View Full Trace
                                                            </NeoButton>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 text-center md:text-left">Freeze Duration</div>
                                                        <div className="text-sm font-black text-black text-center md:text-left">{(anr.durationMs / 1000).toFixed(2)}s</div>
                                                    </div>
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 text-center md:text-left">Detected At</div>
                                                        <div className="text-sm font-black text-black text-center md:text-left">{new Date(anr.timestamp).toLocaleString()}</div>
                                                    </div>
                                                    <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] md:col-span-2 lg:col-span-1">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 text-center md:text-left">Environment</div>
                                                        <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                                                            <NeoBadge variant="neutral" size="sm">{anr.deviceMetadata?.deviceModel}</NeoBadge>
                                                            <NeoBadge variant="info" size="sm">iOS {anr.deviceMetadata?.osVersion}</NeoBadge>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* RIGHT: Visual Context */}
                                            <div className="lg:col-span-12 xl:col-span-4 space-y-8">
                                                <div>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                            <Play size={12} className="text-purple-500" /> Evidence Sample
                                                        </h4>
                                                        {anr.sessionId && (
                                                            <NeoButton
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => navigate(`${pathPrefix}/sessions/${anr.sessionId}`)}
                                                            >
                                                                Watch Replay <ChevronRight size={10} className="ml-1" />
                                                            </NeoButton>
                                                        )}
                                                    </div>

                                                    <NeoCard variant="flat" className="flex justify-center items-center py-6 bg-slate-100 border-2 border-black !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                                        <div className="transform hover:scale-105 transition-transform duration-500">
                                                            <MiniSessionCard
                                                                session={{
                                                                    id: anr.sessionId,
                                                                    deviceModel: anr.deviceMetadata?.deviceModel,
                                                                    createdAt: anr.timestamp
                                                                }}
                                                                onClick={() => navigate(`${pathPrefix}/sessions/${anr.sessionId}`)}
                                                            />
                                                        </div>
                                                    </NeoCard>
                                                </div>

                                                <NeoCard variant="flat" className="!bg-purple-600 p-5 text-purple-50 !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] border-2 border-black">
                                                    <h5 className="font-bold text-sm mb-2 uppercase tracking-wide">UX Breakdown</h5>
                                                    <p className="text-xs leading-relaxed text-purple-100 mb-4">
                                                        This ANR caused the main thread to be unresponsive for <span className="text-white font-bold">{anr.durationMs}ms</span>, leading to potential user frustration or termination.
                                                    </p>
                                                    {anr.sessionId && (
                                                        <NeoButton
                                                            variant="secondary"
                                                            size="sm"
                                                            onClick={() => navigate(`${pathPrefix}/sessions/${anr.sessionId}`)}
                                                        >
                                                            Investigate Interaction <Play size={10} fill="currentColor" className="ml-1" />
                                                        </NeoButton>
                                                    )}
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
            {stackTraceModal.anrId && (() => {
                const anr = anrs.find(a => a.id === stackTraceModal.anrId);
                if (!anr?.threadState) return null;
                return (
                    <StackTraceModal
                        isOpen={stackTraceModal.isOpen}
                        onClose={() => setStackTraceModal({ isOpen: false, anrId: null })}
                        title={`ANR Issue: ${anr.durationMs}ms Freeze`}
                        subtitle={anr.deviceMetadata?.deviceModel}
                        stackTrace={anr.threadState}
                        issueType="anr"
                        sessionId={anr.sessionId}
                        onViewReplay={() => {
                            if (anr.sessionId) {
                                navigate(`${pathPrefix}/sessions/${anr.sessionId}`);
                            }
                        }}
                    />
                );
            })()}
        </div>
    );
};

export default ANRsList;
