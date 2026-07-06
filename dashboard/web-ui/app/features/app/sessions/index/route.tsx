import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import {
  Search,
  Smartphone,
  ScanEye,
  ChevronUp,
  ChevronDown,
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
  Filter,
  Loader,
  Gauge,
  User,
  X,
  Activity,
} from 'lucide-react';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';

import {
  getSessionsArchiveTotalCount,
  getSessionsPaginated,
  getAvailableFilters,
  getProjectSmartCaptureConfig,
  type SessionArchiveSortKey,
  type SmartCaptureConfig,
  type SmartCaptureRule,
} from '~/shared/api/client';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useSafeTeam } from '~/shared/providers/TeamContext';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { formatDeviceModel, getDeviceModelSearchText } from '~/shared/lib/deviceModelNames';
import { hasSuccessfulRecordingFromSession } from '~/shared/lib/replayAvailability';
import { getWebNetworkDisplay, getWebSessionEnvironment } from '~/shared/lib/webSessionEnvironment';
import { formatWebReferralLabel, getWebReferral, getWebUtmAttribution, getAbsoluteUrl } from '~/shared/lib/webAttributionMetadata';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { AnimalAvatar, getAnimalAvatarSeed, getAnimalForIdentity } from '~/shared/ui/core/AnimalAvatar';
import { BrowserBrandIcon } from '~/shared/ui/core/BrowserBrandIcon';
import { MobilePlatformBrandIcon } from '~/shared/ui/core/MobilePlatformBrandIcon';
import { CountryFlag } from '~/shared/ui/core/CountryFlag';
import { matchesSessionArchiveIssueFilter } from './sessionArchiveFilters';
import { QueryBuilder } from './QueryBuilder';
import { SmartCaptureModal } from './SmartCaptureModal';
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
    case 'effective-4g': case '4g': case 'lte': return 2;
    case '3g': return 1;
    case 'effective-3g': case '2g': case 'effective-2g': case 'slow-2g': case 'effective-slow-2g': case 'edge': return 1;
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


const hasSuccessfulRecording = (session: any): boolean => {
  return hasSuccessfulRecordingFromSession(session, Number(session?.stats?.screenshotSegmentCount ?? 0) > 0);
};

function isWebSession(session: any): boolean {
  return String(session?.platform || '').toLowerCase() === 'web';
}

function getPlatformLabel(session: any): string {
  const platform = String(session?.platform || '').toLowerCase();
  if (platform === 'web') return 'Web';
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iOS';
  return 'Mobile';
}

function formatNativeOsLabel(platformLabel: string, osVersion: unknown): string {
  const cleanVersion = String(osVersion || '').trim();
  if (!cleanVersion) return platformLabel;
  if (cleanVersion.toLowerCase().startsWith(platformLabel.toLowerCase())) {
    return `${platformLabel}${cleanVersion.slice(platformLabel.length)}`;
  }
  return `${platformLabel} ${cleanVersion.replace(/^v/i, '')}`;
}

function formatSessionDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function getRowAccentColor(session: any, hasIssues: boolean, isReplayBlocked: boolean, hasSlowStart: boolean, hasSlowApi: boolean): string {
  if (isReplayBlocked) return '#cbd5e1';
  if ((session.crashCount || 0) > 0) return '#fb7185';
  if (((session as any).anrCount || 0) > 0) return '#c4b5fd';
  if ((session.rageTapCount || 0) > 0 || ((session as any).deadTapCount || 0) > 0) return '#fbbf24';
  if (((session as any).errorCount || 0) > 0 || hasSlowApi || hasSlowStart) return '#f9a8d4';
  return '#86efac';
}

const SMART_CAPTURE_NOTE_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  cyan: { bg: '#ecfeff', border: '#0891b2', text: '#164e63' },
  emerald: { bg: '#dcfce7', border: '#16a34a', text: '#14532d' },
  amber: { bg: '#fef3c7', border: '#d97706', text: '#78350f' },
  rose: { bg: '#ffe4e6', border: '#e11d48', text: '#881337' },
  violet: { bg: '#ede9fe', border: '#7c3aed', text: '#4c1d95' },
  blue: { bg: '#dbeafe', border: '#2563eb', text: '#1e3a8a' },
  pink: { bg: '#fce7f3', border: '#db2777', text: '#831843' },
  slate: { bg: '#f1f5f9', border: '#475569', text: '#0f172a' },
};

function getSmartCaptureRuleNote(session: any, config: SmartCaptureConfig | null): { label: string; color: string } | null {
  const ignoredReasons = new Set(['record_all', 'analytics_only', 'no_rules_configured', 'no_rules_matched', 'feature_disabled', 'waiting_for_decision_window']);
  const ruleId = typeof session?.smartCaptureRuleId === 'string' ? session.smartCaptureRuleId : null;
  const matchedRule = ruleId
    ? (config?.rules ?? []).find((rule: SmartCaptureRule) => rule.id === ruleId)
    : null;
  const label = (matchedRule?.name || session?.smartCaptureReason || matchedRule?.label || '').trim();
  if (!label || ignoredReasons.has(label)) return null;
  return {
    label,
    color: matchedRule?.color || 'cyan',
  };
}

function SmartCaptureNoteBadge({ note }: { note: { label: string; color: string } }) {
  const style = SMART_CAPTURE_NOTE_STYLES[note.color] ?? SMART_CAPTURE_NOTE_STYLES.cyan;
  return (
    <span
      className="inline-block max-w-[8rem] truncate whitespace-nowrap border px-2 py-0.5 text-[10px] font-black uppercase leading-tight shadow-neo-sm"
      style={{ backgroundColor: style.bg, borderColor: style.border, color: style.text }}
      title={`Smart Capture: ${note.label}`}
    >
      {note.label}
    </span>
  );
}

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

export const RecordingsList: React.FC = () => {
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();
  const { isDemoMode, demoReplaySessions } = useDemoMode();
  const manualRefreshVersion = useDashboardManualRefreshVersion();
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
  const [sortConfigs, setSortConfigs] = useState<SortConfig[]>([{ key: 'date', direction: 'desc' }]);
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [smartCaptureConfig, setSmartCaptureConfig] = useState<SmartCaptureConfig | null>(null);
  const [isLoadingSmartCapture, setIsLoadingSmartCapture] = useState(false);
  const [isSmartCaptureModalOpen, setIsSmartCaptureModalOpen] = useState(false);
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

  useEffect(() => {
    if (!isDemoMode && (!selectedProjectId || !isProjectFromCurrentTeam)) {
      setSmartCaptureConfig(null);
      setIsLoadingSmartCapture(false);
      return;
    }

    let cancelled = false;
    setIsLoadingSmartCapture(true);
    getProjectSmartCaptureConfig(selectedProjectId || 'demo')
      .then((config) => {
        if (!cancelled) {
          setSmartCaptureConfig(config);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load Smart Capture config:', err);
          setSmartCaptureConfig(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSmartCapture(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manualRefreshVersion, selectedProjectId, isProjectFromCurrentTeam]);

  // Use refs to avoid stale closures
  const queryGroupsRef = useRef(queryGroups);
  useEffect(() => { queryGroupsRef.current = queryGroups; }, [queryGroups]);

  // Fetch sessions with pagination
  const fetchSessions = useCallback(async (cursor?: string | null, requestId: number = activeRequestIdRef.current) => {
    const groups = queryGroupsRef.current;
    const allConds = groups.flatMap((g) => g.conditions);
    const issueCondition = allConds.find((c) => c.type === 'issue') as IssueCondition | undefined;
    const issueFilter = issueCondition?.issueFilter ?? 'all';
    const filterParams = groupsToArchiveQuery(groups);

    // Demo mode: only show the real recorded phone replay in the Replays page.
    if (isDemoMode) {
      const demoFilteredSessions = demoReplaySessions.filter((session) => (
        hasSuccessfulRecording(session) &&
        matchesSessionArchiveIssueFilter(session, issueFilter) &&
        (!filterParams.platform || filterParams.platform === 'all' || session.platform === filterParams.platform)
      ));
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
      if (!isProjectFromCurrentTeam) {
        setSessions([]);
        setNextCursor(null);
        setHasMore(false);
        setIsLoading(true);
        setIsRefreshing(false);
        return;
      }

      if (isContextLoading) {
        const hasExistingRows = sessions.length > 0;
        setIsLoading(!hasExistingRows);
        setIsRefreshing(hasExistingRows);
        if (!hasExistingRows) {
          setSessions([]);
          setNextCursor(null);
          setHasMore(false);
        }
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
      const platform = filterParams.platform;
      const archiveQuery = {
        cursor,
        limit: rowsPerPage,
        projectId: selectedProjectId,
        platform,
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
          platform,
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
    demoReplaySessions,
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
  const fetchScopeKeyBase = `all:${currentTeam?.id || 'no-team'}:${selectedProjectId || 'no-project'}:${isContextLoading ? 'loading' : 'ready'}:${projects.length}:${isProjectFromCurrentTeam ? 'valid' : 'invalid'}:${rowsPerPage}:${conditionsKey}:refresh-${manualRefreshVersion}`;
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

  // Lazy-load available filter options when query builder or Smart Capture needs them.
  useEffect(() => {
    if (isDemoMode || (!showQueryBuilder && !isSmartCaptureModalOpen) || !selectedProjectId || !isProjectFromCurrentTeam) {
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
  }, [isDemoMode, showQueryBuilder, isSmartCaptureModalOpen, selectedProjectId, isProjectFromCurrentTeam]);

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
          (session.deviceModel && getDeviceModelSearchText(session.deviceModel).includes(q))
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
  const smartCaptureEntitled = Boolean(smartCaptureConfig?.entitlement.smartCaptureEnabled);
  const smartCaptureHasRules = (smartCaptureConfig?.rules?.length ?? 0) > 0;
  const smartCaptureStatusTone = isLoadingSmartCapture
    ? 'loading'
    : !smartCaptureEntitled
      ? 'locked'
      : !smartCaptureConfig?.enabled
        ? 'off'
        : smartCaptureHasRules
          ? 'active'
          : 'pending';
  const smartCaptureButtonClass = {
    loading: 'border-slate-200/40 bg-slate-500/5 text-slate-400 cursor-not-allowed',
    locked: 'border-amber-200/80 bg-amber-50/60 text-amber-700 hover:bg-amber-50/85 hover:border-amber-300 hover:text-amber-800 shadow-sm hover:shadow-md hover:shadow-amber-500/5 hover:scale-[1.01]',
    off: 'border-amber-200/80 bg-amber-50/60 text-amber-700 hover:bg-amber-50/85 hover:border-amber-300 hover:text-amber-800 shadow-sm hover:shadow-md hover:shadow-amber-500/5 hover:scale-[1.01]',
    active: 'border-emerald-200/80 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-50/85 hover:border-emerald-300 hover:text-emerald-800 shadow-sm hover:shadow-md hover:shadow-emerald-500/5 hover:scale-[1.01]',
    pending: 'border-amber-200/80 bg-amber-50/60 text-amber-700 hover:bg-amber-50/85 hover:border-amber-300 hover:text-amber-800 shadow-sm hover:shadow-md hover:shadow-amber-500/5 hover:scale-[1.01]',
  }[smartCaptureStatusTone];

  const smartCaptureDotClass = {
    loading: 'bg-slate-300 animate-pulse',
    locked: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    off: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    active: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse',
    pending: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
  }[smartCaptureStatusTone];
  const smartCaptureStatusLabel = isLoadingSmartCapture
    ? 'Loading'
    : !smartCaptureEntitled
      ? 'Scale'
      : !smartCaptureConfig?.enabled
        ? 'Off'
        : smartCaptureHasRules
          ? `${smartCaptureConfig?.rules.length ?? 0} rules`
          : 'No rules';

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
      <span className="inline-flex items-center">
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
      <span className="flex items-center gap-1 whitespace-nowrap">
        {align === 'right' && (
          <span className="text-slate-400 transition-colors group-hover:text-slate-900">{getSortIndicator(sortKey)}</span>
        )}
        <span>{label}</span>
        {align !== 'right' && (
          <span className="text-slate-400 transition-colors group-hover:text-slate-900">{getSortIndicator(sortKey)}</span>
        )}
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
    setShowQueryBuilder((value) => !value);
  }, []);

  const handleClearActiveFilters = useCallback(() => {
    if (typeof window !== 'undefined' && !window.confirm('Clear the search text and all query filters?')) {
      return;
    }
    setSearchQuery('');
    clearQueryGroups();
    setShowQueryBuilder(false);
  }, [clearQueryGroups]);

  if (isLoading && sessions.length === 0 && (selectedProjectId || isContextLoading)) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="rejourney-replays-page min-h-screen flex flex-col bg-[#f8fafd] font-sans text-slate-900">
      {/* Main Header — scrolls away with page */}
      <div className="shrink-0">
        <DashboardPageHeader
          title="Replays"
          subtitle={selectedProjectId ? archiveCountLabel : 'Browse, filter & replay user sessions'}
          {...dashboardPageHeaderProps('sessions')}
        >
          {(selectedProjectId || isDemoMode) && (
            <button
              type="button"
              disabled={isLoadingSmartCapture}
              onClick={() => setIsSmartCaptureModalOpen(true)}
              className={`smart-capture-trigger relative inline-flex h-9 items-center justify-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold backdrop-blur-md transition-all duration-300 disabled:pointer-events-none hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${smartCaptureButtonClass}`}
              title={`Smart Capture: ${smartCaptureStatusLabel}`}
              aria-label={`Smart Capture: ${smartCaptureStatusLabel}`}
            >
              {isLoadingSmartCapture ? (
                <Loader className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <ScanEye className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span>Smart Capture</span>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-300 ${smartCaptureDotClass}`} />
            </button>
          )}
        </DashboardPageHeader>

        {/* Search & Controls Row */}
        <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <div className="group relative min-w-0 sm:flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-slate-400 transition-colors group-focus-within:text-[#2563eb]">
                <Search className="h-4 w-4 shrink-0" />
              </span>
              <input
                type="text"
                placeholder="Search session ID, UUID, fingerprint..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white py-2 pl-11 pr-4 text-sm font-semibold text-slate-900 shadow-sm outline-none transition placeholder:font-semibold placeholder:text-slate-400 focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"
              />
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center">
              <button
                onClick={handleQueryButtonClick}
                className={`relative flex h-10 w-full min-w-[7.5rem] items-center justify-center gap-2 rounded-md border px-3 text-sm font-bold shadow-sm transition whitespace-nowrap sm:w-auto ${showQueryBuilder || totalConditions > 0
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-slate-950'
                  }`}
              >
                {showQueryBuilder ? <ChevronUp className="h-4 w-4 shrink-0" /> : <Filter className="h-4 w-4 shrink-0" />}
                {showQueryBuilder ? 'Hide query' : 'Query'}
                {totalConditions > 0 && (
                  <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-950">
                    {totalConditions}
                  </span>
                )}
              </button>
              <select
                value={`${primarySortKey}:${primarySortDir}`}
                onChange={(event) => {
                  const [key, direction] = event.target.value.split(':') as [SortKey, SortDirection];
                  setSortConfigs([{ key, direction }]);
                }}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-xs font-bold uppercase text-slate-700 shadow-sm outline-none transition hover:border-blue-300 focus:border-slate-950 focus:ring-2 focus:ring-slate-200 sm:w-[9.5rem] md:hidden"
                aria-label="Sort replays"
              >
                <option value="date:desc">Newest</option>
                <option value="date:asc">Oldest</option>
                <option value="duration:desc">Longest</option>
                <option value="duration:asc">Shortest</option>
                <option value="screens:desc">Most screens</option>
                <option value="crashes:desc">Issues first</option>
              </select>
            </div>

            {hasActiveFilters && (
              <div className="flex sm:border-l sm:border-slate-200 sm:pl-2">
                <button
                  onClick={handleClearActiveFilters}
                  className="flex h-10 w-full items-center justify-center gap-1 rounded-[8px] border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 sm:w-auto sm:justify-start"
                  title="Clear all filters"
                >
                  <X className="w-3 h-3" /> Clear filters
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Query Builder Panel */}
        {showQueryBuilder && (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
            <div className="max-w-[1800px] mx-auto">
              <QueryBuilder
                groups={queryGroups}
                onGroupsChange={setQueryGroups}
                onClearQueries={clearQueryGroups}
                availableFilters={availableFilters}
                isLoadingFilters={isLoadingFilters}
                projectId={selectedProjectId}
                smartCaptureRules={smartCaptureConfig?.rules ?? []}
              />
            </div>
          </div>
        )}

        {/* Compact summary bar when panel is closed but conditions are active */}
        {!showQueryBuilder && totalConditions > 0 && (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 sm:px-6">
            <div className="flex max-w-[1800px] items-center gap-1.5 mx-auto overflow-x-auto no-scrollbar">
              <span className="shrink-0 text-[10px] font-semibold text-slate-500">Where</span>
              {queryGroups.map((group, gi) => (
                <React.Fragment key={group.id}>
                  {gi > 0 && <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">OR</span>}
                  {group.conditions.map((cond, idx) => (
                    <React.Fragment key={cond.id}>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm whitespace-nowrap">
                        {getConditionShortLabel(cond)}
                        <X
                          className="h-3 w-3 cursor-pointer text-slate-400 transition-colors hover:text-rose-600"
                          onClick={() => setQueryGroups((prev) => prev.map((g) => g.id === group.id ? { ...g, conditions: g.conditions.filter((c) => c.id !== cond.id) } : g))}
                        />
                      </span>
                      {idx < group.conditions.length - 1 && <span className="shrink-0 text-[10px] font-semibold text-slate-400">AND</span>}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
              <button onClick={() => setShowQueryBuilder(true)} className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 whitespace-nowrap">
                Edit
              </button>
            </div>
          </div>
        )}
      </div>

      {/* List Content — table header sticks when scrolling */}
      <div className="sessions-list-shell flex-1 w-full max-w-full px-4 sm:px-6 pt-4 pb-24">
        <div className="sessions-mobile-list space-y-3">
          {paginatedSessions.length === 0 ? (
            <div className="border border-slate-200 bg-white p-6 text-center shadow-sm">
              <div className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center border border-black bg-[#86efac]">
                <Smartphone className="h-5 w-5 text-black" />
              </div>
              <h3 className="text-sm font-black uppercase text-black">
                {selectedProjectId ? 'No Sessions Found' : 'No Project Selected'}
              </h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {selectedProjectId ? 'Adjust your filters or search query.' : 'Select or create a project to view replay data.'}
              </p>
            </div>
          ) : (
            paginatedSessions.map((session, rowIndex) => {
              const isExpanded = expandedSessionId === session.id;
              const screensCount = (session as any).screensVisited?.length || 0;
              const networkType = (session as any).networkType || (session as any).cellularGeneration;
              const userId = session.userId || (session as any).anonymousDisplayName || 'Anonymous';
              const displayUserId = userId.length > 26 ? `${userId.substring(0, 23)}...` : userId;
              const rawStartupMs = (session as any).appStartupTimeMs;
              const startupMs = typeof rawStartupMs === 'number' && Number.isFinite(rawStartupMs) && rawStartupMs > 0
                ? rawStartupMs
                : null;
              const hasSlowStart = false;
              const hasSlowApi = (session.apiAvgResponseMs || 0) > 1000;
              const hasLowExploration = typeof session.explorationScore === 'number' && session.explorationScore < 40;
              const hasDeepExploration = typeof session.explorationScore === 'number' && session.explorationScore >= 70;
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
              const isReplayBlocked = !canNavigateToSession;
              const displayDeviceModel = formatDeviceModel(session.deviceModel);
              const webSession = isWebSession(session);
              const webEnvironment = webSession ? getWebSessionEnvironment(session) : null;
              const networkDisplay = webSession ? getWebNetworkDisplay(networkType) : null;
              const platformLabel = getPlatformLabel(session);
              const webReferral = getWebReferral(session);
              const webReferralLabel = formatWebReferralLabel(webReferral);
              const webUtm = webSession ? getWebUtmAttribution(session) : null;
              const replayAnimalSeed = getAnimalAvatarSeed(session as any);
              const replayAnimal = getAnimalForIdentity(session as any);
              const fingerprintLabel = ((session as any).anonymousDisplayName as string | undefined)?.trim() || replayAnimal;
              const deviceColumn = webSession && webEnvironment
                ? {
                    kind: 'web' as const,
                    primary: webEnvironment.browserLabel,
                    secondary: webEnvironment.osLabel,
                    iconName: webEnvironment.browserName,
                    title: `${webEnvironment.browserTitle} · ${webEnvironment.osTitle}`,
                  }
                : {
                    kind: 'native' as const,
                    primary: formatNativeOsLabel(platformLabel, session.osVersion),
                    secondary: displayDeviceModel,
                    iconName: platformLabel,
                    title: `${displayDeviceModel}${session.osVersion ? ` · ${session.osVersion}` : ''}`,
                  };
              const hasIssues = (session.crashCount || 0) > 0 ||
                ((session as any).anrCount || 0) > 0 ||
                ((session as any).errorCount || 0) > 0 ||
                (session.rageTapCount || 0) > 0 ||
                hasDeadTaps ||
                hasSlowStart ||
                hasSlowApi;
              const rowAccent = getRowAccentColor(session, hasIssues, isReplayBlocked, hasSlowStart, hasSlowApi);
              const smartCaptureNote = getSmartCaptureRuleNote(session, smartCaptureConfig);
              const screens: string[] = (session as any).screensVisited || [];

              return (
                <article
                  key={session.id}
                  className={`border border-slate-200 bg-white shadow-sm ${rowIndex % 2 === 0 ? '' : 'bg-[#f8fafc]'}`}
                  style={{ boxShadow: `inset 3px 0 0 ${rowAccent}, 0 1px 2px rgba(15,23,42,0.06)` }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex w-full items-start gap-3 p-3 text-left"
                    onClick={(event) => toggleExpand(event, session.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        setExpandedSessionId(expandedSessionId === session.id ? null : session.id);
                      }
                    }}
                    aria-expanded={isExpanded}
                  >
                    <div className={`mt-0.5 shrink-0 ${isReplayBlocked ? 'opacity-60' : ''}`} title={`${fingerprintLabel} fingerprint`}>
                      <AnimalAvatar animal={replayAnimal} seed={replayAnimalSeed} size={32} active={isExpanded} neutral />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={`truncate font-mono text-sm font-black text-slate-950 ${isReplayBlocked ? 'opacity-60' : ''}`} title={userId}>
                          {displayUserId}
                        </span>
                        {userId !== 'Anonymous' && (
                          <button
                            type="button"
                            onClick={(event) => handleCopyUserId(event as unknown as React.MouseEvent, userId)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleCopyUserId(event as unknown as React.MouseEvent, userId);
                              }
                            }}
                            className="shrink-0 text-slate-400 transition-colors hover:text-slate-900"
                            aria-label="Copy user id"
                          >
                            {copiedId === userId ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-slate-500">
                        <span>{new Date(session.startedAt).toLocaleDateString()}</span>
                        <span>{new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="inline-flex items-center gap-1" title={deviceColumn.title}>
                          {deviceColumn.kind === 'web' ? (
                            <BrowserBrandIcon browserName={deviceColumn.iconName} className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <MobilePlatformBrandIcon platformName={deviceColumn.iconName} className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          )}
                          <span>{deviceColumn.primary}</span>
                        </span>
                      </div>
                    </div>
                    <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-3 py-2 text-[11px]">
                    <div className="min-w-0">
                      <div className="font-black uppercase text-slate-400">Location</div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 font-bold text-slate-800">
                        {geoDisplay.hasLocation ? (
                          <>
                            <CountryFlag countryCode={geoDisplay.countryCode} countryLabel={geoDisplay.countryLabel} className="h-3.5" imageClassName="h-3.5 w-3.5" decorative />
                            <span className="truncate">{geoDisplay.cityLabel || geoDisplay.countryLabel}</span>
                          </>
                        ) : (
                          <span className="text-slate-400">Unknown</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-black uppercase text-slate-400">Duration</div>
                      <div className="mt-1 font-mono text-sm font-black text-slate-950">{formatSessionDuration(session.durationSeconds)}</div>
                    </div>
                    <div>
                      <div className="font-black uppercase text-slate-400">Screens</div>
                      <div className="mt-1 font-mono text-sm font-black text-slate-950">{screensCount}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black uppercase text-slate-400">Notes</div>
                      <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                        {session.isFirstSession && (
                          <span
                            className="inline-flex items-center border-2 border-black bg-[#86efac] px-2 py-0.5 text-[10px] font-black uppercase text-black shadow-neo-sm"
                            title="First recorded session for this visitor in this project"
                          >
                            NEW USER
                          </span>
                        )}
                        {smartCaptureNote && <SmartCaptureNoteBadge note={smartCaptureNote} />}
                        {hasDeepExploration && (
                          <span
                            title="Deep session (high exploration score 70 or above)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=start`);
                              }
                            }}
                          >
                            <span className="inline-flex items-center border border-[#15803d] bg-[#dcfce7] px-2 py-0.5 text-[10px] font-black uppercase text-[#14532d]">
                              DEEP
                            </span>
                          </span>
                        )}
                        {(session.crashCount || 0) > 0 && (
                          <span
                            title="Application crash (fatal exception)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=crash`);
                              }
                            }}
                          >
                            <NeoBadge variant="danger" size="sm">CRASH</NeoBadge>
                          </span>
                        )}
                        {((session as any).anrCount || 0) > 0 && (
                          <span
                            title="App Not Responding (UI thread blocked)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=anr`);
                              }
                            }}
                          >
                            <NeoBadge variant="neutral" size="sm">ANR</NeoBadge>
                          </span>
                        )}
                        {((session as any).errorCount || 0) > 0 && (
                          <span
                            title="Logged error or resource loading failure"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=error`);
                              }
                            }}
                          >
                            <NeoBadge variant="neutral" size="sm">ERR</NeoBadge>
                          </span>
                        )}
                        {(session.rageTapCount || 0) > 0 && (
                          <span
                            title="Rage tap (repeated rapid taps in a small area)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=rage`);
                              }
                            }}
                          >
                            <NeoBadge variant="danger" size="sm">RAGE</NeoBadge>
                          </span>
                        )}
                        {hasDeadTaps && (
                          <span
                            title="Dead tap (tap on a non-interactive area with no response)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=dead`);
                              }
                            }}
                          >
                            <NeoBadge variant="neutral" size="sm">DEAD</NeoBadge>
                          </span>
                        )}
                        {hasSlowStart && (
                          <span
                            title="Slow cold startup duration"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=slow_start`);
                              }
                            }}
                          >
                            <NeoBadge variant="neutral" size="sm">SLOW</NeoBadge>
                          </span>
                        )}
                        {hasSlowApi && (
                          <span
                            title="Slow API average latency (over 1000ms)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=api`);
                              }
                            }}
                          >
                            <NeoBadge variant="neutral" size="sm">API</NeoBadge>
                          </span>
                        )}
                        {hasLowExploration && (
                          <span
                            title="Shallow session (low exploration score under 40)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                            onClick={(e) => {
                              if (canNavigateToSession) {
                                e.stopPropagation();
                                e.preventDefault();
                                navigate(`${pathPrefix}/sessions/${session.id}?seekToType=start`);
                              }
                            }}
                          >
                            <NeoBadge variant="low_exp" size="sm">SHALLOW</NeoBadge>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-[#f8fafc] px-3 py-3">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="border border-slate-200 bg-white p-2">
                          <div className="font-black uppercase text-slate-400">Startup</div>
                          <div className={`mt-1 font-mono text-sm font-black ${hasSlowStart ? 'text-rose-700' : 'text-slate-950'}`}>
                            {startupMs === null ? 'N/A' : `${startupMs.toFixed(0)}ms`}
                          </div>
                        </div>
                        <div className="border border-slate-200 bg-white p-2">
                          <div className="font-black uppercase text-slate-400">API Avg</div>
                          <div className={`mt-1 font-mono text-sm font-black ${hasSlowApi ? 'text-rose-700' : 'text-slate-950'}`}>
                            {(session.apiAvgResponseMs || 0).toFixed(0)}ms
                          </div>
                        </div>
                        <div className="border border-slate-200 bg-white p-2">
                          <div className="font-black uppercase text-slate-400">Network</div>
                          <div className="mt-1 flex items-center gap-1 font-bold uppercase text-slate-800">
                            <NetworkIcon type={networkDisplay?.rawNetworkType || networkType} />
                            <span className="truncate">{webSession ? networkDisplay?.networkLabel : (networkType || 'Unknown')}</span>
                          </div>
                        </div>
                        <div className="border border-slate-200 bg-white p-2">
                          <div className="font-black uppercase text-slate-400">Source</div>
                          <div className="mt-1 truncate font-bold text-slate-800" title={webReferral || 'Direct'}>
                            {webSession ? webReferralLabel : platformLabel}
                          </div>
                        </div>
                      </div>

                      {webSession && webUtm && (
                        <div className="mt-2 border border-slate-200 bg-white p-2 text-[11px]">
                          <div className="font-black uppercase text-slate-400">UTM</div>
                          <div className={`mt-1 break-words font-bold ${webUtm.hasUtm ? 'text-slate-800' : 'text-slate-400'}`} title={webUtm.title}>
                            {webUtm.label}
                          </div>
                        </div>
                      )}

                      {screens.length > 0 && (
                        <div className="dashboard-mobile-scroll mt-2 overflow-x-auto pb-1">
                          <div className="flex min-w-max items-center gap-1.5">
                            {screens.slice(0, 8).map((screen, idx) => (
                              <span key={`${session.id}:${screen}:${idx}`} className="border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700">
                                {idx + 1}. {screen}
                              </span>
                            ))}
                            {screens.length > 8 && (
                              <span className="border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500">
                                +{screens.length - 8}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (canNavigateToSession) {
                            navigate(`${pathPrefix}/sessions/${session.id}`);
                          }
                        }}
                        disabled={!canNavigateToSession}
                        className={`mt-3 flex h-10 w-full items-center justify-center gap-2 border border-black text-sm font-black uppercase transition ${isReplayBlocked ? 'cursor-not-allowed bg-slate-100 text-slate-400' : 'bg-[#67e8f9] text-black hover:bg-[#22d3ee]'}`}
                      >
                        {isReplayBlocked ? <Loader size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                        {isReplayBlocked ? 'Replay unavailable' : isLiveIngest ? 'Open live replay' : 'Open replay'}
                      </button>
                    </div>
                  )}
                </article>
              );
            })
          )}

          {filteredSessions.length > 0 && (
            <div className="flex flex-col gap-3 border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-center text-xs font-bold text-slate-500">
                Showing <span className="text-slate-900">{startIndex}-{endIndex}</span> of{' '}
                <span className="text-slate-900">{filteredSessions.length.toLocaleString()}</span> loaded
              </div>
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="flex h-9 w-9 items-center justify-center border border-black bg-white disabled:cursor-not-allowed disabled:opacity-30"
                  title="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="text-center text-xs font-black text-slate-700">
                  Page {currentPage} of {totalPages || 1}
                </div>
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
                  className="flex h-9 w-9 items-center justify-center border border-black bg-white disabled:cursor-not-allowed disabled:opacity-30"
                  title="Next page"
                >
                  {isLoadingMore ? <Loader size={15} className="animate-spin" /> : <ChevronRight size={16} />}
                </button>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-[10px] font-bold uppercase text-slate-500">Per page</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-9 border border-black bg-white px-2 text-xs font-black outline-none"
                >
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="sessions-desktop-table dashboard-mobile-scroll overflow-x-auto pb-2">
          <div className="w-full min-w-[900px] overflow-hidden border-2 border-black bg-white shadow-neo lg:min-w-[1020px] xl:min-w-[1070px]">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b-2 border-black bg-[#cffafe]">
                <th className="sticky top-0 z-40 bg-[#cffafe] w-9 py-3 pl-3 pr-1" />
                <th className="sticky top-0 z-40 bg-[#cffafe] text-left py-3 px-2.5 text-[10px] font-black text-slate-600 uppercase tracking-widest w-[250px]">User</th>
                <th className="sticky top-0 z-40 bg-[#cffafe] hidden lg:table-cell text-left py-3 px-2.5 text-[10px] font-black text-slate-600 uppercase tracking-widest w-[112px]"><SortableHeader label="Date" sortKey="date" /></th>
                <th className="sticky top-0 z-40 bg-[#cffafe] hidden xl:table-cell text-left py-3 px-2.5 text-[10px] font-black text-slate-600 uppercase tracking-widest w-[150px]">Device</th>
                <th className="sticky top-0 z-40 bg-[#cffafe] hidden lg:table-cell text-left py-3 px-2.5 text-[10px] font-black text-slate-600 uppercase tracking-widest w-[132px]">Location</th>
                <th className="sticky top-0 z-40 bg-[#cffafe] hidden lg:table-cell text-right py-3 px-2 text-[10px] font-black text-slate-600 uppercase tracking-widest w-[76px]"><SortableHeader label="Screens" sortKey="screens" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#cffafe] hidden md:table-cell text-right py-3 px-2 text-[10px] font-black text-slate-600 uppercase tracking-widest w-[92px]"><SortableHeader label="Duration" sortKey="duration" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#cffafe] text-right py-3 px-2.5 text-[10px] font-black text-slate-600 uppercase tracking-widest w-[150px]"><SortableHeader label="Notes" sortKey="crashes" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#cffafe] w-[68px] py-3 pl-1 pr-3" />
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-black/15">
            {paginatedSessions.length === 0 && (
              <tr>
                <td colSpan={9} className="py-16 text-center">
                  <div className="inline-flex items-center justify-center p-4 bg-[#86efac] border-2 border-black shadow-neo-sm mb-4">
                    <Smartphone className="w-8 h-8 text-black" />
                  </div>
                  <h3 className="text-lg font-black uppercase text-black mb-1">
                    {selectedProjectId ? 'No Sessions Found' : 'No Project Selected'}
                  </h3>
                  <p className="text-slate-600 text-sm font-semibold">
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
              const rawStartupMs = (session as any).appStartupTimeMs;
              const startupMs = typeof rawStartupMs === 'number' && Number.isFinite(rawStartupMs) && rawStartupMs > 0
                ? rawStartupMs
                : null;

              // Performance issue detection
              const hasSlowStart = false;
              const hasSlowApi = (session.apiAvgResponseMs || 0) > 1000;
              const hasLowExploration = typeof session.explorationScore === 'number' && session.explorationScore < 40;
              const hasDeepExploration = typeof session.explorationScore === 'number' && session.explorationScore >= 70;
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
	              const displayDeviceModel = formatDeviceModel(session.deviceModel);
	              const webSession = isWebSession(session);
	              const webEnvironment = webSession ? getWebSessionEnvironment(session) : null;
	              const networkDisplay = webSession ? getWebNetworkDisplay(networkType) : null;
	              const platformLabel = getPlatformLabel(session);
	              const webReferral = getWebReferral(session);
	              const webReferralLabel = formatWebReferralLabel(webReferral);
	              const webUtm = webSession ? getWebUtmAttribution(session) : null;
	              const replayAnimalSeed = getAnimalAvatarSeed(session as any);
	              const replayAnimal = getAnimalForIdentity(session as any);
	              const fingerprintLabel = ((session as any).anonymousDisplayName as string | undefined)?.trim() || replayAnimal;
	              const deviceColumn = webSession && webEnvironment
	                ? {
	                    kind: 'web' as const,
	                    primary: webEnvironment.browserLabel,
	                    secondary: webEnvironment.osLabel,
	                    iconName: webEnvironment.browserName,
	                    title: `${webEnvironment.browserTitle} · ${webEnvironment.osTitle}`,
	                  }
	                : {
	                    kind: 'native' as const,
	                    primary: formatNativeOsLabel(platformLabel, session.osVersion),
	                    secondary: displayDeviceModel,
	                    iconName: platformLabel,
	                    title: `${displayDeviceModel}${session.osVersion ? ` · ${session.osVersion}` : ''}`,
	                  };

              const hasIssues = (session.crashCount || 0) > 0 ||
                ((session as any).anrCount || 0) > 0 ||
                ((session as any).errorCount || 0) > 0 ||
                (session.rageTapCount || 0) > 0 ||
                hasDeadTaps ||
                hasSlowStart || hasSlowApi;
              const rowAccent = getRowAccentColor(session, hasIssues, isReplayBlocked, hasSlowStart, hasSlowApi);
              const smartCaptureNote = getSmartCaptureRuleNote(session, smartCaptureConfig);

              return (
                <React.Fragment key={session.id}>
                <tr
                  className={`cursor-pointer transition-colors ${isExpanded ? 'bg-[#f8fafc]' : isZebraEven ? 'bg-white hover:bg-[#f8fafc]' : 'bg-[#f8fafc] hover:bg-[#ecfeff]/45'}`}
                  style={{ boxShadow: `inset 3px 0 0 ${rowAccent}` }}
                  onClick={(e) => toggleExpand(e, session.id)}
                >
	                    {/* Visual Indicator */}
	                    <td className="w-9 py-2.5 pl-3 pr-1 align-middle text-center">
	                      <div
	                        className={`mx-auto inline-flex h-7 w-7 items-center justify-center ${isReplayBlocked ? 'opacity-60' : ''}`}
	                        title={`${fingerprintLabel} fingerprint · ${platformLabel} session${hasIssues ? ' with issues' : ''}`}
	                      >
	                        <AnimalAvatar animal={replayAnimal} seed={replayAnimalSeed} size={24} active={isExpanded} neutral />
	                      </div>
	                    </td>

                    {/* User */}
                    <td className="w-[250px] py-2.5 px-2.5 align-middle overflow-hidden min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3
                          className={`font-bold text-sm text-slate-900 font-mono truncate shrink min-w-0 ${isReplayBlocked ? 'opacity-50' : ''}`}
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
	                    </td>

                    {/* Date (Desktop) */}
                    <td className="hidden lg:table-cell py-2.5 px-2.5 align-middle w-[112px]">
                      <div className="text-xs font-black text-slate-900">{new Date(session.startedAt).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-400 font-mono tracking-tight">{new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>

                    {/* Device */}
                    <td className="hidden xl:table-cell py-2.5 px-2.5 align-middle text-left w-[150px]">
                      <div className={`flex min-w-0 items-center gap-2 ${isReplayBlocked ? 'opacity-50' : ''}`} title={deviceColumn.title}>
                        {deviceColumn.kind === 'web' ? (
                          <BrowserBrandIcon browserName={deviceColumn.iconName} className="h-4 w-4 shrink-0" />
                        ) : (
                          <MobilePlatformBrandIcon platformName={deviceColumn.iconName} className="h-4 w-4 shrink-0 text-slate-500" />
                        )}
                        <div className="min-w-0 leading-tight">
                          <div className="truncate text-sm font-bold text-slate-900">{deviceColumn.primary}</div>
                          <div className="truncate text-[10px] font-bold tracking-tight text-slate-500">{deviceColumn.secondary}</div>
                        </div>
                      </div>
                    </td>

                    {/* Location */}
                    <td className="hidden lg:table-cell py-2.5 px-2.5 align-middle w-[132px] overflow-hidden">
                      <div className={`leading-tight ${isReplayBlocked ? 'opacity-50' : ''}`}>
                        {geoDisplay.hasLocation ? (
                          <>
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                              <CountryFlag countryCode={geoDisplay.countryCode} countryLabel={geoDisplay.countryLabel} decorative />
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

                    {/* Screens */}
                    <td className="hidden lg:table-cell py-2.5 px-2 align-middle text-right w-[76px]">
                      {screensCount > 0 ? (
                        <span className="inline-block border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-mono font-bold text-slate-700">{screensCount}</span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>

                    {/* Duration: LIVE REPLAY while ingest / replay preparing; MM:SS once replay is playable (or session ended) and not live-ingesting */}
                    <td className="hidden md:table-cell py-2.5 px-2 align-middle text-right w-[92px]">
                      {showLiveReplayInDurationColumn ? (
                        <span className="inline-flex items-center justify-end whitespace-nowrap border-2 border-black bg-[#86efac] px-1.5 py-1 text-[9px] font-black leading-none text-black shadow-neo-sm animate-pulse">
                          LIVE REPLAY
                        </span>
                      ) : (
                        <span className="border border-black bg-[#ecfeff] px-1.5 py-0.5 text-xs font-mono font-bold text-black">
                          {Math.floor(session.durationSeconds / 60)}:{String(session.durationSeconds % 60).padStart(2, '0')}
                        </span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="py-2.5 px-2.5 align-middle text-right w-[150px]">
                      <div className="flex justify-end gap-1.5 items-center flex-wrap min-h-[28px]">
                      {session.isFirstSession && (
                        <span
                          className="inline-flex items-center border-2 border-black bg-[#86efac] px-2 py-0.5 text-[10px] font-black uppercase text-black shadow-neo-sm"
                          title="First recorded session for this visitor in this project"
                        >
                          NEW USER
                        </span>
                      )}
                      {smartCaptureNote && <SmartCaptureNoteBadge note={smartCaptureNote} />}
                      {hasDeepExploration && (
                        <span
                          title="Deep session (high exploration score 70 or above)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=start`);
                            }
                          }}
                        >
                          <span className="inline-flex items-center border border-[#15803d] bg-[#dcfce7] px-2 py-0.5 text-[10px] font-black uppercase text-[#14532d]">
                            DEEP
                          </span>
                        </span>
                      )}
                      {(session.crashCount || 0) > 0 && (
                        <span
                          title="Application crash (fatal exception)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=crash`);
                            }
                          }}
                        >
                          <NeoBadge variant="danger" size="sm">CRASH</NeoBadge>
                        </span>
                      )}
                      {((session as any).anrCount || 0) > 0 && (
                        <span
                          title="App Not Responding (UI thread blocked)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=anr`);
                            }
                          }}
                        >
                          <NeoBadge variant="neutral" size="sm">ANR</NeoBadge>
                        </span>
                      )}
                      {((session as any).errorCount || 0) > 0 && (
                        <span
                          title="Logged error or resource loading failure"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=error`);
                            }
                          }}
                        >
                          <NeoBadge variant="neutral" size="sm">ERR</NeoBadge>
                        </span>
                      )}
                      {(session.rageTapCount || 0) > 0 && (
                        <span
                          title="Rage tap (repeated rapid taps in a small area)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=rage`);
                            }
                          }}
                        >
                          <NeoBadge variant="danger" size="sm">RAGE</NeoBadge>
                        </span>
                      )}
                      {hasDeadTaps && (
                        <span
                          title="Dead tap (tap on a non-interactive area with no response)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=dead`);
                            }
                          }}
                        >
                          <NeoBadge variant="neutral" size="sm">DEAD</NeoBadge>
                        </span>
                      )}
                      {hasSlowStart && (
                        <span
                          title="Slow cold startup duration"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=slow_start`);
                            }
                          }}
                        >
                          <NeoBadge variant="neutral" size="sm">SLOW</NeoBadge>
                        </span>
                      )}
                      {hasSlowApi && (
                        <span
                          title="Slow API average latency (over 1000ms)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=api`);
                            }
                          }}
                        >
                          <NeoBadge variant="neutral" size="sm">API</NeoBadge>
                        </span>
                      )}
                      {hasLowExploration && (
                        <span
                          title="Shallow session (low exploration score under 40)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          onClick={(e) => {
                            if (canNavigateToSession) {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate(`${pathPrefix}/sessions/${session.id}?seekToType=start`);
                            }
                          }}
                        >
                          <NeoBadge variant="low_exp" size="sm">SHALLOW</NeoBadge>
                        </span>
                      )}
                      </div>
                    </td>

                    <td className="w-[68px] py-2.5 pl-1 pr-3 align-middle">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canNavigateToSession) {
                              navigate(`${pathPrefix}/sessions/${session.id}`);
                            }
                          }}
                          disabled={!canNavigateToSession}
                          className={`inline-flex items-center justify-center p-1.5 rounded-lg border transition-all duration-200 group/play
                            ${isReplayBlocked 
                              ? 'cursor-not-allowed opacity-40 text-slate-300 border-transparent' 
                              : 'text-slate-600 bg-slate-50 border-slate-200/40 hover:bg-cyan-50 hover:text-cyan-600 hover:border-cyan-200/60 hover:shadow-sm'
                            }`}
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
                        <button
                          onClick={(e) => toggleExpand(e, session.id)}
                          className={`inline-flex items-center justify-center p-1.5 rounded-lg border transition-all duration-200
                            ${isExpanded 
                              ? 'bg-slate-100 border-slate-300 text-slate-800 shadow-sm' 
                              : 'text-slate-600 bg-slate-50 border-slate-200/40 hover:bg-slate-100 hover:text-slate-800 hover:border-slate-300 hover:shadow-sm'
                            }`}
                          title={isExpanded ? 'Collapse details' : 'Expand details'}
                          aria-label={isExpanded ? 'Collapse replay details' : 'Expand replay details'}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </td>
                </tr>

                  {/* Expanded Details - full-width row */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} className="border-b border-slate-200/80 bg-[#f8fafc]/50 p-0 align-top">
                        <div className="px-5 sm:px-7 pb-5 pt-4 space-y-4">

                          {/* ── Top stats strip ── */}
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">

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
                                if (n >= 5)  return { label: '↩ Regular', color: 'text-pink-700', bg: 'bg-pink-50' };
                                return { label: '↩ Returning', color: 'text-slate-700', bg: 'bg-slate-100' };
                              };
                              const tier = getTier(sessionNum);

                              // Only show /total if the number makes sense (must be >= current session ordinal)
                              const showTotal = totalSessions !== null && sessionNum !== null && totalSessions >= sessionNum;

                              return (
                                <div className="col-span-2 border border-slate-200 bg-white p-4 rounded-xl shadow-sm md:col-span-1 hover:shadow-md transition-shadow duration-200">
                                  <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    <User className="w-3.5 h-3.5 text-slate-400" /> User
                                  </div>
                                  <div className="space-y-2">
                                    {/* Loyalty tier */}
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-slate-500 font-semibold uppercase">Loyalty</span>
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${tier.color} ${tier.bg} border border-slate-100`}>
                                        {tier.label}
                                      </span>
                                    </div>
                                    {/* Session ordinal */}
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10px] text-slate-500 font-semibold uppercase">Session #</span>
                                      <span className="bg-slate-50 border border-slate-200/60 px-2 py-0.5 rounded-md font-mono text-xs font-bold text-slate-800">
                                        {sessionNum !== null && sessionNum > 0 ? sessionNum : '—'}
                                        {showTotal ? ` of ${totalSessions}` : ''}
                                      </span>
                                    </div>
                                    {/* Engagement score */}
                                    <div className="flex flex-col gap-2">
                                      <div className="flex justify-between items-center">
                                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Engagement</span>
                                        <span className={`border border-slate-200/60 px-2 py-0.5 rounded-md font-mono text-xs font-bold ${interactionScore >= 70 ? 'text-emerald-700 bg-emerald-50' : interactionScore >= 40 ? 'text-pink-700 bg-pink-50' : 'text-rose-700 bg-rose-50'}`}>
                                          {interactionScore}/100
                                        </span>
                                      </div>
                                      {webSession ? (
                                        <div className="flex flex-col gap-1 border-t border-slate-100 pt-2">
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="text-[10px] text-slate-500 font-semibold uppercase">Referral</span>
                                          </div>
                                          <div
                                            className="min-w-0 break-all text-[10px] font-mono leading-relaxed text-slate-500 bg-slate-50/80 p-2 border border-slate-100 rounded-md max-h-[80px] overflow-y-auto"
                                            title={webReferral || 'Direct'}
                                          >
                                            {webReferral || 'Direct'}
                                          </div>
                                        </div>
                                      ) : null}
                                      {webSession && webUtm ? (
                                        <div className="flex flex-col gap-1 border-t border-slate-100 pt-2">
                                          <span className="text-[10px] text-slate-500 font-semibold uppercase mb-1">UTM Parameters</span>
                                          <div
                                            className={`min-w-0 break-all text-[10px] font-mono leading-relaxed p-2.5 border rounded-md max-h-[100px] overflow-y-auto ${
                                              webUtm.hasUtm 
                                                ? 'text-emerald-800 bg-emerald-50/40 border-emerald-100' 
                                                : 'text-slate-400 bg-slate-50/80 border-slate-100'
                                            }`}
                                            title={webUtm.title || undefined}
                                          >
                                            {webUtm.hasUtm ? (
                                              <div className="space-y-0.5 text-[9px]">
                                                {webUtm.source && (
                                                  <div>
                                                    <span className="font-bold text-slate-400">source:</span>{' '}
                                                    <span className="text-slate-800 font-semibold">{webUtm.source}</span>
                                                  </div>
                                                )}
                                                {webUtm.medium && (
                                                  <div>
                                                    <span className="font-bold text-slate-400">medium:</span>{' '}
                                                    <span className="text-slate-800 font-semibold">{webUtm.medium}</span>
                                                  </div>
                                                )}
                                                {webUtm.campaign && (
                                                  <div>
                                                    <span className="font-bold text-slate-400">campaign:</span>{' '}
                                                    <span className="text-slate-800 font-semibold">{webUtm.campaign}</span>
                                                  </div>
                                                )}
                                                {webUtm.term && (
                                                  <div>
                                                    <span className="font-bold text-slate-400">term:</span>{' '}
                                                    <span className="text-slate-800 font-semibold">{webUtm.term}</span>
                                                  </div>
                                                )}
                                                {webUtm.content && (
                                                  <div>
                                                    <span className="font-bold text-slate-400">content:</span>{' '}
                                                    <span className="text-slate-800 font-semibold">{webUtm.content}</span>
                                                  </div>
                                                )}
                                                {webUtm.campaignId && (
                                                  <div>
                                                    <span className="font-bold text-slate-400">id:</span>{' '}
                                                    <span className="text-slate-800 font-semibold">{webUtm.campaignId}</span>
                                                  </div>
                                                )}
                                              </div>
                                            ) : (
                                              'No UTM attribution'
                                            )}
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Performance */}
                            <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Gauge className="w-3.5 h-3.5 text-slate-400" /> Performance</div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Startup</span>
                                  <span className={`border px-2 py-0.5 rounded-md font-mono text-xs font-bold ${
                                    startupMs === null 
                                      ? 'text-slate-500 bg-slate-50 border-slate-100' 
                                      : startupMs > 2000 
                                        ? 'text-rose-700 bg-rose-50 border-rose-100' 
                                        : 'text-emerald-700 bg-emerald-50 border-emerald-100'
                                  }`}>
                                    {startupMs === null ? 'N/A' : `${startupMs.toFixed(0)}ms`}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">API Avg</span>
                                  <span className={`border px-2 py-0.5 rounded-md font-mono text-xs font-bold ${
                                    (session.apiAvgResponseMs || 0) > 1000 
                                      ? 'text-pink-700 bg-pink-50 border-pink-100' 
                                      : 'text-slate-800 bg-slate-50 border-slate-100'
                                  }`}>
                                    {(session.apiAvgResponseMs || 0).toFixed(0)}ms
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Duration</span>
                                  <span className="border border-slate-100 bg-slate-50 px-2 py-0.5 rounded-md font-mono text-xs font-bold text-slate-800">
                                    {Math.floor(session.durationSeconds / 60)}:{String(session.durationSeconds % 60).padStart(2, '0')}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Environment */}
                            <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Globe className="w-3.5 h-3.5 text-slate-400" /> Environment</div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center gap-1">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase shrink-0">Network</span>
                                  <div
                                    className="flex items-center gap-1 font-bold text-slate-800 uppercase text-[10px] min-w-0"
                                    title={networkDisplay?.networkTitle}
                                  >
                                    <NetworkIcon type={networkDisplay?.rawNetworkType || networkType} />
                                    <span className="truncate">{webSession ? networkDisplay?.networkLabel : (networkType || 'Unknown')}</span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center gap-1">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase shrink-0">OS</span>
                                  <span
                                    className="font-bold text-slate-800 text-[10px] truncate max-w-[110px] text-right"
                                    title={webSession ? webEnvironment?.osTitle : undefined}
                                  >
                                    {webSession ? webEnvironment?.osLabel : (session.osVersion || '—')}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center gap-1">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase shrink-0">Location</span>
                                  <span className="inline-flex max-w-[110px] items-center justify-end gap-1 text-right text-[10px] font-bold text-slate-800">
                                    {geoDisplay.hasLocation ? (
                                      <>
                                        <CountryFlag
                                          countryCode={geoDisplay.countryCode}
                                          countryLabel={geoDisplay.countryLabel}
                                          className="h-3.5"
                                          imageClassName="h-3.5 w-3.5"
                                          decorative
                                        />
                                        <span className="truncate">{geoDisplay.cityLabel || geoDisplay.countryLabel}</span>
                                      </>
                                    ) : '—'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* API — compact inline */}
                            <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200">
                              <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Activity className="w-3.5 h-3.5 text-slate-400" /> API Calls</div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Total</span>
                                  <span className="border border-blue-100 bg-blue-50 px-2 py-0.5 rounded-md font-mono text-xs font-bold text-blue-700">{session.apiTotalCount || ((session.apiSuccessCount || 0) + (session.apiErrorCount || 0))}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">OK</span>
                                  <span className="border border-emerald-100 bg-emerald-50 px-2 py-0.5 rounded-md font-mono text-xs font-bold text-emerald-700">{session.apiSuccessCount || 0}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Errors</span>
                                  <span className={`border px-2 py-0.5 rounded-md font-mono text-xs font-bold ${
                                    (session.apiErrorCount || 0) > 0 
                                      ? 'text-rose-700 bg-rose-50 border-rose-100' 
                                      : 'text-slate-500 bg-slate-50 border-slate-100'
                                  }`}>{session.apiErrorCount || 0}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase">Avg Lat.</span>
                                  <span className={`border px-2 py-0.5 rounded-md font-mono text-xs font-bold ${
                                    (session.apiAvgResponseMs || 0) > 1000 
                                      ? 'text-pink-700 bg-pink-50 border-pink-100' 
                                      : 'text-slate-800 bg-slate-50 border-slate-100'
                                  }`}>
                                    {(session.apiAvgResponseMs || 0).toFixed(0)}ms
                                  </span>
                                </div>
                              </div>
                            </div>
                            {/* Replay - compact */}
                            <button
                              type="button"
                              onClick={() => !isReplayBlocked && navigate(`${pathPrefix}/sessions/${session.id}`)}
                              disabled={isReplayBlocked}
                              className={`group flex flex-col justify-between text-left gap-3 border p-4 !rounded-xl shadow-sm transition-all duration-300 w-full focus:outline-none focus:ring-2 focus:ring-offset-2
                                ${isReplayBlocked 
                                  ? 'bg-slate-50 border-slate-200 cursor-not-allowed opacity-75' 
                                  : webSession 
                                    ? 'bg-gradient-to-br from-cyan-50/60 via-[#ecfeff]/40 to-indigo-50/30 border-cyan-100 hover:border-cyan-300/80 hover:shadow-md hover:scale-[1.02] cursor-pointer focus:ring-cyan-500' 
                                    : 'bg-gradient-to-br from-indigo-50/40 via-indigo-50/20 to-slate-100/50 border-slate-200/80 hover:border-indigo-300/80 hover:shadow-md hover:scale-[1.02] cursor-pointer focus:ring-indigo-500'
                                }`}
                            >
                              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                <AnimalAvatar animal={replayAnimal} seed={replayAnimalSeed} size={18} active={isExpanded} neutral />
                                {webSession ? 'Browser Replay' : 'Replay'}
                              </div>

                              <div className="flex-1 flex flex-col items-center justify-center py-2.5 my-1 w-full">
                                <div className={`h-11 w-11 rounded-full flex items-center justify-center shadow-sm transition-all duration-300
                                  ${isReplayBlocked 
                                    ? 'bg-slate-200 text-slate-400' 
                                    : webSession
                                      ? 'bg-cyan-600 text-white group-hover:scale-110 group-hover:bg-cyan-500 group-hover:shadow-md group-hover:shadow-cyan-500/25'
                                      : 'bg-indigo-600 text-white group-hover:scale-110 group-hover:bg-indigo-500 group-hover:shadow-md group-hover:shadow-indigo-500/25'
                                  }`}
                                >
                                  {isReplayBlocked ? (
                                    <Loader className="h-5 w-5 animate-spin" />
                                  ) : (
                                    <Play className="h-5 w-5 ml-0.5 fill-current" />
                                  )}
                                </div>
                                <span className={`text-[11px] font-black mt-3 transition-colors duration-200 uppercase tracking-wider
                                  ${isReplayBlocked 
                                    ? 'text-slate-400' 
                                    : webSession
                                      ? 'text-cyan-700 group-hover:text-cyan-900'
                                      : 'text-indigo-700 group-hover:text-indigo-900'
                                  }`}
                                >
                                  {isReplayBlocked ? 'Unavailable' : isLiveIngest ? 'Live Replay' : 'Open Replay'}
                                </span>
                              </div>

                              <div className="text-[10px] text-slate-500 font-semibold text-center leading-tight w-full mt-0.5">
                                {screensCount} {webSession ? 'page' : 'screen'}{screensCount !== 1 ? 's' : ''}&nbsp;·&nbsp;{Math.floor(session.durationSeconds / 60)}m {session.durationSeconds % 60}s
                              </div>
                            </button>
                          </div>

                          {/* ── Page Journey ── */}
                          {(() => {
                            const screens: string[] = (session as any).screensVisited || [];
                            if (screens.length === 0) return null;
                            return (
                            <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Page Journey</div>
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
                                            {webSession ? (
                                              <a
                                                href={getAbsoluteUrl(screen, selectedProject?.webDomain)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-semibold border transition-all duration-200
                                                  ${isEntry
                                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100/80 hover:border-emerald-300'
                                                    : isExit
                                                    ? 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100/80 hover:border-rose-300'
                                                    : 'bg-slate-50 border-slate-200/80 text-slate-700 hover:bg-slate-100/80 hover:border-slate-350'
                                                  }`}
                                                title={`Visit ${screen}`}
                                              >
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isEntry ? 'bg-emerald-500' : isExit ? 'bg-rose-500' : 'bg-slate-350'}`} />
                                                <span className="whitespace-nowrap max-w-[120px] truncate">{screen}</span>
                                                {/* step number badge */}
                                                <span className={`absolute -top-2 -right-1.5 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full leading-none text-center shadow-sm border
                                                  ${isEntry 
                                                    ? 'bg-emerald-500 text-white border-emerald-400' 
                                                    : isExit 
                                                      ? 'bg-rose-500 text-white border-rose-400' 
                                                      : 'bg-slate-200 text-slate-700 border-slate-300'
                                                  }`}>
                                                  {idx + 1}
                                                </span>
                                              </a>
                                            ) : (
                                              <div
                                                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-semibold border transition-all duration-200
                                                  ${isEntry
                                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                                    : isExit
                                                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                                                    : 'bg-slate-50 border-slate-200/80 text-slate-700'
                                                  }`}
                                              >
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isEntry ? 'bg-emerald-500' : isExit ? 'bg-rose-500' : 'bg-slate-350'}`} />
                                                <span className="whitespace-nowrap max-w-[120px] truncate">{screen}</span>
                                                {/* step number badge */}
                                                <span className={`absolute -top-2 -right-1.5 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full leading-none text-center shadow-sm border
                                                  ${isEntry 
                                                    ? 'bg-emerald-500 text-white border-emerald-400' 
                                                    : isExit 
                                                      ? 'bg-rose-500 text-white border-rose-400' 
                                                      : 'bg-slate-200 text-slate-700 border-slate-300'
                                                  }`}>
                                                  {idx + 1}
                                                </span>
                                              </div>
                                            )}
                                            <span className={`text-[9px] font-bold uppercase tracking-wider mt-1
                                              ${isEntry ? 'text-emerald-600' : isExit ? 'text-rose-600' : 'text-transparent'}`}>
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
            <div className="flex items-center justify-between border-t-2 border-black bg-[#f8fafc] px-6 py-4 flex-wrap gap-4">
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
                  className="border-2 border-black bg-white p-1.5 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo disabled:cursor-not-allowed disabled:opacity-30"
                  title="First page"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="border-2 border-black bg-white p-1.5 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo disabled:cursor-not-allowed disabled:opacity-30"
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
                  className="border-2 border-black bg-white p-1.5 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo disabled:cursor-not-allowed disabled:opacity-30"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className="border-2 border-black bg-white p-1.5 shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo disabled:cursor-not-allowed disabled:opacity-30"
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
                  className="cursor-pointer border-2 border-black bg-white px-2 py-1 text-xs font-black shadow-neo-sm outline-none focus:outline-none"
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

      <SmartCaptureModal
        isOpen={isSmartCaptureModalOpen}
        onClose={() => setIsSmartCaptureModalOpen(false)}
        projectId={selectedProjectId || 'demo'}
        pathPrefix={pathPrefix}
        config={smartCaptureConfig}
        isLoading={isLoadingSmartCapture}
        availableFilters={availableFilters}
        isLoadingFilters={isLoadingFilters}
        onConfigChange={setSmartCaptureConfig}
      />
    </div>
  );
};

export default RecordingsList;
