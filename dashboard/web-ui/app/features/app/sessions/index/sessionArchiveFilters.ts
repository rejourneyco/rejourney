export const SESSION_ARCHIVE_ISSUE_FILTERS = [
  'all',
  'crashes',
  'errors',
  'anrs',
  'rage',
  'dead_taps',
  'slow_start',
  'slow_api',
  'new_user',
] as const;

export type SessionArchiveIssueFilter = typeof SESSION_ARCHIVE_ISSUE_FILTERS[number];

export const SESSION_ARCHIVE_ISSUE_FILTER_OPTIONS: Array<{
  id: SessionArchiveIssueFilter;
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'crashes', label: 'Crashes' },
  { id: 'errors', label: 'Errors' },
  { id: 'anrs', label: 'ANRs' },
  { id: 'rage', label: 'Rage' },
  { id: 'dead_taps', label: 'Dead Taps' },
  { id: 'slow_start', label: 'Slow Start' },
  { id: 'slow_api', label: 'Slow API' },
  { id: 'new_user', label: 'New User' },
];

export function matchesSessionArchiveIssueFilter(session: any, filter: SessionArchiveIssueFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'crashes') return (session.crashCount || 0) > 0;
  if (filter === 'anrs') return (session.anrCount || 0) > 0;
  if (filter === 'errors') return (session.errorCount || 0) > 0;
  if (filter === 'rage') return (session.rageTapCount || 0) > 3;
  if (filter === 'dead_taps') return (session.deadTapCount || 0) > 0;
  if (filter === 'slow_start') return (session.appStartupTimeMs || 0) > 3000;
  if (filter === 'slow_api') return (session.apiAvgResponseMs || 0) > 1000;
  if (filter === 'new_user') return Boolean(session.isFirstSession);
  return true;
}
