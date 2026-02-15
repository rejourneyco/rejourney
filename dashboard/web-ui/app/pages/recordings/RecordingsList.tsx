import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { usePathPrefix } from '../../hooks/usePathPrefix';
import {
  Search,
  AlertTriangle,
  Smartphone,
  AlertOctagon,
  ChevronUp,
  ChevronDown,
  Layers,
  Zap,
  Download,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  Check,
  Play,
  Wifi,
  Signal,
  Globe,
  Activity,
  Filter,
  Loader,
  Gauge,
  Timer,
  MousePointerClick
} from 'lucide-react';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { getSessionsPaginated } from '../../services/api';
import { useDemoMode } from '../../context/DemoModeContext';
import { useSessionData } from '../../context/SessionContext';
import { useSafeTeam } from '../../context/TeamContext';
import { PromotionLogicGraphic } from '../../components/recordings/PromotionLogicGraphic';

const ROWS_PER_PAGE = 50;

type SortKey = 'date' | 'duration' | 'apiResponse' | 'startup' | 'screens' | 'apiSuccess' | 'apiError' | 'crashes' | 'anrs' | 'errors' | 'rage' | 'network';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

// Map network type to signal strength level (0-3)
const getNetworkStrength = (networkType: string | undefined): number => {
  if (!networkType) return 0;
  switch (networkType.toLowerCase()) {
    case 'wifi': return 3;
    case '5g': return 3;
    case '4g': case 'lte': return 2;
    case '3g': return 1;
    case '2g': case 'edge': return 1;
    case 'cellular': return 2;
    default: return 0;
  }
};

const NetworkIcon: React.FC<{ type: string | undefined }> = ({ type }) => {
  if (!type) return <Signal className="w-3 h-3 text-slate-300" />;
  const normalized = type.toLowerCase();
  if (normalized === 'wifi') return <Wifi className="w-3 h-3" />;
  if (['5g', '4g', 'lte', '3g', 'cellular'].includes(normalized)) return <Signal className="w-3 h-3" />;
  return <Globe className="w-3 h-3" />;
};

export const RecordingsList: React.FC = () => {
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();
  const { isDemoMode, demoSessions } = useDemoMode();
  const { selectedProject, projects, isLoading: isContextLoading } = useSessionData();
  const { currentTeam } = useSafeTeam();
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'crashes' | 'anrs' | 'errors' | 'rage' | 'dead_taps' | 'failed_funnel' | 'slow_start' | 'slow_api'>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  const [sortConfigs, setSortConfigs] = useState<SortConfig[]>([{ key: 'date', direction: 'desc' }]);
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const activeRequestIdRef = useRef(0);

  const selectedProjectId = selectedProject?.id;
  const selectedProjectTeamId = selectedProject?.teamId;
  const isProjectFromCurrentTeam = !selectedProjectId || !currentTeam?.id || selectedProjectTeamId === currentTeam.id;

  // Fetch sessions with pagination
  const fetchSessions = useCallback(async (cursor?: string | null, requestId: number = activeRequestIdRef.current) => {
    // Demo mode: use static demo sessions
    if (isDemoMode) {
      if (requestId !== activeRequestIdRef.current) return;
      setSessions(demoSessions);
      setNextCursor(null);
      setHasMore(false);
      setIsLoading(false);
      return;
    }

    // On team/project switches, wait until context resolves to avoid cross-team bleed-through.
    if (!cursor) {
      if (isContextLoading || !isProjectFromCurrentTeam) {
        setSessions([]);
        setNextCursor(null);
        setHasMore(false);
        setIsLoading(true);
        return;
      }

      if (!selectedProjectId) {
        // Team has no selected project yet (or no projects): don't fetch global sessions.
        setSessions([]);
        setNextCursor(null);
        setHasMore(false);
        setIsLoading(false);
        return;
      }
    }

    try {
      if (cursor) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setSessions([]);
      }

      const result = await getSessionsPaginated({
        cursor,
        limit: 100, // Fetch 100 at a time for better UX
        timeRange: timeRange === 'all' ? undefined : timeRange,
        projectId: selectedProjectId,
      });

      if (requestId !== activeRequestIdRef.current) return;

      if (cursor) {
        // Append to existing sessions
        setSessions(prev => [...prev, ...result.sessions]);
      } else {
        // Replace all sessions
        setSessions(result.sessions);
      }

      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (err) {
      if (requestId !== activeRequestIdRef.current) return;
      console.error('Failed to fetch sessions:', err);
    } finally {
      if (requestId === activeRequestIdRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [timeRange, isDemoMode, demoSessions, selectedProjectId, isContextLoading, isProjectFromCurrentTeam]);

  // Initial fetch and refetch when time range or project changes
  const fetchScopeKey = `${isDemoMode ? 'demo' : 'live'}:${timeRange}:${currentTeam?.id || 'no-team'}:${selectedProjectId || 'no-project'}:${isContextLoading ? 'loading' : 'ready'}:${projects.length}:${isProjectFromCurrentTeam ? 'valid' : 'invalid'}`;

  useEffect(() => {
    const requestId = ++activeRequestIdRef.current;
    setCurrentPage(1);
    setExpandedSessionId(null);
    setNextCursor(null);
    setHasMore(false);
    setIsLoadingMore(false);
    fetchSessions(undefined, requestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchScopeKey]);

  const handleLoadMore = useCallback(async () => {
    if (nextCursor && !isLoadingMore) {
      await fetchSessions(nextCursor, activeRequestIdRef.current);
    }
  }, [nextCursor, isLoadingMore, fetchSessions]);

  // Client-side filtering for search and issue types
  // Only show sessions that were promoted for replay (have video recordings)
  const filteredSessions = useMemo(() => {
    let result = sessions.filter(session => {
      // Only show promoted sessions (ones that have video recordings)
      // Non-promoted sessions never had video uploaded and shouldn't appear in archive
      if (!session.replayPromoted) return false;

      const matchesSearch =
        session.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (session.userId && session.userId.toLowerCase().includes(searchQuery.toLowerCase())) ||
        ((session as any).anonymousDisplayName && (session as any).anonymousDisplayName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (session.deviceModel && session.deviceModel.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;
      if (filter === 'crashes') return (session.crashCount || 0) > 0;
      if (filter === 'anrs') return ((session as any).anrCount || 0) > 0;
      if (filter === 'errors') return ((session as any).errorCount || 0) > 0;
      if (filter === 'rage') return (session.rageTapCount || 0) > 3;
      if (filter === 'dead_taps') return ((session as any).deadTapCount || 0) > 0;
      if (filter === 'slow_start') return ((session as any).appStartupTimeMs || 0) > 3000;
      if (filter === 'slow_api') return (session.apiAvgResponseMs || 0) > 1000;
      if (filter === 'failed_funnel') {
        // Check if the session was promoted specifically because of a failed funnel
        // OR check manually if we want to detect it on the fly (but reason is better)
        return session.replayPromotedReason === 'failed_funnel';
      }
      return true;
    });

    result.sort((a, b) => {
      for (const { key, direction } of sortConfigs) {
        let comparison = 0;
        switch (key) {
          case 'date':
            comparison = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
            break;
          case 'duration':
            comparison = a.durationSeconds - b.durationSeconds;
            break;
          case 'apiResponse':
            comparison = (a.apiAvgResponseMs || 0) - (b.apiAvgResponseMs || 0);
            break;
          case 'startup':
            comparison = ((a as any).appStartupTimeMs || 0) - ((b as any).appStartupTimeMs || 0);
            break;
          case 'screens':
            comparison = ((a as any).screensVisited?.length || 0) - ((b as any).screensVisited?.length || 0);
            break;
          case 'apiSuccess':
            comparison = (a.apiSuccessCount || 0) - (b.apiSuccessCount || 0);
            break;
          case 'apiError':
            comparison = (a.apiErrorCount || 0) - (b.apiErrorCount || 0);
            break;
          case 'crashes':
            comparison = (a.crashCount || 0) - (b.crashCount || 0);
            break;
          case 'anrs':
            comparison = ((a as any).anrCount || 0) - ((b as any).anrCount || 0);
            break;
          case 'rage':
            comparison = (a.rageTapCount || 0) - (b.rageTapCount || 0);
            break;
          case 'network':
            comparison = getNetworkStrength((a as any).networkType) - getNetworkStrength((b as any).networkType);
            break;
        }
        if (comparison !== 0) {
          return direction === 'desc' ? -comparison : comparison;
        }
      }
      return 0;
    });

    return result;
  }, [sessions, searchQuery, filter, sortConfigs]);

  const handleCopyUserId = (e: React.MouseEvent, userId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(userId);
    setCopiedId(userId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filter, sortConfigs]);

  const totalPages = Math.ceil(filteredSessions.length / ROWS_PER_PAGE);
  const paginatedSessions = useMemo(() => {
    const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
    return filteredSessions.slice(startIndex, startIndex + ROWS_PER_PAGE);
  }, [filteredSessions, currentPage]);

  const handleSort = (key: SortKey, multiSort: boolean) => {
    setSortConfigs(prev => {
      const existingIndex = prev.findIndex(s => s.key === key);
      if (existingIndex >= 0) {
        const current = prev[existingIndex];
        if (current.direction === 'desc') {
          const updated = [...prev];
          updated[existingIndex] = { key, direction: 'asc' };
          return updated;
        } else {
          return prev.filter((_, i) => i !== existingIndex);
        }
      } else {
        if (multiSort) {
          return [...prev, { key, direction: 'desc' }];
        } else {
          return [{ key, direction: 'desc' }];
        }
      }
    });
  };

  const getSortIndicator = (key: SortKey) => {
    const config = sortConfigs.find(s => s.key === key);
    if (!config) return <div className="w-3 h-3" />;
    const index = sortConfigs.indexOf(config);
    return (
      <span className="inline-flex items-center ml-1">
        {config.direction === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        {sortConfigs.length > 1 && <span className="text-[9px] ml-0.5">{index + 1}</span>}
      </span>
    );
  };

  const SortableHeader = ({ label, sortKey, className = '', align = 'left' }: { label: string; sortKey: SortKey; className?: string, align?: 'left' | 'right' | 'center' }) => (
    <div
      onClick={(e) => handleSort(sortKey, e.shiftKey)}
      className={`flex items-center cursor-pointer select-none hover:text-black transition-colors group ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'} ${className}`}
      title="Click to sort, Shift+Click for multi-column sort"
    >
      <span className="flex items-center gap-1">
        {label}
        <span className="text-slate-400 group-hover:text-black transition-colors">{getSortIndicator(sortKey)}</span>
      </span>
    </div>
  );

  const toggleExpand = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setExpandedSessionId(expandedSessionId === sessionId ? null : sessionId);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white">
        <div className="text-2xl font-black uppercase tracking-tighter animate-bounce">
          <Activity className="w-12 h-12 mb-4 mx-auto" />
          Loading Archive...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-black">
      {/* Sticky Header Group */}
      <div className="sticky top-0 z-50 bg-white">

        {/* Main Header */}
        <DashboardPageHeader
          title="Session Archive"
          subtitle="Browse, filter & replay user sessions"
          icon={<Layers className="w-6 h-6" />}
          iconColor="bg-indigo-500"
        >
          <div className="hidden lg:block mr-2">
            <PromotionLogicGraphic />
          </div>

          <div className="relative max-w-xs w-full hidden md:block group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black group-focus-within:text-indigo-600 transition-colors" />
            <input
              type="text"
              placeholder="SEARCH SESSION..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg font-bold text-sm uppercase placeholder:text-slate-400 focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all"
            />
          </div>

          <TimeFilter value={timeRange} onChange={setTimeRange} />

          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (timeRange && timeRange !== 'all') params.append('timeRange', timeRange);
              if (selectedProjectId) params.append('projectId', selectedProjectId);
              window.location.href = `/api/sessions/export?${params.toString()}`;
            }}
            className="bg-black text-white p-2 border-2 border-black shadow-[2px_2px_0px_0px_rgba(100,100,100,1)] hover:bg-slate-800 active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all rounded-md"
            title="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </DashboardPageHeader>

        {/* Filter Bar */}
        <div className="bg-slate-50 border-b-2 border-black px-6 py-3 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-3 max-w-[1800px] mx-auto">
            <div className="lg:hidden">
              <PromotionLogicGraphic />
            </div>
            <span className="font-black uppercase text-xs mr-2 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Filters:
            </span>
            {[
              { id: 'all', label: 'All', icon: Layers },
              { id: 'crashes', label: 'Crashes', icon: AlertOctagon },
              { id: 'errors', label: 'Errors', icon: AlertTriangle },
              { id: 'anrs', label: 'ANRs', icon: Clock },
              { id: 'rage', label: 'Rage', icon: Zap },
              { id: 'dead_taps', label: 'Dead Taps', icon: MousePointerClick },
              { id: 'slow_start', label: 'Slow Start', icon: Timer },
              { id: 'slow_api', label: 'Slow API', icon: Gauge },
              { id: 'failed_funnel', label: 'Failed Funnel', icon: Compass },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 font-bold text-[10px] uppercase rounded-none border-2 transition-all whitespace-nowrap shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:translate-x-0 active:shadow-none
                    ${filter === f.id
                    ? 'bg-black text-white border-black'
                    : 'bg-white border-black text-black hover:bg-indigo-50'}`}
              >
                <f.icon className="w-3 h-3" />
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table Header */}
        <div className="bg-white border-b-2 border-black">
          <div className="max-w-[1800px] mx-auto w-full px-6">
            <div className="flex items-center py-2 text-xs font-black text-black uppercase tracking-wider gap-2">
              <div className="w-8 flex-shrink-0"></div>
              <div className="flex-1 min-w-0 px-2 outline outline-2 outline-transparent">User & Device</div>
              <div className="hidden lg:block w-32 px-2"><SortableHeader label="Date" sortKey="date" /></div>
              <div className="hidden md:block w-24 text-right px-2"><SortableHeader label="Duration" sortKey="duration" align="right" /></div>
              <div className="hidden lg:block w-24 text-right px-2"><SortableHeader label="Screens" sortKey="screens" align="right" /></div>

              {/* API Metrics */}
              <div className="hidden xl:block w-24 text-right px-2"><SortableHeader label="API Lat." sortKey="apiResponse" align="right" /></div>
              <div className="hidden xl:block w-24 text-right px-2"><SortableHeader label="API Err" sortKey="apiError" align="right" /></div>

              {/* Reason Recorded */}
              <div className="w-56 flex justify-end gap-1 px-2">
                <SortableHeader label="Reason Recorded" sortKey="crashes" align="right" />
              </div>
              <div className="w-10"></div>
              <div className="w-10"></div>
            </div>
          </div>
        </div>
      </div>

      {/* List Content */}
      <div className="flex-1 max-w-[1800px] mx-auto w-full px-6 pt-6 pb-20">
        <div className="bg-white">
          {paginatedSessions.length === 0 && (
            <div className="py-20 text-center">
              <div className="inline-flex items-center justify-center p-4 bg-slate-50 rounded-full mb-4">
                <Smartphone className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-lg font-black uppercase text-slate-900 mb-1">
                {selectedProjectId ? 'No Sessions Found' : 'No Project Selected'}
              </h3>
              <p className="text-slate-500 text-sm">
                {selectedProjectId
                  ? 'Adjust your filters or search query'
                  : 'Select or create a project to view replay data.'}
              </p>
            </div>
          )}

          {paginatedSessions.map((session) => {
            const isExpanded = expandedSessionId === session.id;
            const screensCount = (session as any).screensVisited?.length || 0;
            const networkType = (session as any).networkType || (session as any).cellularGeneration;
            const userId = session.userId || (session as any).anonymousDisplayName || 'Anonymous';
            // Truncate after 25 chars for a slightly less aggressive truncation
            const displayUserId = userId.length > 25 ? userId.substring(0, 25) + '...' : userId;

            // Performance issue detection
            const hasSlowStart = ((session as any).appStartupTimeMs || 0) > 3000;
            const hasSlowApi = (session.apiAvgResponseMs || 0) > 1000;
            const durationMinutes = session.durationSeconds / 60;
            const hasLowExp = session.replayPromotedReason === 'failed_funnel';
            const hasDeadTaps = ((session as any).deadTapCount || 0) > 0;

            const isProcessing = session.durationSeconds === 0;

            const hasIssues = (session.crashCount || 0) > 0 ||
              ((session as any).anrCount || 0) > 0 ||
              ((session as any).errorCount || 0) > 0 ||
              (session.rageTapCount || 0) > 0 ||
              hasDeadTaps ||
              hasSlowStart || hasSlowApi || hasLowExp;

            return (
              <div
                key={session.id}
                className={`border-b-2 border-black transition-all mb-2 ${isExpanded ? 'bg-indigo-50 border-indigo-500 transform scale-[1.005] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'bg-white hover:bg-slate-50'}`}
              >
                {/* Compact Row */}
                <div
                  className="flex items-center py-4 px-0 cursor-pointer gap-2"
                  onClick={(e) => toggleExpand(e, session.id)}
                >
                  {/* Visual Indicator */}
                  <div className="w-8 flex-shrink-0 flex justify-center">
                    <div className={`w-3 h-3 border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${isProcessing ? 'bg-indigo-400 animate-pulse' : hasIssues ? 'bg-amber-400' : 'bg-success'}`} />
                  </div>

                  {/* User & Device */}
                  <div className="flex-1 min-w-0 px-2">
                    <div className="flex items-center gap-2 mb-1">
                      <h3
                        className={`font-black text-sm text-black font-mono truncate ${isProcessing ? 'opacity-50' : ''}`}
                        title={userId}
                      >
                        {displayUserId}
                      </h3>
                      {userId !== 'Anonymous' && (
                        <button
                          onClick={(e) => handleCopyUserId(e, userId)}
                          className="text-slate-400 hover:text-black transition-colors"
                        >
                          {copiedId === userId ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                        </button>
                      )}
                    </div>
                    <div className={`flex items-center gap-2 text-[10px] text-slate-500 uppercase font-bold tracking-tight ${isProcessing ? 'opacity-50' : ''}`}>
                      <span className="truncate max-w-[120px]">{session.deviceModel || 'Unknown Device'}</span>
                      <span className="w-1 h-1 bg-black"></span>
                      <span>v{session.appVersion || '?.?.?'}</span>
                    </div>
                  </div>

                  {/* Date (Desktop) */}
                  <div className="hidden lg:block w-32 px-2">
                    <div className="text-xs font-bold text-black">{new Date(session.startedAt).toLocaleDateString()}</div>
                    <div className="text-[10px] text-slate-500 font-mono font-bold">{new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>

                  {/* Duration */}
                  <div className="hidden md:block w-24 text-right px-2">
                    {isProcessing ? (
                      <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-1 py-0.5 animate-pulse rounded-sm">
                        LIVE INGEST
                      </span>
                    ) : (
                      <span className="text-xs font-mono font-bold text-black border border-black bg-slate-100 px-1 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                        {Math.floor(session.durationSeconds / 60)}:{String(session.durationSeconds % 60).padStart(2, '0')}
                      </span>
                    )}
                  </div>

                  {/* Screens */}
                  <div className="hidden lg:block w-24 text-right px-2">
                    <span className={`text-xs font-black ${screensCount > 0 ? 'text-black' : 'text-slate-300'}`}>{screensCount}</span>
                  </div>

                  {/* API Metrics */}
                  <div className="hidden xl:block w-24 text-right px-2">
                    {(session.apiAvgResponseMs || 0) > 0 ? (
                      <span className={`text-xs font-mono font-bold ${session.apiAvgResponseMs > 1000 ? 'text-red-600' : session.apiAvgResponseMs > 500 ? 'text-amber-600' : 'text-black'}`}>
                        {Math.round(session.apiAvgResponseMs)}ms
                      </span>
                    ) : <span className="text-slate-300 text-xs">-</span>}
                  </div>
                  <div className="hidden xl:block w-24 text-right px-2">
                    {(session.apiErrorCount || 0) > 0 ? (
                      <span className="text-xs font-mono font-bold text-red-600 border border-red-200 bg-red-50 px-1.5 py-0.5 rounded-sm">
                        {session.apiErrorCount}
                      </span>
                    ) : <span className="text-slate-300 text-xs">-</span>}
                  </div>

                  {/* Reason Recorded */}
                  <div className="w-56 flex justify-end gap-1 px-2 items-center flex-wrap">
                    {!hasIssues && <NeoBadge variant="success" size="sm">HEALTHY</NeoBadge>}
                    {(session.crashCount || 0) > 0 && <NeoBadge variant="danger" size="sm">CRASH</NeoBadge>}
                    {((session as any).anrCount || 0) > 0 && <NeoBadge variant="anr" size="sm">ANR</NeoBadge>}
                    {((session as any).errorCount || 0) > 0 && <NeoBadge variant="warning" size="sm">ERR</NeoBadge>}
                    {(session.rageTapCount || 0) > 0 && <NeoBadge variant="rage" size="sm">RAGE</NeoBadge>}
                    {hasDeadTaps && <NeoBadge variant="dead_tap" size="sm">DEAD TAP</NeoBadge>}
                    {hasSlowStart && <NeoBadge variant="slow_start" size="sm">SLOW</NeoBadge>}
                    {hasSlowApi && <NeoBadge variant="slow_api" size="sm">API</NeoBadge>}
                    {hasLowExp && <NeoBadge variant="low_exp" size="sm">FAILED FUNNEL</NeoBadge>}
                  </div>

                  {/* Play Action */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isProcessing) {
                        navigate(`${pathPrefix}/sessions/${session.id}`);
                      }
                    }}
                    disabled={isProcessing}
                    className={`w-10 h-8 flex items-center justify-center rounded-none border-2 border-transparent transition-all group/play ${isProcessing ? 'cursor-not-allowed opacity-20' : 'hover:border-black hover:bg-black hover:text-white'}`}
                    title={isProcessing ? "Session is still processing" : "Open Replay"}
                  >
                    <Play size={16} className={isProcessing ? "" : "group-hover/play:fill-white"} />
                  </button>

                  {/* Expand Toggle */}
                  <button
                    onClick={(e) => toggleExpand(e, session.id)}
                    className={`w-10 h-8 flex items-center justify-center rounded-none border-2 border-transparent hover:border-black transition-all ${isExpanded ? 'bg-black text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)]' : 'text-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                      }`}
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-14 pb-4 pt-1">
                    <NeoCard variant="flat" className="p-4 bg-white border-2 border-black !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {/* Performance Stats */}
                        <div className="space-y-2">
                          <h4 className="font-black text-black uppercase tracking-wider text-[10px] border-b-2 border-slate-200 pb-1">Performance</h4>

                          <div className="flex justify-between items-center pb-1">
                            <span className="text-slate-600 font-bold text-xs uppercase">Startup</span>
                            <span className={`font-mono font-bold ${((session as any).appStartupTimeMs || 0) > 2000 ? 'text-red-600' : 'text-emerald-600'}`}>
                              {((session as any).appStartupTimeMs || 0).toFixed(0)}ms
                            </span>
                          </div>
                          <div className="flex justify-between items-center pb-1">
                            <span className="text-slate-600 font-bold text-xs uppercase">API Latency</span>
                            <span className="font-mono font-bold text-black">{(session.apiAvgResponseMs || 0).toFixed(0)}ms</span>
                          </div>
                        </div>

                        {/* Network & Device */}
                        <div className="space-y-2">
                          <h4 className="font-black text-black uppercase tracking-wider text-[10px] border-b-2 border-slate-200 pb-1">Environment</h4>

                          <div className="flex justify-between items-center pb-1">
                            <span className="text-slate-600 font-bold text-xs uppercase">Network</span>
                            <div className="flex items-center gap-1.5 font-bold text-black uppercase text-xs">
                              <NetworkIcon type={networkType} />
                              <span>{networkType || 'Unknown'}</span>
                            </div>
                          </div>
                          <div className="flex justify-between items-center pb-1">
                            <span className="text-slate-600 font-bold text-xs uppercase">OS Version</span>
                            <span className="font-bold text-black text-xs">{session.osVersion || 'Unknown'}</span>
                          </div>
                        </div>

                        {/* API Reliability */}
                        <div className="space-y-2">
                          <h4 className="font-black text-black uppercase tracking-wider text-[10px] border-b-2 border-slate-200 pb-1">API</h4>
                          <div className="flex gap-2">
                            <div className="flex-1 bg-emerald-50 border-2 border-emerald-200 p-2 text-center rounded-sm">
                              <div className="text-emerald-700 font-black font-mono text-lg leading-none">{session.apiSuccessCount || 0}</div>
                              <div className="text-[9px] uppercase font-bold text-emerald-500">Success</div>
                            </div>
                            <div className="flex-1 bg-red-50 border-2 border-red-200 p-2 text-center rounded-sm">
                              <div className="text-red-600 font-black font-mono text-lg leading-none">{session.apiErrorCount || 0}</div>
                              <div className="text-[9px] uppercase font-bold text-red-500">Failed</div>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col justify-start">
                          <NeoButton
                            variant="primary"
                            size="sm"
                            onClick={() => !isProcessing && navigate(`${pathPrefix}/sessions/${session.id}`)}
                            className={`w-full justify-center ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={isProcessing}
                          >
                            {isProcessing ? (
                              <><Loader size={12} className="animate-spin mr-2" /> Live Ingesting...</>
                            ) : (
                              <><Play size={12} fill="currentColor" className="mr-2" /> Open Replay</>
                            )}
                          </NeoButton>
                        </div>
                      </div>
                    </NeoCard>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination for filtered/sorted results */}
        {(totalPages > 1 || hasMore) && (
          <div className="flex items-center justify-between border-t border-slate-200 py-4 mt-4 px-6">
            <NeoButton
              variant="secondary"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1 || isLoadingMore}
            >
              <ChevronLeft size={14} className="mr-1" /> Previous
            </NeoButton>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-bold text-slate-400">
                {filteredSessions.length} sessions{hasMore ? ' (more available)' : ''}
              </span>
            </div>
            <NeoButton
              variant="secondary"
              size="sm"
              onClick={async () => {
                // If we're on the last page and there's more data, load it first
                if (currentPage === totalPages && hasMore && !isLoadingMore) {
                  await handleLoadMore();
                  // After loading, increment page to show new data
                  setCurrentPage(p => p + 1);
                } else if (currentPage < totalPages) {
                  // Normal pagination - just go to next page
                  setCurrentPage(p => p + 1);
                }
              }}
              disabled={(currentPage === totalPages && !hasMore) || isLoadingMore}
              rightIcon={isLoadingMore ? <Loader size={14} className="animate-spin" /> : undefined}
            >
              Next <ChevronRight size={14} className="ml-1" />
            </NeoButton>
          </div>
        )}

        {/* Show count when no more to load */}
        {!hasMore && filteredSessions.length > 0 && totalPages <= 1 && (
          <div className="flex justify-center py-4 border-t border-slate-200">
            <span className="text-xs font-bold text-slate-400">
              All {filteredSessions.length} sessions loaded
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
