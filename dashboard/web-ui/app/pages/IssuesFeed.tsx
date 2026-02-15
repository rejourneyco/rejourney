import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router';
import { useSessionData } from '../context/SessionContext';
import { useDemoMode } from '../context/DemoModeContext';
import { usePathPrefix } from '../hooks/usePathPrefix';
import {
  Search,
  CheckCircle,
  Key,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Play,
  ExternalLink,
  AlertTriangle,
  Copy,
  ClipboardCheck,
  Loader,
  Plus,
  Activity,
  Check,
} from 'lucide-react';
import { TimeRange, TimeFilter } from '../components/ui/TimeFilter';
import { NeoButton } from '../components/ui/neo/NeoButton';
import { NeoCard } from '../components/ui/neo/NeoCard';
import { NeoBadge } from '../components/ui/neo/NeoBadge';
import { DashboardPageHeader } from '../components/ui/DashboardPageHeader';
import { ModernPhoneFrame } from '../components/ui/ModernPhoneFrame';
import { MiniSessionCard } from '../components/ui/MiniSessionCard';

import { api } from '../services/api';
import * as demoApiData from '../data/demoApiData';
import { API_BASE_URL } from '../config';
import { Issue, IssueSession } from '../types';

// Format relative time like "3min ago"
function formatLastSeen(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

// Format age like "3mo" or "2wk"
function formatAge(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays < 1) return '<1d';
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}wk`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

const SPARKLINE_POINTS_BY_RANGE: Record<TimeRange, number> = {
  '24h': 14,
  '7d': 14,
  '30d': 30,
  '90d': 90,
  'all': 90,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const toUtcDayStart = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const toUtcDateKey = (date: Date): string =>
  date.toISOString().slice(0, 10);

const parseDailyCount = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const buildSparklineSeries = (
  data: Record<string, number> | undefined,
  timeRange: TimeRange,
): { series: number[]; start: Date; end: Date } => {
  const pointCount = SPARKLINE_POINTS_BY_RANGE[timeRange] ?? 30;
  const today = toUtcDayStart(new Date());
  const start = new Date(today.getTime() - (pointCount - 1) * ONE_DAY_MS);

  const counts = new Map<string, number>();
  if (data) {
    for (const [date, rawCount] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const count = parseDailyCount(rawCount);
      if (count > 0) counts.set(date, count);
    }
  }

  const series: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    const date = new Date(start.getTime() + i * ONE_DAY_MS);
    series.push(counts.get(toUtcDateKey(date)) ?? 0);
  }

  return { series, start, end: today };
};

// Sparkline component (kept local as it's simple)
const Sparkline: React.FC<{
  data?: Record<string, number>;
  color?: string;
  timeRange: TimeRange;
  releaseMarkerDate?: string | null;
  releaseLabel?: string | null;
}> = ({
  data,
  color = '#6366f1',
  timeRange,
  releaseMarkerDate,
  releaseLabel,
}) => {
    const { series: rawValues, start, end } = buildSparklineSeries(data, timeRange);
    const values = rawValues.map((value) => Math.sqrt(value));
    const max = Math.max(...values, 1);
    const range = max;

    const pointTuples = values.map((val, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * 100;
      const normalizedY = val / range;
      const y = 24 - (normalizedY * 20 + 2);
      return { x, y };
    });

    const points = pointTuples.map((point) => `${point.x},${point.y}`).join(' ');
    const firstX = pointTuples[0]?.x ?? 0;
    const lastX = pointTuples[pointTuples.length - 1]?.x ?? 100;
    const areaLine = pointTuples.map((point) => `${point.x},${point.y}`).join(' L');
    const areaPath = `M${firstX},24 L${areaLine} L${lastX},24 Z`;
    const hasSignal = rawValues.some((value) => value > 0);

    let releaseMarkerX: number | null = null;
    let releaseMarkerHint: 'before' | 'after' | 'within' | null = null;
    if (releaseMarkerDate) {
      const parsed = new Date(releaseMarkerDate);
      if (!Number.isNaN(parsed.getTime())) {
        const markerDay = toUtcDayStart(parsed);
        const markerIndex = Math.round((markerDay.getTime() - start.getTime()) / ONE_DAY_MS);
        const clampedIndex = Math.max(0, Math.min(values.length - 1, markerIndex));
        releaseMarkerX = (clampedIndex / Math.max(values.length - 1, 1)) * 100;
        // Keep marker slightly inset so it doesn't get clipped at chart edges.
        releaseMarkerX = Math.max(1, Math.min(99, releaseMarkerX));

        if (markerDay < start) releaseMarkerHint = 'before';
        else if (markerDay > end) releaseMarkerHint = 'after';
        else releaseMarkerHint = 'within';
      }
    }

    const releaseTag = releaseLabel?.trim() ? releaseLabel.trim() : null;
    const releaseTagText = releaseTag && releaseTag.length > 10 ? `${releaseTag.slice(0, 9)}…` : releaseTag;
    const releaseTagWidth = releaseTagText ? releaseTagText.length * 2.8 + 4 : 0;
    const placeTagOnRight = releaseMarkerX !== null && releaseTagText
      ? releaseMarkerX + releaseTagWidth + 1 <= 99
      : true;
    const releaseTagRectX = releaseMarkerX !== null
      ? (placeTagOnRight ? releaseMarkerX + 1 : releaseMarkerX - releaseTagWidth - 1)
      : 0;
    const releaseTagTextX = releaseMarkerX !== null
      ? (placeTagOnRight ? releaseMarkerX + 2.2 : releaseMarkerX - 2.2)
      : 0;
    const releaseTagAnchor: 'start' | 'end' = placeTagOnRight ? 'start' : 'end';

    return (
      <div className="h-8 w-24">
        <svg width="100%" height="100%" viewBox="0 0 100 24" preserveAspectRatio="none" className="overflow-visible">
          {releaseMarkerX !== null && (
            <g>
              <line
                x1={releaseMarkerX}
                y1={2}
                x2={releaseMarkerX}
                y2={22}
                stroke="#0f172a"
                strokeWidth="1.2"
                strokeDasharray="2 2"
                opacity={0.65}
              />
              <circle cx={releaseMarkerX} cy={3} r={1.3} fill="#0f172a" opacity={0.75} />
              {releaseTagText && (
                <>
                  <rect
                    x={releaseTagRectX}
                    y={2}
                    width={releaseTagWidth}
                    height={5.8}
                    rx={1}
                    fill="#ffffff"
                    fillOpacity={0.9}
                    stroke="#0f172a"
                    strokeWidth={0.35}
                  />
                  <text
                    x={releaseTagTextX}
                    y={6.3}
                    textAnchor={releaseTagAnchor}
                    fill="#0f172a"
                    fontSize={3.8}
                    fontWeight={700}
                  >
                    {releaseTagText}
                  </text>
                </>
              )}
              {releaseLabel && (
                <title>
                  {releaseMarkerHint === 'before'
                    ? `${releaseLabel} released before selected window`
                    : releaseMarkerHint === 'after'
                      ? `${releaseLabel} released after selected window`
                      : `${releaseLabel} first seen`}
                </title>
              )}
            </g>
          )}
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={hasSignal ? 1 : 0.35}
          />
          <path
            d={areaPath}
            fill={color}
            fillOpacity={hasSignal ? 0.1 : 0.04}
            stroke="none"
          />
        </svg>
      </div>
    );
  };

export const IssuesFeed: React.FC = () => {
  const { selectedProject, projects, isLoading: projectsLoading } = useSessionData();
  const { isDemoMode } = useDemoMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const pathPrefix = usePathPrefix();

  // State
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState({ unresolved: 0, resolved: 0, ignored: 0 });
  const [totalIssues, setTotalIssues] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Expanded state and sessions for expanded issue
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<IssueSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [expandedIssueDetail, setExpandedIssueDetail] = useState<{ stackTrace?: string } | null>(null);
  const [issueDetailLoading, setIssueDetailLoading] = useState(false);
  const [copiedStackId, setCopiedStackId] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [timeRange, setTimeRange] = useState<TimeRange>((searchParams.get('timeRange') as TimeRange) || '30d');
  const [selectedType, setSelectedType] = useState<string | null>(searchParams.get('type') || null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unresolved' | 'resolved'>(searchParams.get('status') as any || 'all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'users' | 'events'>(searchParams.get('sort') as any || 'newest');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Track status overrides for optimistic UI updates
  const [statusOverrides, setStatusOverrides] = useState<Record<string, Issue['status']>>({});

  const [copiedKey, setCopiedKey] = useState(false);

  // Fetch sessions and issue detail when an issue is expanded
  useEffect(() => {
    if (!expandedId) {
      setExpandedSessions([]);
      setExpandedIssueDetail(null);
      return;
    }

    const fetchData = async () => {
      setSessionsLoading(true);
      setIssueDetailLoading(true);
      try {
        const [sessionsData, issueDetail] = await Promise.all([
          api.getIssueSessions(expandedId, 6),
          // Only fetch detail if it's a crash/error/anr type
          (() => {
            const issue = issues.find(i => i.id === expandedId);
            if (issue && (issue.issueType === 'crash' || issue.issueType === 'error' || issue.issueType === 'anr')) {
              return api.getIssue(expandedId).catch(() => null);
            }
            return Promise.resolve(null);
          })()
        ]);
        setExpandedSessions(sessionsData.sessions || []);
        if (issueDetail) {
          setExpandedIssueDetail({ stackTrace: issueDetail.sampleStackTrace });
        }
      } catch (err) {
        setExpandedSessions([]);
        setExpandedIssueDetail(null);
      } finally {
        setSessionsLoading(false);
        setIssueDetailLoading(false);
      }
    };

    fetchData();
  }, [expandedId, issues]);

  const handleCopyKey = () => {
    if (selectedProject?.publicKey) {
      navigator.clipboard.writeText(selectedProject.publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleCopyStack = (issueId: string, stackTrace?: string) => {
    if (stackTrace) {
      navigator.clipboard.writeText(stackTrace);
      setCopiedStackId(issueId);
      setTimeout(() => setCopiedStackId(null), 2000);
    }
  };

  const syncIssues = useCallback(async () => {
    // Skip sync in demo mode
    if (isDemoMode) return;
    if (!selectedProject?.id) return;
    setIsSyncing(true);
    try {
      await api.syncIssues(selectedProject.id);
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [selectedProject?.id, isDemoMode]);

  const fetchIssues = useCallback(async () => {
    // Demo mode: use static demo data
    if (isDemoMode) {
      setIssues(demoApiData.demoIssuesResponse.issues);
      setStats(demoApiData.demoIssuesResponse.stats);
      setTotalIssues(demoApiData.demoIssuesResponse.total);
      setIsLoading(false);
      return;
    }

    if (!selectedProject?.id) return;
    setIsLoading(true);
    try {
      const data = await api.getIssues(selectedProject.id, timeRange, searchQuery, selectedType || undefined);
      setIssues(data.issues);
      setStats(data.stats);
      setTotalIssues(typeof data.total === 'number' ? data.total : data.issues.length);
      // Do NOT auto-expand - let user click to expand
    } catch (err) {
      setIssues([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject?.id, timeRange, searchQuery, selectedType, isDemoMode]);

  const typeCounts = useMemo(() => {
    return issues.reduce(
      (acc, issue) => {
        acc[issue.issueType] = (acc[issue.issueType] ?? 0) + 1;
        return acc;
      },
      {} as Record<Issue['issueType'], number>
    );
  }, [issues]);

  useEffect(() => {
    // In demo mode, fetch immediately without waiting for project
    if (isDemoMode) {
      fetchIssues();
      return;
    }
    syncIssues().then(() => fetchIssues());
  }, [selectedProject?.id, isDemoMode]);

  useEffect(() => {
    if (!isLoading) fetchIssues();
  }, [timeRange, searchQuery, selectedType]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (timeRange !== '30d') params.set('timeRange', timeRange);
    if (selectedType) params.set('type', selectedType);
    setSearchParams(params, { replace: true });
  }, [searchQuery, timeRange, selectedType, setSearchParams]);

  const handleNavigate = (issue: Issue) => {
    // Navigate to the issue detail page for error, crash, and ANR types
    if (issue.issueType === 'anr' || issue.issueType === 'crash' || issue.issueType === 'error') {
      navigate(`${pathPrefix}/issues/${issue.id}`);
    } else {
      // Other types (insights) don't have detail pages yet
      navigate(`${pathPrefix}/issues`);
    }
  };

  // Get effective status for an issue (with overrides applied)
  const getEffectiveStatus = (issue: Issue): Issue['status'] => {
    return statusOverrides[issue.id] ?? issue.status;
  };

  // Toggle resolved/unresolved status with optimistic UI update
  const handleResolveToggle = async (issue: Issue, e: React.MouseEvent) => {
    e.stopPropagation();
    if (resolvingId) return; // Prevent double-clicks

    const currentStatus = getEffectiveStatus(issue);
    const newStatus: Issue['status'] = currentStatus === 'resolved' ? 'unresolved' : 'resolved';

    // Optimistic update - immediately update UI via override
    setStatusOverrides(prev => ({ ...prev, [issue.id]: newStatus }));
    setResolvingId(issue.id);

    // Update stats optimistically
    setStats(prev => {
      if (newStatus === 'resolved') {
        return { ...prev, resolved: prev.resolved + 1, unresolved: Math.max(0, prev.unresolved - 1) };
      } else {
        return { ...prev, resolved: Math.max(0, prev.resolved - 1), unresolved: prev.unresolved + 1 };
      }
    });

    try {
      await api.updateIssue(issue.id, { status: newStatus });
      // Success - keep the override in place
    } catch (err) {
      console.error('Failed to update issue status:', err);
      // Revert on failure
      setStatusOverrides(prev => {
        const updated = { ...prev };
        delete updated[issue.id];
        return updated;
      });
      // Revert stats
      setStats(prev => {
        if (newStatus === 'resolved') {
          return { ...prev, resolved: Math.max(0, prev.resolved - 1), unresolved: prev.unresolved + 1 };
        } else {
          return { ...prev, resolved: prev.resolved + 1, unresolved: Math.max(0, prev.unresolved - 1) };
        }
      });
    } finally {
      setResolvingId(null);
    }
  };

  // Get the correct link for an issue based on type
  const getIssueLink = (issue: Issue): string => {
    // Standard issue types -> issue detail page
    if (issue.issueType === 'anr' || issue.issueType === 'crash' || issue.issueType === 'error') {
      return `${pathPrefix}/issues/${issue.id}`;
    }
    // Insight types -> relevant analytics pages with search context
    else if (issue.issueType === 'api_latency') {
      // Link to API analytics with the endpoint as search
      const endpoint = issue.culprit || '';
      return `${pathPrefix}/analytics/api?search=${encodeURIComponent(endpoint)}`;
    } else if (issue.issueType === 'ux_friction') {
      // Link to Journeys page with screen search
      const screenName = issue.culprit || '';
      return `${pathPrefix}/analytics/journeys?search=${encodeURIComponent(screenName)}`;
    } else if (issue.issueType === 'performance') {
      // Link to Devices page for startup analysis
      return `${pathPrefix}/analytics/devices`;
    } else if (issue.issueType === 'rage_tap') {
      // Rage taps link to the specific session if available
      if (issue.sampleSessionId) {
        return `${pathPrefix}/sessions/${issue.sampleSessionId}`;
      }
      return `${pathPrefix}/sessions`;
    }
    // Fallback for unknown types
    return `${pathPrefix}/issues`;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-black">
      {/* Unified Sticky Header Container */}
      <div className="sticky top-0 z-50 bg-white border-b-2 border-black">
        {/* Main Header */}
        <DashboardPageHeader
          title="Issues Feed"
          subtitle="Live stream of detected anomalies"
          icon={<AlertTriangle className="w-6 h-6" />}
          iconColor="bg-amber-400"
        >
          <div className="relative max-w-xs w-full hidden md:block group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black group-focus-within:text-indigo-600 transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH ISSUES..."
              className="w-full pl-10 pr-4 py-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-lg font-bold text-sm uppercase placeholder:text-slate-400 focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all"
            />
          </div>
          <TimeFilter value={timeRange} onChange={setTimeRange} />
        </DashboardPageHeader>

        {/* Secondary Filter Bar */}
        <div className="bg-white border-b-2 border-slate-100 px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2 mr-4">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Type:</span>
              <div className="flex gap-1">
                {[
                  { type: 'crash', label: 'Crashes', count: typeCounts.crash ?? 0, variant: 'danger' as const },
                  { type: 'error', label: 'Errors', count: typeCounts.error ?? 0, variant: 'warning' as const },
                  { type: 'anr', label: 'ANRs', count: typeCounts.anr ?? 0, variant: 'anr' as const },
                  { type: 'rage_tap', label: 'Rage', count: typeCounts.rage_tap ?? 0, variant: 'rage' as const },
                  { type: 'api_latency', label: 'API', count: typeCounts.api_latency ?? 0, variant: 'neutral' as const },
                  { type: 'ux_friction', label: 'UX', count: typeCounts.ux_friction ?? 0, variant: 'neutral' as const },
                  { type: 'performance', label: 'Perf', count: typeCounts.performance ?? 0, variant: 'neutral' as const },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => setSelectedType(selectedType === item.type ? null : item.type)}
                    className={`transition-all ${selectedType === item.type ? 'brightness-90 translate-y-[1px]' : 'hover:-translate-y-[1px] hover:shadow-sm'}`}
                  >
                    <NeoBadge variant={item.variant} size="sm" className={selectedType === item.type ? 'ring-2 ring-black ring-offset-1' : ''}>
                      {item.label} {item.count}
                    </NeoBadge>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="text-xs font-bold uppercase px-2 py-1 border-2 border-black rounded bg-white cursor-pointer hover:bg-slate-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all"
            >
              <option value="all">All Status</option>
              <option value="unresolved">Unresolved</option>
              <option value="resolved">Resolved</option>
            </select>
            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-xs font-bold uppercase px-2 py-1 border-2 border-black rounded bg-white cursor-pointer hover:bg-slate-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="users">Most Users</option>
              <option value="events">Most Events</option>
            </select>
            <div className="h-4 w-[2px] bg-slate-200" />
            <div className="text-slate-400 uppercase font-black tracking-tighter">
              Total: <span className="text-black font-mono">{issues.length}</span>
            </div>
          </div>
        </div>

        {/* Table Header */}
        <div className="bg-slate-50/50 px-6">
          <div className="flex items-center py-2 text-[10px] font-black text-black uppercase tracking-wider gap-4">
            <div className="w-6 flex-shrink-0"></div>
            <div className="w-4 flex-shrink-0"></div>
            <div className="flex-1 min-w-0">Issue</div>
            <div className="hidden md:block w-20 text-right">Last Seen</div>
            <div className="hidden md:block w-16 text-right">Age</div>
            <div className="hidden md:block w-24 text-center px-2">Trend</div>
            <div className="w-16 text-right">Events</div>
            <div className="w-16 text-right">Users</div>
            <div className="w-10"></div>
          </div>
        </div>
      </div>

      <div className="bg-white">
        {/* Compute filtered and sorted issues */}
        {(() => {
          const filteredAndSortedIssues = issues
            .filter(issue => {
              const effectiveStatus = getEffectiveStatus(issue);
              if (statusFilter === 'unresolved') return effectiveStatus !== 'resolved';
              if (statusFilter === 'resolved') return effectiveStatus === 'resolved';
              return true;
            })
            .sort((a, b) => {
              switch (sortBy) {
                case 'newest':
                  return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
                case 'oldest':
                  return new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
                case 'users':
                  return b.userCount - a.userCount;
                case 'events':
                  return b.eventCount - a.eventCount;
                default:
                  return 0;
              }
            });

          if (filteredAndSortedIssues.length === 0 && !isLoading) {
            // Show different message for users with no projects vs no issues
            if (!projectsLoading && projects.length === 0) {
              return (
                <div className="py-16 text-center text-slate-400">
                  <div className="max-w-md mx-auto">
                    <div className="w-16 h-16 mx-auto mb-6 bg-slate-100 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center">
                      <Plus className="w-8 h-8 text-black" />
                    </div>
                    <h3 className="text-xl font-black text-black mb-2 uppercase">Welcome to Rejourney!</h3>
                    <p className="text-sm text-slate-500 mb-6">
                      Create your first project to start monitoring your mobile app's sessions, crashes, and user experience.
                    </p>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('openAddProjectModal'))}
                      className="bg-black text-white px-6 py-3 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all font-black uppercase text-sm tracking-wider"
                    >
                      Create Your First Project
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div className="py-16 text-center text-slate-400">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-bold">No issues found</p>
                <p className="text-sm">Issues will appear here when they are detected</p>
              </div>
            );
          }

          return filteredAndSortedIssues.map((issue) => {
            const isExpanded = expandedId === issue.id;
            const typeColor = issue.issueType === 'crash' ? 'bg-red-500' :
              issue.issueType === 'error' ? 'bg-amber-500' :
                issue.issueType === 'anr' ? 'bg-purple-500' :
                  issue.issueType === 'api_latency' ? 'bg-blue-500' :
                    issue.issueType === 'ux_friction' ? 'bg-orange-500' :
                      issue.issueType === 'performance' ? 'bg-cyan-500' : 'bg-slate-400';
            const sparklineColor = issue.issueType === 'crash' ? '#ef4444' :
              issue.issueType === 'error' ? '#f59e0b' :
                issue.issueType === 'anr' ? '#8b5cf6' :
                  issue.issueType === 'api_latency' ? '#3b82f6' :
                    issue.issueType === 'ux_friction' ? '#f97316' :
                      issue.issueType === 'performance' ? '#06b6d4' : '#64748b';

            // Insight types navigate directly instead of expanding
            const isInsightType = ['api_latency', 'ux_friction', 'performance', 'rage_tap'].includes(issue.issueType);

            return (
              <div key={issue.id} className="border-b border-slate-100">

                {/* Row */}
                <div
                  className={`flex items-center py-3 px-6 gap-4 cursor-pointer group/row transition-colors ${isExpanded ? 'bg-slate-50/50' : 'hover:bg-slate-50/50'} ${getEffectiveStatus(issue) === 'resolved' ? 'opacity-50' : ''}`}
                  onClick={() => setExpandedId(isExpanded ? null : issue.id)}
                >

                  {/* Resolve Checkbox - Left side like a todo */}
                  <button
                    onClick={(e) => handleResolveToggle(issue, e)}
                    disabled={resolvingId === issue.id}
                    className={`w-6 h-6 flex-shrink-0 flex items-center justify-center border-2 border-black rounded-sm transition-all ${getEffectiveStatus(issue) === 'resolved'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white hover:bg-slate-100'
                      } ${resolvingId === issue.id ? 'opacity-50 cursor-wait' : 'hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'}`}
                    title={getEffectiveStatus(issue) === 'resolved' ? 'Mark as unresolved' : 'Mark as resolved'}
                  >
                    {resolvingId === issue.id ? (
                      <Loader className="w-3 h-3 animate-spin" />
                    ) : getEffectiveStatus(issue) === 'resolved' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : null}
                  </button>

                  {/* Type Color Dot */}
                  <div className="w-4 flex-shrink-0 flex justify-center">
                    <div className={`w-3 h-3 border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${typeColor}`} />
                  </div>

                  {/* Issue Info (Left) */}
                  <div className="flex-1 min-w-0">
                    <Link
                      to={getIssueLink(issue)}
                      className="inline-block group/link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-extrabold text-sm truncate group-hover/link:underline decoration-2 underline-offset-2 ${getEffectiveStatus(issue) === 'resolved' ? 'text-slate-500 line-through' : 'text-black'}`}>
                          {issue.title}
                        </h3>
                      </div>
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="border-l-2 border-black pl-2 truncate max-w-[300px] font-mono text-[10px]">
                        {issue.subtitle || issue.culprit || 'No details'}
                      </span>
                      <NeoBadge variant={
                        issue.issueType === 'crash' ? 'danger' :
                          issue.issueType === 'error' ? 'warning' :
                            issue.issueType === 'anr' ? 'anr' :
                              issue.issueType === 'api_latency' ? 'neutral' :
                                issue.issueType === 'ux_friction' ? 'rage' :
                                  issue.issueType === 'performance' ? 'neutral' : 'neutral'
                      } size="sm">
                        {issue.issueType.replace('_', ' ')}
                      </NeoBadge>
                    </div>
                  </div>

                  {/* Last Seen */}
                  <div className="hidden md:block w-20 text-right">
                    <span className="text-xs text-slate-600">{formatLastSeen(issue.lastSeen)}</span>
                  </div>

                  {/* Age */}
                  <div className="hidden md:block w-16 text-right">
                    <span className="text-xs text-slate-400">{formatAge(issue.firstSeen)}</span>
                  </div>

                  {/* Trend Sparkline */}
                  <div className="hidden md:flex w-24 h-6 items-center justify-center">
                    <Sparkline
                      data={issue.dailyEvents}
                      color={sparklineColor}
                      timeRange={timeRange}
                      releaseMarkerDate={issue.sampleAppVersionFirstSeenAt ?? (issue.sampleAppVersion ? issue.firstSeen : null)}
                      releaseLabel={issue.sampleAppVersion ? `v${issue.sampleAppVersion}` : null}
                    />
                  </div>

                  {/* Events */}
                  <div className="w-16 text-right">
                    <span className="text-sm font-black text-black font-mono bg-slate-100 border border-slate-300 px-1 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                      {issue.eventCount >= 1000 ? (issue.eventCount / 1000).toFixed(1) + 'k' : issue.eventCount}
                    </span>
                  </div>

                  {/* Users */}
                  <div className="w-16 text-right">
                    <span className="text-sm font-black text-black font-mono bg-indigo-100 border border-indigo-300 px-1 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                      {issue.userCount >= 1000 ? (issue.userCount / 1000).toFixed(1) + 'k' : issue.userCount}
                    </span>
                  </div>

                  {/* Expand Toggle */}
                  <div className="w-10 flex justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(isExpanded ? null : issue.id);
                      }}
                      className={`w-8 h-8 flex items-center justify-center border-2 border-transparent transition-all ${isExpanded ? 'bg-black text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] rotate-180' : 'text-slate-400 group-hover/row:border-black group-hover/row:bg-white group-hover/row:text-black group-hover/row:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                        }`}
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </div>

                {/* Expanded Section - Detailed Issue Summary & Sessions */}
                {isExpanded && (
                  <div className="px-6 py-8 bg-slate-50/80 border-t border-slate-100">
                    <div className="max-w-7xl mx-auto">

                      {/* Mission Control Header */}
                      <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-4">
                          <NeoBadge variant={
                            issue.issueType === 'crash' ? 'danger' :
                              issue.issueType === 'error' ? 'warning' :
                                issue.issueType === 'anr' ? 'anr' :
                                  issue.issueType === 'api_latency' ? 'neutral' :
                                    issue.issueType === 'ux_friction' ? 'rage' :
                                      issue.issueType === 'performance' ? 'neutral' : 'neutral'
                          } size="md">
                            {issue.issueType.replace('_', ' ').toUpperCase()}
                          </NeoBadge>
                          <div className="h-6 w-[2px] bg-black" />
                          <div className="flex gap-8">
                            <div className="flex flex-col">
                              <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Affected Users</span>
                              <span className="text-xl font-black text-black font-mono">{issue.userCount.toLocaleString()}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Total Events</span>
                              <span className="text-xl font-black text-black font-mono">{issue.eventCount.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <Link to={getIssueLink(issue)}>
                            <NeoButton size="md" variant="primary" rightIcon={<ExternalLink size={16} />}>
                              Deep Analysis
                            </NeoButton>
                          </Link>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

                        {/* LEFT: Diagnostic Context (2x2 Grid) */}
                        <div className="lg:col-span-5">
                          <h4 className="text-[10px] font-black text-black uppercase tracking-widest mb-4 flex items-center gap-2">
                            <AlertTriangle size={14} className="text-black" /> Diagnostic Context
                          </h4>

                          <div className="grid grid-cols-2 gap-4">
                            {/* Card 1: Affected Devices */}
                            <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-4">Affected Devices</h5>
                              <div className="space-y-3">
                                {issue.affectedDevices && Object.keys(issue.affectedDevices).length > 0 ? (
                                  Object.entries(issue.affectedDevices)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 4)
                                    .map(([device, count]) => (
                                      <div key={device} className="flex justify-between items-end border-b border-slate-100 pb-1 last:border-0 last:pb-0">
                                        <span className="text-xs font-bold text-black truncate max-w-[120px]">{device}</span>
                                        <span className="text-[10px] font-mono text-black bg-slate-100 border border-black px-1.5 py-0.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{count}</span>
                                      </div>
                                    ))
                                ) : (
                                  <span className="text-xs text-slate-300 font-bold">No device data</span>
                                )}
                              </div>
                            </div>

                            {/* Card 2: Affected Versions */}
                            <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-4">Affected Versions</h5>
                              <div className="space-y-3">
                                {issue.affectedVersions && Object.keys(issue.affectedVersions).length > 0 ? (
                                  Object.entries(issue.affectedVersions)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 4)
                                    .map(([version, count]) => (
                                      <div key={version} className="flex justify-between items-end border-b border-slate-100 pb-1 last:border-0 last:pb-0">
                                        <span className="text-xs font-bold text-black">{version}</span>
                                        <span className="text-[10px] font-mono text-black bg-slate-100 border border-black px-1.5 py-0.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{count}</span>
                                      </div>
                                    ))
                                ) : (
                                  <span className="text-xs text-slate-300 font-bold">No version data</span>
                                )}
                              </div>
                            </div>

                            {/* Card 3: First Seen */}
                            <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-2">First Seen</h5>
                              <div className="text-lg font-black tracking-tighter text-black leading-none py-1">
                                {new Date(issue.firstSeen).toLocaleDateString()}
                              </div>
                            </div>

                            {/* Card 4: Last Seen */}
                            <div className="bg-white p-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                              <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-2">Last Seen</h5>
                              <div className="text-lg font-black tracking-tighter text-black leading-none py-1">
                                {formatLastSeen(issue.lastSeen)}
                              </div>
                            </div>
                          </div>

                          {/* Stack Trace Preview - Only for Crash/Error/ANR */}
                          {(issue.issueType === 'crash' || issue.issueType === 'error' || issue.issueType === 'anr') && (
                            <div className="mt-6">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-[10px] font-black text-black uppercase tracking-widest flex items-center gap-2">
                                  <Activity size={12} className="text-black" />
                                  {issue.issueType === 'anr' ? 'Main Thread State' : 'Stack Trace Preview'}
                                </h4>
                                {expandedIssueDetail?.stackTrace && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCopyStack(issue.id, expandedIssueDetail.stackTrace);
                                    }}
                                    className="flex items-center gap-1 text-[9px] font-black uppercase text-slate-500 hover:text-black transition-colors"
                                  >
                                    {copiedStackId === issue.id ? (
                                      <>
                                        <Check size={10} className="text-green-600" />
                                        <span>Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy size={10} />
                                        <span>Copy</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                              {issueDetailLoading ? (
                                <div className="bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] p-4">
                                  <div className="flex items-center gap-2 text-xs text-slate-400">
                                    <Loader size={12} className="animate-spin" />
                                    <span>Loading stack trace...</span>
                                  </div>
                                </div>
                              ) : expandedIssueDetail?.stackTrace ? (
                                <div className="bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] p-4">
                                  <div className="bg-slate-900 text-green-400 p-4 font-mono text-[10px] overflow-x-auto whitespace-pre border-2 border-black shadow-inner max-h-[200px] overflow-y-auto leading-relaxed">
                                    {expandedIssueDetail.stackTrace.split('\n').slice(0, 10).join('\n')}
                                    {expandedIssueDetail.stackTrace.split('\n').length > 10 && (
                                      <div className="mt-2 pt-2 border-t border-slate-700 text-slate-500 text-[9px] flex items-center justify-between">
                                        <span className="italic">... and {expandedIssueDetail.stackTrace.split('\n').length - 10} more lines</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] p-4 text-center">
                                  <span className="text-xs text-slate-400 font-bold">No stack trace available</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* RIGHT: Evidence Sample */}
                        <div className="lg:col-span-7">
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-[10px] font-black text-black uppercase tracking-widest flex items-center gap-2">
                              <Play size={14} className="text-indigo-500" /> Evidence Sample
                            </h4>
                          </div>

                          <NeoCard variant="flat" className="bg-slate-100 border-2 border-black !shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-8 min-h-[360px] flex items-center justify-center">
                            {sessionsLoading ? (
                              <div className="flex flex-col items-center gap-4">
                                <div className="w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin" />
                                <span className="text-[10px] font-black text-black uppercase tracking-widest">Hydrating Replays...</span>
                              </div>
                            ) : expandedSessions.length > 0 ? (
                              <div className="flex gap-8 overflow-x-auto pb-6 pt-2 px-2 hide-scrollbar w-full justify-start">
                                {expandedSessions.map((session) => (
                                  <div key={session.id} className="transform hover:-translate-y-2 hover:rotate-1 transition-all duration-300">
                                    <MiniSessionCard
                                      session={session}
                                      onClick={() => navigate(`${pathPrefix}/sessions/${session.id}`)}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center opacity-50">
                                <Play className="w-12 h-12 mx-auto mb-4 text-black" />
                                <p className="text-[10px] font-black text-black uppercase tracking-widest">No Replay Samples Available</p>
                              </div>
                            )}
                          </NeoCard>
                        </div>

                      </div>

                    </div>
                  </div>
                )
                }
              </div>
            );
          })
        })()}
      </div>
    </div >
  );
};

export default IssuesFeed;
