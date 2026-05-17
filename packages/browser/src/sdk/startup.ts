export interface WebStartupTiming {
  durationMs: number;
  source: 'navigation_timing' | 'legacy_performance_timing';
  milestone: 'loadEventEnd' | 'domContentLoadedEventEnd' | 'responseEnd' | 'now';
  complete: boolean;
  navigationType?: string;
  domContentLoadedMs?: number;
  loadEventMs?: number;
  responseEndMs?: number;
  activationStartMs?: number;
}

type NavigationTimingLike = {
  startTime?: number;
  type?: string;
  loadEventEnd?: number;
  domContentLoadedEventEnd?: number;
  responseEnd?: number;
  activationStart?: number;
};

type PerformanceLike = {
  now?: () => number;
  getEntriesByType?: (type: string) => unknown[];
  timing?: {
    navigationStart?: number;
    loadEventEnd?: number;
    domContentLoadedEventEnd?: number;
    responseEnd?: number;
  };
};

const MAX_STARTUP_DURATION_MS = 5 * 60 * 1000;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveDuration(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(Math.min(value, MAX_STARTUP_DURATION_MS));
}

function metricSinceStart(value: unknown, startTime: number): number | undefined {
  const numeric = finiteNumber(value);
  if (numeric === null || numeric <= startTime) return undefined;
  return Math.round(numeric - startTime);
}

function firstNavigationEntry(performanceLike: PerformanceLike): NavigationTimingLike | null {
  const entries = performanceLike.getEntriesByType?.('navigation');
  const entry = Array.isArray(entries) ? entries[0] : undefined;
  return entry && typeof entry === 'object' ? entry as NavigationTimingLike : null;
}

function collectNavigationTiming(performanceLike: PerformanceLike): WebStartupTiming | null {
  const entry = firstNavigationEntry(performanceLike);
  if (!entry) return null;

  const startTime = finiteNumber(entry.activationStart) && Number(entry.activationStart) > 0
    ? Number(entry.activationStart)
    : finiteNumber(entry.startTime) ?? 0;
  const loadEventMs = metricSinceStart(entry.loadEventEnd, startTime);
  const domContentLoadedMs = metricSinceStart(entry.domContentLoadedEventEnd, startTime);
  const responseEndMs = metricSinceStart(entry.responseEnd, startTime);
  const nowMs = metricSinceStart(performanceLike.now?.(), startTime);

  const milestone = loadEventMs !== undefined
    ? 'loadEventEnd'
    : domContentLoadedMs !== undefined
      ? 'domContentLoadedEventEnd'
      : responseEndMs !== undefined
        ? 'responseEnd'
        : 'now';
  const rawDuration = loadEventMs ?? domContentLoadedMs ?? responseEndMs ?? nowMs;
  const durationMs = rawDuration === undefined ? null : positiveDuration(rawDuration);
  if (durationMs === null) return null;

  return {
    durationMs,
    source: 'navigation_timing',
    milestone,
    complete: loadEventMs !== undefined,
    navigationType: typeof entry.type === 'string' ? entry.type : undefined,
    domContentLoadedMs,
    loadEventMs,
    responseEndMs,
    activationStartMs: metricSinceStart(entry.activationStart, 0),
  };
}

function collectLegacyTiming(performanceLike: PerformanceLike, epochNow: number): WebStartupTiming | null {
  const timing = performanceLike.timing;
  const navigationStart = finiteNumber(timing?.navigationStart);
  if (!timing || navigationStart === null || navigationStart <= 0) return null;

  const loadEventMs = metricSinceStart(timing.loadEventEnd, navigationStart);
  const domContentLoadedMs = metricSinceStart(timing.domContentLoadedEventEnd, navigationStart);
  const responseEndMs = metricSinceStart(timing.responseEnd, navigationStart);
  const nowMs = metricSinceStart(epochNow, navigationStart);
  const milestone = loadEventMs !== undefined
    ? 'loadEventEnd'
    : domContentLoadedMs !== undefined
      ? 'domContentLoadedEventEnd'
      : responseEndMs !== undefined
        ? 'responseEnd'
        : 'now';
  const rawDuration = loadEventMs ?? domContentLoadedMs ?? responseEndMs ?? nowMs;
  const durationMs = rawDuration === undefined ? null : positiveDuration(rawDuration);
  if (durationMs === null) return null;

  return {
    durationMs,
    source: 'legacy_performance_timing',
    milestone,
    complete: loadEventMs !== undefined,
    domContentLoadedMs,
    loadEventMs,
    responseEndMs,
  };
}

export function collectWebStartupTiming(
  performanceLike: PerformanceLike | null = typeof performance !== 'undefined' ? performance : null,
  epochNow = Date.now(),
): WebStartupTiming | null {
  if (!performanceLike) return null;
  return collectNavigationTiming(performanceLike)
    ?? collectLegacyTiming(performanceLike, epochNow);
}
