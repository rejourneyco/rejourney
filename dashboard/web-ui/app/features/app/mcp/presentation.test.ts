import { describe, expect, it } from 'vitest';
import {
  COHORT_REPORT_CREDITS,
  SESSION_REVIEW_CREDITS,
  buildConnectSnippet,
  clampPercent,
  creditsRemaining,
  estimateCapacity,
  formatCallCount,
  formatCreditCount,
  formatCredits,
  formatProjectCount,
  formatRelativeTime,
  formatUsageBadge,
  maskingChip,
  matchesSearch,
  outcomeMeta,
  scopeLabel,
  sortToolUsage,
  sumToolCalls,
  sumToolCredits,
  usageBarClass,
  usagePercent,
  usageTone,
} from './presentation';

describe('MCP usage percentage', () => {
  it('clamps to the 0 to 100 range', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it('rounds to a whole percent of the allowance', () => {
    expect(usagePercent(2340, 6000)).toBe(39);
    expect(usagePercent(0, 6000)).toBe(0);
    expect(usagePercent(3000, 6000)).toBe(50);
  });

  it('never exceeds 100 and only reads 100 when the allowance is fully used', () => {
    expect(usagePercent(6000, 6000)).toBe(100);
    expect(usagePercent(9000, 6000)).toBe(100);
    expect(usagePercent(5990, 6000)).toBe(99);
  });

  it('shows at least 1 percent once anything is used', () => {
    expect(usagePercent(3, 75000)).toBe(1);
  });

  it('treats bad input and missing limits as nothing used', () => {
    expect(usagePercent(-50, 6000)).toBe(0);
    expect(usagePercent(Number.NaN, 6000)).toBe(0);
    expect(usagePercent(500, null)).toBe(0);
    expect(usagePercent(500, undefined)).toBe(0);
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(1, 0)).toBe(100);
  });

  it('uses the billing page thresholds for colour', () => {
    expect(usageTone(39)).toBe('neutral');
    expect(usageTone(80)).toBe('warning');
    expect(usageTone(100)).toBe('danger');
    expect(usageBarClass(39)).toBe('bg-[#1a73e8]');
    expect(usageBarClass(85)).toBe('bg-[#f9ab00]');
    expect(usageBarClass(100)).toBe('bg-[#d93025]');
  });
});

describe('MCP credit formatting', () => {
  it('groups thousands the same way everywhere', () => {
    expect(formatCredits(2340)).toBe('2,340');
    expect(formatCredits(75000)).toBe('75,000');
    expect(formatCredits(0)).toBe('0');
    expect(formatCredits(-3)).toBe('0');
    expect(formatCredits(null)).toBe('0');
    expect(formatCredits(11.6)).toBe('12');
  });

  it('pluralises counts', () => {
    expect(formatCreditCount(1)).toBe('1 credit');
    expect(formatCreditCount(3660)).toBe('3,660 credits');
    expect(formatCallCount(1)).toBe('1 call');
    expect(formatCallCount(702)).toBe('702 calls');
    expect(formatProjectCount(1)).toBe('1 project');
    expect(formatProjectCount(4)).toBe('4 projects');
  });

  it('formats the used / limit badge', () => {
    expect(formatUsageBadge(2340, 6000)).toBe('2,340 / 6,000');
    expect(formatUsageBadge(2340, null)).toBe('2,340 used');
  });

  it('never reports negative credits remaining', () => {
    expect(creditsRemaining(2340, 6000)).toBe(3660);
    expect(creditsRemaining(9000, 6000)).toBe(0);
    expect(creditsRemaining(100, null)).toBeNull();
  });

  it('estimates what the remaining credits cover', () => {
    expect(SESSION_REVIEW_CREDITS).toBe(5);
    expect(COHORT_REPORT_CREDITS).toBe(150);
    expect(estimateCapacity(3660)).toEqual({ sessionReviews: 732, cohortReports: 24 });
    expect(estimateCapacity(4)).toEqual({ sessionReviews: 0, cohortReports: 0 });
    expect(estimateCapacity(null)).toEqual({ sessionReviews: 0, cohortReports: 0 });
  });
});

describe('MCP tool usage rows', () => {
  const rows = [
    { tool: 'list_projects', calls: 58, credits: 0 },
    { tool: 'get_session', calls: 215, credits: 215 },
    { tool: 'get_session_context', calls: 240, credits: 720 },
  ];

  it('sums calls and credits', () => {
    expect(sumToolCredits(rows)).toBe(935);
    expect(sumToolCalls(rows)).toBe(513);
    expect(sumToolCredits([])).toBe(0);
  });

  it('sorts the most expensive tools first without changing the input', () => {
    expect(sortToolUsage(rows).map((row) => row.tool)).toEqual(['get_session_context', 'get_session', 'list_projects']);
    expect(rows[0].tool).toBe('list_projects');
  });
});

describe('MCP labels', () => {
  it('names each call outcome', () => {
    expect(outcomeMeta('ok')).toEqual({ label: 'OK', tone: 'success' });
    expect(outcomeMeta('limit_reached')).toEqual({ label: 'Limit reached', tone: 'warning' });
    expect(outcomeMeta('error')).toEqual({ label: 'Error', tone: 'danger' });
  });

  it('describes scopes in plain words and passes unknown ones through', () => {
    expect(scopeLabel('sessions:read')).toBe('Read sessions and timelines');
    expect(scopeLabel('replay:read')).toBe('View replay frames');
    expect(scopeLabel('issues:read')).toBe('Read crashes, ANRs and errors');
    expect(scopeLabel('analytics:read')).toBe('Read project health and analytics');
    expect(scopeLabel('future:scope')).toBe('future:scope');
  });

  it('states the masking setting, including when it is unknown', () => {
    expect(maskingChip(true)).toEqual({ label: 'Identifier masking on', tone: 'success' });
    expect(maskingChip(false)).toEqual({ label: 'Identifier masking off', tone: 'warning' });
    expect(maskingChip(null).tone).toBe('neutral');
  });

  it('formats relative times against a fixed clock', () => {
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(formatRelativeTime(ago(20 * 1000), now)).toBe('just now');
    expect(formatRelativeTime(ago(60 * 1000), now)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(38 * 60 * 1000), now)).toBe('38 minutes ago');
    expect(formatRelativeTime(ago(5 * 60 * 60 * 1000), now)).toBe('5 hours ago');
    expect(formatRelativeTime(ago(51 * 60 * 60 * 1000), now)).toBe('2 days ago');
    expect(formatRelativeTime(new Date(now + 60 * 1000).toISOString(), now)).toBe('just now');
    expect(formatRelativeTime(null, now)).toBe('Never');
    expect(formatRelativeTime('not a date', now)).toBe('Unknown');
  });

  it('matches search text against any field, ignoring case', () => {
    expect(matchesSearch('', ['Cursor'])).toBe(true);
    expect(matchesSearch('  ', ['Cursor'])).toBe(true);
    expect(matchesSearch('curs', ['Claude Code', 'Cursor'])).toBe(true);
    expect(matchesSearch('PRIYA', ['Claude Code', 'Priya Raman'])).toBe(true);
    expect(matchesSearch('zed', ['Claude Code', null, undefined])).toBe(false);
  });
});

describe('MCP connect snippets', () => {
  const url = 'https://mcp.rejourney.co/mcp';

  it('builds the Claude Code command', () => {
    expect(buildConnectSnippet('claude-code', url)).toBe('claude mcp add --transport http --scope user rejourney https://mcp.rejourney.co/mcp');
  });


  it('gives the bare URL to clients that take a connector address', () => {
    expect(buildConnectSnippet('other', url)).toBe(url);
  });
});
