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
  Maximize2,
  Minimize2,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Smartphone,
  TrendingUp,
  Wifi,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  api,
  type ANRRecord,
  type ApiErrorSpikeRecord,
  type CrashOverviewGroup,
  type CrashReport,
  type ErrorOverviewGroup,
  type StabilityDiagnosticState,
  type StabilityIssuesResponse,
  type StabilityOccurrence,
  type StabilitySymbolicationState,
  getANRsOverview,
  getApiEndpointStats,
  getApiErrorSpikes,
  getCrashesOverview,
  getErrorsOverview,
  getStabilityIssueOccurrences,
  getStabilityIssues,
  getProjectAlertSettings,
  updateProjectAlertSettings,
} from '~/shared/api/client';
import { adaptStabilityIssues } from './stabilityIssueAdapters';
import { platformLensToSessionPlatform, useSharedPlatformLens } from '~/shared/hooks/useSharedPlatformLens';
import { formatAge, formatLastSeen } from '~/shared/lib/formatDates';
import { formatDeviceModel, getDeviceModelSearchText } from '~/shared/lib/deviceModelNames';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { DashboardGhostLoader, useInitialDashboardLoad } from '~/shared/ui/core/DashboardGhostLoader';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { KpiCardItem, KpiCardsGrid } from '~/features/app/shared/dashboard/KpiCardsGrid';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { dashboardButtonClass, dashboardButtonVariants, dashboardChipClass } from '~/shared/ui/core/dashboardStyles';
import { formatSetupPlatform } from '~/features/app/setup/setupUtils';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';

type StabilityIssueKind = 'crashes' | 'errors' | 'anrs' | 'api_spikes';
type MobileIssueDetailSize = 'compact' | 'expanded';

type IgnoredEndpointOption = {
  pattern: string;
  totalCalls: number;
  totalErrors: number;
  errorRate: number;
};

type StabilityOccurrencePageState = {
  items: StabilityOccurrence[];
  total: number;
  nextCursor: string | null;
  isLoading: boolean;
  error: string | null;
};

const EMPTY_STABILITY_SUMMARY: StabilityIssuesResponse['summary'] = {
  issues: 0,
  events: 0,
  users: 0,
  sessions: 0,
  completeDiagnostics: 0,
  incompleteDiagnostics: 0,
  totalSessions: 0,
  crashFreeSessions: 0,
  crashFreeSessionRate: 100,
  totalUsers: 0,
  crashFreeUsers: 0,
  crashFreeUserRate: 100,
};

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
      sessionCount: number;
      diagnosticState: StabilityDiagnosticState | null;
      symbolicationState: StabilitySymbolicationState | null;
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
      sessionCount: number;
      diagnosticState: StabilityDiagnosticState | null;
      symbolicationState: StabilitySymbolicationState | null;
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
      sessionCount: number;
      diagnosticState: StabilityDiagnosticState | null;
      symbolicationState: StabilitySymbolicationState | null;
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
      sessionCount: number;
      diagnosticState: null;
      symbolicationState: null;
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
    hoverDotClass: string;
  }
> = {
  crashes: {
    label: 'Crash',
    plural: 'Crashes',
    badge: 'danger',
    icon: Bug,
    dotClass: 'bg-[#d93025]',
    hoverDotClass: 'group-hover/row:bg-[#d93025]',
  },
  errors: {
    label: 'Error',
    plural: 'Errors',
    badge: 'warning',
    icon: AlertTriangle,
    dotClass: 'bg-[#e37400]',
    hoverDotClass: 'group-hover/row:bg-[#e37400]',
  },
  anrs: {
    label: 'ANR',
    plural: 'ANRs',
    badge: 'anr',
    icon: Clock,
    dotClass: 'bg-[#9334e6]',
    hoverDotClass: 'group-hover/row:bg-[#9334e6]',
  },
  api_spikes: {
    label: 'API spike',
    plural: 'API spikes',
    badge: 'info',
    icon: TrendingUp,
    dotClass: 'bg-[#1a73e8]',
    hoverDotClass: 'group-hover/row:bg-[#1a73e8]',
  },
};

// The dashboard's one code-block style for stack traces and thread dumps, whatever the issue type.
const STACK_BLOCK_CLASS = 'm-4 max-h-[400px] overflow-auto whitespace-pre border border-[#e8eaed] bg-[#f8fafd] p-4 font-mono text-xs leading-relaxed text-[#202124]';
const PANEL_HEADER_CLASS = 'flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eaed] px-4 py-2.5';
const PANEL_TITLE_CLASS = 'flex items-center gap-2 text-sm font-medium text-[#202124]';
const PANEL_ICON_CLASS = 'text-[#5f6368]';
const CONTEXT_CHIP_CLASS = 'flex items-center gap-1.5 rounded-none border border-[#dadce0] bg-white px-2 py-1 text-[#3c4043]';
const ENDPOINT_INPUT_CLASS = 'h-9 min-w-0 flex-1 rounded-none border border-[#dadce0] bg-white px-3 font-mono text-xs text-[#202124] outline-none transition-colors placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 disabled:cursor-not-allowed disabled:bg-[#f8fafd] disabled:text-[#80868b]';
const IGNORED_PATTERN_CHIP_CLASS = 'inline-flex max-w-full items-center gap-1.5 rounded-none border border-[#dadce0] bg-[#f8fafd] px-2 py-1 font-mono text-[11px] text-[#3c4043] transition-colors hover:border-[#bdc1c6] hover:bg-[#f1f3f4] disabled:opacity-60';
const DIAGNOSTIC_CHIP_TONE: Record<StabilityDiagnosticState, 'success' | 'danger' | 'warning'> = {
  complete: 'success',
  partial: 'warning',
  incomplete: 'danger',
};
const diagnosticChipClass = (state: StabilityDiagnosticState | null | undefined): string => (
  dashboardChipClass((state && DIAGNOSTIC_CHIP_TONE[state]) || 'warning')
);
const sentenceCase = (value: string): string => (value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value);
const filterChipClass = (selected: boolean): string => (
  `inline-flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-xs font-medium transition-colors ${
    selected
      ? 'border-[#d2e3fc] bg-[#e8f0fe] text-[#1967d2]'
      : 'border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f1f3f4]'
  }`
);
// Secondary button that switches to the selected tonal state while its panel is open.
const toggleButtonClass = (selected: boolean): string => {
  const base = dashboardButtonClass('secondary', 'sm');
  return selected
    ? base.replace(dashboardButtonVariants.secondary, 'border-[#d2e3fc] bg-[#e8f0fe] text-[#1967d2] hover:bg-[#d2e3fc]')
    : base;
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

const normalizeIgnoredEndpointPatterns = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    const pattern = (value || '').trim().replace(/\s+/g, ' ');
    if (!pattern) return;
    const key = pattern.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(pattern);
  });

  return normalized.slice(0, 50);
};

const endpointPatternFromTopEndpoint = (endpoint: { method: string; endpoint: string }): string => {
  const method = endpoint.method.trim().toUpperCase();
  const pathOrLabel = endpoint.endpoint.trim();
  return pathOrLabel.toUpperCase().startsWith(`${method} `) ? pathOrLabel : `${method} ${pathOrLabel}`;
};

const formatEndpointOptionLabel = (option: IgnoredEndpointOption): string => (
  `${option.pattern} (${formatCompact(option.totalCalls)} calls${option.totalErrors > 0 ? `, ${formatCompact(option.totalErrors)} errors` : ''})`
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
    userCount: group.userCount ?? group.users.length,
    sessionCount: group.sessionCount ?? (group.sampleSessionId ? 1 : 0),
    diagnosticState: group.diagnosticState || null,
    symbolicationState: group.symbolicationState || null,
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
    userCount: group.userCount ?? group.users.length,
    sessionCount: group.sessionCount ?? (sampleError?.sessionId ? 1 : 0),
    diagnosticState: group.diagnosticState || null,
    symbolicationState: group.symbolicationState || null,
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
    sessionCount: anr.sessionCount ?? (anr.sessionId ? 1 : 0),
    diagnosticState: anr.diagnosticState || null,
    symbolicationState: anr.symbolicationState || null,
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

const formatApiRateChange = (spike: ApiErrorSpikeRecord): string => (
  spike.percentIncrease === null ? 'from 0% baseline' : `+${spike.percentIncrease}%`
);

const buildApiSpikeRow = (spike: ApiErrorSpikeRecord): StabilityIssueRow => ({
  key: `api_spike:${spike.id}`,
  kind: 'api_spikes',
  title: spike.percentIncrease === null ? 'New API error activity' : `API error rate +${spike.percentIncrease}%`,
  subtitle: `${spike.currentRate.toFixed(1)}% error rate vs ${spike.previousRate.toFixed(1)}% baseline · ${spike.affectedSessions} API calls`,
  firstSeen: spike.detectedAt,
  lastOccurred: spike.detectedAt,
  eventCount: spike.affectedSessions,
  userCount: 0,
  sessionCount: 0,
  diagnosticState: null,
  symbolicationState: null,
  deviceModel: '',
  deviceLabel: '',
  appVersion: '',
  replaySessionId: null,
  canOpenReplay: false,
  searchText: ['api spike', 'api error', spike.topEndpoints.map(e => `${e.method} ${e.endpoint}`).join(' ')].join(' ').toLowerCase(),
  focusKeys: [spike.id],
  source: spike,
});

const getStabilityIssueId = (row: StabilityIssueRow): string | null => {
  if (row.kind === 'api_spikes') return null;
  return row.source.issueId || (row.kind === 'anrs' ? row.source.groupKey : null) || null;
};

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
        fill="rgba(26,115,232,0.12)"
      />
      {/* trend line */}
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="#1a73e8"
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
          fill="#d93025"
          stroke="white"
          strokeWidth="1"
        />
      )}
    </svg>
  );
};

const DetailedApiSpikeChart: React.FC<{ spike: ApiErrorSpikeRecord; rateChangeLabel: string }> = ({ spike, rateChangeLabel }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const gradientId = useMemo(() => `api-spike-area-${spike.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`, [spike.id]);
  const chart = useMemo(() => {
    const trend = spike.trend.length > 0
      ? spike.trend
      : [{ bucket: spike.detectedAt, errorCount: 0, totalCount: Math.max(spike.affectedSessions, 1), errorRate: spike.currentRate }];
    const width = Math.max(560, Math.min(920, 72 + Math.max(1, spike.trend.length - 1) * 40));
    const height = 210;
    const margin = { top: 22, right: 28, bottom: 44, left: 42 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const rates = trend.map((bucket) => bucket.errorRate);
    const maxObservedRate = Math.max(...rates, spike.currentRate, spike.previousRate, 1);
    const yMax = Math.ceil(maxObservedRate * 1.25);
    const maxTotalCount = Math.max(...trend.map((bucket) => bucket.totalCount), 1);
    const baselineY = margin.top + (1 - Math.min(spike.previousRate, yMax) / yMax) * plotHeight;
    const points = trend.map((bucket, index) => {
      const x = margin.left + (index / Math.max(1, trend.length - 1)) * plotWidth;
      const y = margin.top + (1 - Math.min(bucket.errorRate, yMax) / yMax) * plotHeight;
      const volumeHeight = Math.max(4, (bucket.totalCount / maxTotalCount) * 34);
      const errorShareHeight = Math.max(2, bucket.errorCount > 0 ? (bucket.errorCount / Math.max(bucket.totalCount, 1)) * volumeHeight : 0);
      return { bucket, index, x, y, volumeHeight, errorShareHeight };
    });
    const peakPoint = points.reduce((peak, point) => point.bucket.errorRate > peak.bucket.errorRate ? point : peak, points[0]);
    const currentPoint = points[points.length - 1];
    const activePoint = points[hoverIndex ?? peakPoint.index] ?? peakPoint;
    const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(margin.top + plotHeight).toFixed(1)} L${points[0].x.toFixed(1)},${(margin.top + plotHeight).toFixed(1)} Z`;
    return { width, height, margin, plotWidth, plotHeight, yMax, baselineY, points, peakPoint, currentPoint, activePoint, linePath, areaPath };
  }, [hoverIndex, spike.affectedSessions, spike.currentRate, spike.detectedAt, spike.previousRate, spike.trend]);

  if (spike.trend.length < 2) {
    return <p className="text-sm text-[#5f6368]">Not enough data to render trend.</p>;
  }

  const tooltip = chart.activePoint;
  const tooltipWidth = 182;
  const tooltipX = Math.min(Math.max(tooltip.x - tooltipWidth / 2, 8), chart.width - tooltipWidth - 8);
  const tooltipY = tooltip.y > 92 ? tooltip.y - 86 : tooltip.y + 18;
  const activeDelta = tooltip.bucket.errorRate - spike.previousRate;
  const tickRates = [chart.yMax, chart.yMax / 2, 0];

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 gap-2 px-4 pt-4 sm:grid-cols-4">
        <div className="rounded-none border border-[#e8eaed] bg-white px-3 py-2">
          <div className="text-[11px] font-medium text-[#5f6368]">Baseline</div>
          <div className="mt-1 text-sm font-medium tabular-nums text-[#202124]">{spike.previousRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-none border border-[#e8eaed] bg-white px-3 py-2">
          <div className="text-[11px] font-medium text-[#5f6368]">Current</div>
          <div className="mt-1 text-sm font-medium tabular-nums text-[#c5221f]">{spike.currentRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-none border border-[#e8eaed] bg-white px-3 py-2">
          <div className="text-[11px] font-medium text-[#5f6368]">Calls</div>
          <div className="mt-1 text-sm font-medium tabular-nums text-[#202124]">{spike.affectedSessions.toLocaleString()}</div>
        </div>
        <div className="rounded-none border border-[#e8eaed] bg-white px-3 py-2">
          <div className="text-[11px] font-medium text-[#5f6368]">Peak</div>
          <div className="mt-1 text-sm font-medium tabular-nums text-[#202124]">{chart.peakPoint.bucket.errorRate.toFixed(1)}%</div>
        </div>
      </div>
      <div className="overflow-x-auto px-4 py-4">
        <svg
          width={chart.width}
          height={chart.height}
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          className="mx-auto block max-w-full overflow-visible"
          role="img"
          aria-label={`API error rate trend from ${spike.previousRate.toFixed(1)}% baseline to ${spike.currentRate.toFixed(1)}% current`}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#1a73e8" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#1a73e8" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {tickRates.map((rate) => {
            const y = chart.margin.top + (1 - rate / chart.yMax) * chart.plotHeight;
            return (
              <g key={rate.toFixed(2)}>
                <line x1={chart.margin.left} x2={chart.width - chart.margin.right} y1={y} y2={y} stroke="#e8eaed" strokeDasharray={rate === 0 ? undefined : '3 4'} />
                <text x={chart.margin.left - 10} y={y + 3} textAnchor="end" className="fill-[#5f6368] text-[10px] font-medium tabular-nums">
                  {rate.toFixed(rate >= 10 ? 0 : 1)}%
                </text>
              </g>
            );
          })}

          <line
            x1={chart.margin.left}
            x2={chart.width - chart.margin.right}
            y1={chart.baselineY}
            y2={chart.baselineY}
            stroke="#e37400"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
          <text x={chart.width - chart.margin.right} y={Math.max(12, chart.baselineY - 6)} textAnchor="end" className="fill-[#b06000] text-[10px] font-medium tabular-nums">
            baseline {spike.previousRate.toFixed(1)}%
          </text>

          <g aria-hidden="true">
            {chart.points.map((point) => (
              <g key={`volume:${point.index}`}>
                <rect
                  x={point.x - 5}
                  y={chart.margin.top + chart.plotHeight + 6 + (34 - point.volumeHeight)}
                  width={10}
                  height={point.volumeHeight}
                  rx={0}
                  fill="#d2e3fc"
                />
                <rect
                  x={point.x - 5}
                  y={chart.margin.top + chart.plotHeight + 6 + (34 - point.errorShareHeight)}
                  width={10}
                  height={point.errorShareHeight}
                  rx={0}
                  fill="#d93025"
                />
              </g>
            ))}
          </g>

          <path d={chart.areaPath} fill={`url(#${gradientId})`} />
          <path d={chart.linePath} fill="none" stroke="#1a73e8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {chart.points.map((point) => {
            const isPeak = point.index === chart.peakPoint.index;
            const isCurrent = point.index === chart.currentPoint.index;
            const isActive = point.index === tooltip.index;
            return (
              <g key={`point:${point.index}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isActive ? 5 : isPeak || isCurrent ? 4 : 2.5}
                  fill={isPeak ? '#d93025' : isCurrent ? '#1967d2' : '#1a73e8'}
                  stroke="white"
                  strokeWidth="1.5"
                />
                <rect
                  x={point.x - 12}
                  y={chart.margin.top - 12}
                  width={24}
                  height={chart.plotHeight + 58}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(point.index)}
                  onFocus={() => setHoverIndex(point.index)}
                  tabIndex={0}
                >
                  <title>{`${new Date(point.bucket.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${point.bucket.errorRate.toFixed(1)}% error rate, ${point.bucket.errorCount.toLocaleString()} errors from ${point.bucket.totalCount.toLocaleString()} calls`}</title>
                </rect>
              </g>
            );
          })}

          <line x1={tooltip.x} x2={tooltip.x} y1={chart.margin.top} y2={chart.margin.top + chart.plotHeight + 40} stroke="#202124" strokeOpacity="0.18" strokeDasharray="3 3" />
          <g transform={`translate(${tooltipX}, ${tooltipY})`} pointerEvents="none">
            <rect width={tooltipWidth} height={72} rx={0} fill="white" stroke="#dadce0" />
            <text x={10} y={17} className="fill-[#5f6368] text-[10px] font-medium tabular-nums">
              {new Date(tooltip.bucket.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
            <text x={10} y={36} className="fill-[#202124] text-[14px] font-medium tabular-nums">
              {tooltip.bucket.errorRate.toFixed(1)}% error rate
            </text>
            <text x={10} y={54} className="fill-[#3c4043] text-[10px] tabular-nums">
              {tooltip.bucket.errorCount.toLocaleString()} errors / {tooltip.bucket.totalCount.toLocaleString()} calls
            </text>
            <text x={10} y={66} className={`text-[10px] font-medium tabular-nums ${activeDelta >= 0 ? 'fill-[#d93025]' : 'fill-[#188038]'}`}>
              {activeDelta >= 0 ? '+' : ''}{activeDelta.toFixed(1)} pts vs baseline
            </text>
          </g>

        </svg>
        <div
          className="mx-auto mt-2 grid max-w-full grid-cols-[1fr_auto_1fr] items-center gap-3 text-[10px] font-medium tabular-nums text-[#5f6368]"
          style={{ width: chart.width }}
        >
          <span className="truncate">
            {new Date(spike.trend[0].bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="whitespace-nowrap font-medium text-[#d93025]">Peak {chart.peakPoint.bucket.errorRate.toFixed(1)}%</span>
          <span className="truncate text-right">
            {new Date(spike.trend[spike.trend.length - 1].bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#e8eaed] px-4 py-2 text-[11px] font-medium text-[#5f6368]">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#1a73e8]" /> Error rate</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-none bg-[#d2e3fc]" /> API calls</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-none bg-[#d93025]" /> Errors</span>
        <span className="inline-flex items-center gap-1"><span className="h-px w-5 border-t border-dashed border-[#e37400]" /> Baseline</span>
        <span className="ml-auto tabular-nums text-[#3c4043]">{spike.previousRate.toFixed(1)}% → {spike.currentRate.toFixed(1)}% ({rateChangeLabel})</span>
      </div>
    </div>
  );
};

export const Stability: React.FC = () => {
  const { selectedProject, projectsLoading } = useSessionData();
  const manualRefreshVersion = useDashboardManualRefreshVersion();
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
  const [stabilitySummary, setStabilitySummary] = useState<StabilityIssuesResponse['summary']>(EMPTY_STABILITY_SUMMARY);
  const [failedSections, setFailedSections] = useState<string[]>([]);
  const [retryVersion, setRetryVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [mobileIssueDetailSize, setMobileIssueDetailSize] = useState<MobileIssueDetailSize>('compact');
  const [crashDetails, setCrashDetails] = useState<Record<string, CrashReport | null>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [ignoredEndpointPatterns, setIgnoredEndpointPatterns] = useState<string[]>([]);
  const [isIgnoredEndpointPanelOpen, setIsIgnoredEndpointPanelOpen] = useState(false);
  const [recordedEndpointOptions, setRecordedEndpointOptions] = useState<IgnoredEndpointOption[]>([]);
  const [selectedEndpointPattern, setSelectedEndpointPattern] = useState('');
  const [isSavingIgnoredEndpoints, setIsSavingIgnoredEndpoints] = useState(false);
  const [ignoreSettingsError, setIgnoreSettingsError] = useState<string | null>(null);
  const [occurrencePages, setOccurrencePages] = useState<Record<string, StabilityOccurrencePageState>>({});

  useEffect(() => {
    const projectId = currentProject?.id || (isDemoMode ? 'demo' : '');
    if (!projectId) {
      setCrashGroups([]);
      setErrorGroups([]);
      setAnrs([]);
      setApiSpikes([]);
      setStabilitySummary(EMPTY_STABILITY_SUMMARY);
      setFailedSections([]);
      setOccurrencePages({});
      setIgnoredEndpointPatterns([]);
      setRecordedEndpointOptions([]);
      setSelectedEndpointPattern('');
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setOccurrencePages({});

    const stabilityRequest = isDemoMode
      ? Promise.all([
          getCrashesOverview(projectId, timeRange, platform),
          getErrorsOverview(projectId, timeRange, platform),
          getANRsOverview(projectId, timeRange, platform),
        ]).then(([crashesResponse, errorsResponse, anrsResponse]) => {
          const issues = (crashesResponse.groups?.length || 0) + (errorsResponse.groups?.length || 0) + (anrsResponse.anrs?.length || 0);
          const events = (crashesResponse.summary?.events || 0) + (errorsResponse.summary?.events || 0) + (anrsResponse.summary?.events || 0);
          const totalSessions = 12_480;
          const crashFreeSessions = 12_048;
          const totalUsers = 8_236;
          const crashFreeUsers = 7_942;

          return {
            crashGroups: crashesResponse.groups || [],
            errorGroups: errorsResponse.groups || [],
            anrs: anrsResponse.anrs || [],
            summary: {
              issues,
              events,
              users: (crashesResponse.summary?.users || 0) + (errorsResponse.summary?.users || 0) + (anrsResponse.summary?.users || 0),
              sessions: 914,
              completeDiagnostics: Math.max(0, issues - 2),
              incompleteDiagnostics: Math.min(2, issues),
              totalSessions,
              crashFreeSessions,
              crashFreeSessionRate: (crashFreeSessions / totalSessions) * 100,
              totalUsers,
              crashFreeUsers,
              crashFreeUserRate: (crashFreeUsers / totalUsers) * 100,
            },
          };
        })
      : getStabilityIssues(projectId, timeRange, platform).then((response) => ({
          ...adaptStabilityIssues(response.issues || []),
          summary: response.summary,
        }));

    Promise.allSettled([
      stabilityRequest,
      getApiErrorSpikes(projectId, timeRange),
      getApiEndpointStats(projectId, 'all'),
      isDemoMode
        ? Promise.resolve({ ignoredApiEndpoints: [] } as unknown as Awaited<ReturnType<typeof getProjectAlertSettings>>)
        : getProjectAlertSettings(projectId),
    ]).then(([stabilityResult, spikesResult, endpointStatsResult, alertSettingsResult]) => {
      if (cancelled) return;

      const nextFailedSections: string[] = [];
      if (stabilityResult.status === 'fulfilled') {
        setCrashGroups(stabilityResult.value.crashGroups);
        setErrorGroups(stabilityResult.value.errorGroups);
        setAnrs(stabilityResult.value.anrs);
        setStabilitySummary(stabilityResult.value.summary);
      } else {
        console.error('Failed to fetch Stability issues:', stabilityResult.reason);
        setCrashGroups([]);
        setErrorGroups([]);
        setAnrs([]);
        setStabilitySummary(EMPTY_STABILITY_SUMMARY);
        nextFailedSections.push('crash, error, and ANR issues');
      }

      if (spikesResult.status === 'fulfilled') setApiSpikes(spikesResult.value.spikes || []);
      else {
        setApiSpikes([]);
        nextFailedSections.push('API spikes');
      }

      if (endpointStatsResult.status === 'fulfilled') {
        const seen = new Set<string>();
        const options = (endpointStatsResult.value.allEndpoints || [])
          .map((endpoint) => ({
            pattern: endpoint.endpoint.trim(),
            totalCalls: endpoint.totalCalls || 0,
            totalErrors: endpoint.totalErrors || 0,
            errorRate: endpoint.errorRate || 0,
          }))
          .filter((option) => {
            if (!option.pattern) return false;
            const key = option.pattern.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => b.totalErrors - a.totalErrors || b.totalCalls - a.totalCalls || a.pattern.localeCompare(b.pattern))
          .slice(0, 200);
        setRecordedEndpointOptions(options);
      } else {
        setRecordedEndpointOptions([]);
        nextFailedSections.push('API endpoint catalog');
      }

      if (alertSettingsResult.status === 'fulfilled') {
        const patterns = normalizeIgnoredEndpointPatterns(alertSettingsResult.value.ignoredApiEndpoints || []);
        setIgnoredEndpointPatterns(patterns);
        setIgnoreSettingsError(null);
      } else {
        setIgnoredEndpointPatterns([]);
        nextFailedSections.push('alert settings');
      }
      setFailedSections(nextFailedSections);
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, isDemoMode, manualRefreshVersion, timeRange, platform, retryVersion]);

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

  const availableEndpointOptions = useMemo(() => {
    const ignored = new Set(ignoredEndpointPatterns.map((pattern) => pattern.toLowerCase()));
    return recordedEndpointOptions.filter((option) => !ignored.has(option.pattern.toLowerCase()));
  }, [ignoredEndpointPatterns, recordedEndpointOptions]);

  const selectedEndpointOption = useMemo(() => {
    const query = selectedEndpointPattern.trim().toLowerCase();
    if (!query) return null;
    return availableEndpointOptions.find((option) => option.pattern.toLowerCase() === query) || null;
  }, [availableEndpointOptions, selectedEndpointPattern]);

  useEffect(() => {
    if (!focusId || isLoading || allRows.length === 0) return;

    const normalizedFocusId = normalizeFocusKey(focusId);
    const target = allRows.find((row) => row.focusKeys.some((key) => normalizeFocusKey(key) === normalizedFocusId));
    if (!target) return;

    setExpandedIssueKey(target.key);
    setMobileIssueDetailSize('compact');
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
    setMobileIssueDetailSize('compact');
  }, [expandedIssueKey]);

  const handleIssueRowClick = (row: StabilityIssueRow, isExpanded: boolean) => {
    setExpandedIssueKey(isExpanded ? null : row.key);
    if (!isExpanded) {
      setMobileIssueDetailSize('compact');
    }
  };

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

  const expandedStabilityIssueId = expandedRow ? getStabilityIssueId(expandedRow) : null;

  useEffect(() => {
    if (!expandedRow || !expandedStabilityIssueId) return;
    const projectId = currentProject?.id || (isDemoMode ? 'demo' : '');
    if (!projectId || occurrencePages[expandedRow.key]) return;

    let cancelled = false;
    setOccurrencePages((current) => ({
      ...current,
      [expandedRow.key]: {
        items: [],
        total: 0,
        nextCursor: null,
        isLoading: true,
        error: null,
      },
    }));

    getStabilityIssueOccurrences(projectId, expandedStabilityIssueId, {
      timeRange,
      platform,
      limit: 25,
    }).then((page) => {
      if (cancelled) return;
      setOccurrencePages((current) => ({
        ...current,
        [expandedRow.key]: {
          items: page.occurrences || [],
          total: page.total || 0,
          nextCursor: page.nextCursor,
          isLoading: false,
          error: null,
        },
      }));
    }).catch((error) => {
      if (cancelled) return;
      console.error('Failed to fetch Stability occurrences:', error);
      setOccurrencePages((current) => ({
        ...current,
        [expandedRow.key]: {
          items: [],
          total: 0,
          nextCursor: null,
          isLoading: false,
          error: 'Could not load occurrences. Retry this issue.',
        },
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentProject?.id,
    expandedIssueKey,
    expandedRow,
    expandedStabilityIssueId,
    isDemoMode,
    platform,
    timeRange,
  ]);

  const loadMoreOccurrences = async (row: StabilityIssueRow) => {
    const projectId = currentProject?.id;
    const issueId = getStabilityIssueId(row);
    const currentPage = occurrencePages[row.key];
    if (!projectId || !issueId || !currentPage?.nextCursor || currentPage.isLoading) return;

    setOccurrencePages((current) => ({
      ...current,
      [row.key]: { ...currentPage, isLoading: true, error: null },
    }));
    try {
      const page = await getStabilityIssueOccurrences(projectId, issueId, {
        timeRange,
        platform,
        cursor: currentPage.nextCursor,
        limit: 25,
      });
      setOccurrencePages((current) => ({
        ...current,
        [row.key]: {
          items: [...(current[row.key]?.items || []), ...(page.occurrences || [])],
          total: page.total || currentPage.total,
          nextCursor: page.nextCursor,
          isLoading: false,
          error: null,
        },
      }));
    } catch (error) {
      console.error('Failed to load more Stability occurrences:', error);
      setOccurrencePages((current) => ({
        ...current,
        [row.key]: {
          ...(current[row.key] || currentPage),
          isLoading: false,
          error: 'Could not load more occurrences.',
        },
      }));
    }
  };

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

  const saveIgnoredEndpointPatterns = async (patterns: string[]) => {
    const projectId = currentProject?.id || (isDemoMode ? 'demo' : '');
    if (!projectId || isDemoMode) return;

    const normalized = normalizeIgnoredEndpointPatterns(patterns);
    setIsSavingIgnoredEndpoints(true);
    setIgnoreSettingsError(null);

    try {
      const updated = await updateProjectAlertSettings(projectId, { ignoredApiEndpoints: normalized });
      const nextPatterns = normalizeIgnoredEndpointPatterns(updated.ignoredApiEndpoints || normalized);
      setIgnoredEndpointPatterns(nextPatterns);
      const spikes = await getApiErrorSpikes(projectId, timeRange);
      setApiSpikes(spikes.spikes || []);
    } catch (error) {
      console.error('Failed to update ignored API endpoints:', error);
      setIgnoreSettingsError('Could not save ignored endpoints.');
    } finally {
      setIsSavingIgnoredEndpoints(false);
    }
  };

  const handleAddSelectedIgnoredEndpoint = () => {
    if (!selectedEndpointOption) return;
    const pattern = selectedEndpointOption.pattern;
    setSelectedEndpointPattern('');
    void saveIgnoredEndpointPatterns([...ignoredEndpointPatterns, pattern]);
  };

  const handleIgnoreEndpoint = (endpoint: { method: string; endpoint: string }, event: React.MouseEvent) => {
    event.stopPropagation();
    const pattern = endpointPatternFromTopEndpoint(endpoint);
    void saveIgnoredEndpointPatterns([...ignoredEndpointPatterns, pattern]);
  };

  const handleRemoveIgnoredEndpoint = (pattern: string, event: React.MouseEvent) => {
    event.stopPropagation();
    void saveIgnoredEndpointPatterns(ignoredEndpointPatterns.filter((item) => item.toLowerCase() !== pattern.toLowerCase()));
  };

  const renderIssueSummaryCard = (
    row: Exclude<StabilityIssueRow, { kind: 'api_spikes' }>,
    title: string,
    additionalProperties: Array<{ label: string; value: React.ReactNode }> = [],
  ) => {
    const diagnosticLabel = row.diagnosticState
      ? `${row.diagnosticState.charAt(0).toUpperCase()}${row.diagnosticState.slice(1)}`
      : 'Unknown';
    const symbolicationLabel: Record<StabilitySymbolicationState, string> = {
      symbolicated: 'Symbolicated',
      missing_symbols: 'Symbols missing',
      raw: 'Raw stack',
      not_applicable: 'Not applicable',
    };

    return (
      <NeoCard variant="flat" disablePadding className="p-4">
        <h4 className="mb-3 border-b border-[#e8eaed] pb-2 text-sm font-medium text-[#202124]">
          {title}
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Occurrences', formatCompact(row.eventCount)],
            ['Sessions', formatCompact(row.sessionCount)],
            ['Users', formatCompact(row.userCount)],
            ['App version', row.appVersion || '?'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-none border border-[#e8eaed] bg-[#f8fafd] px-2.5 py-2">
              <p className="text-[11px] font-medium text-[#5f6368]">{label}</p>
              <p className="mt-0.5 truncate text-sm font-medium tabular-nums text-[#202124]" title={value}>
                {value}
              </p>
            </div>
          ))}
        </div>
        <dl className="mt-4 space-y-3 border-t border-[#e8eaed] pt-3 text-xs">
          <div>
            <dt className="mb-0.5 text-[#5f6368]">First seen</dt>
            <dd className="font-medium tabular-nums text-[#202124]">{new Date(row.firstSeen).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="mb-0.5 text-[#5f6368]">Latest event</dt>
            <dd className="font-medium tabular-nums text-[#202124]">{new Date(row.lastOccurred).toLocaleString()}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[#5f6368]">Diagnostics</dt>
            <dd className={diagnosticChipClass(row.diagnosticState)}>
              {diagnosticLabel}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-[#5f6368]">Stack symbols</dt>
            <dd className={`text-right text-[11px] font-medium ${
              row.symbolicationState === 'symbolicated' ? 'text-[#137333]' : 'text-[#3c4043]'
            }`}>
              {row.symbolicationState ? symbolicationLabel[row.symbolicationState] : 'Unknown'}
            </dd>
          </div>
          {additionalProperties.map((property) => (
            <div key={property.label}>
              <dt className="mb-0.5 text-[#5f6368]">{property.label}</dt>
              <dd className="break-words font-medium text-[#202124]">{property.value}</dd>
            </div>
          ))}
        </dl>
      </NeoCard>
    );
  };

  const renderOccurrencesCard = (row: StabilityIssueRow) => {
    const issueId = getStabilityIssueId(row);
    if (!issueId) return null;
    const page = occurrencePages[row.key];
    const replayStateLabel: Record<StabilityOccurrence['replayState'], string> = {
      available: 'Replay available',
      expired: 'Replay expired',
      deleted: 'Replay deleted',
      unsampled: 'Not sampled',
      unavailable: 'No replay',
    };

    return (
      <NeoCard variant="flat" disablePadding className="overflow-hidden">
        <div className={PANEL_HEADER_CLASS}>
          <div>
            <h4 className={PANEL_TITLE_CLASS}>
              <Clock size={14} className={PANEL_ICON_CLASS} />
              Occurrences and sessions
            </h4>
            <p className="mt-1 text-[11px] text-[#5f6368]">
              Every captured occurrence is listed here; duplicate transports are merged.
            </p>
          </div>
          <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
            {page ? `${page.items.length} of ${page.total}` : `${row.eventCount} events`}
          </span>
        </div>

        {!page || (page.isLoading && page.items.length === 0) ? (
          <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-[#5f6368]">
            <Loader size={17} className="animate-spin" />
            Loading occurrences...
          </div>
        ) : page.error && page.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <p className="text-sm font-medium text-[#c5221f]">{page.error}</p>
            <NeoButton
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                setRetryVersion((version) => version + 1);
              }}
            >
              Retry
            </NeoButton>
          </div>
        ) : (
          <>
            <div className="max-h-[420px] divide-y divide-[#e8eaed] overflow-y-auto">
              {page.items.map((occurrence) => (
                <div key={occurrence.id} className="grid gap-3 px-4 py-3 text-xs sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center">
                  <div>
                    <div className="font-medium tabular-nums text-[#202124]">{new Date(occurrence.timestamp).toLocaleString()}</div>
                    <div className="mt-1 font-mono text-[10px] text-[#80868b]">
                      {occurrence.id.slice(0, 12)}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={dashboardChipClass('neutral')}>
                        {occurrence.platform ? formatSetupPlatform(occurrence.platform) : 'Unknown platform'}
                      </span>
                      <span className={dashboardChipClass('neutral')}>
                        {formatDeviceModel(occurrence.deviceModel, 'Unknown device')}
                      </span>
                      <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                        v{occurrence.appVersion || '?'}
                      </span>
                      <span className={diagnosticChipClass(occurrence.diagnosticState)}>
                        {sentenceCase(occurrence.diagnosticState)} diagnostics
                      </span>
                    </div>
                    <p className="mt-1.5 truncate font-mono text-[11px] text-[#5f6368]" title={occurrence.stackTrace || occurrence.message || ''}>
                      {occurrence.stackTrace?.split('\n').find(Boolean) || occurrence.message || 'No stack captured'}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-[#80868b]" title={occurrence.sessionId || ''}>
                      Session: {occurrence.sessionId || 'Unavailable'} · {replayStateLabel[occurrence.replayState]}
                    </p>
                  </div>
                  <div className="flex justify-end">
                    {occurrence.canOpenReplay && occurrence.sessionId ? (
                      <NeoButton
                        variant="secondary"
                        size="sm"
                        leftIcon={<Play size={12} />}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`${pathPrefix}/sessions/${occurrence.sessionId}`);
                        }}
                      >
                        Play
                      </NeoButton>
                    ) : (
                      <span className="whitespace-nowrap text-[11px] text-[#80868b]">
                        {replayStateLabel[occurrence.replayState]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {(page.nextCursor || page.error) && (
              <div className="flex items-center justify-between gap-3 border-t border-[#e8eaed] px-4 py-3">
                {page.error ? <p className="text-xs font-medium text-[#c5221f]">{page.error}</p> : <span />}
                {page.nextCursor && (
                  <NeoButton
                    variant="secondary"
                    size="sm"
                    leftIcon={page.isLoading ? <Loader size={13} className="animate-spin" /> : undefined}
                    disabled={page.isLoading}
                    onClick={(event) => {
                      event.stopPropagation();
                      void loadMoreOccurrences(row);
                    }}
                  >
                    Load more
                  </NeoButton>
                )}
              </div>
            )}
          </>
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
            <NeoCard variant="flat" disablePadding className="overflow-hidden">
              <div className={PANEL_HEADER_CLASS}>
                <h4 className={PANEL_TITLE_CLASS}>
                  <Code size={14} className={PANEL_ICON_CLASS} />
                  Stack trace
                </h4>
                <div className="flex items-center gap-1.5">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={copiedKey === `${row.key}:stack` ? <Check size={13} /> : <Copy size={13} />}
                    onClick={(event) => handleCopyText(stackTrace, `${row.key}:stack`, event)}
                    disabled={!stackTrace}
                  >
                    Copy
                  </NeoButton>
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<Download size={13} />}
                    onClick={(event) => handleDownloadText(stackTrace, row.source.sampleCrashId, 'crash-trace', event)}
                    disabled={!stackTrace}
                  >
                    Save
                  </NeoButton>
                </div>
              </div>

              {!detailLoaded ? (
                <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-[#5f6368]">
                  <Loader size={18} className="animate-spin" />
                  Loading crash details...
                </div>
              ) : stackTrace ? (
                <div className={STACK_BLOCK_CLASS}>
                  {stackTrace}
                </div>
              ) : (
                <div className="bg-[#f8fafd] px-6 py-10 text-center text-sm text-[#5f6368]">No stack trace captured.</div>
              )}
            </NeoCard>

            {renderOccurrencesCard(row)}

            <div className="flex flex-wrap gap-4 text-xs">
              <div className={CONTEXT_CHIP_CLASS}>
                <Smartphone size={12} className="text-[#80868b]" />
                <span className="font-medium text-[#5f6368]">Device:</span>
                <span title={detail?.deviceMetadata?.model || row.deviceModel}>
                  {formatDeviceModel(detail?.deviceMetadata?.model || row.deviceModel, 'Unknown')}
                </span>
              </div>
              <div className={CONTEXT_CHIP_CLASS}>
                <Activity size={12} className="text-[#80868b]" />
                <span className="font-medium text-[#5f6368]">OS:</span>
                {detail?.deviceMetadata?.systemName || 'Unknown'} {detail?.deviceMetadata?.systemVersion || ''}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-1">
            {renderIssueSummaryCard(row, 'Crash summary')}
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
            <NeoCard variant="flat" disablePadding className="overflow-hidden">
              <div className={PANEL_HEADER_CLASS}>
                <h4 className={PANEL_TITLE_CLASS}>
                  <Code size={14} className={PANEL_ICON_CLASS} />
                  Stack trace
                </h4>
                <div className="flex items-center gap-1.5">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={copiedKey === `${row.key}:stack` ? <Check size={13} /> : <Copy size={13} />}
                    onClick={(event) => handleCopyText(stackTrace, `${row.key}:stack`, event)}
                    disabled={!stackTrace}
                  >
                    Copy
                  </NeoButton>
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<Download size={13} />}
                    onClick={(event) => handleDownloadText(stackTrace, row.source.fingerprint, 'error-trace', event)}
                    disabled={!stackTrace}
                  >
                    Save
                  </NeoButton>
                </div>
              </div>

              {stackTrace ? (
                <div className={STACK_BLOCK_CLASS}>
                  {stackTrace}
                </div>
              ) : (
                <div className="bg-[#f8fafd] px-6 py-10 text-center text-sm text-[#5f6368]">No stack trace captured for this occurrence.</div>
              )}
            </NeoCard>

            {renderOccurrencesCard(row)}

            <div className="flex flex-wrap gap-4 text-xs">
              <div className={CONTEXT_CHIP_CLASS}>
                <Smartphone size={12} className="text-[#80868b]" />
                <span className="font-medium text-[#5f6368]">Device:</span>
                <span title={row.deviceModel}>{row.deviceLabel}</span>
              </div>
              {row.screenName && (
                <div className={CONTEXT_CHIP_CLASS}>
                  <Activity size={12} className="text-[#80868b]" />
                  <span className="font-medium text-[#5f6368]">Screen:</span>
                  {row.screenName}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-1">
            {renderIssueSummaryCard(row, 'Error summary', [
              { label: 'Fingerprint', value: row.source.fingerprint },
            ])}
          </div>
        </div>
      );
    }

    if (row.kind === 'api_spikes') {
    const spike = row.source;
    const rateChangeLabel = formatApiRateChange(spike);
    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <div className="flex flex-col gap-4 lg:col-span-3">
          {/* Trend chart */}
          <NeoCard variant="flat" disablePadding className="overflow-hidden">
            <div className={PANEL_HEADER_CLASS}>
              <h4 className={PANEL_TITLE_CLASS}>
                <TrendingUp size={14} className={PANEL_ICON_CLASS} />
                API error rate, 90 min window
              </h4>
              <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                {spike.previousRate.toFixed(1)}% → {spike.currentRate.toFixed(1)}% ({rateChangeLabel})
              </span>
            </div>
            <DetailedApiSpikeChart spike={spike} rateChangeLabel={rateChangeLabel} />
          </NeoCard>

          {/* Top failing endpoints */}
          {spike.topEndpoints.length > 0 && (
            <NeoCard variant="flat" disablePadding className="overflow-hidden">
              <div className="border-b border-[#e8eaed] px-4 py-2.5">
                <h4 className={PANEL_TITLE_CLASS}>
                  <Wifi size={14} className={PANEL_ICON_CLASS} />
                  Top failing endpoints
                </h4>
              </div>
              <div className="divide-y divide-[#e8eaed]">
                {spike.topEndpoints.map((ep, i) => {
                  const endpointPattern = endpointPatternFromTopEndpoint(ep);
                  const isIgnored = ignoredEndpointPatterns.some((pattern) => pattern.toLowerCase() === endpointPattern.toLowerCase());
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`shrink-0 font-mono ${dashboardChipClass('neutral')}`}>
                        {ep.method}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#3c4043]" title={ep.endpoint}>
                        {ep.endpoint}
                      </span>
                      <span className={`shrink-0 tabular-nums ${dashboardChipClass('danger')}`}>
                        {ep.errorCount} errors
                      </span>
                      <NeoButton
                        variant="ghost"
                        size="sm"
                        leftIcon={<Plus size={12} />}
                        disabled={isIgnored || isSavingIgnoredEndpoints}
                        onClick={(event) => handleIgnoreEndpoint(ep, event)}
                        className="shrink-0"
                      >
                        {isIgnored ? 'Ignored' : 'Ignore'}
                      </NeoButton>
                    </div>
                  );
                })}
              </div>
            </NeoCard>
          )}

          <NeoCard variant="flat" disablePadding className="overflow-hidden">
            <div className={PANEL_HEADER_CLASS}>
              <h4 className={PANEL_TITLE_CLASS}>
                <X size={14} className={PANEL_ICON_CLASS} />
                Ignored endpoints
              </h4>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  list="stability-recorded-api-endpoints"
                  value={selectedEndpointPattern}
                  onChange={(event) => setSelectedEndpointPattern(event.target.value)}
                  disabled={availableEndpointOptions.length === 0 || isSavingIgnoredEndpoints}
                  placeholder={availableEndpointOptions.length === 0 ? 'No recorded endpoints available' : 'Search recorded endpoints'}
                  className={ENDPOINT_INPUT_CLASS}
                />
                <NeoButton
                  variant="primary"
                  size="md"
                  leftIcon={isSavingIgnoredEndpoints ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
                  disabled={!selectedEndpointOption || isSavingIgnoredEndpoints}
                  onClick={handleAddSelectedIgnoredEndpoint}
                >
                  Add
                </NeoButton>
              </div>
              {ignoredEndpointPatterns.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {ignoredEndpointPatterns.map((pattern) => (
                    <button
                      key={pattern}
                      type="button"
                      onClick={(event) => handleRemoveIgnoredEndpoint(pattern, event)}
                      disabled={isSavingIgnoredEndpoints}
                      className={IGNORED_PATTERN_CHIP_CLASS}
                    >
                      <span className="truncate">{pattern}</span>
                      <X size={12} className="shrink-0 text-[#80868b]" />
                    </button>
                  ))}
                </div>
              )}
              {ignoreSettingsError && <p className="text-xs font-medium text-[#c5221f]">{ignoreSettingsError}</p>}
            </div>
          </NeoCard>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-1">
          <NeoCard variant="flat" disablePadding className="p-4">
            <h4 className="mb-3 border-b border-[#e8eaed] pb-2 text-sm font-medium text-[#202124]">
              Spike properties
            </h4>
            <dl className="space-y-3 text-xs">
              <div>
                <dt className="mb-0.5 text-[#5f6368]">Detected at</dt>
                <dd className="font-medium tabular-nums text-[#202124]">{new Date(spike.detectedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="mb-0.5 text-[#5f6368]">Error rate</dt>
                <dd className="font-medium tabular-nums text-[#202124]">{spike.currentRate.toFixed(1)}% <span className="text-[#80868b]">(was {spike.previousRate.toFixed(1)}%)</span></dd>
              </div>
              <div>
                <dt className="mb-0.5 text-[#5f6368]">Change</dt>
                <dd className="font-medium tabular-nums text-[#d93025]">{rateChangeLabel}</dd>
              </div>
              <div>
                <dt className="mb-0.5 text-[#5f6368]">API calls in window</dt>
                <dd className="font-medium tabular-nums text-[#202124]">{spike.affectedSessions.toLocaleString()}</dd>
              </div>
            </dl>
          </NeoCard>
          <NeoCard variant="flat" disablePadding className="p-4">
            <p className="mb-2 text-sm font-medium text-[#202124]">What is this?</p>
            <p className="text-xs leading-relaxed text-[#3c4043]">
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
          <NeoCard variant="flat" disablePadding className="overflow-hidden">
            <div className={PANEL_HEADER_CLASS}>
              <h4 className={PANEL_TITLE_CLASS}>
                <Code size={14} className={PANEL_ICON_CLASS} />
                Main thread state
              </h4>
              <div className="flex items-center gap-1.5">
                <NeoButton
                  variant="ghost"
                  size="sm"
                  leftIcon={copiedKey === `${row.key}:thread` ? <Check size={13} /> : <Copy size={13} />}
                  onClick={(event) => handleCopyText(threadState, `${row.key}:thread`, event)}
                  disabled={!threadState}
                >
                  Copy
                </NeoButton>
                <NeoButton
                  variant="ghost"
                  size="sm"
                  leftIcon={<Download size={13} />}
                  onClick={(event) => handleDownloadText(threadState, row.source.id, 'anr-thread', event)}
                  disabled={!threadState}
                >
                  Save
                </NeoButton>
              </div>
            </div>

            {threadState ? (
              <div className={STACK_BLOCK_CLASS}>
                {threadState}
              </div>
            ) : (
              <div className="bg-[#f8fafd] px-6 py-10 text-center text-sm text-[#5f6368]">No thread state captured.</div>
            )}
          </NeoCard>

          {renderOccurrencesCard(row)}

          <div className="flex flex-wrap gap-4 text-xs">
            <div className={CONTEXT_CHIP_CLASS}>
              <Smartphone size={12} className="text-[#80868b]" />
              <span className="font-medium text-[#5f6368]">Device:</span>
              <span title={row.deviceModel}>{row.deviceLabel}</span>
            </div>
            <div className={CONTEXT_CHIP_CLASS}>
              <Activity size={12} className="text-[#80868b]" />
              <span className="font-medium text-[#5f6368]">OS:</span>
              {row.source.deviceMetadata?.osVersion || 'Unknown'}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-1">
          {renderIssueSummaryCard(row, 'ANR summary', [
            { label: 'Block duration', value: `${row.durationMs}ms` },
          ])}
        </div>
      </div>
    );
  };

  const renderMobileIssueDetailSheet = (row: StabilityIssueRow) => {
    const meta = KIND_META[row.kind];
    const isExpanded = mobileIssueDetailSize === 'expanded';

    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`${meta.label} issue details`}
        className={`fixed inset-x-2 bottom-2 z-[70] flex flex-col overflow-hidden rounded-none border border-[#dadce0] bg-white shadow-lg transition-[max-height] duration-200 ease-out sm:hidden ${
          isExpanded ? 'max-h-[calc(100dvh-1rem)]' : 'max-h-[54dvh]'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[#e8eaed] bg-white px-3 pb-2.5 pt-2">
          <div className="mx-auto mb-2 h-1 w-12 rounded-none bg-[#dadce0]" aria-hidden="true" />
          <div className="flex min-w-0 items-center gap-2">
            <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-[#5f6368]">{meta.label} detail</div>
              <div className="truncate text-sm font-medium text-[#202124]" title={row.title}>
                {row.title}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileIssueDetailSize(isExpanded ? 'compact' : 'expanded')}
              className={dashboardButtonClass('secondary', 'sm')}
              aria-pressed={isExpanded}
              aria-label={isExpanded ? 'Reduce issue detail sheet' : 'Expand issue detail sheet'}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span>{isExpanded ? 'Reduce' : 'Expand'}</span>
            </button>
            <button
              type="button"
              onClick={() => setExpandedIssueKey(null)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124]"
              aria-label="Close issue detail"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f8fafd] p-3">
          {renderExpandedContent(row)}
        </div>
      </div>
    );
  };

  const shouldShowInitialGhost = useInitialDashboardLoad(isLoading || projectsLoading);

  const stabilityKpiCards = useMemo<KpiCardItem[]>(() => {
    const sessionRate = stabilitySummary.totalSessions > 0
      ? `${stabilitySummary.crashFreeSessionRate.toFixed(2)}%`
      : '—';
    const userRate = stabilitySummary.totalUsers > 0
      ? `${stabilitySummary.crashFreeUserRate.toFixed(2)}%`
      : '—';

    return [
      {
        id: 'crash-free-sessions',
        label: 'Crash-free sessions',
        value: sessionRate,
        sortValue: stabilitySummary.crashFreeSessionRate,
        info: 'Share of sessions in the selected window without a captured native crash.',
        comparisonText: stabilitySummary.totalSessions > 0
          ? `${formatCompact(stabilitySummary.crashFreeSessions)} of ${formatCompact(stabilitySummary.totalSessions)} sessions`
          : 'No sessions in this window',
      },
      {
        id: 'crash-free-users',
        label: 'Crash-free users',
        value: userRate,
        sortValue: stabilitySummary.crashFreeUserRate,
        info: 'Share of identified or anonymous users in the selected window without a captured native crash.',
        comparisonText: stabilitySummary.totalUsers > 0
          ? `${formatCompact(stabilitySummary.crashFreeUsers)} of ${formatCompact(stabilitySummary.totalUsers)} users`
          : 'No users in this window',
      },
      {
        id: 'stability-issues',
        label: 'Stability issues',
        value: formatCompact(stabilitySummary.issues),
        sortValue: stabilitySummary.issues,
        info: 'Distinct crashes, runtime errors, and ANRs grouped by their canonical fingerprint.',
        comparisonText: 'Grouped root-cause candidates',
      },
      {
        id: 'stability-events',
        label: 'Events',
        value: formatCompact(stabilitySummary.events),
        sortValue: stabilitySummary.events,
        info: 'Captured Stability occurrences after duplicate delivery paths are merged.',
        comparisonText: 'Deduplicated occurrences',
      },
      {
        id: 'affected-sessions',
        label: 'Affected sessions',
        value: formatCompact(stabilitySummary.sessions),
        sortValue: stabilitySummary.sessions,
        info: 'Distinct sessions represented by the Stability issues in this window.',
        comparisonText: 'Open any issue to inspect every session',
      },
      {
        id: 'complete-diagnostics',
        label: 'Complete diagnostics',
        value: formatCompact(stabilitySummary.completeDiagnostics),
        sortValue: stabilitySummary.completeDiagnostics,
        info: 'Issues with a usable stack trace plus sufficient app, OS, and device context.',
        comparisonText: `${formatCompact(stabilitySummary.completeDiagnostics)} of ${formatCompact(stabilitySummary.issues)} issues`,
        comparisonClassName: stabilitySummary.incompleteDiagnostics > 0 ? 'text-[#b06000]' : 'text-[#137333]',
      },
    ];
  }, [stabilitySummary]);

  if (shouldShowInitialGhost) {
    return <DashboardGhostLoader variant="list" />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-8">
      <DashboardPageHeader
        title="Stability"
        subtitle="Crashes, runtime errors, and ANRs ordered by latest event"
        {...dashboardPageHeaderProps('stability')}
      >
        <DashboardLensControls timeRange={timeRange} onTimeRangeChange={setTimeRange} />
      </DashboardPageHeader>

      <div className="mx-auto w-full max-w-[1800px] px-6 pt-6">
        <KpiCardsGrid
          cards={stabilityKpiCards}
          timeRange={timeRange}
          storageKey="stability-overview"
          showControls={false}
          className="mb-4"
          gridClassName="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6"
        />

        {failedSections.length > 0 && (
          <div role="alert" className="mb-4 flex flex-col gap-3 rounded-none border border-[#feefc3] bg-[#fef7e0] px-4 py-3 text-[#b06000] sm:flex-row sm:items-center">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[#b06000]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Some Stability data could not be loaded</p>
              <p className="mt-0.5 text-xs text-[#3c4043]">
                Unavailable: {failedSections.join(', ')}. Existing results are partial and are not being presented as “no issues.”
              </p>
            </div>
            <NeoButton
              variant="secondary"
              size="sm"
              onClick={() => setRetryVersion((version) => version + 1)}
              className="shrink-0"
            >
              Retry
            </NeoButton>
          </div>
        )}

        <NeoCard variant="flat" disablePadding className="overflow-hidden">
          <div className="flex items-center gap-3 overflow-x-auto border-b border-[#e8eaed] bg-white px-4 py-3">
            <datalist id="stability-recorded-api-endpoints">
              {availableEndpointOptions.map((option) => (
                <option key={option.pattern} value={option.pattern} label={formatEndpointOptionLabel(option)} />
              ))}
            </datalist>
            <div className="relative w-80 shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#80868b]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search stability issues..."
                  className="w-full rounded-none border border-[#dadce0] bg-white py-1.5 pl-9 pr-3 text-sm text-[#202124] outline-none transition-colors placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
                />
              </div>

              <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap" aria-label="Stability issue type filters">
                <button
                  type="button"
                  onClick={() => updateKindFilter([])}
                  aria-pressed={activeKindSet.size === 0}
                  className={filterChipClass(activeKindSet.size === 0)}
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
                      aria-pressed={selected}
                      className={filterChipClass(selected)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {meta.plural}
                      <span className={`rounded-none px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${selected ? 'bg-white text-[#1967d2]' : 'bg-[#f1f3f4] text-[#5f6368]'}`}>
                        {formatCompact(kindCounts[kind])}
                      </span>
                    </button>
                  );
                })}
              </div>

            <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-[#5f6368]">
              <button
                type="button"
                aria-pressed={isIgnoredEndpointPanelOpen}
                onClick={() => setIsIgnoredEndpointPanelOpen((open) => !open)}
                className={toggleButtonClass(isIgnoredEndpointPanelOpen)}
              >
                <SlidersHorizontal size={13} className="shrink-0" />
                Ignored endpoints
                {ignoredEndpointPatterns.length > 0 && (
                  <span className={`rounded-none px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${isIgnoredEndpointPanelOpen ? 'bg-white text-[#1967d2]' : 'bg-[#f1f3f4] text-[#5f6368]'}`}>
                    {ignoredEndpointPatterns.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {isIgnoredEndpointPanelOpen && (
            <div className="border-b border-[#e8eaed] bg-white px-4 py-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0 space-y-2">
                  <div>
                    <h3 className={PANEL_TITLE_CLASS}>
                      <SlidersHorizontal size={14} className={PANEL_ICON_CLASS} />
                      Ignored API endpoints
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-[#5f6368]">
                      Select from API endpoints already recorded for this project.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      list="stability-recorded-api-endpoints"
                      value={selectedEndpointPattern}
                      onChange={(event) => setSelectedEndpointPattern(event.target.value)}
                      disabled={availableEndpointOptions.length === 0 || isSavingIgnoredEndpoints}
                      placeholder={availableEndpointOptions.length === 0 ? 'No recorded endpoints available' : 'Search recorded endpoints'}
                      className={ENDPOINT_INPUT_CLASS}
                    />
                    <NeoButton
                      variant="primary"
                      size="md"
                      leftIcon={isSavingIgnoredEndpoints ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
                      disabled={!selectedEndpointOption || isSavingIgnoredEndpoints}
                      onClick={handleAddSelectedIgnoredEndpoint}
                    >
                      Add
                    </NeoButton>
                  </div>
                  {ignoredEndpointPatterns.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {ignoredEndpointPatterns.map((pattern) => (
                        <button
                          key={pattern}
                          type="button"
                          onClick={(event) => handleRemoveIgnoredEndpoint(pattern, event)}
                          disabled={isSavingIgnoredEndpoints}
                          className={IGNORED_PATTERN_CHIP_CLASS}
                        >
                          <span className="truncate">{pattern}</span>
                          <X size={12} className="shrink-0 text-[#80868b]" />
                        </button>
                      ))}
                    </div>
                  )}
                  {ignoreSettingsError && <p className="text-xs font-medium text-[#c5221f]">{ignoreSettingsError}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<X size={13} />}
                    onClick={() => setIsIgnoredEndpointPanelOpen(false)}
                  >
                    Close
                  </NeoButton>
                </div>
              </div>
            </div>
          )}

          <div className="border-b border-[#e8eaed] bg-white px-4">
            <div className="flex items-center gap-4 py-3 text-xs font-medium text-[#5f6368]">
              <div className="w-24 shrink-0">Type</div>
              <div className="min-w-0 flex-1">Issue details</div>
              <div className="hidden w-32 md:block">Environment</div>
              <div className="hidden w-24 text-right sm:block">First seen</div>
              <div className="hidden w-24 text-right lg:block">Last event</div>
              <div className="w-16 text-right">Events</div>
              <div className="w-16 text-right">Users</div>
              <div className="hidden w-16 text-right xl:block">Sessions</div>
              <div className="w-8 shrink-0" />
            </div>
          </div>

          <div className="divide-y divide-[#e8eaed] bg-white">
            {filteredRows.length === 0 && failedSections.length === 0 && (
              <div className="py-24 text-center text-[#5f6368]">
                <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-[#dadce0]" />
                <p className="text-base font-medium text-[#202124]">No stability issues found</p>
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
                  className={`transition-colors ${isExpanded ? 'bg-[#f8fafd]' : 'hover:bg-[#f8fafd]'}`}
                >
                  <div
                    className="group/row flex cursor-pointer items-center gap-4 px-4 py-3"
                    onClick={() => handleIssueRowClick(row, isExpanded)}
                  >
                    <div className="flex w-24 shrink-0 items-center gap-2">
                      <div className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${isExpanded ? meta.dotClass : `bg-[#dadce0] ${meta.hoverDotClass}`}`} />
                      <NeoBadge variant={meta.badge} size="sm">
                        {meta.label}
                      </NeoBadge>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[13px] font-medium text-[#202124]" title={row.title}>
                          {row.title}
                        </h3>
                        {row.kind === 'errors' && row.screenName && (
                          <span className="hidden rounded-none bg-[#f1f3f4] px-1.5 py-0.5 text-[11px] font-medium text-[#5f6368] xl:inline-block">
                            {row.screenName}
                          </span>
                        )}
                        {row.kind === 'anrs' && (
                          <span className="hidden rounded-none bg-[#f3e8fd] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[#8430ce] xl:inline-block">
                            {Math.round(row.durationMs / 100) / 10}s block
                          </span>
                        )}
                        {row.diagnosticState === 'incomplete' && (
                          <span className="hidden rounded-none bg-[#fce8e6] px-1.5 py-0.5 text-[11px] font-medium text-[#c5221f] xl:inline-block">
                            Incomplete
                          </span>
                        )}
                        {row.symbolicationState === 'missing_symbols' && (
                          <span className="hidden rounded-none bg-[#fef7e0] px-1.5 py-0.5 text-[11px] font-medium text-[#b06000] xl:inline-block">
                            Symbols missing
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[#5f6368]" title={row.subtitle}>
                        {row.subtitle}
                      </p>
                    </div>

                    <div className="hidden w-32 shrink-0 md:block">
                      {row.kind === 'api_spikes' ? (
                        <ApiSpikeTrendline spike={row.source} height={28} />
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <span className="block max-w-full truncate rounded-none bg-[#f1f3f4] px-1.5 py-0.5 text-[11px] font-medium leading-4 text-[#3c4043]" title={row.deviceModel}>
                            {row.deviceLabel}
                          </span>
                          <span className="block max-w-full truncate rounded-none bg-[#f1f3f4] px-1.5 py-0.5 text-[11px] font-medium leading-4 tabular-nums text-[#3c4043]">v{row.appVersion}</span>
                        </div>
                      )}
                    </div>

                    <div className="hidden w-24 text-right sm:block">
                      <span className="text-xs tabular-nums text-[#5f6368]" title={new Date(row.firstSeen).toLocaleString()}>
                        {formatAge(row.firstSeen)}
                      </span>
                    </div>

                    <div className="hidden w-24 text-right lg:block">
                      <span className="text-xs font-medium tabular-nums text-[#3c4043]" title={new Date(row.lastOccurred).toLocaleString()}>
                        {formatLastSeen(row.lastOccurred)}
                      </span>
                    </div>

                    <div className="w-16 text-right">
                      <span className="inline-block text-xs font-medium tabular-nums text-[#202124]">
                        {formatCompact(row.eventCount)}
                      </span>
                    </div>

                    <div className="w-16 text-right">
                      <span className="inline-block text-xs tabular-nums text-[#3c4043]">
                        {formatCompact(row.userCount)}
                      </span>
                    </div>

                    <div className="hidden w-16 text-right xl:block">
                      <span className="inline-block text-xs tabular-nums text-[#3c4043]">
                        {formatCompact(row.sessionCount)}
                      </span>
                    </div>

                    <div className="flex w-8 shrink-0 justify-end">
                      <div
                        className={`flex h-6 w-6 items-center justify-center rounded-none text-[#80868b] transition ${
                          isExpanded ? 'rotate-180 bg-[#f1f3f4] text-[#202124]' : 'group-hover/row:bg-[#f1f3f4] group-hover/row:text-[#3c4043]'
                        }`}
                      >
                        <ChevronDown size={14} />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <>
                      {renderMobileIssueDetailSheet(row)}
                      <div className="hidden cursor-default border-t border-[#e8eaed] bg-[#f8fafd] p-4 sm:block sm:p-5">
                        {renderExpandedContent(row)}
                      </div>
                    </>
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
