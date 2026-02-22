import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CircleAlert,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';
import { useSessionData } from '../context/SessionContext';
import { usePathPrefix } from '../hooks/usePathPrefix';
import { TimeFilter, TimeRange } from '../components/ui/TimeFilter';
import { DashboardPageHeader } from '../components/ui/DashboardPageHeader';
import { NeoButton } from '../components/ui/neo/NeoButton';
import { NeoCard } from '../components/ui/neo/NeoCard';
import { NeoBadge } from '../components/ui/neo/NeoBadge';
import { KpiCardItem, KpiCardsGrid, computePeriodDeltaFromSeries } from '../components/dashboard/KpiCardsGrid';
import { api } from '../services/api';
import { Issue, RecordingSession } from '../types';

const DEFAULT_TIME_RANGE: TimeRange = '30d';

const ISSUE_TYPE_BADGE_VARIANT: Record<Issue['issueType'], 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'anr' | 'rage' | 'dead_tap' | 'slow_start' | 'slow_api' | 'low_exp'> = {
  error: 'warning',
  crash: 'danger',
  anr: 'anr',
  rage_tap: 'rage',
  api_latency: 'slow_api',
  ux_friction: 'low_exp',
  performance: 'info',
};

const ISSUE_TYPE_COLOR: Record<Issue['issueType'], string> = {
  error: '#f59e0b',
  crash: '#ef4444',
  anr: '#8b5cf6',
  rage_tap: '#ec4899',
  api_latency: '#6366f1',
  ux_friction: '#f97316',
  performance: '#06b6d4',
};

const TIMELINE_POINTS_BY_RANGE: Record<TimeRange, number> = {
  '24h': 14,
  '7d': 14,
  '30d': 30,
  '90d': 45,
  all: 60,
};

interface UserReplayBucket {
  key: string;
  label: string;
  issueSignals: number;
  replayCount: number;
  totalDurationSeconds: number;
  latestStartedAt: string;
  sessions: RecordingSession[];
}

function isValidTimeRange(value: string | null): value is TimeRange {
  return value === '24h' || value === '7d' || value === '30d' || value === '90d' || value === 'all';
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatLastSeen(dateIso: string): string {
  const ts = new Date(dateIso).getTime();
  if (Number.isNaN(ts)) return 'unknown';
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function toDateKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function issueSignalsForSession(session: RecordingSession): number {
  return (
    (session.errorCount || 0)
    + (session.crashCount || 0)
    + (session.anrCount || 0)
    + (session.rageTapCount || 0)
  );
}

function sessionUserKey(session: RecordingSession): string {
  if (session.userId) return `user:${session.userId}`;
  if (session.anonymousId) return `anon:${session.anonymousId}`;
  if (session.anonymousDisplayName) return `anon_name:${session.anonymousDisplayName}`;
  if (session.deviceId) return `device:${session.deviceId}`;
  return `session:${session.id}`;
}

function sessionUserLabel(session: RecordingSession): string {
  if (session.userId) return session.userId;
  if (session.anonymousDisplayName) return session.anonymousDisplayName;
  if (session.anonymousId) return session.anonymousId;
  if (session.deviceId) return `Device ${session.deviceId.slice(-6)}`;
  return 'Anonymous user';
}

function aggregateIssueTimeline(issues: Issue[], timeRange: TimeRange): Array<{ date: string; value: number }> {
  const totals = new Map<string, number>();

  for (const issue of issues) {
    if (!issue.dailyEvents) continue;
    for (const [date, count] of Object.entries(issue.dailyEvents)) {
      const parsedCount = typeof count === 'number' ? count : Number(count);
      if (!Number.isFinite(parsedCount) || parsedCount <= 0) continue;
      totals.set(date, (totals.get(date) || 0) + parsedCount);
    }
  }

  const sorted = Array.from(totals.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));

  return sorted.slice(-TIMELINE_POINTS_BY_RANGE[timeRange]);
}

function buildIssueSparkline(dailyEvents?: Record<string, number>): number[] {
  if (!dailyEvents) return [];
  const values = Object.entries(dailyEvents)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([, raw]) => {
      const value = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    });

  return values;
}

const IssueSparkline: React.FC<{ dailyEvents?: Record<string, number>; color: string }> = ({ dailyEvents, color }) => {
  const values = buildIssueSparkline(dailyEvents);
  if (values.length === 0) {
    return <div className="h-8 rounded-md border border-dashed border-slate-200 bg-slate-50" />;
  }

  const max = Math.max(...values, 1);
  return (
    <div className="h-8 flex items-end gap-0.5">
      {values.map((value, index) => (
        <div
          key={index}
          title={`${value}`}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(8, (value / max) * 100)}%`,
            backgroundColor: color,
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
};

const EmptyStateCard: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <NeoCard className="border-dashed border-slate-300 bg-white">
    <div className="py-8 text-center">
      <p className="text-sm font-bold uppercase tracking-wide text-slate-700">{title}</p>
      <p className="mt-2 text-xs text-slate-500">{subtitle}</p>
    </div>
  </NeoCard>
);

export const IssuesFeed: React.FC = () => {
  const { selectedProject, isLoading: projectLoading } = useSessionData();
  const pathPrefix = usePathPrefix();
  const [searchParams, setSearchParams] = useSearchParams();

  const timeRangeParam = searchParams.get('range');
  const timeRange: TimeRange = isValidTimeRange(timeRangeParam) ? timeRangeParam : DEFAULT_TIME_RANGE;

  const [issues, setIssues] = useState<Issue[]>([]);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGeneral = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!selectedProject?.id) {
        setIssues([]);
        setSessions([]);
        setLoading(false);
        return;
      }

      if (mode === 'refresh') {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const [issueData, replayData] = await Promise.allSettled([
          api.getIssues(selectedProject.id, timeRange),
          api.getSessionsPaginated({
            projectId: selectedProject.id,
            timeRange,
            limit: 120,
          }),
        ]);

        const failedSections: string[] = [];

        if (issueData.status === 'fulfilled') {
          setIssues(issueData.value.issues || []);
        } else {
          failedSections.push('issues');
          setIssues([]);
        }

        if (replayData.status === 'fulfilled') {
          setSessions((replayData.value.sessions || []) as RecordingSession[]);
        } else {
          failedSections.push('replays');
          setSessions([]);
        }

        if (failedSections.length === 1) {
          setError(`Loaded partial data. Failed to load ${failedSections[0]}.`);
        } else if (failedSections.length > 1) {
          setError('Failed to load issues and replay analytics.');
        }
      } catch (err) {
        console.error('Failed to load general dashboard data:', err);
        setIssues([]);
        setSessions([]);
        setError(err instanceof Error ? err.message : 'Failed to load general analytics');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedProject?.id, timeRange],
  );

  useEffect(() => {
    if (projectLoading) return;
    loadGeneral('initial');
  }, [loadGeneral, projectLoading]);

  const handleTimeRangeChange = (nextRange: TimeRange) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextRange === DEFAULT_TIME_RANGE) {
      nextParams.delete('range');
    } else {
      nextParams.set('range', nextRange);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const topIssues = useMemo(() => {
    return [...issues]
      .sort((a, b) => {
        if (b.eventCount !== a.eventCount) return b.eventCount - a.eventCount;
        return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
      })
      .slice(0, 8);
  }, [issues]);

  const issueTypeMix = useMemo(() => {
    const counts = new Map<Issue['issueType'], number>();
    for (const issue of issues) {
      counts.set(issue.issueType, (counts.get(issue.issueType) || 0) + issue.eventCount);
    }

    return Array.from(counts.entries())
      .map(([issueType, count]) => ({ issueType, count }))
      .sort((a, b) => b.count - a.count);
  }, [issues]);

  const totalIssueEvents = useMemo(() => issues.reduce((sum, issue) => sum + issue.eventCount, 0), [issues]);

  const totalSignalsAcrossReplays = useMemo(
    () => sessions.reduce((sum, session) => sum + issueSignalsForSession(session), 0),
    [sessions],
  );

  const replaysWithSignals = useMemo(
    () => sessions.filter((session) => issueSignalsForSession(session) > 0),
    [sessions],
  );

  const topUsersWithReplays = useMemo(() => {
    const buckets = new Map<string, UserReplayBucket>();

    for (const session of sessions) {
      const key = sessionUserKey(session);
      const existing = buckets.get(key);
      const sessionSignals = issueSignalsForSession(session);

      if (!existing) {
        buckets.set(key, {
          key,
          label: sessionUserLabel(session),
          issueSignals: sessionSignals,
          replayCount: 1,
          totalDurationSeconds: session.durationSeconds || 0,
          latestStartedAt: session.startedAt,
          sessions: [session],
        });
        continue;
      }

      existing.issueSignals += sessionSignals;
      existing.replayCount += 1;
      existing.totalDurationSeconds += session.durationSeconds || 0;
      if (new Date(session.startedAt).getTime() > new Date(existing.latestStartedAt).getTime()) {
        existing.latestStartedAt = session.startedAt;
      }
      existing.sessions.push(session);
    }

    return Array.from(buckets.values())
      .map((bucket) => ({
        ...bucket,
        sessions: [...bucket.sessions].sort((a, b) => {
          const signalDiff = issueSignalsForSession(b) - issueSignalsForSession(a);
          if (signalDiff !== 0) return signalDiff;
          return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
        }),
      }))
      .sort((a, b) => {
        if (b.issueSignals !== a.issueSignals) return b.issueSignals - a.issueSignals;
        return b.replayCount - a.replayCount;
      })
      .slice(0, 6);
  }, [sessions]);

  const summaryStats = useMemo(() => {
    const unresolved = issues.filter((issue) => issue.status === 'unresolved' || issue.status === 'ongoing').length;
    const ongoing = issues.filter((issue) => issue.status === 'ongoing').length;
    const replayCoverage = sessions.length > 0 ? (replaysWithSignals.length / sessions.length) * 100 : 0;
    const avgSignals = sessions.length > 0 ? totalSignalsAcrossReplays / sessions.length : 0;

    return {
      unresolved,
      ongoing,
      replayCoverage,
      avgSignals,
    };
  }, [issues, replaysWithSignals.length, sessions.length, totalSignalsAcrossReplays]);

  const behaviorAnalytics = useMemo(() => {
    const timeline = aggregateIssueTimeline(issues, timeRange);
    const values = timeline.map((point) => point.value);

    const mean = values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    const variance = values.length > 0
      ? values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length
      : 0;
    const volatility = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0;

    const windowSize = Math.max(3, Math.floor(values.length / 3));
    const recentWindow = values.slice(-windowSize);
    const previousWindow = values.slice(-windowSize * 2, -windowSize);

    const recentSum = recentWindow.reduce((sum, value) => sum + value, 0);
    const previousSum = previousWindow.reduce((sum, value) => sum + value, 0);
    const momentum = previousSum > 0 ? ((recentSum - previousSum) / previousSum) * 100 : (recentSum > 0 ? 100 : 0);

    const now = Date.now();
    const recentIssues = issues.filter((issue) => {
      const firstSeen = new Date(issue.firstSeen).getTime();
      return Number.isFinite(firstSeen) && now - firstSeen <= 7 * 24 * 60 * 60 * 1000;
    }).length;

    const topThreeShare = totalIssueEvents > 0
      ? (topIssues.slice(0, 3).reduce((sum, issue) => sum + issue.eventCount, 0) / totalIssueEvents) * 100
      : 0;

    return {
      timeline,
      volatility,
      momentum,
      recentIssues,
      topThreeShare,
    };
  }, [issues, timeRange, topIssues, totalIssueEvents]);

  const maxTimelineValue = useMemo(
    () => Math.max(...behaviorAnalytics.timeline.map((entry) => entry.value), 1),
    [behaviorAnalytics.timeline],
  );

  const kpiCards = useMemo<KpiCardItem[]>(() => {
    const issueEventsSeries = behaviorAnalytics.timeline.map((entry) => entry.value);

    const issueGroupByDate = new Map<string, Set<string>>();
    for (const issue of issues) {
      for (const [date, count] of Object.entries(issue.dailyEvents || {})) {
        const parsedCount = typeof count === 'number' ? count : Number(count);
        if (!Number.isFinite(parsedCount) || parsedCount <= 0) continue;
        const existing = issueGroupByDate.get(date) || new Set<string>();
        existing.add(issue.id);
        issueGroupByDate.set(date, existing);
      }
    }
    const issueGroupSeries = Array.from(issueGroupByDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, issueSet]) => issueSet.size);

    const replayCountByDate = new Map<string, number>();
    for (const session of sessions) {
      const dateKey = toDateKey(session.startedAt);
      if (!dateKey) continue;
      replayCountByDate.set(dateKey, (replayCountByDate.get(dateKey) || 0) + 1);
    }
    const replaySeries = Array.from(replayCountByDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, count]) => count);

    const issueEventMap = new Map(behaviorAnalytics.timeline.map((entry) => [entry.date, entry.value]));
    const allDateKeys = new Set<string>([
      ...Array.from(issueEventMap.keys()),
      ...Array.from(replayCountByDate.keys()),
    ]);
    const signalDensitySeries = Array.from(allDateKeys)
      .sort((a, b) => a.localeCompare(b))
      .map((date) => {
        const issueCount = issueEventMap.get(date) || 0;
        const replayCount = replayCountByDate.get(date) || 0;
        if (replayCount <= 0) return 0;
        return issueCount / replayCount;
      });

    const trackedIssueDelta = computePeriodDeltaFromSeries(issueGroupSeries, timeRange, 'avg');
    const issueEventsDelta = computePeriodDeltaFromSeries(issueEventsSeries, timeRange, 'sum');
    const replayDelta = computePeriodDeltaFromSeries(replaySeries, timeRange, 'sum');
    const signalDensityDelta = computePeriodDeltaFromSeries(signalDensitySeries, timeRange, 'avg');

    return [
      {
        id: 'tracked-issues',
        label: 'Tracked Issues',
        value: compactNumber(issues.length),
        sortValue: issues.length,
        info: 'Unique issue groups active in this selected window.',
        detail: `${compactNumber(summaryStats.unresolved)} unresolved`,
        delta: trackedIssueDelta
          ? {
            value: trackedIssueDelta.deltaPct,
            label: trackedIssueDelta.comparisonLabel,
            betterDirection: 'down',
            precision: 1,
          }
          : undefined,
      },
      {
        id: 'issue-events',
        label: 'Issue Events',
        value: compactNumber(totalIssueEvents),
        sortValue: totalIssueEvents,
        info: 'Total issue event volume aggregated across all issue groups.',
        detail: `${compactNumber(summaryStats.ongoing)} ongoing now`,
        delta: issueEventsDelta
          ? {
            value: issueEventsDelta.deltaPct,
            label: issueEventsDelta.comparisonLabel,
            betterDirection: 'down',
            precision: 1,
          }
          : undefined,
      },
      {
        id: 'replays-scanned',
        label: 'Replays Scanned',
        value: compactNumber(sessions.length),
        sortValue: sessions.length,
        info: 'Replay sessions evaluated for issue and behavioral signals.',
        detail: `${summaryStats.replayCoverage.toFixed(0)}% with issue signals`,
        delta: replayDelta
          ? {
            value: replayDelta.deltaPct,
            label: replayDelta.comparisonLabel,
            betterDirection: 'up',
            precision: 1,
          }
          : undefined,
      },
      {
        id: 'signal-density',
        label: 'Signal Density',
        value: summaryStats.avgSignals.toFixed(1),
        sortValue: summaryStats.avgSignals,
        info: 'Average count of issue signals generated per replay session.',
        detail: 'Signals per replay',
        delta: signalDensityDelta
          ? {
            value: signalDensityDelta.deltaPct,
            label: signalDensityDelta.comparisonLabel,
            betterDirection: 'down',
            precision: 1,
          }
          : undefined,
      },
    ];
  }, [behaviorAnalytics.timeline, issues, sessions, summaryStats.unresolved, summaryStats.ongoing, summaryStats.replayCoverage, summaryStats.avgSignals, timeRange, totalIssueEvents]);

  if (!selectedProject && !projectLoading) {
    return (
      <div className="p-6 md:p-8">
        <EmptyStateCard
          title="No project selected"
          subtitle="Pick a project to open the General dashboard."
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <DashboardPageHeader
        title="General"
        subtitle="Top issues, top users, and behavior analytics"
        icon={<Sparkles className="w-5 h-5" />}
        iconColor="bg-sky-50"
      >
        <TimeFilter value={timeRange} onChange={handleTimeRangeChange} />
        <NeoButton
          size="sm"
          variant="secondary"
          onClick={() => loadGeneral('refresh')}
          disabled={refreshing || loading}
          leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
        >
          Refresh
        </NeoButton>
      </DashboardPageHeader>

      <div className="mx-auto max-w-[1800px] space-y-6 p-6 md:p-8">
        {error && (
          <NeoCard className="border-rose-300 bg-rose-50">
            <div className="flex items-center gap-3 text-sm font-semibold text-rose-700">
              <AlertTriangle className="h-5 w-5" />
              {error}
            </div>
          </NeoCard>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5" />
            ))}
          </div>
        ) : (
          <>
            <KpiCardsGrid
              cards={kpiCards}
              timeRange={timeRange}
              storageKey="issues-feed"
              gridClassName="grid grid-cols-2 gap-5 lg:grid-cols-4"
            />

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-800">Top Issues</h2>
                <NeoBadge variant="neutral" size="sm">{topIssues.length} shown</NeoBadge>
              </div>

              {topIssues.length === 0 ? (
                <EmptyStateCard
                  title="No issues in this window"
                  subtitle="As new issue groups are detected, they appear here with direct replay links."
                />
              ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  {topIssues.map((issue) => {
                    const issueColor = ISSUE_TYPE_COLOR[issue.issueType] || '#64748b';
                    return (
                      <NeoCard key={issue.id} className="border-slate-100/80 bg-white ring-1 ring-slate-900/5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="mb-2 flex items-center gap-2">
                              <NeoBadge variant={ISSUE_TYPE_BADGE_VARIANT[issue.issueType] || 'neutral'} size="sm">
                                {issue.issueType.replace('_', ' ')}
                              </NeoBadge>
                              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                {issue.status}
                              </span>
                            </div>
                            <h3 className="truncate text-base font-black text-slate-900">{issue.title}</h3>
                            <p className="mt-1 truncate text-xs text-slate-500">{issue.subtitle || issue.culprit || 'No extra context'}</p>
                          </div>
                          <CircleAlert className="h-5 w-5 shrink-0 text-slate-400" />
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-3">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Events</div>
                            <div className="mt-1 text-xl font-black text-slate-900">{compactNumber(issue.eventCount)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Users</div>
                            <div className="mt-1 text-xl font-black text-slate-900">{compactNumber(issue.userCount)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Last Seen</div>
                            <div className="mt-1 text-sm font-bold text-slate-900">{formatLastSeen(issue.lastSeen)}</div>
                          </div>
                        </div>

                        <div className="mt-4">
                          <IssueSparkline dailyEvents={issue.dailyEvents} color={issueColor} />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            to={`${pathPrefix}/general/${issue.id}`}
                            className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-700 hover:border-slate-900 hover:text-slate-900"
                          >
                            View Issue
                          </Link>
                          {issue.sampleSessionId && (
                            <Link
                              to={`${pathPrefix}/sessions/${issue.sampleSessionId}`}
                              className="inline-flex items-center rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-sky-700 hover:border-sky-500"
                            >
                              Replay
                            </Link>
                          )}
                        </div>
                      </NeoCard>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-800">Top Users and Replays</h2>
                <NeoBadge variant="neutral" size="sm">{topUsersWithReplays.length} users</NeoBadge>
              </div>

              {topUsersWithReplays.length === 0 ? (
                <EmptyStateCard
                  title="No replay users in this window"
                  subtitle="Replay-backed user ranking appears here once sessions are available."
                />
              ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  {topUsersWithReplays.map((bucket) => (
                    <NeoCard key={bucket.key} className="border-slate-100/80 bg-white ring-1 ring-slate-900/5">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-base font-black text-slate-900">{bucket.label}</div>
                          <div className="mt-1 text-xs text-slate-500">Last replay {formatLastSeen(bucket.latestStartedAt)}</div>
                        </div>
                        <Users className="h-5 w-5 shrink-0 text-slate-400" />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Issue Signals</div>
                          <div className="mt-1 text-xl font-black text-slate-900">{bucket.issueSignals}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Replays</div>
                          <div className="mt-1 text-xl font-black text-slate-900">{bucket.replayCount}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Watch Time</div>
                          <div className="mt-1 text-sm font-bold text-slate-900">{formatDuration(bucket.totalDurationSeconds)}</div>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        {bucket.sessions.slice(0, 3).map((session) => {
                          const sessionSignals = issueSignalsForSession(session);
                          const hasSignals = sessionSignals > 0;
                          return (
                            <Link
                              key={session.id}
                              to={`${pathPrefix}/sessions/${session.id}`}
                              className="flex items-center justify-between rounded-xl border border-slate-100/80 bg-slate-50/50 px-3 py-2 transition-colors hover:border-sky-300 hover:bg-sky-50"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-bold uppercase tracking-wide text-slate-800">
                                  Replay {session.id.replace('session_', '').slice(0, 10)}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {session.platform.toUpperCase()} · {formatDuration(session.durationSeconds)} · UX {Math.round(session.uxScore)}
                                </div>
                              </div>
                              <div className="ml-3 flex items-center gap-2">
                                <NeoBadge variant={hasSignals ? 'warning' : 'success'} size="sm">
                                  {sessionSignals}
                                </NeoBadge>
                                <Activity className="h-4 w-4 text-slate-400" />
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </NeoCard>
                  ))}
                </div>
              )}
            </section>

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <NeoCard className="xl:col-span-2 border-slate-100/80 bg-white ring-1 ring-slate-900/5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-800">General Behavior Analytics</h2>
                  <BarChart3 className="h-5 w-5 text-slate-400" />
                </div>

                <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
                  <div className="rounded-2xl border border-slate-100/80 bg-slate-50/50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Volatility</div>
                    <div className="mt-1 text-xl font-black text-slate-900">{behaviorAnalytics.volatility.toFixed(0)}%</div>
                  </div>
                  <div className="rounded-2xl border border-slate-100/80 bg-slate-50/50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Momentum</div>
                    <div className={`mt-1 text-xl font-black ${behaviorAnalytics.momentum >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {behaviorAnalytics.momentum >= 0 ? '+' : ''}{behaviorAnalytics.momentum.toFixed(0)}%
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-100/80 bg-slate-50/50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">New This Week</div>
                    <div className="mt-1 text-xl font-black text-slate-900">{behaviorAnalytics.recentIssues}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-100/80 bg-slate-50/50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Top-3 Concentration</div>
                    <div className="mt-1 text-xl font-black text-slate-900">{behaviorAnalytics.topThreeShare.toFixed(0)}%</div>
                  </div>
                </div>

                <div className="mt-5 h-36 rounded-2xl border border-slate-100/80 bg-slate-50/50 p-3">
                  {behaviorAnalytics.timeline.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-500">
                      No timeline activity in this range
                    </div>
                  ) : (
                    <div className="flex h-full items-end gap-1">
                      {behaviorAnalytics.timeline.map((point) => {
                        return (
                          <div
                            key={point.date}
                            title={`${point.date}: ${point.value}`}
                            className="flex-1 rounded-sm bg-slate-900/80"
                            style={{ height: `${Math.max(5, (point.value / maxTimelineValue) * 100)}%` }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </NeoCard>

              <NeoCard className="border-slate-100/80 bg-white ring-1 ring-slate-900/5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-800">Issue Type Mix</h2>
                  <Sparkles className="h-5 w-5 text-slate-400" />
                </div>

                {issueTypeMix.length === 0 ? (
                  <div className="flex h-[220px] items-center justify-center text-xs font-semibold text-slate-500">
                    No issue type data
                  </div>
                ) : (
                  <div className="space-y-3">
                    {issueTypeMix.map((entry) => {
                      const share = totalIssueEvents > 0 ? (entry.count / totalIssueEvents) * 100 : 0;
                      const color = ISSUE_TYPE_COLOR[entry.issueType] || '#64748b';
                      return (
                        <div key={entry.issueType}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-bold uppercase tracking-wide text-slate-700">
                              {entry.issueType.replace('_', ' ')}
                            </span>
                            <span className="font-semibold text-slate-500">{compactNumber(entry.count)}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.max(3, share)}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </NeoCard>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default IssuesFeed;
