import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ReplayLink } from './ReplayLink';
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
  Loader2,
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
  dashboardButtonClass,
  dashboardButtonVariants,
  dashboardCardClass,
  dashboardChipClass,
  dashboardChipTones,
  dashboardSelectedClass,
  type DashboardChipTone,
} from '~/shared/ui/core/dashboardStyles';

import {
  getSessionsArchiveTotalCount,
  getSessionsPaginated,
  getAvailableFilters,
  getAvailableLocations,
  getProjectSmartCaptureConfig,
  type SessionArchiveSortKey,
  type SmartCaptureConfig,
  type SmartCaptureRule,
} from '~/shared/api/client';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useSafeTeam } from '~/shared/providers/TeamContext';
import { findCountryCodesMatchingName, formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { formatDeviceModel, getDeviceModelSearchText } from '~/shared/lib/deviceModelNames';
import { hasSuccessfulRecordingFromSession } from '~/shared/lib/replayAvailability';
import { getWebNetworkDisplay, getWebSessionEnvironment } from '~/shared/lib/webSessionEnvironment';
import { formatWebReferralLabel, getWebReferral, getWebUtmAttribution, getAbsoluteUrl } from '~/shared/lib/webAttributionMetadata';
import { DashboardGhostLoader, useInitialDashboardLoad } from '~/shared/ui/core/DashboardGhostLoader';
import { AnimalAvatar, getAnimalAvatarSeed, getAnimalForIdentity } from '~/shared/ui/core/AnimalAvatar';
import { BrowserBrandIcon } from '~/shared/ui/core/BrowserBrandIcon';
import { MobilePlatformBrandIcon } from '~/shared/ui/core/MobilePlatformBrandIcon';
import { CountryFlag } from '~/shared/ui/core/CountryFlag';
import { matchesSessionArchiveIssueFilter } from './sessionArchiveFilters';
import { QueryBuilder } from './QueryBuilder';
import { SmartCaptureModal, SMART_CAPTURE_RULE_COLOR_TONES } from './SmartCaptureModal';
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
  if (!type) return <Signal className="w-3 h-3 text-[#bdc1c6]" />;
  const normalized = type.toLowerCase();
  if (normalized === 'wifi') return <Wifi className="w-3 h-3" />;
  if (['5g', '4g', 'lte', '3g', 'cellular'].includes(normalized)) return <Signal className="w-3 h-3" />;
  return <Globe className="w-3 h-3" />;
};

// Native SDKs report raw network values ("wifi", "cellular", "5g"); show them as readable labels.
function formatNativeNetworkLabel(type: string | undefined): string {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  if (normalized === 'wifi') return 'Wi-Fi';
  if (/^(2g|3g|4g|5g|lte|edge)$/.test(normalized)) return normalized.toUpperCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}


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

/** Secondary button that takes the selected tone while the panel it controls is open. */
function toggleButtonClass(selected: boolean, size: 'sm' | 'md' = 'md'): string {
  const base = dashboardButtonClass('secondary', size);
  return selected
    ? base.replace(dashboardButtonVariants.secondary, `border-[#d2e3fc] ${dashboardSelectedClass} hover:bg-[#d2e3fc]`)
    : base;
}

/** Square secondary icon button (pagination). */
const ICON_BUTTON_CLASS = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-none border border-[#dadce0] bg-white text-[#3c4043] transition-colors hover:border-[#bdc1c6] hover:bg-[#f8fafd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 disabled:cursor-not-allowed disabled:opacity-40';

/** Borderless icon button used inside table rows. */
const ROW_ICON_BUTTON_CLASS = 'inline-flex h-8 w-8 items-center justify-center rounded-none border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40';

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
  const tone: DashboardChipTone = SMART_CAPTURE_RULE_COLOR_TONES[note.color] ?? 'info';
  return (
    <span
      className={`inline-block max-w-[8rem] truncate whitespace-nowrap rounded-none px-2 py-0.5 text-[11px] font-medium leading-4 ${dashboardChipTones[tone]}`}
      title={`Smart Capture: ${note.label}`}
    >
      {note.label}
    </span>
  );
}

const createEmptyQueryGroups = (): QueryGroup[] => [{ id: generateGroupId(), conditions: [] }];

const SEARCH_STORAGE_PREFIX = 'rejourney:session-archive:search:v1';
/** Slow text searches get cut off with a clear message instead of an endless spinner. */
const ARCHIVE_REQUEST_TIMEOUT_MS = 20000;

// Session storage keeps the search when returning from a replay without writing it to the URL,
// which would remount the page on every keystroke.
function readStoredArchiveSearch(projectId?: string | null): string {
  if (typeof window === 'undefined' || !projectId) return '';
  try {
    return window.sessionStorage.getItem(`${SEARCH_STORAGE_PREFIX}:${projectId}`) ?? '';
  } catch {
    return '';
  }
}

function writeStoredArchiveSearch(projectId: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${SEARCH_STORAGE_PREFIX}:${projectId}`;
    if (value) {
      window.sessionStorage.setItem(key, value);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage can fail in private mode; the search still works in memory.
  }
}

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
  const [searchQuery, setSearchQuery] = useState(() => readStoredArchiveSearch(selectedProject?.id));
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(() => readStoredArchiveSearch(selectedProject?.id));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchRunVersion, setSearchRunVersion] = useState(0);
  const forceFreshFetchRef = useRef(false);
  const activeAbortRef = useRef<AbortController | null>(null);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  // Query builder
  const [availableFilters, setAvailableFilters] = useState<{ events: string[]; eventPropertyKeys: string[]; screens: string[]; metadata: Record<string, string[]>; locations: Array<{ country?: string; city?: string }> }>({ events: [], eventPropertyKeys: [], screens: [], metadata: {}, locations: [] });
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

  const queryBuilderAvailableFilters = useMemo(() => {
    if (!isDemoMode) return availableFilters;

    const seenLocations = new Set<string>();
    const locations = demoReplaySessions.flatMap((session) => {
      if (!hasSuccessfulRecording(session)) return [];
      const country = session.geoLocation?.country?.trim();
      const city = session.geoLocation?.city?.trim();
      if (!country && !city) return [];

      const key = `${country ?? ''}\u0000${city ?? ''}`;
      if (seenLocations.has(key)) return [];
      seenLocations.add(key);
      return [{ country, city }];
    });

    return { ...availableFilters, locations };
  }, [availableFilters, demoReplaySessions, isDemoMode]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 350);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const runSearchNow = useCallback((value: string) => {
    forceFreshFetchRef.current = true;
    setDebouncedSearchQuery(value);
    setSearchRunVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (selectedProject?.id && queryGroupsProjectId === selectedProject.id) {
      writeStoredArchiveSearch(selectedProject.id, debouncedSearchQuery.trim());
    }
  }, [debouncedSearchQuery, selectedProject?.id, queryGroupsProjectId]);

  const primarySortKey: SortKey = sortConfigs[0]?.key ?? 'date';
  const primarySortDir: SortDirection = sortConfigs[0]?.direction ?? 'desc';

  const selectedProjectId = selectedProject?.id;
  const selectedProjectTeamId = selectedProject?.teamId;
  const isProjectFromCurrentTeam = !selectedProjectId || !currentTeam?.id || selectedProjectTeamId === currentTeam.id;
  const loadLocationOptions = useCallback((
    kind: 'country' | 'city',
    search: string,
    country?: string,
  ) => {
    if (isDemoMode || !selectedProjectId) return Promise.resolve([]);
    return getAvailableLocations(selectedProjectId, {
      kind,
      search,
      country,
      countryCodes: kind === 'country' ? findCountryCodesMatchingName(search) : undefined,
    });
  }, [isDemoMode, selectedProjectId]);

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
        (!filterParams.platform || filterParams.platform === 'all' || session.platform === filterParams.platform) &&
        (!filterParams.geoCountry || session.geoLocation?.country === filterParams.geoCountry) &&
        (!filterParams.geoCity || session.geoLocation?.city === filterParams.geoCity)
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

    const fresh = !cursor && forceFreshFetchRef.current;
    if (!cursor) forceFreshFetchRef.current = false;
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: number | undefined;
    if (controller) {
      activeAbortRef.current?.abort();
      activeAbortRef.current = controller;
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ARCHIVE_REQUEST_TIMEOUT_MS);
    }

    try {
      if (cursor) {
        setIsLoadingMore(true);
      } else {
        setLoadError(null);
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

      const result = await getSessionsPaginated(archiveQuery, controller ? { signal: controller.signal, fresh } : {});

      if (requestId !== activeRequestIdRef.current) return;

      if (cursor) {
        // Append to existing sessions
        setSessions(prev => [...prev, ...result.sessions]);
      } else {
        // Replace all sessions; total count runs as a follow-up (avoids slow count(*) blocking first paint)
        setSessions(result.sessions);
        if (!result.hasMore) {
          setTotalCount(result.sessions.length);
        } else void getSessionsArchiveTotalCount({
          projectId: selectedProjectId!,
          platform,
          hasRecording: true,
          q: qLive,
          ...filterParams,
        }, { signal: controller.signal, fresh }).then((n) => {
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
      // A newer search cancelled this one; its own result will arrive.
      if ((err as { name?: string } | null)?.name === 'AbortError' && !timedOut) return;
      console.error('Failed to fetch sessions:', err);
      setLoadError(timedOut
        ? 'Search is taking too long. Paste a full user ID or session ID for an instant match.'
        : err instanceof Error && err.message
          ? err.message
          : 'Could not load replays.');
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
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
  const fetchScopeKeyBase = `hydrated:${queryGroupsProjectId}:all:${currentTeam?.id || 'no-team'}:${selectedProjectId || 'no-project'}:${isContextLoading ? 'loading' : 'ready'}:${projects.length}:${isProjectFromCurrentTeam ? 'valid' : 'invalid'}:${rowsPerPage}:${conditionsKey}:refresh-${manualRefreshVersion}`;
  const fetchScopeKey = isDemoMode
    ? `demo:${fetchScopeKeyBase}`
    : `live:${fetchScopeKeyBase}:${debouncedSearchQuery}:${primarySortKey}:${primarySortDir}:run-${searchRunVersion}`;

  useEffect(() => {
    if (!isDemoMode && selectedProjectId && queryGroupsProjectId !== selectedProjectId) return;
    const requestId = ++activeRequestIdRef.current;
    setCurrentPage(1);
    setExpandedSessionId(null);
    setNextCursor(null);
    setHasMore(false);
    setIsLoadingMore(false);
    void fetchSessions(undefined, requestId);
    return () => {
      ++activeRequestIdRef.current;
      activeAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchScopeKey]);

  // Reset query conditions and available filters when project/team changes
  const prevProjectIdRef = useRef<string | undefined>(undefined);
  const availableFiltersFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedProjectId || !isProjectFromCurrentTeam) {
      setAvailableFilters({ events: [], eventPropertyKeys: [], screens: [], metadata: {}, locations: [] });
      setQueryGroups(createEmptyQueryGroups());
      setQueryGroupsProjectId(null);
      prevProjectIdRef.current = undefined;
      return;
    }
    const projectChanged = prevProjectIdRef.current !== selectedProjectId;
    prevProjectIdRef.current = selectedProjectId;
    if (projectChanged) {
      const storedSearch = readStoredArchiveSearch(selectedProjectId);
      setSearchQuery(storedSearch);
      setDebouncedSearchQuery(storedSearch);
      const storedGroups = readStoredQueryGroups(selectedProjectId);
      setQueryGroups(storedGroups ?? createEmptyQueryGroups());
      setQueryGroupsProjectId(selectedProjectId);
      setAvailableFilters({ events: [], eventPropertyKeys: [], screens: [], metadata: {}, locations: [] });
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
          setAvailableFilters({ events: [], eventPropertyKeys: [], screens: [], metadata: {}, locations: [] });
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
  // Demo search filters in the browser, so its count follows the filtered list.
  const displayedTotalCount = isDemoMode ? filteredSessions.length : totalCount;
  const archiveCountLabel = `${displayedTotalCount === null ? '…' : displayedTotalCount.toLocaleString()} total replays`;
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
  const smartCaptureDotClass = {
    loading: 'bg-[#bdc1c6]',
    locked: 'bg-[#f9ab00]',
    off: 'bg-[#f9ab00]',
    active: 'bg-[#1e8e3e]',
    pending: 'bg-[#f9ab00]',
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
      className={`flex items-center cursor-pointer select-none hover:text-[#202124] transition-colors group ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'} ${className}`}
      title={
        isDemoMode
          ? 'Click to sort, Shift+click for multi-column sort (full demo list)'
        : 'Click to sort the full archive. Shift+click is only available in demo mode — live data uses the primary column on the server.'
      }
    >
      <span className="flex items-center gap-1 whitespace-nowrap">
        {align === 'right' && (
          <span className="text-[#80868b] transition-colors group-hover:text-[#202124]">{getSortIndicator(sortKey)}</span>
        )}
        <span>{label}</span>
        {align !== 'right' && (
          <span className="text-[#80868b] transition-colors group-hover:text-[#202124]">{getSortIndicator(sortKey)}</span>
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

  const shouldShowInitialGhost = useInitialDashboardLoad(isLoading || isContextLoading);

  if (shouldShowInitialGhost && (selectedProjectId || isContextLoading)) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="rejourney-replays-page min-h-screen flex flex-col bg-[#f8fafd] font-sans text-[#202124]">
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
              className={`smart-capture-trigger ${dashboardButtonClass('secondary', 'md')}`}
              title={`Smart Capture: ${smartCaptureStatusLabel}`}
              aria-label={`Smart Capture: ${smartCaptureStatusLabel}`}
            >
              {isLoadingSmartCapture ? (
                <Loader className="h-4 w-4 shrink-0 animate-spin text-[#5f6368]" aria-hidden />
              ) : (
                <ScanEye className="h-4 w-4 shrink-0 text-[#5f6368]" aria-hidden />
              )}
              <span>Smart Capture</span>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${smartCaptureDotClass}`} aria-hidden />
            </button>
          )}
        </DashboardPageHeader>

        {/* Search & Controls Row */}
        <div className="border-b border-[#dadce0] bg-white px-4 py-3 sm:px-6">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <form
              role="search"
              className="group relative min-w-0 sm:flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                runSearchNow(searchQuery);
              }}
            >
              <span className="pointer-events-none absolute left-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-[#5f6368] transition-colors group-focus-within:text-[#1a73e8]">
                <Search className="h-4 w-4 shrink-0" />
              </span>
              <input
                type="search"
                name="q"
                enterKeyHint="search"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Search replays"
                placeholder="Search user ID, session ID or device"
                value={searchQuery}
                onChange={(e) => {
                  const value = e.target.value;
                  setSearchQuery(value);
                  // A pasted ID is a complete query; don't wait for the typing debounce.
                  if ((e.nativeEvent as InputEvent).inputType === 'insertFromPaste') runSearchNow(value);
                }}
                className="h-9 w-full rounded-none border border-[#dadce0] bg-white py-2 pl-10 pr-4 text-sm text-[#202124] outline-none transition-colors placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
              />
            </form>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center">
              <button
                onClick={handleQueryButtonClick}
                className={`${toggleButtonClass(showQueryBuilder)} relative w-full min-w-[7.5rem] sm:w-auto`}
              >
                {showQueryBuilder ? <ChevronUp className="h-4 w-4 shrink-0" /> : <Filter className="h-4 w-4 shrink-0" />}
                {showQueryBuilder ? 'Hide query' : 'Query'}
                {totalConditions > 0 && (
                  <span className={`ml-0.5 min-w-[18px] px-1.5 py-0.5 text-center text-[11px] font-medium leading-none tabular-nums ${showQueryBuilder ? 'bg-white text-[#1967d2]' : 'bg-[#e8f0fe] text-[#1967d2]'}`}>
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
                className="h-9 w-full rounded-none border border-[#dadce0] bg-white px-3 text-sm text-[#202124] outline-none transition-colors hover:bg-[#f8fafd] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 sm:w-[9.5rem] md:hidden"
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
              <div className="flex sm:border-l sm:border-[#e8eaed] sm:pl-2">
                <button
                  onClick={handleClearActiveFilters}
                  className={`${dashboardButtonClass('secondary', 'md')} w-full sm:w-auto`}
                  title="Clear all filters"
                >
                  <X className="h-3.5 w-3.5" /> Clear filters
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Query Builder Panel */}
        {showQueryBuilder && (
          <div className="border-b border-[#dadce0] bg-[#f8fafd] px-4 py-4 sm:px-6">
            <div className="max-w-[1800px] mx-auto">
              <QueryBuilder
                groups={queryGroups}
                onGroupsChange={setQueryGroups}
                onSearchQuery={(value) => { setSearchQuery(value); runSearchNow(value); }}
                onClearQueries={clearQueryGroups}
                availableFilters={queryBuilderAvailableFilters}
                isLoadingFilters={isLoadingFilters}
                projectId={selectedProjectId}
                smartCaptureRules={smartCaptureConfig?.rules ?? []}
                loadLocationOptions={loadLocationOptions}
              />
            </div>
          </div>
        )}

        {/* Compact summary bar when panel is closed but conditions are active */}
        {!showQueryBuilder && totalConditions > 0 && (
          <div className="border-b border-[#dadce0] bg-[#f8fafd] px-4 py-2.5 sm:px-6">
            <div className="flex max-w-[1800px] items-center gap-1.5 mx-auto overflow-x-auto no-scrollbar">
              <span className="shrink-0 text-xs font-medium text-[#5f6368]">Where</span>
              {queryGroups.map((group, gi) => (
                <React.Fragment key={group.id}>
                  {gi > 0 && <span className="shrink-0 px-0.5 text-[11px] font-medium text-[#5f6368]">OR</span>}
                  {group.conditions.map((cond, idx) => (
                    <React.Fragment key={cond.id}>
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-none border border-[#dadce0] bg-white px-2.5 py-1 text-xs font-medium text-[#3c4043]">
                        {getConditionShortLabel(cond)}
                        <X
                          className="h-3 w-3 cursor-pointer text-[#5f6368] transition-colors hover:text-[#202124]"
                          onClick={() => setQueryGroups((prev) => prev.map((g) => g.id === group.id ? { ...g, conditions: g.conditions.filter((c) => c.id !== cond.id) } : g))}
                        />
                      </span>
                      {idx < group.conditions.length - 1 && <span className="shrink-0 px-0.5 text-[11px] font-medium text-[#5f6368]">AND</span>}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
              <button onClick={() => setShowQueryBuilder(true)} className={dashboardButtonClass('secondary', 'sm')}>
                Edit
              </button>
            </div>
          </div>
        )}
      </div>

      {/* List Content — table header sticks when scrolling */}
      <div className="sessions-list-shell flex-1 w-full max-w-full px-4 sm:px-6 pt-4 pb-24">
        {loadError && (
          <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 border border-[#f6aea9] bg-[#fce8e6] px-3 py-2 text-sm text-[#a50e0e]">
            <span className="min-w-0">{loadError}</span>
            <button type="button" onClick={() => runSearchNow(searchQuery)} className={dashboardButtonClass('secondary', 'sm')}>
              Try again
            </button>
          </div>
        )}
        {isRefreshing && (
          <div role="status" className="mb-3 flex items-center gap-2 text-sm text-[#5f6368]">
            <Loader2 className="h-4 w-4 animate-spin text-[#1a73e8]" aria-hidden />
            {debouncedSearchQuery.trim() ? 'Searching…' : 'Updating…'}
          </div>
        )}
        <div className={`sessions-mobile-list space-y-3 transition-opacity ${isRefreshing ? 'pointer-events-none opacity-50' : ''}`}>
          {paginatedSessions.length === 0 ? (
            <div className={`${dashboardCardClass} p-6 text-center`}>
              <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center bg-[#f1f3f4] text-[#5f6368]">
                <Smartphone className="h-5 w-5" />
              </div>
              <h3 className="text-[15px] font-medium text-[#202124]">
                {selectedProjectId ? 'No sessions found' : 'No project selected'}
              </h3>
              <p className="mt-1 text-xs text-[#5f6368]">
                {selectedProjectId ? 'Adjust your filters or search query.' : 'Select or create a project to view replay data.'}
              </p>
            </div>
          ) : (
            paginatedSessions.map((session) => {
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
                    // Device model leads; the OS version is the secondary line. Web
                    // sessions keep the browser on top intentionally.
                    primary: displayDeviceModel,
                    secondary: formatNativeOsLabel(platformLabel, session.osVersion),
                    iconName: platformLabel,
                    title: `${displayDeviceModel}${session.osVersion ? ` · ${session.osVersion}` : ''}`,
                  };
              const smartCaptureNote = getSmartCaptureRuleNote(session, smartCaptureConfig);
              const screens: string[] = (session as any).screensVisited || [];

              return (
                <article
                  key={session.id}
                  className={dashboardCardClass}
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
                        <span className={`truncate font-mono text-sm font-medium text-[#202124] ${isReplayBlocked ? 'opacity-60' : ''}`} title={userId}>
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
                            className="shrink-0 text-[#5f6368] transition-colors hover:text-[#202124]"
                            aria-label="Copy user id"
                          >
                            {copiedId === userId ? <Check size={12} className="text-[#1e8e3e]" /> : <Copy size={12} />}
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums text-[#5f6368]">
                        <span>{new Date(session.startedAt).toLocaleDateString()}</span>
                        <span>{new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="inline-flex items-center gap-1" title={deviceColumn.title}>
                          {deviceColumn.kind === 'web' ? (
                            <BrowserBrandIcon browserName={deviceColumn.iconName} className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <MobilePlatformBrandIcon platformName={deviceColumn.iconName} className="h-3.5 w-3.5 shrink-0 text-[#5f6368]" />
                          )}
                          <span>{deviceColumn.primary}</span>
                        </span>
                      </div>
                    </div>
                    <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-[#5f6368] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-[#e8eaed] px-3 py-2 text-[11px]">
                    <div className="min-w-0">
                      <div className="font-medium text-[#5f6368]">Location</div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-[#202124]">
                        {geoDisplay.hasLocation ? (
                          <>
                            <CountryFlag countryCode={geoDisplay.countryCode} countryLabel={geoDisplay.countryLabel} className="h-3.5" imageClassName="h-3.5 w-3.5" decorative />
                            <span className="truncate">{geoDisplay.cityLabel || geoDisplay.countryLabel}</span>
                          </>
                        ) : (
                          <span className="text-[#80868b]">Unknown</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-[#5f6368]">Duration</div>
                      <div className="mt-1 text-sm tabular-nums text-[#202124]">{formatSessionDuration(session.durationSeconds)}</div>
                    </div>
                    <div>
                      <div className="font-medium text-[#5f6368]">Screens</div>
                      <div className="mt-1 text-sm tabular-nums text-[#202124]">{screensCount}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-[#5f6368]">Notes</div>
                      <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                        {session.isFirstSession && (
                          <span title="First recorded session for this visitor in this project">
                            <NeoBadge variant="info" size="sm">New user</NeoBadge>
                          </span>
                        )}
                        {smartCaptureNote && <SmartCaptureNoteBadge note={smartCaptureNote} />}
                        {hasDeepExploration && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=start`}
                            disabled={!canNavigateToSession}
                            title="Deep session (high exploration score 70 or above)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="success" size="sm">Deep</NeoBadge>
                          </ReplayLink>
                        )}
                        {(session.crashCount || 0) > 0 && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=crash`}
                            disabled={!canNavigateToSession}
                            title="Application crash (fatal exception)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="danger" size="sm">Crash</NeoBadge>
                          </ReplayLink>
                        )}
                        {((session as any).anrCount || 0) > 0 && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=anr`}
                            disabled={!canNavigateToSession}
                            title="App Not Responding (UI thread blocked)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="anr" size="sm">ANR</NeoBadge>
                          </ReplayLink>
                        )}
                        {((session as any).errorCount || 0) > 0 && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=error`}
                            disabled={!canNavigateToSession}
                            title="Logged error or resource loading failure"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="warning" size="sm">Error</NeoBadge>
                          </ReplayLink>
                        )}
                        {(session.rageTapCount || 0) > 0 && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=rage`}
                            disabled={!canNavigateToSession}
                            title="Rage tap (repeated rapid taps in a small area)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="rage" size="sm">Rage tap</NeoBadge>
                          </ReplayLink>
                        )}
                        {hasDeadTaps && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=dead`}
                            disabled={!canNavigateToSession}
                            title="Dead tap (tap on a non-interactive area with no response)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="dead_tap" size="sm">Dead tap</NeoBadge>
                          </ReplayLink>
                        )}
                        {hasSlowStart && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=slow_start`}
                            disabled={!canNavigateToSession}
                            title="Slow cold startup duration"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="slow_start" size="sm">Slow start</NeoBadge>
                          </ReplayLink>
                        )}
                        {hasSlowApi && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=api`}
                            disabled={!canNavigateToSession}
                            title="Slow API average latency (over 1000ms)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="slow_api" size="sm">Slow API</NeoBadge>
                          </ReplayLink>
                        )}
                        {hasLowExploration && (
                          <ReplayLink
                            to={`${pathPrefix}/sessions/${session.id}?seekToType=start`}
                            disabled={!canNavigateToSession}
                            title="Shallow session (low exploration score under 40)"
                            className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                          >
                            <NeoBadge variant="neutral" size="sm">Shallow</NeoBadge>
                          </ReplayLink>
                        )}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[#e8eaed] bg-[#f8fafd] px-3 py-3">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="border border-[#dadce0] bg-white p-2">
                          <div className="font-medium text-[#5f6368]">Startup</div>
                          <div className={`mt-1 text-sm tabular-nums ${hasSlowStart ? 'text-[#b06000]' : 'text-[#202124]'}`}>
                            {startupMs === null ? 'N/A' : `${startupMs.toFixed(0)}ms`}
                          </div>
                        </div>
                        <div className="border border-[#dadce0] bg-white p-2">
                          <div className="font-medium text-[#5f6368]">API avg</div>
                          <div className={`mt-1 text-sm tabular-nums ${hasSlowApi ? 'text-[#b06000]' : 'text-[#202124]'}`}>
                            {(session.apiAvgResponseMs || 0).toFixed(0)}ms
                          </div>
                        </div>
                        <div className="border border-[#dadce0] bg-white p-2">
                          <div className="font-medium text-[#5f6368]">Network</div>
                          <div className="mt-1 flex items-center gap-1 text-xs text-[#202124]">
                            <NetworkIcon type={networkDisplay?.rawNetworkType || networkType} />
                            <span className="truncate">{webSession ? networkDisplay?.networkLabel : formatNativeNetworkLabel(networkType)}</span>
                          </div>
                        </div>
                        <div className="border border-[#dadce0] bg-white p-2">
                          <div className="font-medium text-[#5f6368]">Source</div>
                          <div className="mt-1 truncate text-xs text-[#202124]" title={webReferral || 'Direct'}>
                            {webSession ? webReferralLabel : platformLabel}
                          </div>
                        </div>
                      </div>

                      {webSession && webUtm && (
                        <div className="mt-2 border border-[#dadce0] bg-white p-2 text-[11px]">
                          <div className="font-medium text-[#5f6368]">UTM</div>
                          <div className={`mt-1 break-words text-xs ${webUtm.hasUtm ? 'text-[#202124]' : 'text-[#80868b]'}`} title={webUtm.title}>
                            {webUtm.label}
                          </div>
                        </div>
                      )}

                      {screens.length > 0 && (
                        <div className="dashboard-mobile-scroll mt-2 overflow-x-auto pb-1">
                          <div className="flex min-w-max items-center gap-1.5">
                            {screens.slice(0, 8).map((screen, idx) => (
                              <span key={`${session.id}:${screen}:${idx}`} className="border border-[#dadce0] bg-white px-2 py-1 text-[11px] font-medium text-[#3c4043]">
                                {idx + 1}. {screen}
                              </span>
                            ))}
                            {screens.length > 8 && (
                              <span className="border border-[#dadce0] bg-white px-2 py-1 text-[11px] font-medium tabular-nums text-[#5f6368]">
                                +{screens.length - 8}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      <ReplayLink
                        to={`${pathPrefix}/sessions/${session.id}`}
                        disabled={!canNavigateToSession}
                        className={`${dashboardButtonClass(isReplayBlocked ? 'secondary' : 'primary', 'lg')} mt-3 w-full`}
                      >
                        {isReplayBlocked ? <Loader size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                        {isReplayBlocked ? 'Replay unavailable' : isLiveIngest ? 'Open live replay' : 'Open replay'}
                      </ReplayLink>
                    </div>
                  )}
                </article>
              );
            })
          )}

          {filteredSessions.length > 0 && (
            <div className={`${dashboardCardClass} flex flex-col gap-3 p-3`}>
              <div className="text-center text-xs text-[#5f6368]">
                Showing <span className="font-medium tabular-nums text-[#202124]">{startIndex}-{endIndex}</span> of{' '}
                <span className="font-medium tabular-nums text-[#202124]">{filteredSessions.length.toLocaleString()}</span> loaded
              </div>
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className={ICON_BUTTON_CLASS}
                  title="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="text-center text-xs tabular-nums text-[#3c4043]">
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
                  className={ICON_BUTTON_CLASS}
                  title="Next page"
                >
                  {isLoadingMore ? <Loader size={15} className="animate-spin" /> : <ChevronRight size={16} />}
                </button>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs font-medium text-[#5f6368]">Per page</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-8 cursor-pointer rounded-none border border-[#dadce0] bg-white px-2 text-xs tabular-nums text-[#202124] outline-none focus:border-[#1a73e8]"
                >
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className={`sessions-desktop-table dashboard-mobile-scroll overflow-x-auto pb-2 transition-opacity ${isRefreshing ? 'pointer-events-none opacity-50' : ''}`}>
          <div className={`w-full min-w-[900px] overflow-hidden ${dashboardCardClass} lg:min-w-[1020px] xl:min-w-[1070px]`}>
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-[#dadce0] bg-[#f8fafd]">
                <th className="sticky top-0 z-40 bg-[#f8fafd] w-9 py-2.5 pl-3 pr-1" />
                <th className="sticky top-0 z-40 bg-[#f8fafd] text-left py-2.5 px-2.5 text-[11px] font-medium text-[#5f6368] uppercase w-[250px]">User</th>
                <th className="sticky top-0 z-40 bg-[#f8fafd] hidden lg:table-cell text-left py-2.5 px-2.5 text-[11px] font-medium text-[#5f6368] uppercase w-[112px]"><SortableHeader label="Date" sortKey="date" /></th>
                <th className="sticky top-0 z-40 bg-[#f8fafd] hidden xl:table-cell text-left py-2.5 px-2.5 text-[11px] font-medium text-[#5f6368] uppercase w-[150px]">Device</th>
                <th className="sticky top-0 z-40 bg-[#f8fafd] hidden lg:table-cell text-left py-2.5 px-2.5 text-[11px] font-medium text-[#5f6368] uppercase w-[132px]">Location</th>
                <th className="sticky top-0 z-40 bg-[#f8fafd] hidden lg:table-cell text-right py-2.5 px-2 text-[11px] font-medium text-[#5f6368] uppercase w-[76px]"><SortableHeader label="Screens" sortKey="screens" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#f8fafd] hidden md:table-cell text-right py-2.5 px-2 text-[11px] font-medium text-[#5f6368] uppercase w-[92px]"><SortableHeader label="Duration" sortKey="duration" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#f8fafd] text-right py-2.5 px-2.5 text-[11px] font-medium text-[#5f6368] uppercase w-[150px]"><SortableHeader label="Notes" sortKey="crashes" align="right" /></th>
                <th className="sticky top-0 z-40 bg-[#f8fafd] w-[68px] py-2.5 pl-1 pr-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8eaed]">
            {paginatedSessions.length === 0 && (
              <tr>
                <td colSpan={9} className="py-16 text-center">
                  <div className="mb-3 inline-flex h-12 w-12 items-center justify-center bg-[#f1f3f4] text-[#5f6368]">
                    <Smartphone className="h-6 w-6" />
                  </div>
                  <h3 className="mb-1 text-[15px] font-medium text-[#202124]">
                    {selectedProjectId ? 'No sessions found' : 'No project selected'}
                  </h3>
                  <p className="text-sm text-[#5f6368]">
                    {selectedProjectId
                      ? 'Adjust your filters or search query.'
                      : 'Select or create a project to view replay data.'}
                  </p>
                </td>
              </tr>
            )}

            {paginatedSessions.map((session) => {
              const isExpanded = expandedSessionId === session.id;
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
	                    // Device model leads; the OS version is the secondary line. Web
	                    // sessions keep the browser on top intentionally.
	                    primary: displayDeviceModel,
	                    secondary: formatNativeOsLabel(platformLabel, session.osVersion),
	                    iconName: platformLabel,
	                    title: `${displayDeviceModel}${session.osVersion ? ` · ${session.osVersion}` : ''}`,
	                  };

              const hasIssues = (session.crashCount || 0) > 0 ||
                ((session as any).anrCount || 0) > 0 ||
                ((session as any).errorCount || 0) > 0 ||
                (session.rageTapCount || 0) > 0 ||
                hasDeadTaps ||
                hasSlowStart || hasSlowApi;
              const smartCaptureNote = getSmartCaptureRuleNote(session, smartCaptureConfig);

              return (
                <React.Fragment key={session.id}>
                <tr
                  className={`cursor-pointer transition-colors ${isExpanded ? 'bg-[#f8fafd]' : 'bg-white hover:bg-[#f8fafd]'}`}
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
                          className={`font-mono text-sm font-medium text-[#202124] truncate shrink min-w-0 ${isReplayBlocked ? 'opacity-50' : ''}`}
                          title={userId}
                        >
                          {displayUserId}
                        </h3>
                        {userId !== 'Anonymous' && (
                          <button
                            onClick={(e) => handleCopyUserId(e, userId)}
                            className="text-[#5f6368] transition-colors hover:text-[#202124]"
                          >
                            {copiedId === userId ? <Check size={12} className="text-[#1e8e3e]" /> : <Copy size={12} />}
                          </button>
                        )}
                      </div>
	                    </td>

                    {/* Date (Desktop) */}
                    <td className="hidden lg:table-cell py-2.5 px-2.5 align-middle w-[112px]">
                      <div className="text-xs tabular-nums text-[#202124]">{new Date(session.startedAt).toLocaleDateString()}</div>
                      <div className="text-[11px] tabular-nums text-[#5f6368]">{new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>

                    {/* Device */}
                    <td className="hidden xl:table-cell py-2.5 px-2.5 align-middle text-left w-[150px]">
                      <div className={`flex min-w-0 items-center gap-2 ${isReplayBlocked ? 'opacity-50' : ''}`} title={deviceColumn.title}>
                        {deviceColumn.kind === 'web' ? (
                          <BrowserBrandIcon browserName={deviceColumn.iconName} className="h-4 w-4 shrink-0" />
                        ) : (
                          <MobilePlatformBrandIcon platformName={deviceColumn.iconName} className="h-4 w-4 shrink-0 text-[#5f6368]" />
                        )}
                        <div className="min-w-0 leading-tight">
                          <div className="truncate text-sm text-[#202124]">{deviceColumn.primary}</div>
                          <div className="truncate text-[11px] text-[#5f6368]">{deviceColumn.secondary}</div>
                        </div>
                      </div>
                    </td>

                    {/* Location */}
                    <td className="hidden lg:table-cell py-2.5 px-2.5 align-middle w-[132px] overflow-hidden">
                      <div className={`leading-tight ${isReplayBlocked ? 'opacity-50' : ''}`}>
                        {geoDisplay.hasLocation ? (
                          <>
                            <div className="flex items-center gap-1.5 text-xs text-[#202124]">
                              <CountryFlag countryCode={geoDisplay.countryCode} countryLabel={geoDisplay.countryLabel} decorative />
                              <span className="truncate">{geoDisplay.countryLabel}</span>
                            </div>
                            <div className="pl-5 text-[11px] text-[#5f6368] truncate">
                              {geoDisplay.cityLabel || 'City unknown'}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-[#80868b]">—</span>
                        )}
                      </div>
                    </td>

                    {/* Screens */}
                    <td className="hidden lg:table-cell py-2.5 px-2 align-middle text-right w-[76px]">
                      {screensCount > 0 ? (
                        <span className="text-sm tabular-nums text-[#3c4043]">{screensCount}</span>
                      ) : (
                        <span className="text-xs text-[#80868b]">—</span>
                      )}
                    </td>

                    {/* Duration: a "Live" chip while ingest / replay preparing; MM:SS once replay is playable (or session ended) and not live-ingesting */}
                    <td className="hidden md:table-cell py-2.5 px-2 align-middle text-right w-[92px]">
                      {showLiveReplayInDurationColumn ? (
                        <span className={dashboardChipClass('success')} title="Live replay: still recording or processing">
                          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1e8e3e] opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1e8e3e]" />
                          </span>
                          Live
                        </span>
                      ) : (
                        <span className="text-sm tabular-nums text-[#3c4043]">
                          {Math.floor(session.durationSeconds / 60)}:{String(session.durationSeconds % 60).padStart(2, '0')}
                        </span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="py-2.5 px-2.5 align-middle text-right w-[150px]">
                      <div className="flex justify-end gap-1.5 items-center flex-wrap min-h-[28px]">
                      {session.isFirstSession && (
                        <span title="First recorded session for this visitor in this project">
                          <NeoBadge variant="info" size="sm">New user</NeoBadge>
                        </span>
                      )}
                      {smartCaptureNote && <SmartCaptureNoteBadge note={smartCaptureNote} />}
                      {hasDeepExploration && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=start`}
                          disabled={!canNavigateToSession}
                          title="Deep session (high exploration score 70 or above)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="success" size="sm">Deep</NeoBadge>
                        </ReplayLink>
                      )}
                      {(session.crashCount || 0) > 0 && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=crash`}
                          disabled={!canNavigateToSession}
                          title="Application crash (fatal exception)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="danger" size="sm">Crash</NeoBadge>
                        </ReplayLink>
                      )}
                      {((session as any).anrCount || 0) > 0 && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=anr`}
                          disabled={!canNavigateToSession}
                          title="App Not Responding (UI thread blocked)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="anr" size="sm">ANR</NeoBadge>
                        </ReplayLink>
                      )}
                      {((session as any).errorCount || 0) > 0 && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=error`}
                          disabled={!canNavigateToSession}
                          title="Logged error or resource loading failure"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="warning" size="sm">Error</NeoBadge>
                        </ReplayLink>
                      )}
                      {(session.rageTapCount || 0) > 0 && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=rage`}
                          disabled={!canNavigateToSession}
                          title="Rage tap (repeated rapid taps in a small area)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="rage" size="sm">Rage tap</NeoBadge>
                        </ReplayLink>
                      )}
                      {hasDeadTaps && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=dead`}
                          disabled={!canNavigateToSession}
                          title="Dead tap (tap on a non-interactive area with no response)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="dead_tap" size="sm">Dead tap</NeoBadge>
                        </ReplayLink>
                      )}
                      {hasSlowStart && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=slow_start`}
                          disabled={!canNavigateToSession}
                          title="Slow cold startup duration"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="slow_start" size="sm">Slow start</NeoBadge>
                        </ReplayLink>
                      )}
                      {hasSlowApi && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=api`}
                          disabled={!canNavigateToSession}
                          title="Slow API average latency (over 1000ms)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="slow_api" size="sm">Slow API</NeoBadge>
                        </ReplayLink>
                      )}
                      {hasLowExploration && (
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}?seekToType=start`}
                          disabled={!canNavigateToSession}
                          title="Shallow session (low exploration score under 40)"
                          className={canNavigateToSession ? "cursor-pointer hover:opacity-80" : ""}
                        >
                          <NeoBadge variant="neutral" size="sm">Shallow</NeoBadge>
                        </ReplayLink>
                      )}
                      </div>
                    </td>

                    <td className="w-[68px] py-2.5 pl-1 pr-3 align-middle">
                      <div className="flex items-center justify-end gap-1">
                        <ReplayLink
                          to={`${pathPrefix}/sessions/${session.id}`}
                          disabled={!canNavigateToSession}
                          aria-label={isReplayBlocked ? 'Replay unavailable' : isLiveIngest ? 'Open live replay' : 'Open replay'}
                          className={`${ROW_ICON_BUTTON_CLASS} group/play ${isReplayBlocked
                            ? 'cursor-not-allowed text-[#bdc1c6]'
                            : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'
                          }`}
                          title={
                            !canNavigateToSession
                              ? 'Replay unavailable for this session'
                              : !canOpenReplay
                                ? 'Open session — visual replay may still be preparing'
                                : isLiveIngest
                                  ? 'Open live replay'
                                  : isBackgroundProcessing
                                    ? 'Open session while processing continues'
                                    : 'Open replay'
                          }
                        >
                          <Play size={16} className={isReplayBlocked ? "" : "group-hover/play:fill-current"} />
                        </ReplayLink>
                        <button
                          onClick={(e) => toggleExpand(e, session.id)}
                          className={`${ROW_ICON_BUTTON_CLASS} ${isExpanded
                            ? dashboardSelectedClass
                            : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'
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
                      <td colSpan={9} className="border-b border-[#e8eaed] bg-[#f8fafd] p-0 align-top">
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

                              // Tier is based on sessionNum (ordinal): the count of sessions this visitor has recorded so far
                              const getTier = (n: number | null): { label: string; tone: DashboardChipTone | null } => {
                                if (n === null || n <= 0) return { label: '—', tone: null };
                                if (n === 1 || isNew)    return { label: 'New', tone: 'info' };
                                if (n >= 50) return { label: '50+ sessions', tone: 'neutral' };
                                if (n >= 20) return { label: '20+ sessions', tone: 'neutral' };
                                if (n >= 10) return { label: '10+ sessions', tone: 'neutral' };
                                if (n >= 5)  return { label: '5+ sessions', tone: 'neutral' };
                                return { label: 'Returning', tone: 'neutral' };
                              };
                              const tier = getTier(sessionNum);

                              // Only show /total if the number makes sense (must be >= current session ordinal)
                              const showTotal = totalSessions !== null && sessionNum !== null && totalSessions >= sessionNum;

                              return (
                                <div className={`${dashboardCardClass} col-span-2 p-4 md:col-span-1`}>
                                  <div className="mb-3 flex items-center gap-2 text-[15px] font-medium text-[#202124]">
                                    <User className="h-4 w-4 text-[#5f6368]" /> User
                                  </div>
                                  <div className="space-y-2">
                                    {/* Loyalty tier */}
                                    <div className="flex justify-between items-center gap-2">
                                      <span className="text-xs text-[#5f6368]">Loyalty</span>
                                      {tier.tone ? (
                                        <span className={dashboardChipClass(tier.tone)}>{tier.label}</span>
                                      ) : (
                                        <span className="text-sm text-[#80868b]">{tier.label}</span>
                                      )}
                                    </div>
                                    {/* Session ordinal */}
                                    <div className="flex justify-between items-center gap-2">
                                      <span className="text-xs text-[#5f6368]">Session #</span>
                                      <span className="text-sm tabular-nums text-[#202124]">
                                        {sessionNum !== null && sessionNum > 0 ? sessionNum : '—'}
                                        {showTotal ? ` of ${totalSessions}` : ''}
                                      </span>
                                    </div>
                                    {/* App version — saves opening the replay just to read it */}
                                    {session.appVersion ? (
                                      <div className="flex justify-between items-center gap-2">
                                        <span className="text-xs text-[#5f6368]">App version</span>
                                        <span className="min-w-0 truncate text-sm tabular-nums text-[#202124]" title={session.sdkVersion ? `SDK ${session.sdkVersion}` : undefined}>
                                          {session.appVersion}
                                        </span>
                                      </div>
                                    ) : null}
                                    {/* Engagement score */}
                                    <div className="flex flex-col gap-2">
                                      <div className="flex justify-between items-center gap-2">
                                        <span className="text-xs text-[#5f6368]">Engagement</span>
                                        <span className={`text-sm font-medium tabular-nums ${interactionScore >= 70 ? 'text-[#137333]' : interactionScore >= 40 ? 'text-[#b06000]' : 'text-[#c5221f]'}`}>
                                          {interactionScore}/100
                                        </span>
                                      </div>
                                      {webSession ? (
                                        <div className="flex flex-col gap-1 border-t border-[#e8eaed] pt-2">
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-[#5f6368]">Referral</span>
                                          </div>
                                          <div
                                            className="max-h-[80px] min-w-0 overflow-y-auto break-all border border-[#e8eaed] bg-[#f8fafd] p-2 font-mono text-[11px] leading-relaxed text-[#3c4043]"
                                            title={webReferral || 'Direct'}
                                          >
                                            {webReferral || 'Direct'}
                                          </div>
                                        </div>
                                      ) : null}
                                      {webSession && webUtm ? (
                                        <div className="flex flex-col gap-1 border-t border-[#e8eaed] pt-2">
                                          <span className="mb-1 text-xs text-[#5f6368]">UTM parameters</span>
                                          <div
                                            className={`max-h-[100px] min-w-0 overflow-y-auto break-all border border-[#e8eaed] bg-[#f8fafd] p-2 font-mono text-[11px] leading-relaxed ${
                                              webUtm.hasUtm
                                                ? 'text-[#3c4043]'
                                                : 'text-[#80868b]'
                                            }`}
                                            title={webUtm.title || undefined}
                                          >
                                            {webUtm.hasUtm ? (
                                              <div className="space-y-0.5">
                                                {webUtm.source && (
                                                  <div>
                                                    <span className="text-[#5f6368]">source:</span>{' '}
                                                    <span className="text-[#202124]">{webUtm.source}</span>
                                                  </div>
                                                )}
                                                {webUtm.medium && (
                                                  <div>
                                                    <span className="text-[#5f6368]">medium:</span>{' '}
                                                    <span className="text-[#202124]">{webUtm.medium}</span>
                                                  </div>
                                                )}
                                                {webUtm.campaign && (
                                                  <div>
                                                    <span className="text-[#5f6368]">campaign:</span>{' '}
                                                    <span className="text-[#202124]">{webUtm.campaign}</span>
                                                  </div>
                                                )}
                                                {webUtm.term && (
                                                  <div>
                                                    <span className="text-[#5f6368]">term:</span>{' '}
                                                    <span className="text-[#202124]">{webUtm.term}</span>
                                                  </div>
                                                )}
                                                {webUtm.content && (
                                                  <div>
                                                    <span className="text-[#5f6368]">content:</span>{' '}
                                                    <span className="text-[#202124]">{webUtm.content}</span>
                                                  </div>
                                                )}
                                                {webUtm.campaignId && (
                                                  <div>
                                                    <span className="text-[#5f6368]">id:</span>{' '}
                                                    <span className="text-[#202124]">{webUtm.campaignId}</span>
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
                            <div className={`${dashboardCardClass} p-4`}>
                              <div className="mb-3 flex items-center gap-2 text-[15px] font-medium text-[#202124]"><Gauge className="h-4 w-4 text-[#5f6368]" /> Performance</div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368]">Startup</span>
                                  <span className={`text-sm tabular-nums ${
                                    startupMs === null
                                      ? 'text-[#80868b]'
                                      : startupMs > 2000
                                        ? 'font-medium text-[#b06000]'
                                        : 'text-[#202124]'
                                  }`}>
                                    {startupMs === null ? 'N/A' : `${startupMs.toFixed(0)}ms`}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368]">API avg</span>
                                  <span className={`text-sm tabular-nums ${
                                    (session.apiAvgResponseMs || 0) > 1000
                                      ? 'font-medium text-[#b06000]'
                                      : 'text-[#202124]'
                                  }`}>
                                    {(session.apiAvgResponseMs || 0).toFixed(0)}ms
                                  </span>
                                </div>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368]">Duration</span>
                                  <span className="text-sm tabular-nums text-[#202124]">
                                    {Math.floor(session.durationSeconds / 60)}:{String(session.durationSeconds % 60).padStart(2, '0')}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Environment */}
                            <div className={`${dashboardCardClass} p-4`}>
                              <div className="mb-3 flex items-center gap-2 text-[15px] font-medium text-[#202124]"><Globe className="h-4 w-4 text-[#5f6368]" /> Environment</div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368] shrink-0">Network</span>
                                  <div
                                    className="flex min-w-0 items-center gap-1 text-sm text-[#202124]"
                                    title={networkDisplay?.networkTitle}
                                  >
                                    <NetworkIcon type={networkDisplay?.rawNetworkType || networkType} />
                                    <span className="truncate">{webSession ? networkDisplay?.networkLabel : formatNativeNetworkLabel(networkType)}</span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368] shrink-0">OS</span>
                                  <span
                                    className="max-w-[110px] truncate text-right text-sm text-[#202124]"
                                    title={webSession ? webEnvironment?.osTitle : undefined}
                                  >
                                    {webSession ? webEnvironment?.osLabel : (session.osVersion || '—')}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368] shrink-0">Location</span>
                                  <span className="inline-flex max-w-[110px] items-center justify-end gap-1 text-right text-sm text-[#202124]">
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
                            <div className={`${dashboardCardClass} p-4`}>
                              <div className="mb-3 flex items-center gap-2 text-[15px] font-medium text-[#202124]"><Activity className="h-4 w-4 text-[#5f6368]" /> API calls</div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368]">Total</span>
                                  <span className="text-sm tabular-nums text-[#202124]">{session.apiTotalCount || ((session.apiSuccessCount || 0) + (session.apiErrorCount || 0))}</span>
                                </div>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368]">OK</span>
                                  <span className="text-sm tabular-nums text-[#202124]">{session.apiSuccessCount || 0}</span>
                                </div>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368]">Errors</span>
                                  <span className={`text-sm tabular-nums ${
                                    (session.apiErrorCount || 0) > 0
                                      ? 'font-medium text-[#c5221f]'
                                      : 'text-[#202124]'
                                  }`}>{session.apiErrorCount || 0}</span>
                                </div>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-xs text-[#5f6368]">Avg latency</span>
                                  <span className={`text-sm tabular-nums ${
                                    (session.apiAvgResponseMs || 0) > 1000
                                      ? 'font-medium text-[#b06000]'
                                      : 'text-[#202124]'
                                  }`}>
                                    {(session.apiAvgResponseMs || 0).toFixed(0)}ms
                                  </span>
                                </div>
                              </div>
                            </div>
                            {/* Replay - compact */}
                            <div className={`${dashboardCardClass} flex flex-col gap-3 p-4`}>
                              <div className="flex items-center gap-2 text-[15px] font-medium text-[#202124]">
                                <AnimalAvatar animal={replayAnimal} seed={replayAnimalSeed} size={18} active={isExpanded} neutral />
                                {webSession ? 'Browser replay' : 'Replay'}
                              </div>

                              <div className="text-xs tabular-nums text-[#5f6368]">
                                {screensCount} {webSession ? 'page' : 'screen'}{screensCount !== 1 ? 's' : ''}&nbsp;·&nbsp;{Math.floor(session.durationSeconds / 60)}m {session.durationSeconds % 60}s
                              </div>

                              <ReplayLink
                                to={`${pathPrefix}/sessions/${session.id}`}
                                disabled={isReplayBlocked}
                                className={`${dashboardButtonClass('primary', 'md')} mt-auto w-full`}
                              >
                                {isReplayBlocked ? (
                                  <Loader className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4 fill-current" />
                                )}
                                {isReplayBlocked ? 'Replay unavailable' : isLiveIngest ? 'Open live replay' : 'Open replay'}
                              </ReplayLink>
                            </div>
                          </div>

                          {/* ── Page Journey ── */}
                          {(() => {
                            const screens: string[] = (session as any).screensVisited || [];
                            if (screens.length === 0) return null;
                            return (
                            <div className={`${dashboardCardClass} p-4`}>
                                <div className="flex items-center justify-between gap-3 mb-3">
                                  <div className="text-[15px] font-medium text-[#202124]">Page journey</div>
                                  <div className="text-xs tabular-nums text-[#5f6368]">{screens.length} screen{screens.length !== 1 ? 's' : ''} visited</div>
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
                                                className="relative flex items-center gap-1.5 border border-[#dadce0] bg-white px-3 py-2 text-xs font-medium text-[#3c4043] transition-colors hover:border-[#bdc1c6] hover:bg-[#f8fafd]"
                                                title={`Visit ${screen}`}
                                              >
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isEntry ? 'bg-[#1e8e3e]' : isExit ? 'bg-[#d93025]' : 'bg-[#bdc1c6]'}`} />
                                                <span className="whitespace-nowrap max-w-[120px] truncate">{screen}</span>
                                                {/* step number badge */}
                                                <span className="absolute -top-2 -right-1.5 border border-[#dadce0] bg-white px-1 py-0.5 text-center text-[10px] font-medium leading-none tabular-nums text-[#5f6368]">
                                                  {idx + 1}
                                                </span>
                                              </a>
                                            ) : (
                                              <div className="relative flex items-center gap-1.5 border border-[#dadce0] bg-white px-3 py-2 text-xs font-medium text-[#3c4043]">
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isEntry ? 'bg-[#1e8e3e]' : isExit ? 'bg-[#d93025]' : 'bg-[#bdc1c6]'}`} />
                                                <span className="whitespace-nowrap max-w-[120px] truncate">{screen}</span>
                                                {/* step number badge */}
                                                <span className="absolute -top-2 -right-1.5 border border-[#dadce0] bg-white px-1 py-0.5 text-center text-[10px] font-medium leading-none tabular-nums text-[#5f6368]">
                                                  {idx + 1}
                                                </span>
                                              </div>
                                            )}
                                            <span className={`mt-1 text-[11px] font-medium
                                              ${isEntry ? 'text-[#137333]' : isExit ? 'text-[#c5221f]' : 'text-transparent'}`}>
                                              {isEntry ? 'Entry' : isExit ? 'Exit' : 'ー'}
                                            </span>
                                          </div>

                                          {/* Arrow connector (not after last) */}
                                          {idx < screens.length - 1 && (
                                            <div className="flex items-center px-1 mb-4 shrink-0">
                                              <div className="w-5 h-px bg-[#dadce0]" />
                                              <svg width="6" height="8" viewBox="0 0 6 8" fill="none" className="text-[#bdc1c6]">
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
            <div className="flex items-center justify-between border-t border-[#e8eaed] bg-white px-6 py-3 flex-wrap gap-4">
              {/* Left: Showing X-Y of Z */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#5f6368]">
                  Showing <span className="font-medium tabular-nums text-[#202124]">{startIndex}–{endIndex}</span> of{' '}
                  <span className="font-medium tabular-nums text-[#202124]">{filteredSessions.length.toLocaleString()}</span> loaded
                  {displayedTotalCount !== null && displayedTotalCount > filteredSessions.length && (
                    <span className="tabular-nums text-[#80868b]">
                      {' '}
                      ({displayedTotalCount.toLocaleString()} total matching — load more for the rest)
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
                    Load more
                  </NeoButton>
                )}
              </div>

              {/* Center: Page Navigation */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className={ICON_BUTTON_CLASS}
                  title="First page"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className={ICON_BUTTON_CLASS}
                  title="Previous page"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-3 text-xs tabular-nums text-[#3c4043]">
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
                  className={ICON_BUTTON_CLASS}
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className={ICON_BUTTON_CLASS}
                  title="Last page"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>

              {/* Right: Per-page selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#5f6368]">Per page</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-8 cursor-pointer rounded-none border border-[#dadce0] bg-white px-2 text-xs tabular-nums text-[#202124] outline-none focus:border-[#1a73e8]"
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
        availableFilters={queryBuilderAvailableFilters}
        isLoadingFilters={isLoadingFilters}
        onConfigChange={setSmartCaptureConfig}
      />
    </div>
  );
};

export default RecordingsList;
