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
  getANRsOverview,
  getApiEndpointStats,
  getApiErrorSpikes,
  getCrashesOverview,
  getErrorsOverview,
  getProjectAlertSettings,
  updateProjectAlertSettings,
} from '~/shared/api/client';
import { platformLensToSessionPlatform, useSharedPlatformLens } from '~/shared/hooks/useSharedPlatformLens';
import { formatAge, formatLastSeen } from '~/shared/lib/formatDates';
import { formatDeviceModel, getDeviceModelSearchText } from '~/shared/lib/deviceModelNames';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import { DashboardGhostLoader, useInitialDashboardLoad } from '~/shared/ui/core/DashboardGhostLoader';
import { DashboardLensControls } from '~/shared/ui/core/DashboardLensControls';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { NeoButton } from '~/shared/ui/core/neo/NeoButton';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
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
    return <p className="text-sm text-slate-400">Not enough data to render trend.</p>;
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
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Baseline</div>
          <div className="mt-1 font-mono text-sm font-bold text-slate-800">{spike.previousRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-wide text-red-400">Current</div>
          <div className="mt-1 font-mono text-sm font-bold text-red-700">{spike.currentRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-wide text-sky-500">Calls</div>
          <div className="mt-1 font-mono text-sm font-bold text-sky-800">{spike.affectedSessions.toLocaleString()}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Peak</div>
          <div className="mt-1 font-mono text-sm font-bold text-slate-800">{chart.peakPoint.bucket.errorRate.toFixed(1)}%</div>
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
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {tickRates.map((rate) => {
            const y = chart.margin.top + (1 - rate / chart.yMax) * chart.plotHeight;
            return (
              <g key={rate.toFixed(2)}>
                <line x1={chart.margin.left} x2={chart.width - chart.margin.right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray={rate === 0 ? undefined : '3 4'} />
                <text x={chart.margin.left - 10} y={y + 3} textAnchor="end" className="fill-slate-400 text-[9px] font-semibold">
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
            stroke="#f97316"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
          <text x={chart.width - chart.margin.right} y={Math.max(12, chart.baselineY - 6)} textAnchor="end" className="fill-orange-600 text-[9px] font-bold">
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
                  rx={2}
                  fill="#bae6fd"
                />
                <rect
                  x={point.x - 5}
                  y={chart.margin.top + chart.plotHeight + 6 + (34 - point.errorShareHeight)}
                  width={10}
                  height={point.errorShareHeight}
                  rx={2}
                  fill="#fb7185"
                />
              </g>
            ))}
          </g>

          <path d={chart.areaPath} fill={`url(#${gradientId})`} />
          <path d={chart.linePath} fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

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
                  fill={isPeak ? '#ef4444' : isCurrent ? '#0284c7' : '#0ea5e9'}
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

          <line x1={tooltip.x} x2={tooltip.x} y1={chart.margin.top} y2={chart.margin.top + chart.plotHeight + 40} stroke="#0f172a" strokeOpacity="0.18" strokeDasharray="3 3" />
          <g transform={`translate(${tooltipX}, ${tooltipY})`} pointerEvents="none">
            <rect width={tooltipWidth} height={72} rx={8} fill="white" stroke="#cbd5e1" filter="drop-shadow(0 8px 18px rgba(15,23,42,0.12))" />
            <text x={10} y={17} className="fill-slate-500 text-[9px] font-bold uppercase tracking-wide">
              {new Date(tooltip.bucket.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
            <text x={10} y={36} className="fill-slate-950 text-[14px] font-bold">
              {tooltip.bucket.errorRate.toFixed(1)}% error rate
            </text>
            <text x={10} y={54} className="fill-slate-600 text-[10px] font-semibold">
              {tooltip.bucket.errorCount.toLocaleString()} errors / {tooltip.bucket.totalCount.toLocaleString()} calls
            </text>
            <text x={10} y={66} className={`text-[9px] font-bold ${activeDelta >= 0 ? 'fill-red-600' : 'fill-emerald-600'}`}>
              {activeDelta >= 0 ? '+' : ''}{activeDelta.toFixed(1)} pts vs baseline
            </text>
          </g>

        </svg>
        <div
          className="mx-auto mt-2 grid max-w-full grid-cols-[1fr_auto_1fr] items-center gap-3 text-[9px] font-semibold text-slate-400"
          style={{ width: chart.width }}
        >
          <span className="truncate">
            {new Date(spike.trend[0].bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="whitespace-nowrap font-bold text-red-500">peak {chart.peakPoint.bucket.errorRate.toFixed(1)}%</span>
          <span className="truncate text-right">
            {new Date(spike.trend[spike.trend.length - 1].bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2 text-[10px] font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> Error rate</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-sky-200" /> API calls</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-rose-400" /> Errors</span>
        <span className="inline-flex items-center gap-1"><span className="h-px w-5 border-t border-dashed border-orange-500" /> Baseline</span>
        <span className="ml-auto text-sky-700">{spike.previousRate.toFixed(1)}% → {spike.currentRate.toFixed(1)}% ({rateChangeLabel})</span>
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

  useEffect(() => {
    const projectId = currentProject?.id || (isDemoMode ? 'demo' : '');
    if (!projectId) {
      setCrashGroups([]);
      setErrorGroups([]);
      setAnrs([]);
      setApiSpikes([]);
      setIgnoredEndpointPatterns([]);
      setRecordedEndpointOptions([]);
      setSelectedEndpointPattern('');
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
      getApiEndpointStats(projectId, 'all'),
      isDemoMode
        ? Promise.resolve({ ignoredApiEndpoints: [] } as unknown as Awaited<ReturnType<typeof getProjectAlertSettings>>)
        : getProjectAlertSettings(projectId),
    ]).then(([crashesResult, errorsResult, anrsResult, spikesResult, endpointStatsResult, alertSettingsResult]) => {
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
      }

      if (alertSettingsResult.status === 'fulfilled') {
        const patterns = normalizeIgnoredEndpointPatterns(alertSettingsResult.value.ignoredApiEndpoints || []);
        setIgnoredEndpointPatterns(patterns);
        setIgnoreSettingsError(null);
      } else {
        setIgnoredEndpointPatterns([]);
      }
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, isDemoMode, manualRefreshVersion, timeRange, platform]);

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
    const rateChangeLabel = formatApiRateChange(spike);
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
                {spike.previousRate.toFixed(1)}% → {spike.currentRate.toFixed(1)}% ({rateChangeLabel})
              </span>
            </div>
            <DetailedApiSpikeChart spike={spike} rateChangeLabel={rateChangeLabel} />
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
                {spike.topEndpoints.map((ep, i) => {
                  const endpointPattern = endpointPatternFromTopEndpoint(ep);
                  const isIgnored = ignoredEndpointPatterns.some((pattern) => pattern.toLowerCase() === endpointPattern.toLowerCase());
                  return (
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
                      <NeoButton
                        variant="ghost"
                        size="sm"
                        leftIcon={<Plus size={12} />}
                        disabled={isIgnored || isSavingIgnoredEndpoints}
                        onClick={(event) => handleIgnoreEndpoint(ep, event)}
                        className="h-7 shrink-0 px-2 text-xs"
                      >
                        {isIgnored ? 'Ignored' : 'Ignore'}
                      </NeoButton>
                    </div>
                  );
                })}
              </div>
            </NeoCard>
          )}

          <NeoCard variant="flat" disablePadding className="overflow-hidden border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
                <X size={14} className="text-sky-500" />
                Ignored Endpoints
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
                  className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 font-mono text-xs text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                />
                <NeoButton
                  variant="primary"
                  size="sm"
                  leftIcon={isSavingIgnoredEndpoints ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
                  disabled={!selectedEndpointOption || isSavingIgnoredEndpoints}
                  onClick={handleAddSelectedIgnoredEndpoint}
                  className="h-9 justify-center px-3 text-xs"
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
                      className="inline-flex max-w-full items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white disabled:opacity-60"
                    >
                      <span className="truncate">{pattern}</span>
                      <X size={12} className="shrink-0 text-slate-400" />
                    </button>
                  ))}
                </div>
              )}
              {ignoreSettingsError && <p className="text-xs font-medium text-red-600">{ignoreSettingsError}</p>}
            </div>
          </NeoCard>
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
                <dt className="mb-0.5 text-slate-500">Change</dt>
                <dd className="font-bold text-red-600">{rateChangeLabel}</dd>
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

  const renderMobileIssueDetailSheet = (row: StabilityIssueRow) => {
    const meta = KIND_META[row.kind];
    const isExpanded = mobileIssueDetailSize === 'expanded';

    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`${meta.label} issue details`}
        className={`fixed inset-x-2 bottom-2 z-[70] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 transition-[max-height] duration-200 ease-out sm:hidden ${
          isExpanded ? 'max-h-[calc(100dvh-1rem)]' : 'max-h-[54dvh]'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 pb-2.5 pt-2">
          <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-slate-300" aria-hidden="true" />
          <div className="flex min-w-0 items-center gap-2">
            <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dotClass}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{meta.label} detail</div>
              <div className="truncate text-sm font-semibold text-slate-950" title={row.title}>
                {row.title}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileIssueDetailSize(isExpanded ? 'compact' : 'expanded')}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 transition hover:border-slate-300 hover:bg-white"
              aria-pressed={isExpanded}
              aria-label={isExpanded ? 'Reduce issue detail sheet' : 'Expand issue detail sheet'}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span>{isExpanded ? 'Reduce' : 'Expand'}</span>
            </button>
            <button
              type="button"
              onClick={() => setExpandedIssueKey(null)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Close issue detail"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/60 p-3">
          {renderExpandedContent(row)}
        </div>
      </div>
    );
  };

  const shouldShowInitialGhost = useInitialDashboardLoad(isLoading || projectsLoading);

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
        <NeoCard variant="flat" disablePadding className="overflow-hidden bg-white">
          <div className="flex items-center gap-3 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 py-3">
            <datalist id="stability-recorded-api-endpoints">
              {availableEndpointOptions.map((option) => (
                <option key={option.pattern} value={option.pattern} label={formatEndpointOptionLabel(option)} />
              ))}
            </datalist>
            <div className="relative w-80 shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search stability issues..."
                  className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
              </div>

              <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap" aria-label="Stability issue type filters">
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

            <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-500">
              <NeoButton
                variant="ghost"
                size="sm"
                leftIcon={<SlidersHorizontal size={13} />}
                onClick={() => setIsIgnoredEndpointPanelOpen((open) => !open)}
                className={`h-8 whitespace-nowrap border px-2.5 text-xs ${isIgnoredEndpointPanelOpen ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
              >
                Ignored endpoints
                {ignoredEndpointPatterns.length > 0 && (
                  <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isIgnoredEndpointPanelOpen ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {ignoredEndpointPatterns.length}
                  </span>
                )}
              </NeoButton>
            </div>
          </div>

          {isIgnoredEndpointPanelOpen && (
            <div className="border-b border-slate-200 bg-white px-4 py-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0 space-y-2">
                  <div>
                    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-700">
                      <SlidersHorizontal size={14} className="text-sky-500" />
                      Ignored API Endpoints
                    </h3>
                    <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
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
                      className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 font-mono text-xs text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <NeoButton
                      variant="primary"
                      size="sm"
                      leftIcon={isSavingIgnoredEndpoints ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
                      disabled={!selectedEndpointOption || isSavingIgnoredEndpoints}
                      onClick={handleAddSelectedIgnoredEndpoint}
                      className="h-9 justify-center px-3 text-xs sm:w-auto"
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
                          className="inline-flex max-w-full items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white disabled:opacity-60"
                        >
                          <span className="truncate">{pattern}</span>
                          <X size={12} className="shrink-0 text-slate-400" />
                        </button>
                      ))}
                    </div>
                  )}
                  {ignoreSettingsError && <p className="text-xs font-medium text-red-600">{ignoreSettingsError}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <NeoButton
                    variant="ghost"
                    size="sm"
                    leftIcon={<X size={13} />}
                    onClick={() => setIsIgnoredEndpointPanelOpen(false)}
                    className="h-8 px-3 text-xs"
                  >
                    Close
                  </NeoButton>
                </div>
              </div>
            </div>
          )}

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
                    onClick={() => handleIssueRowClick(row, isExpanded)}
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
                    <>
                      {renderMobileIssueDetailSheet(row)}
                      <div className="hidden cursor-default border-t border-slate-200 bg-slate-50/50 p-4 shadow-inner sm:block sm:p-5">
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
