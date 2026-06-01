import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  Check,
  ChevronDown,
  Clock,
  Code,
  Copy,
  Download,
  Loader,
  Play,
  Search,
  Smartphone,
  TrendingUp,
  Wifi,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  api,
  type ANRRecord,
  type ApiErrorSpikeRecord,
  type CrashOverviewGroup,
  type CrashReport,
  type ErrorOverviewGroup,
  getANRsOverview,
  getApiErrorSpikes,
  getCrashesOverview,
  getErrorsOverview,
} from '~/shared/api/client';
import { platformLensToSessionPlatform, useSharedPlatformLens } from '~/shared/hooks/useSharedPlatformLens';
import { formatAge, formatLastSeen } from '~/shared/lib/formatDates';
import { formatDeviceModel, getDeviceModelSearchText } from '~/shared/lib/deviceModelNames';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { DashboardGhostLoader } from '~/shared/ui/core/DashboardGhostLoader';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';

type StabilityIssueKind = 'crashes' | 'errors' | 'anrs' | 'api_spikes';

type StabilityIssueRow =
  | {
      key: string;
      kind: 'crashes';
      title: string;
      subtitle: string;
      firstSeen: string;
      lastOccurred: string;
      eventCount: number;
      userCount: number;
      deviceModel: string;
      deviceLabel: string;
      appVersion: string;
      replaySessionId: string | null;
      canOpenReplay: boolean;
      searchText: string;
      focusKeys: string[];
      source: CrashOverviewGroup;
    }
  | {
      key: string;
      kind: 'errors';
      title: string;
      subtitle: string;
      firstSeen: string;
      lastOccurred: string;
      eventCount: number;
      userCount: number;
      deviceModel: string;
      deviceLabel: string;
      appVersion: string;
      screenName: string | null;
      replaySessionId: string | null;
      canOpenReplay: boolean;
      searchText: string;
      focusKeys: string[];
      source: ErrorOverviewGroup;
    }
  | {
      key: string;
      kind: 'anrs';
      title: string;
      subtitle: string;
      firstSeen: string;
      lastOccurred: string;
      eventCount: number;
      userCount: number;
      deviceModel: string;
      deviceLabel: string;
      appVersion: string;
      durationMs: number;
      replaySessionId: string | null;
      canOpenReplay: boolean;
      searchText: string;
      focusKeys: string[];
      source: ANRRecord;
    }
  | {
      key: string;
      kind: 'api_spikes';
      title: string;
      subtitle: string;
      firstSeen: string;
      lastOccurred: string;
      eventCount: number;
      userCount: number;
      deviceModel: string;
      deviceLabel: string;
      appVersion: string;
      replaySessionId: null;
      canOpenReplay: false;
      searchText: string;
      focusKeys: string[];
      source: ApiErrorSpikeRecord;
    };

const KIND_ORDER: StabilityIssueKind[] = ['crashes', 'errors', 'anrs', 'api_spikes'];

const KIND_META: Record<
  StabilityIssueKind,
  {
    label: string;
    plural: string;
    badge: 'danger' | 'warning' | 'anr' | 'info';
    icon: React.ElementType;
    dotClass: string;
    rowClass: string;
    hoverDotClass: string;
    textClass: string;
    badgeClass: string;
    detailCardClass: string;
    detailTextClass: string;
  }
> = {
  crashes: {
    label: 'Crash',
    plural: 'Crashes',
    badge: 'danger',
    icon: Bug,
    dotClass: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]',
    rowClass: 'bg-rose-50/25',
    hoverDotClass: 'group-hover/row:bg-rose-400',
    textClass: 'text-rose-700',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
    detailCardClass: 'bg-rose-50/50 border-rose-200',
    detailTextClass: 'text-rose-700',
  },
  errors: {
    label: 'Error',
    plural: 'Errors',
    badge: 'warning',
    icon: AlertTriangle,
    dotClass: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.45)]',
    rowClass: 'bg-amber-50/30',
    hoverDotClass: 'group-hover/row:bg-amber-400',
    textClass: 'text-amber-700',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    detailCardClass: 'bg-amber-50/50 border-amber-200',
    detailTextClass: 'text-amber-700',
  },
  anrs: {
    label: 'ANR',
    plural: 'ANRs',
    badge: 'anr',
    icon: Clock,
    dotClass: 'bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]',
    rowClass: 'bg-violet-50/25',
    hoverDotClass: 'group-hover/row:bg-violet-400',
    textClass: 'text-violet-700',
    badgeClass: 'bg-violet-100 text-violet-800 border-violet-200',
    detailCardClass: 'bg-violet-50/50 border-violet-200',
    detailTextClass: 'text-violet-700',
  },
  api_spikes: {
    label: 'API Spike',
    plural: 'API Spikes',
    badge: 'info',
    icon: TrendingUp,
    dotClass: 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]',
    rowClass: 'bg-sky-50/25',
    hoverDotClass: 'group-hover/row:bg-sky-400',
    textClass: 'text-sky-700',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
    detailCardClass: 'bg-sky-50/50 border-sky-200',
    detailTextClass: 'text-sky-700',
  },
};

const formatCompact = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
};

const normalizeFocusKey = (value: string | null | undefined): string => (
  decodeURIComponent(value || '').trim().toLowerCase()
);

const makeDomId = (key: string): string => `stability-row-${key.replace(/[^a-z0-9_-]+/gi, '-')}`;

const parseKinds = (raw: string | null): Set<StabilityIssueKind> => {
  if (!raw) return new Set();
  const valid = new Set<StabilityIssueKind>();
  raw.split(',').forEach((value) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'crash') valid.add('crashes');
    if (normalized === 'error') valid.add('errors');
    if (normalized === 'anr') valid.add('anrs');
    if (normalized === 'api_spike' || normalized === 'api spike') valid.add('api_spikes');
    if (KIND_ORDER.includes(normalized as StabilityIssueKind)) {
      valid.add(normalized as StabilityIssueKind);
    }
  });
  return valid.size === KIND_ORDER.length ? new Set() : valid;
};

const topRecordKey = (record: Record<string, number>): string | null => {
  const entries = Object.entries(record);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

const compactStrings = (values: Array<string | null | undefined>): string[] => (
  values.filter((value): value is string => Boolean(value))
);

const getTimestampMs = (value: string): number => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const buildCrashRow = (group: CrashOverviewGroup): StabilityIssueRow => {
  const topDevice = topRecordKey(group.affectedDevices) || 'Unknown';
  const topVersion = topRecordKey(group.affectedVersions) || '?';
  const deviceNames = Object.keys(group.affectedDevices);
  const versions = Object.keys(group.affectedVersions);
  const title = group.name || 'Native crash';
  const subtitle = `Affecting ${deviceNames.length || 1} device model${deviceNames.length === 1 ? '' : 's'}`;

  return {
    key: `crash:${group.id || group.sampleCrashId || title}`,
    kind: 'crashes',
    title,
    subtitle,
    firstSeen: group.firstSeen,
    lastOccurred: group.lastOccurred,
    eventCount: group.count || 0,
    userCount: group.users.length,
    deviceModel: topDevice,
    deviceLabel: formatDeviceModel(topDevice, 'Unknown'),
    appVersion: topVersion,
    replaySessionId: group.sampleSessionId || null,
    canOpenReplay: Boolean(group.sampleSessionId && group.canOpenReplay),
    searchText: [
      title,
      subtitle,
      group.id,
      group.sampleCrashId,
      group.sampleSessionId,
      ...deviceNames.map(getDeviceModelSearchText),
      ...versions,
    ].join(' ').toLowerCase(),
    focusKeys: compactStrings([group.id, group.name, group.sampleCrashId, group.sampleSessionId]),
    source: group,
  };
};

const buildErrorRow = (group: ErrorOverviewGroup): StabilityIssueRow => {
  const sampleError = group.sampleError;
  const topDevice = sampleError?.deviceModel || topRecordKey(group.affectedDevices) || 'Unknown';
  const topVersion = sampleError?.appVersion || topRecordKey(group.affectedVersions) || '?';
  const screenName = sampleError?.screenName || group.screens[0] || null;
  const title = group.errorName || 'Runtime error';
  const subtitle = group.message || 'No error message captured.';

  return {
    key: `error:${group.fingerprint || sampleError?.id || title}`,
    kind: 'errors',
    title,
    subtitle,
    firstSeen: group.firstSeen,
    lastOccurred: group.lastOccurred,
    eventCount: group.count || 0,
    userCount: group.users.length,
    deviceModel: topDevice,
    deviceLabel: formatDeviceModel(topDevice, 'Unknown'),
    appVersion: topVersion,
    screenName,
    replaySessionId: sampleError?.sessionId || null,
    canOpenReplay: Boolean(sampleError?.sessionId && sampleError.canOpenReplay),
    searchText: [
      title,
      subtitle,
      group.fingerprint,
      sampleError?.id,
      sampleError?.sessionId,
      screenName,
      ...group.screens,
      ...Object.keys(group.affectedDevices).map(getDeviceModelSearchText),
      ...Object.keys(group.affectedVersions),
    ].join(' ').toLowerCase(),
    focusKeys: compactStrings([group.fingerprint, group.errorName, sampleError?.id, sampleError?.sessionId]),
    source: group,
  };
};

const buildAnrRow = (anr: ANRRecord): StabilityIssueRow => {
  const rawDeviceModel = anr.deviceMetadata?.deviceModel || 'Unknown Device';
  const appVersion = anr.deviceMetadata?.appVersion || '?';
  const shortThread = anr.threadState?.split('\n').find(Boolean) || 'App Not Responding';

  return {
    key: `anr:${anr.id}`,
    kind: 'anrs',
    title: shortThread,
    subtitle: 'Detected UI block in main thread.',
    firstSeen: anr.timestamp,
    lastOccurred: anr.timestamp,
    eventCount: anr.occurrenceCount || 1,
    userCount: anr.userCount || 1,
    deviceModel: rawDeviceModel,
    deviceLabel: formatDeviceModel(rawDeviceModel, 'Unknown'),
    appVersion,
    durationMs: anr.durationMs || 0,
    replaySessionId: anr.sessionId || null,
    canOpenReplay: Boolean(anr.sessionId && anr.canOpenReplay),
    searchText: [
      anr.id,
      shortThread,
      anr.threadState,
      getDeviceModelSearchText(rawDeviceModel),
      appVersion,
      anr.deviceMetadata?.osVersion,
    ].join(' ').toLowerCase(),
    focusKeys: compactStrings([anr.id, anr.sessionId, anr.groupKey]),
    source: anr,
  };
};

const buildApiSpikeRow = (spike: ApiErrorSpikeRecord): StabilityIssueRow => ({
  key: `api_spike:${spike.id}`,
  kind: 'api_spikes',
  title: `API error rate +${spike.percentIncrease}%`,
  subtitle: `${spike.currentRate.toFixed(1)}% error rate vs ${spike.previousRate.toFixed(1)}% baseline · ${spike.affectedSessions} API calls`,
  firstSeen: spike.detectedAt,
  lastOccurred: spike.detectedAt,
  eventCount: spike.affectedSessions,
  userCount: 0,
  deviceModel: '',
  deviceLabel: '',
  appVersion: '',
  replaySessionId: null,
  canOpenReplay: false,
  searchText: ['api spike', 'api error', spike.topEndpoints.map(e => `${e.method} ${e.endpoint}`).join(' ')].join(' ').toLowerCase(),
  focusKeys: [spike.id],
  source: spike,
});

// Inline sparkline SVG for the API error rate trend
const ApiSpikeTrendline: React.FC<{ spike: ApiErrorSpikeRecord; height?: number }> = ({ spike, height = 32 }) => {
  const { trend } = spike;
  if (trend.length < 2) return null;

  const width = 160;
  const pad = 2;
  const rates = trend.map(t => t.errorRate);
  const maxRate = Math.max(...rates, 1);
  const pts = rates.map((r, i) => {
    const x = pad + (i / (rates.length - 1)) * (width - pad * 2);
    const y = pad + (1 - r / maxRate) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Find the spike peak index (highest error rate)
  const peakIdx = rates.indexOf(Math.max(...rates));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 overflow-visible">
      {/* fill area under line */}
      <path
        d={`M${pts[0]} ${pts.slice(1).map(p => `L${p}`).join(' ')} L${(pad + (rates.length - 1) / (rates.length - 1) * (width - pad * 2)).toFixed(1)},${height - pad} L${pad},${height - pad} Z`}
        fill="rgba(14,165,233,0.12)"
      />
      {/* trend line */}
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="#0ea5e9"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* peak dot */}
      {peakIdx >= 0 && (
        <circle
          cx={parseFloat(pts[peakIdx].split(',')[0])}
          cy={parseFloat(pts[peakIdx].split(',')[1])}
          r={3}
          fill="#ef4444"
          stroke="white"
          strokeWidth="1"
        />
      )}
    </svg>
  );
};

export const Stability: React.FC = () => {
  const { selectedProject, projectsLoading } = useSessionData();
  const { isDemoMode } = useDemoMode();
  const currentProject = selectedProject;
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filter') || searchParams.get('tab');
  const activeKindSet = useMemo(() => parseKinds(filterParam), [filterParam]);
  const focusId = searchParams.get('focusId');

  const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(currentProject?.id);
  const { platformLens } = useSharedPlatformLens(currentProject?.id, currentProject?.platforms);
  const platform = platformLensToSessionPlatform(platformLens);
  const [searchQuery, setSearchQuery] = useState('');
  const [crashGroups, setCrashGroups] = useState<CrashOverviewGroup[]>([]);
  const [errorGroups, setErrorGroups] = useState<ErrorOverviewGroup[]>([]);
  const [anrs, setAnrs] = useState<ANRRecord[]>([]);
  const [apiSpikes, setApiSpikes] = useState<ApiErrorSpikeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [crashDetails, setCrashDetails] = useState<Record<string, CrashReport | null>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const projectId = currentProject?.id || (isDemoMode ? 'demo' : '');
    if (!projectId) {
      setCrashGroups([]);
      setErrorGroups([]);
      setAnrs([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    Promise.allSettled([
      getCrashesOverview(projectId, timeRange, platform),
      getErrorsOverview(projectId, timeRange, platform),
      getANRsOverview(projectId, timeRange, platform),
      getApiErrorSpikes(projectId, timeRange),
    ]).then(([crashesResult, errorsResult, anrsResult, spikesResult]) => {
      if (cancelled) return;

      if (crashesResult.status === 'fulfilled') setCrashGroups(crashesResult.value.groups || []);
      else {
        console.error('Failed to fetch crashes overview:', crashesResult.reason);
        setCrashGroups([]);
      }

      if (errorsResult.status === 'fulfilled') setErrorGroups(errorsResult.value.groups || []);
      else {
        console.error('Failed to fetch errors overview:', errorsResult.reason);
        setErrorGroups([]);
      }

      if (anrsResult.status === 'fulfilled') setAnrs(anrsResult.value.anrs || []);
      else {
        console.error('Failed to fetch ANRs overview:', anrsResult.reason);
        setAnrs([]);
      }

      if (spikesResult.status === 'fulfilled') setApiSpikes(spikesResult.value.spikes || []);
      else setApiSpikes([]);
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, isDemoMode, timeRange, platform]);

  const allRows = useMemo<StabilityIssueRow[]>(() => {
    return [
      ...crashGroups.map(buildCrashRow),
      ...errorGroups.map(buildErrorRow),
      ...anrs.map(buildAnrRow),
      ...apiSpikes.map(buildApiSpikeRow),
    ].sort((a, b) => getTimestampMs(b.lastOccurred) - getTimestampMs(a.lastOccurred));
  }, [crashGroups, errorGroups, anrs, apiSpikes]);

  const kindCounts = useMemo(() => {
    return allRows.reduce<Record<StabilityIssueKind, number>>((acc, row) => {
      acc[row.kind] += 1;
      return acc;
    }, { crashes: 0, errors: 0, anrs: 0, api_spikes: 0 });
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allRows.filter((row) => {
      const matchesKind = activeKindSet.size === 0 || activeKindSet.has(row.kind);
      const matchesSearch = !query || row.searchText.includes(query);
      return matchesKind && matchesSearch;
    });
  }, [activeKindSet, allRows, searchQuery]);

  const visibleEventCount = useMemo(
    () => filteredRows.reduce((total, row) => total + row.eventCount, 0),
    [filteredRows],
  );

  useEffect(() => {
    if (!focusId || isLoading || allRows.length === 0) return;

    const normalizedFocusId = normalizeFocusKey(focusId);
    const target = allRows.find((row) => row.focusKeys.some((key) => normalizeFocusKey(key) === normalizedFocusId));
    if (!target) return;

    setExpandedIssueKey(target.key);
    setTimeout(() => {
      const element = document.getElementById(makeDomId(target.key));
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
  }, [allRows, focusId, isLoading]);

  const expandedRow = useMemo(
    () => allRows.find((row) => row.key === expandedIssueKey) || null,
    [allRows, expandedIssueKey],
  );

  useEffect(() => {
    if (!expandedRow || expandedRow.kind !== 'crashes') return;
    const projectId = currentProject?.id || (isDemoMode ? 'demo' : '');
    if (!projectId) return;
    if (Object.prototype.hasOwnProperty.call(crashDetails, expandedRow.key)) return;
    if (!expandedRow.source.sampleCrashId) {
      setCrashDetails((prev) => ({ ...prev, [expandedRow.key]: null }));
      return;
    }

    api.getCrash(projectId, expandedRow.source.sampleCrashId)
      .then((crash) => {
        setCrashDetails((prev) => ({ ...prev, [expandedRow.key]: crash }));
      })
      .catch((error) => {
        console.error('Failed to fetch crash details:', error);
        setCrashDetails((prev) => ({ ...prev, [expandedRow.key]: null }));
      });
  }, [crashDetails, currentProject?.id, expandedRow, isDemoMode]);

  const updateKindFilter = (nextKinds: StabilityIssueKind[]) => {
    const params = new URLSearchParams(searchParams);
    params.delete('tab');
    params.delete('focusId');

    const orderedKinds = KIND_ORDER.filter((kind) => nextKinds.includes(kind));
    if (orderedKinds.length === 0 || orderedKinds.length === KIND_ORDER.length) {
      params.delete('filter');
    } else {
      params.set('filter', orderedKinds.join(','));
    }

    setSearchParams(params, { replace: true });
  };

  const toggleKind = (kind: StabilityIssueKind) => {
    if (activeKindSet.size === 0) {
      updateKindFilter([kind]);
      return;
    }

    const next = new Set(activeKindSet);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    updateKindFilter(Array.from(next));
  };

  const handleCopyText = (text: string | null | undefined, key: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownloadText = (text: string | null | undefined, id: string, prefix: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}-${id}-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderReplayCard = (row: StabilityIssueRow) => {
    const meta = KIND_META[row.kind];
    return (
      <NeoCard variant="flat" className={`p-4 shadow-sm ${meta.detailCardClass}`}>
        <h4 className={`mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${meta.textClass}`}>
          <Play size={14} className="fill-current" />
          Session Replay
        </h4>
        <p className="mb-4 text-xs leading-relaxed text-slate-600">
          Watch the sampled session around this {meta.label.toLowerCase()}.
        </p>
        {row.canOpenReplay && row.replaySessionId ? (
          <NeoButton
            variant="primary"
            className="w-full justify-center border-0 bg-black py-2 text-white shadow-sm hover:bg-slate-800"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`${pathPrefix}/sessions/${row.replaySessionId}`);
            }}
          >
            Play Session
          </NeoButton>
        ) : (
          <p className="rounded-md border border-black/10 bg-white px-3 py-2 text-xs font-medium text-slate-700">
            Replay unavailable for this sampled event.
          </p>
        )}
      </NeoCard>
    );
  };

  const renderExpandedContent = (row: StabilityIssueRow) => {
    if (row.kind === 'crashes') {
      const detailLoaded = Object.prototype.hasOwnProperty.call(crashDetails, row.key);
      const detail = crashDetails[row.key];
      const stackTrace = detail?.stackTrace || null;

      return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          <div className="flex flex-col gap-4 lg:col-span-3">
            <NeoCard variant="flat" disablePadding className="overflow-hidden border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
                  <Code size={14} className="text-rose-500" />
                  Stack Trace Analysis
                </h4>
                <div className="flex items-center gap-1.5">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={copiedKey === `${row.key}:stack` ? <Check size={13} /> : <Copy size={13} />}
                    onClick={(event) => handleCopyText(stackTrace, `${row.key}:stack`, event)}
                    disabled={!stackTrace}
                    className="h-7 px-2 text-xs"
                  >
                    Copy
                  </NeoButton>
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<Download size={13} />}
                    onClick={(event) => handleDownloadText(stackTrace, row.source.sampleCrashId, 'crash-trace', event)}
                    disabled={!stackTrace}
                    className="h-7 px-2 text-xs"
                  >
                    Save
                  </NeoButton>
                </div>
              </div>

              {!detailLoaded ? (
                <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-slate-500">
                  <Loader size={18} className="animate-spin" />
                  Loading crash details...
                </div>
              ) : stackTrace ? (
                <div className="max-h-[400px] overflow-auto bg-[#0d1117] p-4 font-mono text-[11px] leading-relaxed text-emerald-300 selection:bg-rose-900">
                  {stackTrace}
                </div>
              ) : (
                <div className="bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">No stack trace captured.</div>
              )}
            </NeoCard>

            <div className="flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 shadow-sm">
                <Smartphone size={12} className="text-slate-400" />
                <span className="font-semibold text-slate-700">Device:</span>
                <span title={detail?.deviceMetadata?.model || row.deviceModel}>
                  {formatDeviceModel(detail?.deviceMetadata?.model || row.deviceModel, 'Unknown')}
                </span>
              </div>
              <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 shadow-sm">
                <Activity size={12} className="text-slate-400" />
                <span className="font-semibold text-slate-700">OS:</span>
                {detail?.deviceMetadata?.systemName || 'Unknown'} {detail?.deviceMetadata?.systemVersion || ''}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-1">
            {renderReplayCard(row)}
            <NeoCard variant="flat" className="flex-1 border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="mb-3 border-b border-slate-100 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Crash Properties
              </h4>
              <dl className="space-y-3 text-xs">
                <div>
                  <dt className="mb-0.5 text-slate-500">Last Event</dt>
                  <dd className="font-medium text-slate-800">{new Date(detail?.timestamp || row.lastOccurred).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="mb-0.5 text-slate-500">App Version</dt>
                  <dd className="font-medium text-slate-800">{detail?.deviceMetadata?.appVersion || row.appVersion}</dd>
                </div>
                <div>
                  <dt className="mb-0.5 text-slate-500">Occurrences</dt>
                  <dd className="font-medium text-slate-800">{formatCompact(row.eventCount)}</dd>
                </div>
              </dl>
            </NeoCard>
          </div>
        </div>
      );
    }

    if (row.kind === 'errors') {
      const sampleError = row.source.sampleError;
      const stackTrace = sampleError?.stack || null;

      return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          <div className="flex flex-col gap-4 lg:col-span-3">
            <NeoCard variant="flat" disablePadding className="overflow-hidden border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
                  <Code size={14} className="text-amber-500" />
                  Stack Trace Analysis
                </h4>
                <div className="flex items-center gap-1.5">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={copiedKey === `${row.key}:stack` ? <Check size={13} /> : <Copy size={13} />}
                    onClick={(event) => handleCopyText(stackTrace, `${row.key}:stack`, event)}
                    disabled={!stackTrace}
                    className="h-7 px-2 text-xs"
                  >
                    Copy
                  </NeoButton>
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<Download size={13} />}
                    onClick={(event) => handleDownloadText(stackTrace, row.source.fingerprint, 'error-trace', event)}
                    disabled={!stackTrace}
                    className="h-7 px-2 text-xs"
                  >
                    Save
                  </NeoButton>
                </div>
              </div>

              {stackTrace ? (
                <div className="max-h-[400px] overflow-auto bg-[#0d1117] p-4 font-mono text-[11px] leading-relaxed text-slate-300 selection:bg-amber-900">
                  {stackTrace}
                </div>
              ) : (
                <div className="bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">No stack trace captured for this occurrence.</div>
              )}
            </NeoCard>

            <div className="flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 shadow-sm">
                <Smartphone size={12} className="text-slate-400" />
                <span className="font-semibold text-slate-700">Device:</span>
                <span title={row.deviceModel}>{row.deviceLabel}</span>
              </div>
              {row.screenName && (
                <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 shadow-sm">
                  <Activity size={12} className="text-slate-400" />
                  <span className="font-semibold text-slate-700">Screen:</span>
                  {row.screenName}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-1">
            {renderReplayCard(row)}
            <NeoCard variant="flat" className="flex-1 border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="mb-3 border-b border-slate-100 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Error Properties
              </h4>
              <dl className="space-y-3 text-xs">
                <div>
                  <dt className="mb-0.5 text-slate-500">Last Event</dt>
                  <dd className="font-medium text-slate-800">{new Date(sampleError?.timestamp || row.lastOccurred).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="mb-0.5 text-slate-500">App Version</dt>
                  <dd className="font-medium text-slate-800">{row.appVersion}</dd>
                </div>
                <div>
                  <dt className="mb-0.5 text-slate-500">Fingerprint</dt>
                  <dd className="break-words font-medium text-slate-800">{row.source.fingerprint}</dd>
                </div>
              </dl>
            </NeoCard>
          </div>
        </div>
      );
    }

    if (row.kind === 'api_spikes') {
    const spike = row.source;
    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <div className="flex flex-col gap-4 lg:col-span-3">
          {/* Trend chart */}
          <NeoCard variant="flat" disablePadding className="overflow-hidden border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
                <TrendingUp size={14} className="text-sky-500" />
                API Error Rate — 90 min window
              </h4>
              <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                {spike.previousRate.toFixed(1)}% → {spike.currentRate.toFixed(1)}% (+{spike.percentIncrease}%)
              </span>
            </div>
            <div className="flex items-end gap-1 px-4 py-5">
              {spike.trend.length > 1 ? (
                <div className="w-full">
                  <svg
                    viewBox={`0 0 ${spike.trend.length * 20} 60`}
                    preserveAspectRatio="none"
                    className="h-20 w-full"
                  >
                    {(() => {
                      const maxRate = Math.max(...spike.trend.map(t => t.errorRate), 1);
                      const pts = spike.trend.map((t, i) => {
                        const x = i * 20 + 10;
                        const y = 4 + (1 - t.errorRate / maxRate) * 52;
                        return { x, y, t };
                      });
                      const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y.toFixed(1)}`).join(' ');
                      const fillD = `${pathD} L${pts[pts.length - 1].x},60 L${pts[0].x},60 Z`;
                      return (
                        <>
                          <path d={fillD} fill="rgba(14,165,233,0.1)" />
                          <path d={pathD} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          {pts.map((p, i) => (
                            <rect key={i} x={p.x - 8} y={0} width={16} height={60} fill="transparent">
                              <title>{`${new Date(p.t.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${p.t.errorRate.toFixed(1)}% error rate (${p.t.errorCount}/${p.t.totalCount})`}</title>
                            </rect>
                          ))}
                          {/* peak marker */}
                          {(() => {
                            const peak = pts.reduce((a, b) => b.t.errorRate > a.t.errorRate ? b : a, pts[0]);
                            return peak ? <circle cx={peak.x} cy={peak.y} r={4} fill="#ef4444" stroke="white" strokeWidth="1.5" /> : null;
                          })()}
                        </>
                      );
                    })()}
                  </svg>
                  <div className="mt-1 flex justify-between text-[9px] font-medium text-slate-400">
                    <span>{new Date(spike.trend[0].bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="font-bold text-red-500">Peak: {Math.max(...spike.trend.map(t => t.errorRate)).toFixed(1)}%</span>
                    <span>{new Date(spike.trend[spike.trend.length - 1].bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Not enough data to render trend.</p>
              )}
            </div>
          </NeoCard>

          {/* Top failing endpoints */}
          {spike.topEndpoints.length > 0 && (
            <NeoCard variant="flat" disablePadding className="overflow-hidden border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
                  <Wifi size={14} className="text-sky-500" />
                  Top Failing Endpoints
                </h4>
              </div>
              <div className="divide-y divide-slate-100">
                {spike.topEndpoints.map((ep, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                      {ep.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700" title={ep.endpoint}>
                      {ep.endpoint}
                    </span>
                    <span className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-700">
                      {ep.errorCount} errors
                    </span>
                  </div>
                ))}
              </div>
            </NeoCard>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-1">
          <NeoCard variant="flat" className="border-sky-200 bg-sky-50/50 p-4 shadow-sm">
            <h4 className="mb-3 border-b border-sky-100 pb-2 text-[10px] font-bold uppercase tracking-widest text-sky-600">
              Spike Properties
            </h4>
            <dl className="space-y-3 text-xs">
              <div>
                <dt className="mb-0.5 text-slate-500">Detected At</dt>
                <dd className="font-medium text-slate-800">{new Date(spike.detectedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="mb-0.5 text-slate-500">Error Rate</dt>
                <dd className="font-medium text-slate-800">{spike.currentRate.toFixed(1)}% <span className="text-slate-400">(was {spike.previousRate.toFixed(1)}%)</span></dd>
              </div>
              <div>
                <dt className="mb-0.5 text-slate-500">Increase</dt>
                <dd className="font-bold text-red-600">+{spike.percentIncrease}%</dd>
              </div>
              <div>
                <dt className="mb-0.5 text-slate-500">API Calls in Window</dt>
                <dd className="font-medium text-slate-800">{spike.affectedSessions.toLocaleString()}</dd>
              </div>
            </dl>
          </NeoCard>
          <NeoCard variant="flat" className="border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">What Is This?</p>
            <p className="text-xs leading-relaxed text-slate-600">
              An API error rate spike means more HTTP 4xx/5xx responses than normal from your app's network calls — not a crash or JS exception. Check your sessions from this time window for affected traffic.
            </p>
          </NeoCard>
        </div>
      </div>
    );
  }

  const threadState = row.source.threadState;
    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <NeoCard variant="flat" disablePadding className="overflow-hidden border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
                <Code size={14} className="text-violet-500" />
                Main Thread State
              </h4>
              <div className="flex items-center gap-1.5">
                <NeoButton
                  variant="ghost"
                  size="sm"
                  leftIcon={copiedKey === `${row.key}:thread` ? <Check size={13} /> : <Copy size={13} />}
                  onClick={(event) => handleCopyText(threadState, `${row.key}:thread`, event)}
                  disabled={!threadState}
                  className="h-7 px-2 text-xs"
                >
                  Copy
                </NeoButton>
                <NeoButton
                  variant="ghost"
                  size="sm"
                  leftIcon={<Download size={13} />}
                  onClick={(event) => handleDownloadText(threadState, row.source.id, 'anr-thread', event)}
                  disabled={!threadState}
                  className="h-7 px-2 text-xs"
                >
                  Save
                </NeoButton>
              </div>
            </div>

            {threadState ? (
              <div className="max-h-[400px] overflow-auto bg-[#0d1117] p-4 font-mono text-[11px] leading-relaxed text-[#c6a0f6] selection:bg-violet-900">
                {threadState}
              </div>
            ) : (
              <div className="bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">No thread state captured.</div>
            )}
          </NeoCard>

          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 shadow-sm">
              <Smartphone size={12} className="text-slate-400" />
              <span className="font-semibold text-slate-700">Device:</span>
              <span title={row.deviceModel}>{row.deviceLabel}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 shadow-sm">
              <Activity size={12} className="text-slate-400" />
              <span className="font-semibold text-slate-700">OS:</span>
              {row.source.deviceMetadata?.osVersion || 'Unknown'}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-1">
          {renderReplayCard(row)}
          <NeoCard variant="flat" className="flex-1 border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="mb-3 border-b border-slate-100 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              ANR Properties
            </h4>
            <dl className="space-y-3 text-xs">
              <div>
                <dt className="mb-0.5 text-slate-500">Occurred At</dt>
                <dd className="font-medium text-slate-800">{new Date(row.lastOccurred).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="mb-0.5 text-slate-500">App Version</dt>
                <dd className="font-medium text-slate-800">{row.appVersion}</dd>
              </div>
              <div>
                <dt className="mb-0.5 text-slate-500">Block Duration</dt>
                <dd className="break-words font-medium text-slate-800">{row.durationMs}ms</dd>
              </div>
            </dl>
          </NeoCard>
        </div>
      </div>
    );
  };

  if ((isLoading && allRows.length === 0) || projectsLoading) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="Stability"
        subtitle="Crashes, runtime errors, and ANRs ordered by latest event"
        icon={<AlertTriangle className="h-5 w-5" />}
        iconColor="bg-[#ffe4e6]"
      >
        <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
      </DashboardPageHeader>

      <div className="mx-auto w-full max-w-[1800px] px-6 pt-6">
        <NeoCard variant="flat" disablePadding className="overflow-hidden bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
              <div className="relative w-full lg:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search stability issues..."
                  className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5" aria-label="Stability issue type filters">
                <button
                  type="button"
                  onClick={() => updateKindFilter([])}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    activeKindSet.size === 0
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  All
                </button>
                {KIND_ORDER.map((kind) => {
                  const meta = KIND_META[kind];
                  const Icon = meta.icon;
                  const selected = activeKindSet.has(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => toggleKind(kind)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        selected
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {meta.plural}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {formatCompact(kindCounts[kind])}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm font-medium text-slate-500">
              <span>{filteredRows.length} Issues</span>
              <span className="hidden md:inline">|</span>
              <span className="hidden rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700 md:inline">
                {formatCompact(visibleEventCount)} Total Events
              </span>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-white px-4">
            <div className="flex items-center gap-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <div className="w-24 shrink-0">Type</div>
              <div className="min-w-0 flex-1">Issue Details</div>
              <div className="hidden w-32 md:block">Environment</div>
              <div className="hidden w-24 text-right sm:block">First Seen</div>
              <div className="hidden w-24 text-right lg:block">Last Event</div>
              <div className="w-16 text-right">Events</div>
              <div className="w-16 text-right">Users</div>
              <div className="w-8 shrink-0" />
            </div>
          </div>

          <div className="divide-y divide-slate-100 bg-white">
            {filteredRows.length === 0 && (
              <div className="py-24 text-center text-slate-400">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                <p className="text-lg font-semibold text-slate-700">No stability issues found</p>
                <p className="mt-1 text-sm">Try a different issue type, search term, platform, or time range.</p>
              </div>
            )}

            {filteredRows.map((row) => {
              const meta = KIND_META[row.kind];
              const isExpanded = expandedIssueKey === row.key;

              return (
                <div
                  key={row.key}
                  id={makeDomId(row.key)}
                  className={`transition-colors ${isExpanded ? meta.rowClass : 'hover:bg-slate-50'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-4 py-3"
                    onClick={() => setExpandedIssueKey(isExpanded ? null : row.key)}
                  >
                    <div className="flex w-24 shrink-0 items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full transition-all ${isExpanded ? meta.dotClass : `bg-slate-300 ${meta.hoverDotClass}`}`} />
                      <NeoBadge variant={meta.badge} size="sm" className="shadow-none">
                        {meta.label}
                      </NeoBadge>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[13px] font-semibold text-slate-900" title={row.title}>
                          {row.title}
                        </h3>
                        {row.kind === 'errors' && row.screenName && (
                          <span className="hidden rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 xl:inline-block">
                            {row.screenName}
                          </span>
                        )}
                        {row.kind === 'anrs' && (
                          <span className="hidden rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 xl:inline-block">
                            {Math.round(row.durationMs / 100) / 10}s block
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500" title={row.subtitle}>
                        {row.subtitle}
                      </p>
                    </div>

                    <div className="hidden w-32 shrink-0 md:block">
                      {row.kind === 'api_spikes' ? (
                        <ApiSpikeTrendline spike={row.source} height={28} />
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold uppercase text-slate-400" title={row.deviceModel}>
                            {row.deviceLabel}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold uppercase text-slate-400">v{row.appVersion}</span>
                        </div>
                      )}
                    </div>

                    <div className="hidden w-24 text-right sm:block">
                      <span className="text-xs font-medium text-slate-500" title={new Date(row.firstSeen).toLocaleString()}>
                        {formatAge(row.firstSeen)}
                      </span>
                    </div>

                    <div className="hidden w-24 text-right lg:block">
                      <span className="text-xs font-semibold text-slate-700" title={new Date(row.lastOccurred).toLocaleString()}>
                        {formatLastSeen(row.lastOccurred)}
                      </span>
                    </div>

                    <div className="w-16 text-right">
                      <span className={`inline-block rounded border px-2 py-0.5 font-mono text-xs font-medium ${meta.badgeClass}`}>
                        {formatCompact(row.eventCount)}
                      </span>
                    </div>

                    <div className="w-16 text-right">
                      <span className="inline-block font-mono text-xs font-medium text-slate-600">
                        {formatCompact(row.userCount)}
                      </span>
                    </div>

                    <div className="flex w-8 shrink-0 justify-end">
                      <div
                        className={`flex h-6 w-6 items-center justify-center rounded text-slate-400 transition ${
                          isExpanded ? 'rotate-180 bg-slate-100 text-slate-700' : 'group-hover/row:bg-slate-200 group-hover/row:text-slate-600'
                        }`}
                      >
                        <ChevronDown size={14} />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="cursor-default border-t border-slate-200 bg-slate-50/50 p-4 shadow-inner sm:p-5">
                      {renderExpandedContent(row)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </NeoCard>
      </div>
    </div>
  );
};

export default Stability;
