import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import {
  Search,
  Smartphone,
  ChevronUp,
  ChevronDown,
  Layers,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  User,
  Database,
  X,
} from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';

import {
  getSessionsArchiveTotalCount,
  getSessionsPaginated,
  getAvailableFilters,
  type SessionArchiveSortKey,
} from '~/shared/api/client';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useSafeTeam } from '~/shared/providers/TeamContext';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { matchesSessionArchiveIssueFilter } from './sessionArchiveFilters';
import { QueryBuilder } from './QueryBuilder';
import {
  type QueryGroup,
  type IssueCondition,
  generateGroupId,
  groupsToArchiveQuery,
  groupsBuildHumanSummary,
  getConditionShortLabel,
} from './queryBuilderTypes';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 300] as const;
const QUERY_GROUPS_STORAGE_PREFIX = 'rejourney:session-archive:query-groups:v1';
const QUERY_BUILDER_UPDATE_STICKER_SEEN_KEY = 'rejourney:session-archive:query-builder-update-sticker-seen:v1';

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


const hasSuccessfulRecording = (session: any): boolean =>
  Boolean(session?.hasSuccessfulRecording ?? ((session?.stats?.screenshotSegmentCount ?? 0) > 0));

const createEmptyQueryGroups = (): QueryGroup[] => [{ id: generateGroupId(), conditions: [] }];

function getQueryGroupsStorageKey(projectId: string): string {
  return `${QUERY_GROUPS_STORAGE_PREFIX}:${projectId}`;
}

function readStoredQueryGroups(projectId: string): QueryGroup[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getQueryGroupsStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const groups = parsed.filter((group): group is QueryGroup =>
      Boolean(group) &&
      typeof group.id === 'string' &&
      Array.isArray(group.conditions)
    );
    return groups.length > 0 ? groups : null;
  } catch {
    return null;
  }
}

function writeStoredQueryGroups(projectId: string, groups: QueryGroup[]): void {
  if (typeof window === 'undefined') return;
  const hasConditions = groups.some((group) => group.conditions.length > 0);
  try {
    const key = getQueryGroupsStorageKey(projectId);
    if (hasConditions) {
      window.localStorage.setItem(key, JSON.stringify(groups));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage can fail in private mode or under quota; the query still works in memory.
  }
}

function readQueryBuilderUpdateStickerSeen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(QUERY_BUILDER_UPDATE_STICKER_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markQueryBuilderUpdateStickerSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUERY_BUILDER_UPDATE_STICKER_SEEN_KEY, '1');
  } catch {
    // Storage can fail in private mode; hiding it for the current view is still enough.
  }
}

export const RecordingsList: React.FC = () => {
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();
  const { isDemoMode, demoSessions } = useDemoMode();
  const { selectedProject, projects, isLoading: isContextLoading } = useSessionData();
  const { currentTeam } = useSafeTeam();
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(50);

  // Query builder
  const [availableFilters, setAvailableFilters] = useState<{ events: string[]; eventPropertyKeys: string[]; screens: string[]; metadata: Record<string, string[]> }>({ events: [], eventPropertyKeys: [], screens: [], metadata: {} });
  const [isLoadingFilters, setIsLoadingFilters] = useState(false);
  const [queryGroups, setQueryGroups] = useState<QueryGroup[]>(() => createEmptyQueryGroups());
  const [queryGroupsProjectId, setQueryGroupsProjectId] = useState<string | null>(null);
  const [showQueryBuilder, setShowQueryBuilder] = useState(false);
  const [hasSeenQueryBuilderUpdateSticker, setHasSeenQueryBuilderUpdateSticker] = useState(() => readQueryBuilderUpdateStickerSeen());
  const [sortConfigs, setSortConfigs] = useState<SortConfig[]>([{ key: 'date', direction: 'desc' }]);
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const activeRequestIdRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 350);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const primarySortKey: SortKey = sortConfigs[0]?.key ?? 'date';
  const primarySortDir: SortDirection = sortConfigs[0]?.direction ?? 'desc';

  const selectedProjectId = selectedProject?.id;
  const selectedProjectTeamId = selectedProject?.teamId;
  const isProjectFromCurrentTeam = !selectedProjectId || !currentTeam?.id || selectedProjectTeamId === currentTeam.id;

  // Use refs to avoid stale closures
  const queryGroupsRef = useRef(queryGroups);
  useEffect(() => { queryGroupsRef.current = queryGroups; }, [queryGroups]);

  // Fetch sessions with pagination
  const fetchSessions = useCallback(async (cursor?: string | null, requestId: number = activeRequestIdRef.current) => {
    const groups = queryGroupsRef.current;
    const allConds = groups.flatMap((g) => g.conditions);
    const issueCondition = allConds.find((c) => c.type === 'issue') as IssueCondition | undefined;
    const issueFilter = issueCondition?.issueFilter ?? 'all';

    // Demo mode: use static demo sessions
    if (isDemoMode) {
      const demoFilteredSessions = demoSessions.filter((session) => hasSuccessfulRecording(session) && matchesSessionArchiveIssueFilter(session, issueFilter));
      if (requestId !== activeRequestIdRef.current) return;
      setSessions(demoFilteredSessions);
      setNextCursor(null);
      setHasMore(false);
      setTotalCount(demoFilteredSessions.length);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    // On team/project switches, wait until context resolves to avoid cross-team bleed-through.
    if (!cursor) {
      if (isContextLoading || !isProjectFromCurrentTeam) {
        setSessions([]);
        setNextCursor(null);
        setHasMore(false);
        setIsLoading(true);
        setIsRefreshing(false);
        return;
      }

      if (!selectedProjectId) {
        // Team has no selected project yet (or no projects): don't fetch global sessions.
        setSessions([]);
        setNextCursor(null);
        setHasMore(false);
        setTotalCount(null);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }
    }

    try {
      if (cursor) {
        setIsLoadingMore(true);
      } else {
        const hasExistingRows = sessions.length > 0;
        setIsLoading(!hasExistingRows);
        setIsRefreshing(hasExistingRows);
        if (!hasExistingRows) {
          setTotalCount(null);
        }
      }

      const qLive = debouncedSearchQuery.trim() || undefined;
      const filterParams = groupsToArchiveQuery(groups);
      const archiveQuery = {
        cursor,
        limit: rowsPerPage,
        projectId: selectedProjectId,
        hasRecording: true as const,
        q: qLive,
        sort: primarySortKey as SessionArchiveSortKey,
        sortDir: primarySortDir,
        includeTotal: false as const,
        ...filterParams,
      };

      const result = await getSessionsPaginated(archiveQuery);

      if (requestId !== activeRequestIdRef.current) return;

      if (cursor) {
        // Append to existing sessions
        setSessions(prev => [...prev, ...result.sessions]);
      } else {
        // Replace all sessions; total count runs as a follow-up (avoids slow count(*) blocking first paint)
        setSessions(result.sessions);
        void getSessionsArchiveTotalCount({
          projectId: selectedProjectId!,
          hasRecording: true,
          q: qLive,
          ...filterParams,
        } as any).then((n) => {
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
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    }
  }, [
    sessions.length,
    isDemoMode,
    demoSessions,
    selectedProjectId,
    isContextLoading,
    isProjectFromCurrentTeam,
    rowsPerPage,
    debouncedSearchQuery,
    primarySortKey,
    primarySortDir,
  ]);

  // Trigger refetch when filters or project change
  const conditionsKey = queryGroups.map((g) => g.conditions.map((c) => JSON.stringify(c)).join(',')).join('|');
  const fetchScopeKeyBase = `all:${currentTeam?.id || 'no-team'}:${selectedProjectId || 'no-project'}:${isContextLoading ? 'loading' : 'ready'}:${projects.length}:${isProjectFromCurrentTeam ? 'valid' : 'invalid'}:${rowsPerPage}:${conditionsKey}`;
  const fetchScopeKey = isDemoMode
    ? `demo:${fetchScopeKeyBase}`
    : `live:${fetchScopeKeyBase}:${debouncedSearchQuery}:${primarySortKey}:${primarySortDir}`;

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

  // Reset query conditions and available filters when project/team changes
  const prevProjectIdRef = useRef<string | undefined>(undefined);
  const availableFiltersFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedProjectId || !isProjectFromCurrentTeam) {
      setAvailableFilters({ events: [], eventPropertyKeys: [], screens: [], metadata: {} });
      setQueryGroups(createEmptyQueryGroups());
      setQueryGroupsProjectId(null);
      prevProjectIdRef.current = undefined;
      return;
    }
    const projectChanged = prevProjectIdRef.current !== selectedProjectId;
    prevProjectIdRef.current = selectedProjectId;
    if (projectChanged) {
      const storedGroups = readStoredQueryGroups(selectedProjectId);
      setQueryGroups(storedGroups ?? createEmptyQueryGroups());
      setQueryGroupsProjectId(selectedProjectId);
      setAvailableFilters({ events: [], eventPropertyKeys: [], screens: [], metadata: {} });
      availableFiltersFetchedRef.current = null;
    }
  }, [selectedProjectId, isProjectFromCurrentTeam]);

  useEffect(() => {
    if (!selectedProjectId || !isProjectFromCurrentTeam) return;
    if (queryGroupsProjectId !== selectedProjectId) return;
    writeStoredQueryGroups(selectedProjectId, queryGroups);
  }, [selectedProjectId, queryGroupsProjectId, isProjectFromCurrentTeam, queryGroups]);

  // Lazy-load available filter options when query builder panel opens
  useEffect(() => {
    if (isDemoMode || !showQueryBuilder || !selectedProjectId || !isProjectFromCurrentTeam) {
      return;
    }
    if (availableFiltersFetchedRef.current === selectedProjectId) {
      return;
    }
    availableFiltersFetchedRef.current = selectedProjectId;
    setIsLoadingFilters(true);
    let cancelled = false;
    getAvailableFilters(selectedProjectId)
      .then((data) => {
        if (!cancelled) {
          setAvailableFilters(data);
          setIsLoadingFilters(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load available filters:', err);
          setAvailableFilters({ events: [], eventPropertyKeys: [], screens: [], metadata: {} });
          setIsLoadingFilters(false);
        }
      });
    return () => { cancelled = true; };
  }, [isDemoMode, showQueryBuilder, selectedProjectId, isProjectFromCurrentTeam]);

  const handleLoadMore = useCallback(async () => {
    if (nextCursor && !isLoadingMore) {
      await fetchSessions(nextCursor, activeRequestIdRef.current);
    }
  }, [nextCursor, isLoadingMore, fetchSessions]);

  // Live: search + primary column sort run on the server; only hide rows without a successful recording.
  // Demo: full static list — search and multi-column sort stay client-side.
  const filteredSessions = useMemo(() => {
    const withRecording = sessions.filter((session) => hasSuccessfulRecording(session));
    if (!isDemoMode) {
      return withRecording;
    }
    const q = searchQuery.trim().toLowerCase();
    let result = withRecording;
    if (q) {
      result = result.filter((session) => {
        return (
          session.id.toLowerCase().includes(q) ||
          (session.userId && session.userId.toLowerCase().includes(q)) ||
          ((session as any).anonymousDisplayName &&
            (session as any).anonymousDisplayName.toLowerCase().includes(q)) ||
          (session.deviceModel && session.deviceModel.toLowerCase().includes(q))
        );
      });
    }
    const sorted = [...result];
    sorted.sort((a, b) => {
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
          case 'errors':
            comparison = (a.errorCount || 0) - (b.errorCount || 0);
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
    return sorted;
  }, [sessions, isDemoMode, searchQuery, sortConfigs]);

  const handleCopyUserId = (e: React.MouseEvent, userId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(userId);
    setCopiedId(userId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, debouncedSearchQuery, sortConfigs, conditionsKey]);

  const totalPages = Math.ceil(filteredSessions.length / rowsPerPage);
  const paginatedSessions = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredSessions.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredSessions, currentPage, rowsPerPage]);

  // Computed display values
  const startIndex = (currentPage - 1) * rowsPerPage + 1;
  const endIndex = Math.min(currentPage * rowsPerPage, filteredSessions.length);
  const totalConditions = queryGroups.reduce((n, g) => n + g.conditions.length, 0);
  const hasActiveFilters = !!(searchQuery || totalConditions > 0);
  const archiveCountLabel = `${totalCount === null ? '…' : totalCount.toLocaleString()} total replays${isRefreshing ? ' · refreshing…' : ''}`;

  const handleSort = (key: SortKey, multiSort: boolean) => {
    const allowMultiColumn = isDemoMode && multiSort;
    setSortConfigs(prev => {
      const existingIndex = prev.findIndex(s => s.key === key);
      if (existingIndex >= 0) {
        const current = prev[existingIndex];
        if (current.direction === 'desc') {
          const updated = [...prev];
          updated[existingIndex] = { key, direction: 'asc' };
          return updated;
        } else {
          const next = prev.filter((_, i) => i !== existingIndex);
          return next.length > 0 ? next : [{ key: 'date' as SortKey, direction: 'desc' as SortDirection }];
        }
      } else {
        if (allowMultiColumn) {
          return [...prev, { key, direction: 'desc' }];
        }
        return [{ key, direction: 'desc' }];
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
      title={
        isDemoMode
          ? 'Click to sort, Shift+click for multi-column sort (full demo list)'
          : 'Click to sort the full archive. Shift+click is only available in demo mode — live data uses the primary column on the server.'
      }
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

  const clearQueryGroups = useCallback(() => {
    setQueryGroups(createEmptyQueryGroups());
    setQueryGroupsProjectId(selectedProjectId ?? null);
    if (selectedProjectId) {
      writeStoredQueryGroups(selectedProjectId, createEmptyQueryGroups());
    }
  }, [selectedProjectId]);

  const handleQueryButtonClick = useCallback(() => {
    if (!hasSeenQueryBuilderUpdateSticker) {
      setHasSeenQueryBuilderUpdateSticker(true);
      markQueryBuilderUpdateStickerSeen();
    }
    setShowQueryBuilder((value) => !value);
  }, [hasSeenQueryBuilderUpdateSticker]);

  if (isLoading && sessions.length === 0 && (selectedProjectId || isContextLoading)) {
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
          iconColor="bg-sky-50"
        >
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (selectedProjectId) params.append('projectId', selectedProjectId);
              params.append('hasRecording', 'true');
              const filterParams = groupsToArchiveQuery(queryGroups);
              Object.entries(filterParams).forEach(([k, v]) => {
                if (v !== undefined && v !== null) params.append(k, String(v));
              });
              const qExport = debouncedSearchQuery.trim();
              if (qExport) params.append('q', qExport);
              params.append('sort', primarySortKey);
              params.append('sortDir', primarySortDir);
              window.location.href = `/api/sessions/export?${params.toString()}`;
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
            title="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </DashboardPageHeader>

        {/* Search & Controls Row */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-2 max-w-[1800px] mx-auto sm:flex-row sm:items-center">
            <div className="relative flex-1 group min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
              <input
                type="text"
                placeholder="SEARCH SESSION, USER, DEVICE..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm font-semibold uppercase text-slate-900 shadow-sm placeholder:text-gray-400 focus:border-[#5dadec] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleQueryButtonClick}
                className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold uppercase shadow-sm transition-colors whitespace-nowrap sm:flex-initial ${showQueryBuilder || totalConditions > 0
                  ? 'bg-[#5dadec]/10 border-[#5dadec] text-black'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <Filter className="w-3.5 h-3.5" />
                Query
                {totalConditions > 0 && (
                  <span className="ml-1 rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">
                    {totalConditions}
                  </span>
                )}
                {!hasSeenQueryBuilderUpdateSticker && (
                  <span className="absolute -right-2 -top-2 rotate-12 rounded bg-blue-500 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm ring-2 ring-white">
                    Update
                  </span>
                )}
              </button>
            </div>

            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  clearQueryGroups();
                  setShowQueryBuilder(false);
                }}
                className="flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[#ef4444] shadow-sm transition-colors hover:bg-red-100 font-bold uppercase text-[10px] sm:justify-start"
                title="Clear all filters"
              >
                <X className="w-3 h-3" /> Clear All
              </button>
            )}
          </div>
        </div>

        {/* Query Builder Panel */}
        {showQueryBuilder && (
          <div className="bg-white border-b border-slate-200 px-4 py-4 sm:px-6">
            <div className="max-w-[1800px] mx-auto">
              <QueryBuilder
                groups={queryGroups}
                onGroupsChange={setQueryGroups}
                onClearQueries={clearQueryGroups}
                availableFilters={availableFilters}
                isLoadingFilters={isLoadingFilters}
                projectId={selectedProjectId}
              />
            </div>
          </div>
        )}

        {/* Compact summary bar when panel is closed but conditions are active */}
        {!showQueryBuilder && totalConditions > 0 && (
          <div className="bg-white border-b border-slate-100 px-4 py-2 sm:px-6">
            <div className="flex items-center gap-1.5 max-w-[1800px] mx-auto overflow-x-auto no-scrollbar">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0">WHERE</span>
              {queryGroups.map((group, gi) => (
                <React.Fragment key={group.id}>
                  {gi > 0 && <span className="text-[9px] font-black text-violet-400 shrink-0">OR</span>}
                  {group.conditions.map((cond, idx) => (
                    <React.Fragment key={cond.id}>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold text-slate-700 shrink-0 whitespace-nowrap">
                        {getConditionShortLabel(cond)}
                        <X
                          className="w-2.5 h-2.5 cursor-pointer hover:text-red-500 transition-colors"
                          onClick={() => setQueryGroups((prev) => prev.map((g) => g.id === group.id ? { ...g, conditions: g.conditions.filter((c) => c.id !== cond.id) } : g))}
                        />
                      </span>
                      {idx < group.conditions.length - 1 && <span className="text-[9px] font-black text-slate-300 shrink-0">AND</span>}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
              <button onClick={() => setShowQueryBuilder(true)} className="text-[10px] font-bold text-[#5dadec] hover:underline shrink-0 whitespace-nowrap">
                Edit
              </button>
            </div>
          </div>
        )}
      </div>

      {/* List Content — table header sticks when scrolling */}
      <div className="flex-1 w-full max-w-full px-4 sm:px-6 pt-4 pb-24">
        <div className="space-y-3 md:hidden">
          {paginatedSessions.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto mb-4 inline-flex items-center justify-center rounded-full bg-slate-50 p-4">
                <Smartphone className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-base font-semibold uppercase text-slate-900 mb-1">
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
            const screensCount = (session as any).screensVisited?.length || 0;
            const userId = session.userId || (session as any).anonymousDisplayName || 'Anonymous';
            const hasSlowStart = ((session as any).appStartupTimeMs || 0) > 3000;
            const hasSlowApi = (session.apiAvgResponseMs || 0) > 1000;
            const hasDeadTaps = ((session as any).deadTapCount || 0) > 0;
            const geoDisplay = formatGeoDisplay((session as any).geoLocation);
            const hasReplay = hasSuccessfulRecording(session);
            const effectiveStatus = (session as any).effectiveStatus || session.status;
            const canOpenReplay = (session as any).canOpenReplay ?? hasReplay;
            const isLiveIngest = Boolean((session as any).isLiveIngest);
            const isBackgroundProcessing = Boolean((session as any).isBackgroundProcessing);
            const canNavigateToSession =
              canOpenReplay ||
              isLiveIngest ||
              isBackgroundProcessing ||
              effectiveStatus === 'processing' ||
              effectiveStatus === 'pending' ||
              session.status === 'processing' ||
              session.status === 'pending' ||
              hasReplay;
            const hasIssues = (session.crashCount || 0) > 0 ||
              ((session as any).anrCount || 0) > 0 ||
              ((session as any).errorCount || 0) > 0 ||
              (session.rageTapCount || 0) > 0 ||
              hasDeadTaps ||
              hasSlowStart || hasSlowApi;

            return (
              <article
                key={session.id}
                className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${canNavigateToSession ? 'cursor-pointer' : ''}`}
                onClick={() => canNavigateToSession && navigate(`${pathPrefix}/sessions/${session.id}`)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!canNavigateToSession ? 'bg-slate-300' : hasIssues ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      <h3 className="truncate font-mono text-sm font-semibold text-slate-900" title={userId}>{userId}</h3>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-slate-500">
                      <span>{session.deviceModel || 'Unknown Device'}</span>
                      <span>v{session.appVersion || '?.?.?'}</span>
                      <span>{geoDisplay.hasLocation ? geoDisplay.fullLabel : 'Location unknown'}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canNavigateToSession) navigate(`${pathPrefix}/sessions/${session.id}`);
                    }}
                    disabled={!canNavigateToSession}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    title={canNavigateToSession ? 'Open Replay' : 'Replay unavailable'}
                  >
                    <Play size={15} className={canNavigateToSession ? 'fill-current' : ''} />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-center xs:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 px-2 py-2">
                    <div className="text-[9px] font-bold uppercase text-slate-400">Duration</div>
                    <div className="mt-1 font-mono text-[11px] font-semibold text-slate-900">
                      {isLiveIngest || (!canOpenReplay && isBackgroundProcessing)
                        ? 'Live'
                        : `${Math.floor(session.durationSeconds / 60)}:${String(session.durationSeconds % 60).padStart(2, '0')}`}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2 py-2">
                    <div className="text-[9px] font-bold uppercase text-slate-400">Screens</div>
                    <div className="mt-1 font-mono text-[11px] font-semibold text-slate-900">{screensCount}</div>
                  </div>
                  <div className="col-span-2 rounded-lg bg-slate-50 px-2 py-2 xs:col-span-1">
                    <div className="text-[9px] font-bold uppercase text-slate-400">Avg API</div>
                    <div className="mt-1 font-mono text-[11px] font-semibold text-slate-900">{session.apiAvgResponseMs ? `${Math.round(session.apiAvgResponseMs)}ms` : '-'}</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
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
              </article>
            );
          })}

          {filteredSessions.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-center text-xs font-bold text-slate-500">
                Showing <span className="text-slate-900">{startIndex}-{endIndex}</span> of{' '}
                <span className="text-slate-900">{filteredSessions.length.toLocaleString()}</span> loaded
              </div>

              <div className="mt-3 flex items-center justify-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                  title="Previous page"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="min-w-[7rem] px-3 py-2 text-center text-xs font-bold text-slate-700">
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
                  className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                  title="Next page"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              {hasMore && currentPage >= totalPages && (
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold uppercase text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoadingMore ? <Loader size={13} className="mr-2 animate-spin" /> : null}
                  Load More
                </button>
              )}
            </div>
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm w-full">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-[#f4f4f5] border-b border-slate-200">
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
                effectiveStatus === 'pending' ||
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
                    effectiveStatus === 'pending'));

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
                        <div className="px-5 sm:px-7 pb-5 pt-3 space-y-3">

                          {/* ── Top stats strip ── */}
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">

                            {/* ── User Info (leftmost) ── */}
                            {(() => {
                              // visitorSessionNumber = ordinal of THIS session for this visitor (1 = first ever)
                              // visitorFinalSessionNumber = total lifetime sessions recorded for this visitor
                              const sessionNum: number | null = (session as any).visitorSessionNumber ?? null;
                              const totalSessions: number | null = (session as any).visitorFinalSessionNumber ?? null;
                              const interactionScore: number = (session as any).interactionScore ?? 50;
                              const isNew = Boolean(session.isFirstSession);

                              // Tier is based on sessionNum (ordinal) — more sessions = more loyal user
                              const getTier = (n: number | null): { label: string; color: string; bg: string } => {
                                if (n === null || n <= 0) return { label: '—', color: 'text-slate-400', bg: 'bg-slate-50' };
                                if (n === 1 || isNew)    return { label: '🌱 New', color: 'text-emerald-700', bg: 'bg-emerald-50' };
                                if (n >= 50) return { label: '👑 Top 1%', color: 'text-violet-700', bg: 'bg-violet-50' };
                                if (n >= 20) return { label: '🔥 Top 5%', color: 'text-indigo-700', bg: 'bg-indigo-50' };
                                if (n >= 10) return { label: '⭐ Top 15%', color: 'text-sky-700', bg: 'bg-sky-50' };
                                if (n >= 5)  return { label: '↩ Regular', color: 'text-amber-700', bg: 'bg-amber-50' };
                                return { label: '↩ Returning', color: 'text-slate-700', bg: 'bg-slate-100' };
                              };
                              const tier = getTier(sessionNum);

                              // Only show /total if the number makes sense (must be >= current session ordinal)
                              const showTotal = totalSessions !== null && sessionNum !== null && totalSessions >= sessionNum;

                              return (
                                <div className="bg-white border border-gray-200 rounded-lg p-3 col-span-2 md:col-span-1" style={{ boxShadow: '1px 1px 0 0 rgba(0,0,0,0.06)' }}>
                                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                                    <User className="w-3 h-3" /> User
                                  </div>
                                  <div className="space-y-1.5">
                                    {/* Loyalty tier */}
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-slate-500 font-semibold uppercase">Loyalty</span>
                                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tier.color} ${tier.bg}`}>
                                        {tier.label}
                                      </span>
                                    </div>
                                    {/* Session ordinal */}
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-slate-500 font-semibold uppercase">Session #</span>
                                      <span className="font-mono text-xs font-bold text-slate-800 bg-slate-50 px-1.5 py-0.5 rounded">
                                        {sessionNum !== null && sessionNum > 0 ? sessionNum : '—'}
                                        {showTotal ? ` of ${totalSessions}` : ''}
                                      </span>
                                    </div>
                                    {/* Engagement score */}
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-slate-500 font-semibold uppercase">Engagement</span>
                                      <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${interactionScore >= 70 ? 'text-emerald-700 bg-emerald-50' : interactionScore >= 40 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50'}`}>
                                        {interactionScore}/100
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Performance */}
                            <div className="bg-white border border-gray-200 rounded-lg p-3" style={{ boxShadow: '1px 1px 0 0 rgba(0,0,0,0.06)' }}>
                              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2"><Gauge className="w-3 h-3" /> Performance</div>
                              <div className="space-y-1.5">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Startup</span>
                                  <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${((session as any).appStartupTimeMs || 0) > 2000 ? 'text-red-700 bg-red-50' : 'text-emerald-700 bg-emerald-50'}`}>
                                    {((session as any).appStartupTimeMs || 0).toFixed(0)}ms
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">API Avg</span>
                                  <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${(session.apiAvgResponseMs || 0) > 1000 ? 'text-amber-700 bg-amber-50' : 'text-slate-800 bg-slate-50'}`}>
                                    {(session.apiAvgResponseMs || 0).toFixed(0)}ms
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Duration</span>
                                  <span className="font-mono text-xs font-bold text-slate-800 bg-slate-50 px-1.5 py-0.5 rounded">
                                    {Math.floor(session.durationSeconds / 60)}:{String(session.durationSeconds % 60).padStart(2, '0')}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Environment */}
                            <div className="bg-white border border-gray-200 rounded-lg p-3" style={{ boxShadow: '1px 1px 0 0 rgba(0,0,0,0.06)' }}>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">🌐 Environment</div>
                              <div className="space-y-1.5">
                                <div className="flex justify-between items-center gap-1">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase shrink-0">Network</span>
                                  <div className="flex items-center gap-1 font-bold text-slate-800 uppercase text-[10px] min-w-0">
                                    <NetworkIcon type={networkType} />
                                    <span className="truncate">{networkType || 'Unknown'}</span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center gap-1">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase shrink-0">OS</span>
                                  <span className="font-bold text-slate-800 text-[10px] truncate max-w-[110px] text-right">{session.osVersion || '—'}</span>
                                </div>
                                <div className="flex justify-between items-center gap-1">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase shrink-0">Location</span>
                                  <span className="font-bold text-slate-800 text-[10px] truncate max-w-[110px] text-right">
                                    {geoDisplay.hasLocation ? `${geoDisplay.flagEmoji} ${geoDisplay.cityLabel || geoDisplay.countryLabel}` : '—'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* API — compact inline */}
                            <div className="bg-white border border-gray-200 rounded-lg p-3" style={{ boxShadow: '1px 1px 0 0 rgba(0,0,0,0.06)' }}>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">📡 API Calls</div>
                              <div className="space-y-1.5">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">OK</span>
                                  <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{session.apiSuccessCount || 0}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Errors</span>
                                  <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${(session.apiErrorCount || 0) > 0 ? 'text-red-700 bg-red-50' : 'text-slate-500 bg-slate-50'}`}>{session.apiErrorCount || 0}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Avg Lat.</span>
                                  <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${(session.apiAvgResponseMs || 0) > 1000 ? 'text-amber-700 bg-amber-50' : 'text-slate-800 bg-slate-50'}`}>
                                    {(session.apiAvgResponseMs || 0).toFixed(0)}ms
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Replay — compact */}
                            <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-col gap-2" style={{ boxShadow: '1px 1px 0 0 rgba(0,0,0,0.06)' }}>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">🎬 Replay</div>
                              <NeoButton
                                variant="primary"
                                size="sm"
                                onClick={() => !isReplayBlocked && navigate(`${pathPrefix}/sessions/${session.id}`)}
                                className={`w-full justify-center ${isReplayBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                                disabled={isReplayBlocked}
                              >
                                {isReplayBlocked ? (
                                  <><Loader size={12} className="animate-spin mr-2" /> Unavailable</>
                                ) : isLiveIngest ? (
                                  <><Play size={12} fill="currentColor" className="mr-2" /> Live Replay</>
                                ) : (
                                  <><Play size={12} fill="currentColor" className="mr-2" /> Open Replay</>
                                )}
                              </NeoButton>
                              <div className="text-[9px] text-slate-400 font-medium text-center leading-tight">
                                {screensCount} screen{screensCount !== 1 ? 's' : ''}&nbsp;·&nbsp;{Math.floor(session.durationSeconds / 60)}m {session.durationSeconds % 60}s
                              </div>
                            </div>
                          </div>

                          {/* ── Page Journey ── */}
                          {(() => {
                            const screens: string[] = (session as any).screensVisited || [];
                            if (screens.length === 0) return null;
                            return (
                              <div className="bg-white border border-gray-200 rounded-lg p-3" style={{ boxShadow: '1px 1px 0 0 rgba(0,0,0,0.06)' }}>
                                <div className="flex items-center justify-between mb-2.5">
                                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">🗺️ Page Journey</div>
                                  <div className="text-[9px] font-semibold text-slate-400 uppercase">{screens.length} screen{screens.length !== 1 ? 's' : ''} visited</div>
                                </div>
                                <div className="overflow-x-auto no-scrollbar pb-1 pt-3">
                                  <div className="flex items-center gap-0 min-w-max">
                                    {screens.map((screen, idx) => {
                                      const isEntry = idx === 0;
                                      const isExit = idx === screens.length - 1;
                                      return (
                                        <React.Fragment key={`${screen}-${idx}`}>
                                          {/* Screen pill */}
                                          <div className="flex flex-col items-center gap-0.5">
                                            <div
                                              className={`relative flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-bold border transition-all
                                                ${isEntry
                                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                                  : isExit
                                                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                                                  : 'bg-slate-50 border-slate-200 text-slate-700'
                                                }`}
                                            >
                                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isEntry ? 'bg-emerald-500' : isExit ? 'bg-amber-500' : 'bg-slate-300'}`} />
                                              <span className="whitespace-nowrap max-w-[120px] truncate">{screen}</span>
                                              {/* step number badge */}
                                              <span className={`absolute -top-2 -right-1.5 text-[8px] font-bold px-1 py-0 rounded-full leading-4 min-w-[16px] text-center
                                                ${isEntry ? 'bg-emerald-500 text-white' : isExit ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                                {idx + 1}
                                              </span>
                                            </div>
                                            <span className={`text-[8px] font-bold uppercase tracking-wider
                                              ${isEntry ? 'text-emerald-600' : isExit ? 'text-amber-600' : 'text-transparent'}`}>
                                              {isEntry ? 'Entry' : isExit ? 'Exit' : 'ー'}
                                            </span>
                                          </div>

                                          {/* Arrow connector (not after last) */}
                                          {idx < screens.length - 1 && (
                                            <div className="flex items-center px-1 mb-4 shrink-0">
                                              <div className="w-5 h-px bg-slate-300" />
                                              <svg width="6" height="8" viewBox="0 0 6 8" fill="none" className="text-slate-400">
                                                <path d="M1 1L5 4L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                              </svg>
                                            </div>
                                          )}
                                        </React.Fragment>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

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
                      ({totalCount.toLocaleString()} total matching — load more for the rest)
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
                  className="p-1.5 dashboard-surface hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="First page"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 dashboard-surface hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
                  className="p-1.5 dashboard-surface hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 dashboard-surface hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
                  className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold font-mono shadow-sm outline-none focus:outline-none"
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
    </div>
  );
};

export default RecordingsList;
