import type { ApiSession, ApiSessionSummary } from '../services/api';

type NetworkStatsLike = {
  total?: number;
  successful?: number;
  failed?: number;
  avgDuration?: number;
  totalBytes?: number;
};

type StatsLike = {
  duration?: string;
  eventCount?: number;
  frameCount?: number;
  networkStats?: NetworkStatsLike;
};

type SessionLike = Partial<ApiSession | ApiSessionSummary> & {
  uxScore?: number;
  events?: Array<{ type?: string; name?: string }>;
  screensVisited?: string[];
  stats?: StatsLike;
};

type MetricsLike = Partial<NonNullable<ApiSession['metrics']>>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const countEvents = (events: SessionLike['events'], type: string): number => {
  if (!events || events.length === 0) return 0;
  const normalized = type.toLowerCase();
  return events.filter((event) => {
    const eventType = event.type?.toLowerCase();
    const eventName = event.name?.toLowerCase();
    return eventType === normalized || eventName === normalized;
  }).length;
};

export const calculateUxScoreFromSession = (
  session: SessionLike,
  statsOverride?: StatsLike
): number => {
  const metrics: MetricsLike = (session.metrics || {}) as MetricsLike;
  const events = session.events || [];
  const stats: StatsLike | undefined = statsOverride || session.stats;

  const errorCount = metrics.errorCount ?? countEvents(events, 'error');
  const rageTapCount = metrics.rageTapCount ?? countEvents(events, 'rage_tap');
  const apiErrors = metrics.apiErrorCount ?? stats?.networkStats?.failed ?? 0;

  let score = 75;

  score -= Math.min(25, (errorCount || 0) * 5);
  score -= Math.min(15, (rageTapCount || 0) * 3);
  score -= Math.min(15, (apiErrors || 0) * 2);

  const screensVisited = metrics.screensVisited?.length ?? session.screensVisited?.length ?? 0;

  if (screensVisited >= 3) {
    score += 10;
  }

  if (screensVisited >= 5) {
    score += 5;
  }

  return clamp(Math.round(score), 0, 100);
};
