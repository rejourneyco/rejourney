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
  ChevronsLeft,
  ChevronsRight,
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
  MousePointerClick,
  Database,
  X
} from 'lucide-react';
import { DashboardPageHeader } from '../../components/ui/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE } from '../../components/ui/TimeFilter';
import { NeoBadge } from '../../components/ui/neo/NeoBadge';
import { NeoButton } from '../../components/ui/neo/NeoButton';
import { NeoCard } from '../../components/ui/neo/NeoCard';
import { getSessionsPaginated, getAvailableFilters } from '../../services/api';
import { useDemoMode } from '../../context/DemoModeContext';
import { useSessionData } from '../../context/SessionContext';
import { useSafeTeam } from '../../context/TeamContext';
import { formatGeoDisplay } from '../../utils/geoDisplay';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 300] as const;

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
  const [totalCount, setTotalCount] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(50);

  // Advanced Filters
  const [availableFilters, setAvailableFilters] = useState<{ events: string[]; metadata: Record<string, string[]> }>({ events: [], metadata: {} });
  const [eventNameFilter, setEventNameFilter] = useState('');
  const [metaKeyFilter, setMetaKeyFilter] = useState('');
  const [metaValueFilter, setMetaValueFilter] = useState('');
  const [eventCountOp, setEventCountOp] = useState('');
  const [eventCountValue, setEventCountValue] = useState('');
  const [eventPropKey, setEventPropKey] = useState('');
  const [eventPropValue, setEventPropValue] = useState('');

  const [dateFilter, setDateFilter] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

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
      setTotalCount(demoSessions.length);
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
        limit: rowsPerPage,
        timeRange: timeRange === 'all' ? undefined : timeRange,
        date: dateFilter ? dateFilter : undefined,
        projectId: selectedProjectId,
        metaKey: metaKeyFilter ? metaKeyFilter : undefined,
        metaValue: metaValueFilter ? metaValueFilter : undefined,
        eventName: eventNameFilter ? eventNameFilter : undefined,
        eventCountOp: eventCountOp ? eventCountOp : undefined,
        eventCountValue: eventCountValue ? eventCountValue : undefined,
        eventPropKey: eventPropKey ? eventPropKey : undefined,
        eventPropValue: eventPropValue ? eventPropValue : undefined,
      });

      if (requestId !== activeRequestIdRef.current) return;

      if (cursor) {
        // Append to existing sessions
        setSessions(prev => [...prev, ...result.sessions]);
      } else {
        // Replace all sessions
        setSessions(result.sessions);
      }
      setTotalCount(result.totalCount ?? 0);

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
  }, [timeRange, isDemoMode, demoSessions, selectedProjectId, isContextLoading, isProjectFromCurrentTeam, metaKeyFilter, metaValueFilter, eventNameFilter, rowsPerPage, dateFilter, eventCountOp, eventCountValue, eventPropKey, eventPropValue]);

  // Initial fetch and refetch when time range or project changes
  const fetchScopeKey = `${isDemoMode ? 'demo' : 'live'}:${timeRange}:${dateFilter}:${currentTeam?.id || 'no-team'}:${selectedProjectId || 'no-project'}:${isContextLoading ? 'loading' : 'ready'}:${projects.length}:${isProjectFromCurrentTeam ? 'valid' : 'invalid'}:${metaKeyFilter}:${metaValueFilter}:${eventNameFilter}:${rowsPerPage}:${eventCountOp}:${eventCountValue}:${eventPropKey}:${eventPropValue}`;

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

  // Load available metadata keys/values and event names for filter dropdowns
  const prevProjectIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (isDemoMode || !selectedProjectId || !isProjectFromCurrentTeam) {
      setAvailableFilters({ events: [], metadata: {} });
      setEventNameFilter('');
      setMetaKeyFilter('');
      setMetaValueFilter('');
      prevProjectIdRef.current = undefined;
      return;
    }
    const projectChanged = prevProjectIdRef.current !== selectedProjectId;
    prevProjectIdRef.current = selectedProjectId;
    if (projectChanged) {
      setEventNameFilter('');
      setMetaKeyFilter('');
      setMetaValueFilter('');
    }
    let cancelled = false;
    getAvailableFilters(selectedProjectId)
      .then((data) => {
        if (!cancelled) {
          setAvailableFilters(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load available filters:', err);
          setAvailableFilters({ events: [], metadata: {} });
        }
      });
    return () => { cancelled = true; };
  }, [isDemoMode, selectedProjectId, isProjectFromCurrentTeam]);

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
  }, [searchQuery, filter, sortConfigs, dateFilter, eventCountOp, eventCountValue, eventPropKey, eventPropValue]);

  const totalPages = Math.ceil(filteredSessions.length / rowsPerPage);
  const paginatedSessions = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredSessions.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredSessions, currentPage, rowsPerPage]);

  // Computed display values
  const startIndex = (currentPage - 1) * rowsPerPage + 1;
  const endIndex = Math.min(currentPage * rowsPerPage, filteredSessions.length);
  const hasActiveFilters = searchQuery || filter !== 'all' || eventNameFilter || metaKeyFilter || dateFilter || eventCountOp || eventPropKey;
  const advancedFilterCount = (eventNameFilter ? 1 : 0) + (metaKeyFilter ? 1 : 0) + (eventCountOp ? 1 : 0) + (eventPropKey ? 1 : 0);

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
      className={`flex items-center cursor-pointer select-none hover:text-slate-900 transition-colors group ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'} ${className}`}
      title="Click to sort, Shift+Click for multi-column sort"
    >
      <span className="flex items-center gap-1">
        {label}
        <span className="text-slate-400 group-hover:text-slate-900 transition-colors">{getSortIndicator(sortKey)}</span>
      </span>
    </div>
  );

  const toggleExpand = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setExpandedSessionId(expandedSessionId === sessionId ? null : sessionId);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-transparent">
        <div className="text-2xl font-semibold uppercase tracking-tighter animate-bounce">
          <Activity className="w-12 h-12 mb-4 mx-auto" />
          Loading Archive...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans text-slate-900 bg-transparent">
      {/* Sticky Header Group */}
      <div className="sticky top-0 z-50 bg-white">

        {/* Main Header — title only, minimal children */}
        <DashboardPageHeader
          title="Session Archive"
          subtitle={totalCount > 0 ? `${totalCount.toLocaleString()} total replays` : 'Browse, filter & replay user sessions'}
          icon={<Layers className="w-6 h-6" />}
          iconColor="bg-indigo-500"
        >
          <TimeFilter value={timeRange} onChange={setTimeRange} />
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (timeRange && timeRange !== 'all') params.append('timeRange', timeRange);
              if (selectedProjectId) params.append('projectId', selectedProjectId);
              if (dateFilter) params.append('date', dateFilter);
              window.location.href = `/api/sessions/export?${params.toString()}`;
            }}
            className="bg-slate-900 text-white p-2 border border-slate-200 shadow-sm hover:bg-slate-800 transition-all rounded-md"
            title="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </DashboardPageHeader>

        {/* Search & Controls Row */}
        <div className="bg-white border-b border-slate-100 px-6 py-2">
          <div className="flex items-center gap-2 max-w-[1800px] mx-auto">
            <div className="relative flex-1 group min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
              <input
                type="text"
                placeholder="SEARCH SESSION, USER, DEVICE..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg font-bold text-sm uppercase placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 transition-all"
              />
            </div>

            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className={`bg-white border shadow-sm rounded-lg px-3 py-2 text-xs font-bold outline-none max-w-[150px] ${dateFilter ? 'border-indigo-400 ring-1 ring-indigo-200 text-slate-900' : 'border-slate-200 text-slate-500'}`}
              title="Filter by specific date"
            />

            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase rounded-lg border shadow-sm transition-colors whitespace-nowrap ${showAdvancedFilters || advancedFilterCount > 0
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Filters
              {advancedFilterCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold bg-indigo-500 text-white rounded-full leading-none">
                  {advancedFilterCount}
                </span>
              )}
            </button>

            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilter('all');
                  setEventNameFilter('');
                  setMetaKeyFilter('');
                  setMetaValueFilter('');
                  setDateFilter('');
                  setEventCountOp('');
                  setEventCountValue('');
                  setEventPropKey('');
                  setEventPropValue('');
                  setShowAdvancedFilters(false);
                }}
                className="flex items-center gap-1 px-2.5 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all font-bold uppercase text-[10px] border border-red-200"
                title="Clear all filters"
              >
                <X className="w-3 h-3" /> Clear All
              </button>
            )}
          </div>

          {/* Active Filter Summary Pills */}
          {advancedFilterCount > 0 && !showAdvancedFilters && (
            <div className="flex items-center gap-2 mt-2 max-w-[1800px] mx-auto">
              <span className="text-[10px] text-slate-400 font-semibold uppercase">Active:</span>
              {eventNameFilter && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 border border-indigo-200 rounded-full text-[10px] font-bold text-indigo-700 uppercase">
                  Event: {eventNameFilter}
                  <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => setEventNameFilter('')} />
                </span>
              )}
              {eventPropKey && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-50 border border-violet-200 rounded-full text-[10px] font-bold text-violet-700 uppercase">
                  Prop: {eventPropKey}{eventPropValue ? ` = ${eventPropValue}` : ''}
                  <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => { setEventPropKey(''); setEventPropValue(''); }} />
                </span>
              )}
              {metaKeyFilter && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-full text-[10px] font-bold text-emerald-700 uppercase">
                  {metaKeyFilter}{metaValueFilter ? ` = ${metaValueFilter}` : ''}
                  <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => { setMetaKeyFilter(''); setMetaValueFilter(''); }} />
                </span>
              )}
              {eventCountOp && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-full text-[10px] font-bold text-amber-700 uppercase">
                  Events {eventCountOp === 'eq' ? '=' : eventCountOp === 'gt' ? '>' : eventCountOp === 'lt' ? '<' : eventCountOp === 'gte' ? '≥' : '≤'} {eventCountValue}
                  <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => { setEventCountOp(''); setEventCountValue(''); }} />
                </span>
              )}
            </div>
          )}
        </div>

        {/* Issue Filter Pills */}
        <div className="bg-slate-50 border-b border-slate-100/80 px-6 py-2.5 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-2 max-w-[1800px] mx-auto">
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
                className={`flex items-center gap-1.5 px-3 py-1.5 font-bold text-[10px] uppercase rounded-md border transition-all whitespace-nowrap shadow-sm hover:-translate-y-0.5
                    ${filter === f.id
                    ? 'bg-slate-900 text-white border-slate-800'
                    : 'bg-white border-slate-200 text-slate-900 hover:bg-indigo-50'}`}
              >
                <f.icon className="w-3 h-3" />
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced Filters Panel — below issue pills, no overlap */}
        {showAdvancedFilters && (
          <div className="bg-white border-b border-slate-200 px-6 py-4">
            <div className="max-w-[1800px] mx-auto space-y-3">
              {/* Events Section */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider w-20 shrink-0">🏷️ Events</span>
                <span className="text-[10px] text-slate-400">Named actions logged by your app</span>
                <div className="w-px h-5 bg-slate-200 mx-1" />
                <select
                  value={eventNameFilter}
                  onChange={(e) => setEventNameFilter(e.target.value)}
                  className={`bg-white border shadow-sm rounded-md px-3 py-1.5 uppercase outline-none focus:border-indigo-500 font-bold max-w-[200px] text-ellipsis text-xs ${eventNameFilter ? 'border-indigo-400 ring-1 ring-indigo-200 text-indigo-700' : 'border-slate-200 text-slate-600'}`}
                >
                  <option value="">ALL EVENTS</option>
                  {availableFilters.events.map(event => (
                    <option key={event} value={event}>{event}</option>
                  ))}
                </select>

                <div className="w-px h-5 bg-slate-200 mx-1" />

                <span className="text-[10px] text-slate-400">Count</span>
                <select
                  value={eventCountOp}
                  onChange={(e) => { setEventCountOp(e.target.value); if (!e.target.value) setEventCountValue(''); }}
                  className={`bg-white border shadow-sm rounded-md px-2 py-1.5 outline-none focus:border-indigo-500 font-bold text-xs w-16 ${eventCountOp ? 'border-amber-400 ring-1 ring-amber-200 text-amber-700' : 'border-slate-200 text-slate-600'}`}
                >
                  <option value="">—</option>
                  <option value="eq">=</option>
                  <option value="gt">&gt;</option>
                  <option value="lt">&lt;</option>
                  <option value="gte">≥</option>
                  <option value="lte">≤</option>
                </select>
                {eventCountOp && (
                  <input
                    type="number"
                    min="0"
                    value={eventCountValue}
                    onChange={(e) => setEventCountValue(e.target.value)}
                    placeholder="0"
                    className="bg-white border border-slate-200 shadow-sm rounded-md px-2 py-1.5 outline-none focus:border-amber-500 font-bold text-xs w-20 text-amber-700"
                  />
                )}

                <div className="w-px h-5 bg-slate-200 mx-1" />

                <span className="text-[10px] text-slate-400">Property</span>
                <input
                  type="text"
                  value={eventPropKey}
                  onChange={(e) => { setEventPropKey(e.target.value); if (!e.target.value) setEventPropValue(''); }}
                  placeholder="key"
                  className={`bg-white border shadow-sm rounded-md px-2 py-1.5 outline-none focus:border-violet-500 font-bold text-xs w-28 ${eventPropKey ? 'border-violet-400 ring-1 ring-violet-200 text-violet-700' : 'border-slate-200 text-slate-600 placeholder:text-slate-400'}`}
                />
                {eventPropKey && (
                  <>
                    <span className="text-[10px] text-slate-400">=</span>
                    <input
                      type="text"
                      value={eventPropValue}
                      onChange={(e) => setEventPropValue(e.target.value)}
                      placeholder="any value"
                      className={`bg-white border shadow-sm rounded-md px-2 py-1.5 outline-none focus:border-violet-500 font-bold text-xs w-28 ${eventPropValue ? 'border-violet-400 ring-1 ring-violet-200 text-violet-700' : 'border-slate-200 text-slate-600 placeholder:text-slate-400'}`}
                    />
                  </>
                )}
              </div>

              <div className="border-t border-slate-100" />

              {/* Metadata Section */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider w-20 shrink-0">📋 Metadata</span>
                <span className="text-[10px] text-slate-400">Key-value pairs set by your app</span>
                <div className="w-px h-5 bg-slate-200 mx-1" />
                <select
                  value={metaKeyFilter}
                  onChange={(e) => {
                    setMetaKeyFilter(e.target.value);
                    setMetaValueFilter('');
                  }}
                  className={`bg-white border shadow-sm rounded-md px-3 py-1.5 uppercase outline-none focus:border-emerald-500 font-bold max-w-[200px] text-ellipsis text-xs ${metaKeyFilter ? 'border-emerald-400 ring-1 ring-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-600'}`}
                >
                  <option value="">ANY KEY</option>
                  {Object.keys(availableFilters.metadata).map(key => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>

                <select
                  value={metaValueFilter}
                  onChange={(e) => setMetaValueFilter(e.target.value)}
                  disabled={!metaKeyFilter}
                  className={`bg-white border shadow-sm rounded-md px-3 py-1.5 uppercase outline-none focus:border-emerald-500 font-bold max-w-[200px] text-ellipsis text-xs ${!metaKeyFilter ? 'opacity-50 cursor-not-allowed border-slate-200' : metaValueFilter ? 'border-emerald-400 ring-1 ring-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-600'}`}
                >
                  <option value="">{metaKeyFilter ? 'ANY VALUE' : 'SELECT KEY FIRST'}</option>
                  {metaKeyFilter && (availableFilters.metadata[metaKeyFilter] || []).map(val => (
                    <option key={val} value={val}>{val}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Table Header */}
        <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">
          <div className="bg-slate-50 border-b border-slate-200">
            <div className="flex items-center py-3 px-6 text-[11px] font-semibold text-slate-500 uppercase tracking-wider gap-2">
              <div className="w-8 flex-shrink-0"></div>
              <div className="flex-1 min-w-0 px-2 outline outline-2 outline-transparent">User & Device</div>
              <div className="hidden lg:block w-32 px-2"><SortableHeader label="Date" sortKey="date" /></div>
              <div className="hidden lg:block w-40 px-2">Location</div>
              <div className="hidden md:block w-24 text-right px-2"><SortableHeader label="Duration" sortKey="duration" align="right" /></div>
              <div className="hidden lg:block w-24 text-right px-2"><SortableHeader label="Screens" sortKey="screens" align="right" /></div>

              {/* API Metrics */}
              <div className="hidden xl:block w-24 text-right px-2"><SortableHeader label="API Lat." sortKey="apiResponse" align="right" /></div>
              <div className="hidden xl:block w-24 text-right px-2"><SortableHeader label="API Err" sortKey="apiError" align="right" /></div>

              {/* Notes */}
              <div className="w-56 flex justify-end gap-1 px-2">
                <SortableHeader label="Notes" sortKey="crashes" align="right" />
              </div>
              <div className="w-10"></div>
              <div className="w-10"></div>
            </div>
          </div>
        </div>
      </div>

      {/* List Content */}
      <div className="flex-1 max-w-[1800px] mx-auto w-full px-6 pt-6 pb-20">
        <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">
          <div className="bg-white divide-y divide-slate-100">
            {paginatedSessions.length === 0 && (
              <div className="py-20 text-center">
                <div className="inline-flex items-center justify-center p-4 bg-slate-50 rounded-full mb-4">
                  <Smartphone className="w-8 h-8 text-slate-300" />
                </div>
                <h3 className="text-lg font-semibold uppercase text-slate-900 mb-1">
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
              const geoDisplay = formatGeoDisplay((session as any).geoLocation);

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
                  className={`transition-all ${isExpanded ? 'bg-indigo-50 border-indigo-500 transform scale-[1.005] shadow-sm border border-slate-200' : 'bg-white hover:bg-slate-50'}`}
                >
                  {/* Compact Row */}
                  <div
                    className="flex items-center py-4 px-0 cursor-pointer gap-2"
                    onClick={(e) => toggleExpand(e, session.id)}
                  >
                    {/* Visual Indicator */}
                    <div className="w-8 flex-shrink-0 flex justify-center">
                      <div className={`w-3 h-3 border border-slate-100/80 shadow-sm border border-slate-200 ${isProcessing ? 'bg-indigo-400 animate-pulse' : hasIssues ? 'bg-amber-400' : 'bg-success'}`} />
                    </div>

                    {/* User & Device */}
                    <div className="flex-1 min-w-0 px-2">
                      <div className="flex items-center gap-2 mb-1">
                        <h3
                          className={`font-semibold text-sm text-slate-900 font-mono truncate ${isProcessing ? 'opacity-50' : ''}`}
                          title={userId}
                        >
                          {displayUserId}
                        </h3>
                        {userId !== 'Anonymous' && (
                          <button
                            onClick={(e) => handleCopyUserId(e, userId)}
                            className="text-slate-400 hover:text-slate-900 transition-colors"
                          >
                            {copiedId === userId ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                          </button>
                        )}
                      </div>
                      <div className={`flex items-center gap-2 text-[10px] text-slate-500 uppercase font-bold tracking-tight ${isProcessing ? 'opacity-50' : ''}`}>
                        <span className="truncate max-w-[120px]">{session.deviceModel || 'Unknown Device'}</span>
                        <span className="w-1 h-1 bg-slate-900"></span>
                        <span>v{session.appVersion || '?.?.?'}</span>
                      </div>
                    </div>

                    {/* Date (Desktop) */}
                    <div className="hidden lg:block w-32 px-2">
                      <div className="text-xs font-bold text-slate-900">{new Date(session.startedAt).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-500 font-mono font-bold">{new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>

                    {/* Location */}
                    <div className="hidden lg:block w-40 px-2">
                      <div className={`leading-tight ${isProcessing ? 'opacity-50' : ''}`}>
                        <div className={`flex items-center gap-1.5 text-xs font-bold ${geoDisplay.hasLocation ? 'text-slate-900' : 'text-slate-400'}`}>
                          <span className="text-sm leading-none">{geoDisplay.flagEmoji}</span>
                          <span className="truncate">{geoDisplay.countryLabel || 'Unknown'}</span>
                        </div>
                        <div className="pl-5 text-[10px] font-bold text-slate-500 truncate">
                          {geoDisplay.cityLabel || (geoDisplay.hasLocation ? 'City Unknown' : 'Unknown location')}
                        </div>
                      </div>
                    </div>

                    {/* Duration */}
                    <div className="hidden md:block w-24 text-right px-2">
                      {isProcessing ? (
                        <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1 py-0.5 animate-pulse rounded-sm">
                          LIVE INGEST
                        </span>
                      ) : (
                        <span className="text-xs font-mono font-bold text-slate-900 border border-slate-100/80 bg-slate-100 px-1 py-0.5 shadow-sm border border-slate-200">
                          {Math.floor(session.durationSeconds / 60)}:{String(session.durationSeconds % 60).padStart(2, '0')}
                        </span>
                      )}
                    </div>

                    {/* Screens */}
                    <div className="hidden lg:block w-24 text-right px-2">
                      <span className={`text-xs font-semibold ${screensCount > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{screensCount}</span>
                    </div>

                    {/* API Metrics */}
                    <div className="hidden xl:block w-24 text-right px-2">
                      {(session.apiAvgResponseMs || 0) > 0 ? (
                        <span className={`text-xs font-mono font-bold ${session.apiAvgResponseMs > 1000 ? 'text-red-600' : session.apiAvgResponseMs > 500 ? 'text-amber-600' : 'text-slate-900'}`}>
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

                    {/* Notes */}
                    <div className="w-56 flex justify-end gap-1 px-2 items-center flex-wrap">
                      {session.isFirstSession && <NeoBadge variant="info" size="sm">NEW</NeoBadge>}
                      {!hasIssues && <NeoBadge variant="success" size="sm">HEALTHY</NeoBadge>}
                      {(session.crashCount || 0) > 0 && <NeoBadge variant="danger" size="sm">CRASH</NeoBadge>}
                      {((session as any).anrCount || 0) > 0 && <NeoBadge variant="warning" size="sm">ANR</NeoBadge>}
                      {((session as any).errorCount || 0) > 0 && <NeoBadge variant="warning" size="sm">ERRORS</NeoBadge>}
                      {(session.rageTapCount || 0) > 0 && <NeoBadge variant="danger" size="sm">RAGE TAP</NeoBadge>}
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
                      className={`w-10 h-8 flex items-center justify-center rounded-md border-2 border-transparent transition-all group/play ${isProcessing ? 'cursor-not-allowed opacity-20' : 'hover:border-slate-100/80 hover:bg-slate-900 hover:text-white'}`}
                      title={isProcessing ? "Session is still processing" : "Open Replay"}
                    >
                      <Play size={16} className={isProcessing ? "" : "group-hover/play:fill-white"} />
                    </button>

                    {/* Expand Toggle */}
                    <button
                      onClick={(e) => toggleExpand(e, session.id)}
                      className={`w-10 h-8 flex items-center justify-center rounded-md border-2 border-transparent hover:border-slate-100/80 transition-all ${isExpanded ? 'bg-slate-900 text-white shadow-sm border border-slate-200' : 'text-slate-900 hover:shadow-sm border border-slate-200'
                        }`}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-14 pb-4 pt-1">
                      <NeoCard variant="flat" className="p-4 bg-white border border-slate-100/80 shadow-sm border border-slate-200">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                          {/* Performance Stats */}
                          <div className="space-y-2">
                            <h4 className="font-semibold text-slate-900 uppercase tracking-wider text-[10px] border-b-2 border-slate-200 pb-1">Performance</h4>

                            <div className="flex justify-between items-center pb-1">
                              <span className="text-slate-600 font-bold text-xs uppercase">Startup</span>
                              <span className={`font-mono font-bold ${((session as any).appStartupTimeMs || 0) > 2000 ? 'text-red-600' : 'text-emerald-600'}`}>
                                {((session as any).appStartupTimeMs || 0).toFixed(0)}ms
                              </span>
                            </div>
                            <div className="flex justify-between items-center pb-1">
                              <span className="text-slate-600 font-bold text-xs uppercase">API Latency</span>
                              <span className="font-mono font-bold text-slate-900">{(session.apiAvgResponseMs || 0).toFixed(0)}ms</span>
                            </div>
                          </div>

                          {/* Network & Device */}
                          <div className="space-y-2">
                            <h4 className="font-semibold text-slate-900 uppercase tracking-wider text-[10px] border-b-2 border-slate-200 pb-1">Environment</h4>

                            <div className="flex justify-between items-center pb-1">
                              <span className="text-slate-600 font-bold text-xs uppercase">Network</span>
                              <div className="flex items-center gap-1.5 font-bold text-slate-900 uppercase text-xs">
                                <NetworkIcon type={networkType} />
                                <span>{networkType || 'Unknown'}</span>
                              </div>
                            </div>
                            <div className="flex justify-between items-center pb-1">
                              <span className="text-slate-600 font-bold text-xs uppercase">OS Version</span>
                              <span className="font-bold text-slate-900 text-xs">{session.osVersion || 'Unknown'}</span>
                            </div>
                            <div className="flex justify-between items-center pb-1 gap-2">
                              <span className="text-slate-600 font-bold text-xs uppercase">Location</span>
                              <span className="font-bold text-slate-900 text-xs truncate max-w-[140px] text-right">
                                {geoDisplay.flagEmoji} {geoDisplay.fullLabel}
                              </span>
                            </div>
                          </div>

                          {/* API Reliability */}
                          <div className="space-y-2">
                            <h4 className="font-semibold text-slate-900 uppercase tracking-wider text-[10px] border-b-2 border-slate-200 pb-1">API</h4>
                            <div className="flex gap-2">
                              <div className="flex-1 bg-emerald-50 border-2 border-emerald-200 p-2 text-center rounded-sm">
                                <div className="text-emerald-700 font-semibold font-mono text-lg leading-none">{session.apiSuccessCount || 0}</div>
                                <div className="text-[9px] uppercase font-bold text-emerald-500">Success</div>
                              </div>
                              <div className="flex-1 bg-red-50 border-2 border-red-200 p-2 text-center rounded-sm">
                                <div className="text-red-600 font-semibold font-mono text-lg leading-none">{session.apiErrorCount || 0}</div>
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

          {/* Pagination & Info Bar */}
          {filteredSessions.length > 0 && (
            <div className="flex items-center justify-between border-t border-slate-200 py-4 px-6 flex-wrap gap-3">
              {/* Left: Showing X-Y of Z */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500">
                  Showing <span className="text-slate-900">{startIndex}–{endIndex}</span> of{' '}
                  <span className="text-slate-900">{filteredSessions.length.toLocaleString()}</span> loaded
                  {totalCount > filteredSessions.length && (
                    <span className="text-slate-400"> ({totalCount.toLocaleString()} total)</span>
                  )}
                </span>
                {hasMore && (
                  <NeoButton
                    variant="secondary"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    rightIcon={isLoadingMore ? <Loader size={12} className="animate-spin" /> : undefined}
                  >
                    Load More
                  </NeoButton>
                )}
              </div>

              {/* Center: Page Navigation */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="First page"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-3 py-1 text-xs font-bold text-slate-700">
                  Page {currentPage} of {totalPages || 1}
                </span>
                <button
                  onClick={async () => {
                    if (currentPage === totalPages && hasMore && !isLoadingMore) {
                      await handleLoadMore();
                      setCurrentPage(p => p + 1);
                    } else if (currentPage < totalPages) {
                      setCurrentPage(p => p + 1);
                    }
                  }}
                  disabled={(currentPage >= totalPages && !hasMore) || isLoadingMore}
                  className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Last page"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>

              {/* Right: Per-page selector */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Per page:</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-slate-200 shadow-sm rounded-md px-2 py-1 text-xs font-bold outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
