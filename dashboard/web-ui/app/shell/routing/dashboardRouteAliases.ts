const LEGACY_ANALYTICS_ROUTE_ALIASES: Array<{ from: string; to: string }> = [
  { from: '/analytics/api', to: '/api' },
  { from: '/analytics/devices', to: '/devices' },
  { from: '/analytics/geo', to: '/geo' },
  { from: '/analytics/journeys', to: '/journeys' },
  { from: '/analytics/heatmaps', to: '/heatmaps' },
  { from: '/automations/leaks', to: '/leaks' },
];

function splitPathSuffix(path: string): { pathname: string; suffix: string } {
  const suffixIndex = path.search(/[?#]/);
  if (suffixIndex === -1) return { pathname: path, suffix: '' };
  return {
    pathname: path.slice(0, suffixIndex),
    suffix: path.slice(suffixIndex),
  };
}

export function normalizeLegacyAnalyticsAppPath(path: string): string {
  if (!path) return path;

  const { pathname, suffix } = splitPathSuffix(path);
  const prefixMatch = pathname.match(/^\/(dashboard|demo)(?=\/|$)/);
  const prefix = prefixMatch?.[0] ?? '';
  const pathWithoutPrefix = prefix ? pathname.slice(prefix.length) || '/' : pathname;

  for (const { from, to } of LEGACY_ANALYTICS_ROUTE_ALIASES) {
    if (pathWithoutPrefix === from || pathWithoutPrefix.startsWith(`${from}/`)) {
      return `${prefix}${to}${pathWithoutPrefix.slice(from.length)}${suffix}`;
    }
  }

  return path;
}

export function stripDashboardPathPrefix(path: string): string {
  return normalizeLegacyAnalyticsAppPath(path).replace(/^\/(dashboard|demo)/, '') || '/general';
}
