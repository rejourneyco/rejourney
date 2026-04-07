import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
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
  X,
  UserPlus,
} from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TimeFilter, TimeRange, DEFAULT_TIME_RANGE, TIME_RANGE_OPTIONS } from '~/shared/ui/core/TimeFilter';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { getSessionsArchiveTotalCount, getSessionsPaginated, getAvailableFilters } from '~/shared/api/client';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useSafeTeam } from '~/shared/providers/TeamContext';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import {
  matchesSessionArchiveIssueFilter,
  SESSION_ARCHIVE_ISSUE_FILTER_OPTIONS,
  type SessionArchiveIssueFilter,
} from './sessionArchiveFilters';

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

const ISSUE_FILTER_ICONS: Record<SessionArchiveIssueFilter, React.ComponentType<{ className?: string }>> = {
  all: Layers,
  crashes: AlertOctagon,
  errors: AlertTriangle,
  anrs: Clock,
  rage: Zap,
  dead_taps: MousePointerClick,
  slow_start: Timer,
  slow_api: Gauge,
  new_user: UserPlus,
};

const hasSuccessfulRecording = (session: any): boolean =>
  Boolean(session?.hasSuccessfulRecording ?? ((session?.stats?.screenshotSegmentCount ?? 0) > 0));

const formatArchiveScopeLabel = (timeRange: TimeRange, dateFilter: string): string => {
  if (dateFilter) {
    const parsedDate = new Date(`${dateFilter}T00:00:00.000Z`);
    if (!Number.isNaN(parsedDate.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(parsedDate);
    }
    return dateFilter;
  }

  return TIME_RANGE_OPTIONS.find((option) => option.value === timeRange)?.label ?? timeRange;
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
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(50);

  // Advanced Filters
  const [availableFilters, setAvailableFilters] = useState<{ events: string[]; eventPropertyKeys: string[]; metadata: Record<string, string[]> }>({ events: [], eventPropertyKeys: [], metadata: {} });
  const [eventNameFilter, setEventNameFilter] = useState('');
  const [metaKeyFilter, setMetaKeyFilter] = useState('');
  const [metaValueFilter, setMetaValueFilter] = useState('');
  const [eventCountOp, setEventCountOp] = useState('');
  const [eventCountValue, setEventCountValue] = useState('');
  const [eventPropKey, setEventPropKey] = useState('');
  const [eventPropValue, setEventPropValue] = useState('');

  const [dateFilter, setDateFilter] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [filter, setFilter] = useState<SessionArchiveIssueFilter>('all');
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
      const demoFilteredSessions = demoSessions.filter((session) => hasSuccessfulRecording(session) && matchesSessionArchiveIssueFilter(session, filter));
      if (requestId !== activeRequestIdRef.current) return;
      setSessions(demoFilteredSessions);
      setNextCursor(null);
      setHasMore(false);
      setTotalCount(demoFilteredSessions.length);
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
        setTotalCount(null);
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
        setTotalCount(null);
      }

      const archiveQuery = {
        cursor,
        limit: rowsPerPage,
        timeRange: timeRange === 'all' ? undefined : timeRange,
        date: dateFilter ? dateFilter : undefined,
        projectId: selectedProjectId,
        hasRecording: true as const,
        issueFilter: filter,
        metaKey: metaKeyFilter ? metaKeyFilter : undefined,
        metaValue: metaValueFilter ? metaValueFilter : undefined,
        eventName: eventNameFilter ? eventNameFilter : undefined,
        eventCountOp: eventCountOp ? eventCountOp : undefined,
        eventCountValue: eventCountValue ? eventCountValue : undefined,
        eventPropKey: eventPropKey ? eventPropKey : undefined,
        eventPropValue: eventPropValue ? eventPropValue : undefined,
        includeTotal: false as const,
      };

      const result = await getSessionsPaginated(archiveQuery);

      if (requestId !== activeRequestIdRef.current) return;

      if (cursor) {
        // Append to existing sessions
        setSessions(prev => [...prev, ...result.sessions]);
      } else {
        // Replace all sessions; total count runs as a follow-up (same filters, avoids slow count(*) blocking first paint)
        setSessions(result.sessions);
        void getSessionsArchiveTotalCount({
          timeRange: archiveQuery.timeRange,
          date: archiveQuery.date,
          projectId: selectedProjectId!,
          hasRecording: true,
          issueFilter: archiveQuery.issueFilter,
          metaKey: archiveQuery.metaKey,
          metaValue: archiveQuery.metaValue,
          eventName: archiveQuery.eventName,
          eventCountOp: archiveQuery.eventCountOp,
          eventCountValue: archiveQuery.eventCountValue,
          eventPropKey: archiveQuery.eventPropKey,
          eventPropValue: archiveQuery.eventPropValue,
        }).then((n) => {
          if (requestId !== activeRequestIdRef.current) return;
          setTotalCount(n);
        }).catch(() => {
          if (requestId !== activeRequestIdRef.current) return;
          setTotalCount(null);
        });
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
  }, [timeRange, isDemoMode, demoSessions, selectedProjectId, isContextLoading, isProjectFromCurrentTeam, filter, metaKeyFilter, metaValueFilter, eventNameFilter, rowsPerPage, dateFilter, eventCountOp, eventCountValue, eventPropKey, eventPropValue]);

  // Initial fetch and refetch when time range or project changes
  const fetchScopeKey = `${isDemoMode ? 'demo' : 'live'}:${timeRange}:${dateFilter}:${currentTeam?.id || 'no-team'}:${selectedProjectId || 'no-project'}:${isContextLoading ? 'loading' : 'ready'}:${projects.length}:${isProjectFromCurrentTeam ? 'valid' : 'invalid'}:${filter}:${metaKeyFilter}:${metaValueFilter}:${eventNameFilter}:${rowsPerPage}:${eventCountOp}:${eventCountValue}:${eventPropKey}:${eventPropValue}`;

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

  // Reset advanced-filter dropdown data when project/team changes (loaded lazily when panel opens — JSONB scans are expensive)
  const prevProjectIdRef = useRef<string | undefined>(undefined);
  const advancedFiltersFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedProjectId || !isProjectFromCurrentTeam) {
      setAvailableFilters({ events: [], eventPropertyKeys: [], metadata: {} });
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
      setAvailableFilters({ events: [], eventPropertyKeys: [], metadata: {} });
      advancedFiltersFetchedRef.current = null;
    }
  }, [selectedProjectId, isProjectFromCurrentTeam]);

  useEffect(() => {
    if (isDemoMode || !showAdvancedFilters || !selectedProjectId || !isProjectFromCurrentTeam) {
      return;
    }
    if (advancedFiltersFetchedRef.current === selectedProjectId) {
      return;
    }
    advancedFiltersFetchedRef.current = selectedProjectId;
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
          setAvailableFilters({ events: [], eventPropertyKeys: [], metadata: {} });
        }
      });
    return () => { cancelled = true; };
  }, [isDemoMode, showAdvancedFilters, selectedProjectId, isProjectFromCurrentTeam]);

  const handleLoadMore = useCallback(async () => {
    if (nextCursor && !isLoadingMore) {
      await fetchSessions(nextCursor, activeRequestIdRef.current);
    }
  }, [nextCursor, isLoadingMore, fetchSessions]);

  // Search matches only rows already loaded (server has no text search on this endpoint).
  // Issue pills, time range, metadata, etc. are applied on the server across the full archive;
  // use Load more / next page to fetch additional matching rows in stable order.
  // Only show sessions with successful screenshot recordings.
  const filteredSessions = useMemo(() => {
    let result = sessions.filter(session => {
      if (!hasSuccessfulRecording(session)) return false;

      const matchesSearch =
        session.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (session.userId && session.userId.toLowerCase().includes(searchQuery.toLowerCase())) ||
        ((session as any).anonymousDisplayName && (session as any).anonymousDisplayName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (session.deviceModel && session.deviceModel.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;
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
  }, [sessions, searchQuery, sortConfigs]);

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
  const archiveScopeLabel = formatArchiveScopeLabel(timeRange, dateFilter);
  const archiveCountLabel = `${totalCount === null ? '…' : totalCount.toLocaleString()} total replays · ${archiveScopeLabel}`;

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

  if (isLoading && (selectedProjectId || isContextLoading)) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans text-slate-900 bg-transparent">
      {/* Main Header — scrolls away with page */}
      <div className="bg-white shrink-0">
        <DashboardPageHeader
          title="Session Archive"
          subtitle={selectedProjectId ? archiveCountLabel : 'Browse, filter & replay user sessions'}
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
              params.append('hasRecording', 'true');
              if (filter !== 'all') params.append('issueFilter', filter);
              if (metaKeyFilter) params.append('metaKey', metaKeyFilter);
              if (metaValueFilter) params.append('metaValue', metaValueFilter);
              if (eventNameFilter) params.append('eventName', eventNameFilter);
              if (eventCountOp) params.append('eventCountOp', eventCountOp);
              if (eventCountValue) params.append('eventCountValue', eventCountValue);
              if (eventPropKey) params.append('eventPropKey', eventPropKey);
              if (eventPropValue) params.append('eventPropValue', eventPropValue);
              window.location.href = `/api/sessions/export?${params.toString()}`;
            }}
            className="bg-black text-white p-2 border-2 border-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all"
            title="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </DashboardPageHeader>

        {/* Search & Controls Row */}
        <div className="bg-white border-b border-gray-200 px-6 py-1.5">
          <div className="flex items-center gap-2 max-w-[1800px] mx-auto">
            <div className="relative flex-1 group min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
              <input
                type="text"
                placeholder="SEARCH SESSION, USER, DEVICE..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border-2 border-black font-bold text-sm uppercase placeholder:text-gray-400 focus:outline-none focus:border-[#5dadec] transition-all"
              />
            </div>

            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className={`bg-white border-2 border-black px-3 py-2 text-xs font-bold outline-none max-w-[150px] ${dateFilter ? 'border-[#5dadec] text-black' : 'border-black text-gray-500'}`}
              title="Filter by specific date"
            />

            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase rounded-none border shadow-sm transition-colors whitespace-nowrap ${showAdvancedFilters || advancedFilterCount > 0
                ? 'bg-[#5dadec]/10 border-[#5dadec] text-black'
                : 'bg-white border-2 border-black text-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Filters
              {advancedFilterCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold bg-black text-white leading-none">
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
                className="flex items-center gap-1 px-2.5 py-2 text-[#ef4444] border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-none transition-all font-bold uppercase text-[10px]"
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
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#f4f4f5] border border-gray-300 text-[10px] font-bold text-black uppercase">
                  Event: {eventNameFilter}
                  <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => setEventNameFilter('')} />
                </span>
              )}
              {eventPropKey && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#f4f4f5] border border-gray-300 text-[10px] font-bold text-black uppercase">
                  Prop: {eventPropKey}{eventPropValue ? ` = ${eventPropValue}` : ''}
                  <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => { setEventPropKey(''); setEventPropValue(''); }} />
                </span>
              )}
              {metaKeyFilter && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#f4f4f5] border border-gray-300 text-[10px] font-bold text-black uppercase">
                  {metaKeyFilter}{metaValueFilter ? ` = ${metaValueFilter}` : ''}
                  <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => { setMetaKeyFilter(''); setMetaValueFilter(''); }} />
                </span>
              )}
              {eventCountOp && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#f4f4f5] border border-gray-300 text-[10px] font-bold text-black uppercase">
                  Events {eventCountOp === 'eq' ? '=' : eventCountOp === 'gt' ? '>' : eventCountOp === 'lt' ? '<' : eventCountOp === 'gte' ? '≥' : '≤'} {eventCountValue}
                  <X className="w-2.5 h-2.5 cursor-pointer hover:text-red-500" onClick={() => { setEventCountOp(''); setEventCountValue(''); }} />
                </span>
              )}
            </div>
          )}
        </div>

        {/* Issue Filter Pills */}
        <div className="bg-white border-b border-gray-200 px-6 py-1.5 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-2 max-w-[1800px] mx-auto">
            {SESSION_ARCHIVE_ISSUE_FILTER_OPTIONS.map((f) => {
              const Icon = ISSUE_FILTER_ICONS[f.id];
              const isActive = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 font-bold text-[10px] uppercase border transition-all whitespace-nowrap shadow-sm hover:-translate-y-0.5
                    ${isActive
                    ? f.id === 'new_user'
                      ? 'bg-[#34d399] text-black border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                      : 'bg-black text-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                    : f.id === 'new_user'
                      ? 'bg-white border-2 border-black text-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                      : 'bg-white border-2 border-black text-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'}`}
                >
                  <Icon className="w-3 h-3" />
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Advanced Filters Panel — below issue pills, no overlap */}
        {showAdvancedFilters && (
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="max-w-[1800px] mx-auto space-y-3">
              {/* Events Section — event name required; count & property optional */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider w-20 shrink-0">🏷️ Events</span>
                <span className="text-[10px] text-slate-400">Event name</span>
                <div className="w-px h-5 bg-slate-200 mx-1" />
                <select
                  value={eventNameFilter}
                  onChange={(e) => setEventNameFilter(e.target.value)}
                  className={`bg-white border-2 border-black rounded-none px-3 py-1.5 uppercase outline-none focus:border-indigo-500 font-bold max-w-[200px] text-ellipsis text-xs ${eventNameFilter ? 'border-[#5dadec] text-black' : 'border-black text-black'}`}
                  title="Event name — e.g. purchase_completed"
                >
                  <option value="">ALL EVENTS</option>
                  {availableFilters.events.map(event => (
                    <option key={event} value={event}>{event}</option>
                  ))}
                </select>

                {eventNameFilter && (
                  <>
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    <span className="text-[10px] text-slate-400">Count <span className="text-slate-300">(optional)</span></span>
                    <select
                      value={eventCountOp}
                      onChange={(e) => { setEventCountOp(e.target.value); if (!e.target.value) setEventCountValue(''); }}
                      className={`bg-white border-2 border-black rounded-none px-2 py-1.5 outline-none focus:border-indigo-500 font-bold text-xs w-16 ${eventCountOp ? 'border-[#5dadec] text-black' : 'border-black text-black'}`}
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
                  </>
                )}

                <div className="w-px h-5 bg-slate-200 mx-1" />

                <span className="text-[10px] text-slate-400">Property <span className="text-slate-300">(optional)</span></span>
                <select
                  value={eventPropKey}
                  onChange={(e) => { setEventPropKey(e.target.value); if (!e.target.value) setEventPropValue(''); }}
                  className={`bg-white border-2 border-black rounded-none px-3 py-1.5 outline-none focus:border-violet-500 font-bold max-w-[180px] text-ellipsis text-xs ${eventPropKey ? 'border-[#5dadec] text-black' : 'border-black text-black'}`}
                  title="Event property — e.g. plan, amount"
                >
                  <option value="">ANY</option>
                  {availableFilters.eventPropertyKeys.map(key => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
                {eventPropKey && (
                  <>
                    <span className="text-[10px] text-slate-400">=</span>
                    <input
                      type="text"
                      value={eventPropValue}
                      onChange={(e) => setEventPropValue(e.target.value)}
                      placeholder="any value"
                      className={`bg-white border-2 border-black rounded-none px-2 py-1.5 outline-none focus:border-violet-500 font-bold text-xs w-28 ${eventPropValue ? 'border-[#5dadec] text-black' : 'border-black text-black placeholder:text-gray-400'}`}
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
                  className={`bg-white border-2 border-black rounded-none px-3 py-1.5 uppercase outline-none focus:border-emerald-500 font-bold max-w-[200px] text-ellipsis text-xs ${metaKeyFilter ? 'border-[#5dadec] text-black' : 'border-black text-black'}`}
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
                  className={`bg-white border-2 border-black rounded-none px-3 py-1.5 uppercase outline-none focus:border-emerald-500 font-bold max-w-[200px] text-ellipsis text-xs ${!metaKeyFilter ? 'opacity-50 cursor-not-allowed border-black' : metaValueFilter ? 'border-[#5dadec] text-black' : 'border-black text-black'}`}
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
      </div>

      {/* List Content — table header sticks when scrolling */}
      <div className="flex-1 w-full max-w-full px-4 sm:px-6 pt-4 pb-24 overflow-x-auto">
        <div className="bg-white border-b border-gray-200 overflow-hidden w-full" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-[#f4f4f5] border-b-2 border-black">
                <th className="sticky top-0 z-40 bg-[#f4f4f5] w-10 py-2.5 pl-4 pr-2" />
                <th className="sticky top-0 z-40 bg-[#f4f4f5] text-left py-2.5 px-3 text-[11px] font-semibold font-mono text-black uppercase tracking-wider min-w-[140px]">User & Device</th>
                <th className="sticky top-0 z-40 bg-[#f4f4f5] hidden lg:table-cell text-left py-2.5 px-3 text-[11px] font-semibold font-mono text-black uppercase tracking-wider w-32"><SortableHeader label="Date" sortKey="date" /></th>
                <th className="sticky top-0 z-40 bg-[#f4f4f5] hidden lg:table-cell text-left py-2.5 px-3 text-[11px] font-semibold font-mono text-black uppercase tracking-wider w-36">Location</th>
                <th className="sticky top-0 z-40 bg-[#f4f4f5] hidden md:table-cell text-right py-2.5 px-3 text-[11px] font-semibold font-mono text-black uppercase tracking-wider w-28 min-w-[7rem]"><SortableHeader label="Duration" sortKey="duration" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#f4f4f5] hidden lg:table-cell text-right py-2.5 px-3 text-[11px] font-semibold font-mono text-black uppercase tracking-wider w-16"><SortableHeader label="Screens" sortKey="screens" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#f4f4f5] hidden xl:table-cell text-right py-2.5 px-3 text-[11px] font-semibold font-mono text-black uppercase tracking-wider w-20"><SortableHeader label="API Lat." sortKey="apiResponse" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#f4f4f5] hidden xl:table-cell text-right py-2.5 px-3 text-[11px] font-semibold font-mono text-black uppercase tracking-wider w-20"><SortableHeader label="API Err" sortKey="apiError" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#f4f4f5] text-right py-2.5 px-3 text-[11px] font-semibold font-mono text-black uppercase tracking-wider w-36"><SortableHeader label="Notes" sortKey="crashes" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#f4f4f5] w-12 py-2.5 pl-2 pr-4" />
                <th className="sticky top-0 z-40 bg-[#f4f4f5] w-12 py-2.5 pl-2 pr-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
            {paginatedSessions.length === 0 && (
              <tr>
                <td colSpan={11} className="py-16 text-center">
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
                </td>
              </tr>
            )}

            {paginatedSessions.map((session, rowIndex) => {
              const isExpanded = expandedSessionId === session.id;
              const isZebraEven = rowIndex % 2 === 0;
              const screensCount = (session as any).screensVisited?.length || 0;
              const networkType = (session as any).networkType || (session as any).cellularGeneration;
              const userId = session.userId || (session as any).anonymousDisplayName || 'Anonymous';
              // Truncate after 25 chars for a slightly less aggressive truncation
              const displayUserId = userId.length > 20 ? userId.substring(0, 20) + '…' : userId;

              // Performance issue detection
              const hasSlowStart = ((session as any).appStartupTimeMs || 0) > 3000;
              const hasSlowApi = (session.apiAvgResponseMs || 0) > 1000;
              const durationMinutes = session.durationSeconds / 60;
              const hasDeadTaps = ((session as any).deadTapCount || 0) > 0;
              const geoDisplay = formatGeoDisplay((session as any).geoLocation);

              const hasReplay = hasSuccessfulRecording(session);
              const effectiveStatus = (session as any).effectiveStatus || session.status;
              const canOpenReplay = (session as any).canOpenReplay ?? hasReplay;
              const isLiveIngest = Boolean((session as any).isLiveIngest);
              const isBackgroundProcessing = Boolean((session as any).isBackgroundProcessing);
              /** Open session detail even while replay is still preparing (timeline/logs are useful). */
              const canNavigateToSession =
                canOpenReplay ||
                isLiveIngest ||
                isBackgroundProcessing ||
                effectiveStatus === 'processing' ||
                session.status === 'processing' ||
                session.status === 'pending' ||
                hasReplay;
              const isReplayBlocked = !canNavigateToSession;

              /** One label for the duration column: live ingest, or replay not ready yet. Otherwise show MM:SS. */
              const showLiveReplayInDurationColumn =
                isLiveIngest ||
                (!canOpenReplay &&
                  (isBackgroundProcessing ||
                    effectiveStatus === 'processing' ||
                    session.status === 'processing' ||
                    session.status === 'pending'));

              const hasIssues = (session.crashCount || 0) > 0 ||
                ((session as any).anrCount || 0) > 0 ||
                ((session as any).errorCount || 0) > 0 ||
                (session.rageTapCount || 0) > 0 ||
                hasDeadTaps ||
                hasSlowStart || hasSlowApi;

              return (
                <React.Fragment key={session.id}>
                <tr
                  className={`cursor-pointer transition-colors ${isExpanded ? 'bg-[#f4f4f5]' : isZebraEven ? 'bg-white hover:bg-gray-100' : 'bg-[#f4f4f5] hover:bg-gray-200'}`}
                  onClick={(e) => toggleExpand(e, session.id)}
                >
                    {/* Visual Indicator */}
                    <td className="w-10 py-2.5 pl-4 pr-2 align-middle text-center">
                      <div className={`w-2.5 h-2.5 rounded-sm mx-auto ${isReplayBlocked ? 'bg-slate-400 animate-pulse' : hasIssues ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    </td>

                    {/* User & Device */}
                    <td className="py-2.5 px-3 align-middle overflow-hidden min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3
                          className={`font-semibold text-sm text-slate-900 font-mono truncate shrink min-w-0 ${isReplayBlocked ? 'opacity-50' : ''}`}
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
                      <div className={`flex items-center gap-2 text-[10px] text-slate-600 uppercase font-medium tracking-tight mt-0.5 min-w-0 overflow-hidden ${isReplayBlocked ? 'opacity-50' : ''}`}>
                        <span className="truncate min-w-0">{session.deviceModel || 'Unknown Device'}</span>
                        <span className="w-1 h-1 bg-slate-900"></span>
                        <span>v{session.appVersion || '?.?.?'}</span>
                      </div>
                    </td>

                    {/* Date (Desktop) */}
                    <td className="hidden lg:table-cell py-2.5 px-3 align-middle w-32">
                      <div className="text-xs font-semibold text-slate-800">{new Date(session.startedAt).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-600 font-mono">{new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>

                    {/* Location */}
                    <td className="hidden lg:table-cell py-2.5 px-3 align-middle w-36 overflow-hidden">
                      <div className={`leading-tight ${isReplayBlocked ? 'opacity-50' : ''}`}>
                        {geoDisplay.hasLocation ? (
                          <>
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                              <span className="text-sm leading-none">{geoDisplay.flagEmoji}</span>
                              <span className="truncate">{geoDisplay.countryLabel}</span>
                            </div>
                            <div className="pl-5 text-[10px] font-bold text-slate-500 truncate">
                              {geoDisplay.cityLabel || 'City Unknown'}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs font-medium text-slate-400">—</span>
                        )}
                      </div>
                    </td>

                    {/* Duration: LIVE REPLAY while ingest / replay preparing; MM:SS once replay is playable (or session ended) and not live-ingesting */}
                    <td className="hidden md:table-cell py-2.5 px-3 align-middle text-right w-28 min-w-[7rem]">
                      {showLiveReplayInDurationColumn ? (
                        <span className="inline-flex items-center justify-end whitespace-nowrap text-[9px] font-semibold leading-none text-black bg-[#34d399]/20 border border-[#34d399] px-1.5 py-1 animate-pulse">
                          LIVE REPLAY
                        </span>
                      ) : (
                        <span className="text-xs font-mono font-medium text-black bg-[#f4f4f5] border border-gray-300 px-1.5 py-0.5">
                          {Math.floor(session.durationSeconds / 60)}:{String(session.durationSeconds % 60).padStart(2, '0')}
                        </span>
                      )}
                    </td>

                    {/* Screens */}
                    <td className="hidden lg:table-cell py-2.5 px-3 align-middle text-right w-16">
                      <span className={`text-xs font-semibold ${screensCount > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{screensCount}</span>
                    </td>

                    {/* API Metrics */}
                    <td className="hidden xl:table-cell py-2.5 px-3 align-middle text-right w-20">
                      {(session.apiAvgResponseMs || 0) > 0 ? (
                        <span className={`text-xs font-mono font-medium ${session.apiAvgResponseMs > 1000 ? 'text-amber-700' : session.apiAvgResponseMs > 500 ? 'text-slate-600' : 'text-slate-700'}`}>
                          {Math.round(session.apiAvgResponseMs)}ms
                        </span>
                      ) : <span className="text-slate-300 text-xs">-</span>}
                    </td>
                    <td className="hidden xl:table-cell py-2.5 px-3 align-middle text-right w-20">
                      {(session.apiErrorCount || 0) > 0 ? (
                        <span className="inline-block text-xs font-mono font-medium text-[#ef4444] bg-[#f4f4f5] border border-gray-300 px-1.5 py-0.5">
                          {session.apiErrorCount}
                        </span>
                      ) : <span className="text-slate-300 text-xs">-</span>}
                    </td>

                    {/* Notes */}
                    <td className="py-2.5 px-3 align-middle text-right w-36">
                      <div className="flex justify-end gap-1.5 items-center flex-wrap min-h-[28px]">
                      {session.isFirstSession && (
                        <span
                          className="inline-flex items-center rounded-md border border-emerald-800 bg-emerald-950/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-emerald-900"
                          title="First recorded session for this visitor in this project"
                        >
                          NEW USER
                        </span>
                      )}
                      {!hasIssues && <NeoBadge variant="success" size="sm">HEALTHY</NeoBadge>}
                      {(session.crashCount || 0) > 0 && <NeoBadge variant="danger" size="sm">CRASH</NeoBadge>}
                      {((session as any).anrCount || 0) > 0 && <NeoBadge variant="neutral" size="sm">ANR</NeoBadge>}
                      {((session as any).errorCount || 0) > 0 && <NeoBadge variant="neutral" size="sm">ERR</NeoBadge>}
                      {(session.rageTapCount || 0) > 0 && <NeoBadge variant="danger" size="sm">RAGE</NeoBadge>}
                      {hasDeadTaps && <NeoBadge variant="neutral" size="sm">DEAD</NeoBadge>}
                      {hasSlowStart && <NeoBadge variant="neutral" size="sm">SLOW</NeoBadge>}
                      {hasSlowApi && <NeoBadge variant="neutral" size="sm">API</NeoBadge>}
                      </div>
                    </td>

                    {/* Play - icon only, no box */}
                    <td className="w-12 py-2.5 pl-2 pr-4 align-middle text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canNavigateToSession) {
                            navigate(`${pathPrefix}/sessions/${session.id}`);
                          }
                        }}
                        disabled={!canNavigateToSession}
                        className={`inline-flex items-center justify-center p-1.5 rounded transition-colors group/play ${isReplayBlocked ? 'cursor-not-allowed opacity-40 text-slate-300' : 'text-slate-600 hover:text-slate-900'}`}
                        title={
                          !canNavigateToSession
                            ? 'Replay unavailable for this session'
                            : !canOpenReplay
                              ? 'Open session — visual replay may still be preparing'
                              : isLiveIngest
                                ? 'Open Live Replay'
                                : isBackgroundProcessing
                                  ? 'Open session while processing continues'
                                  : 'Open Replay'
                        }
                      >
                        <Play size={16} className={isReplayBlocked ? "" : "group-hover/play:fill-current"} />
                      </button>
                    </td>

                    {/* Expand Toggle - icon only, no box, extra right padding */}
                    <td className="w-12 py-2.5 pl-2 pr-6 align-middle">
                    <button
                      onClick={(e) => toggleExpand(e, session.id)}
                      className={`flex items-center justify-center p-1.5 rounded transition-colors mx-auto ${isExpanded ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    </td>
                </tr>

                  {/* Expanded Details - full-width row */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={11} className="bg-[#f4f4f5] border-b border-gray-200 p-0 align-top">
                        <div className="px-6 sm:px-8 pb-5 pt-2">
                      <NeoCard variant="flat" className="p-4 bg-white border border-gray-200" style={{ boxShadow: '2px 2px 0 0 rgba(0,0,0,0.07)' }}>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                          {/* Performance Stats */}
                          <div className="space-y-2">
                            <h4 className="font-semibold text-slate-900 uppercase tracking-wider text-[10px] border-b border-gray-300 pb-1">Performance</h4>

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
                            <h4 className="font-semibold text-slate-900 uppercase tracking-wider text-[10px] border-b border-gray-300 pb-1">Environment</h4>

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
                            <h4 className="font-semibold text-slate-900 uppercase tracking-wider text-[10px] border-b border-gray-300 pb-1">API</h4>
                            <div className="flex gap-2">
                              <div className="flex-1 bg-white border border-[#34d399] p-2 text-center rounded-sm">
                                <div className="text-[#34d399] font-semibold font-mono text-lg leading-none">{session.apiSuccessCount || 0}</div>
                                <div className="text-[9px] uppercase font-bold text-[#34d399]">Success</div>
                              </div>
                              <div className="flex-1 bg-white border border-[#ef4444] p-2 text-center rounded-sm">
                                <div className="text-[#ef4444] font-semibold font-mono text-lg leading-none">{session.apiErrorCount || 0}</div>
                                <div className="text-[9px] uppercase font-bold text-[#ef4444]">Failed</div>
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex flex-col justify-start">
                            <NeoButton
                              variant="primary"
                              size="sm"
                              onClick={() => !isReplayBlocked && navigate(`${pathPrefix}/sessions/${session.id}`)}
                              className={`w-full justify-center ${isReplayBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                              disabled={isReplayBlocked}
                            >
                              {isReplayBlocked ? (
                                <><Loader size={12} className="animate-spin mr-2" /> Unavailable</>
                              ) : !canOpenReplay ? (
                                <><Play size={12} fill="currentColor" className="mr-2" /> Open session</>
                              ) : isLiveIngest ? (
                                <><Play size={12} fill="currentColor" className="mr-2" /> Open Live Replay</>
                              ) : isBackgroundProcessing ? (
                                <><Play size={12} fill="currentColor" className="mr-2" /> Open session</>
                              ) : (
                                <><Play size={12} fill="currentColor" className="mr-2" /> Open Replay</>
                              )}
                            </NeoButton>
                          </div>
                        </div>
                      </NeoCard>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          </table>

          {/* Pagination & Info Bar */}
          {filteredSessions.length > 0 && (
            <div className="flex items-center justify-between border-t border-gray-200 py-4 px-6 flex-wrap gap-4 bg-white">
              {/* Left: Showing X-Y of Z */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500">
                  Showing <span className="text-slate-900">{startIndex}–{endIndex}</span> of{' '}
                  <span className="text-slate-900">{filteredSessions.length.toLocaleString()}</span> loaded
                  {totalCount !== null && totalCount > filteredSessions.length && (
                    <span className="text-slate-400">
                      {' '}
                      ({totalCount.toLocaleString()} matching in {archiveScopeLabel} — load more for the rest)
                    </span>
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
                  className="p-1.5 border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="First page"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
                  className="p-1.5 border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="Last page"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>

              {/* Right: Per-page selector */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-500 font-mono uppercase">Per page:</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-white border-2 border-black px-2 py-1 text-xs font-bold font-mono outline-none focus:outline-none cursor-pointer"
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

export default RecordingsList;
