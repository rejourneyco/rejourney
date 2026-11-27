import type { DashboardChipTone } from '~/shared/ui/core/dashboardStyles';
import type { McpCallOutcome, McpClientKind, McpScope, McpToolUsage } from './types';

/** Typical credit cost of reviewing one session end to end. */
export const SESSION_REVIEW_CREDITS = 5;
/** Typical credit cost of one cohort report. */
export const COHORT_REPORT_CREDITS = 150;

const NEAR_LIMIT_PERCENT = 80;

function safeCount(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function hasLimit(limit: number | null | undefined): limit is number {
    return typeof limit === 'number' && Number.isFinite(limit);
}

export function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
}

/**
 * Share of the allowance used, as a whole number from 0 to 100.
 * No limit reads as 0. Any use below 1% reads as 1 so the bar is never empty after a call.
 */
export function usagePercent(used: number, limit: number | null | undefined): number {
    const safeUsed = safeCount(used);
    if (!hasLimit(limit)) return 0;
    if (limit <= 0) return safeUsed > 0 ? 100 : 0;
    const percent = clampPercent((safeUsed / limit) * 100);
    if (percent > 0 && percent < 1) return 1;
    // Only a fully used allowance may read as 100.
    if (percent < 100) return Math.min(99, Math.round(percent));
    return 100;
}

/** Credits left this period, never negative. `null` when there is no limit. */
export function creditsRemaining(used: number, limit: number | null | undefined): number | null {
    if (!hasLimit(limit)) return null;
    return Math.max(0, Math.round(limit) - safeCount(used));
}

/** Fixed en-US grouping so the server render and the browser agree. */
export function formatCredits(value: number | null | undefined): string {
    return safeCount(value).toLocaleString('en-US');
}

export function formatCreditCount(value: number | null | undefined): string {
    const count = safeCount(value);
    return `${formatCredits(count)} ${count === 1 ? 'credit' : 'credits'}`;
}

export function formatCallCount(value: number | null | undefined): string {
    const count = safeCount(value);
    return `${formatCredits(count)} ${count === 1 ? 'call' : 'calls'}`;
}

export function formatProjectCount(value: number | null | undefined): string {
    const count = safeCount(value);
    return `${formatCredits(count)} ${count === 1 ? 'project' : 'projects'}`;
}

/** "2,340 / 6,000", or "2,340 used" when there is no limit. */
export function formatUsageBadge(used: number, limit: number | null | undefined): string {
    if (!hasLimit(limit)) return `${formatCredits(used)} used`;
    return `${formatCredits(used)} / ${formatCredits(limit)}`;
}

/** Same thresholds as the billing page: amber from 80%, red at the limit. */
export function usageTone(percent: number): DashboardChipTone {
    if (percent >= 100) return 'danger';
    if (percent >= NEAR_LIMIT_PERCENT) return 'warning';
    return 'neutral';
}

export function usageBarClass(percent: number): string {
    if (percent >= 100) return 'bg-[#d93025]';
    if (percent >= NEAR_LIMIT_PERCENT) return 'bg-[#f9ab00]';
    return 'bg-[#1a73e8]';
}

/** How many session reviews and cohort reports the given credits cover. */
export function estimateCapacity(credits: number | null | undefined): { sessionReviews: number; cohortReports: number } {
    const safe = safeCount(credits);
    return {
        sessionReviews: Math.floor(safe / SESSION_REVIEW_CREDITS),
        cohortReports: Math.floor(safe / COHORT_REPORT_CREDITS),
    };
}

export function sumToolCredits(rows: McpToolUsage[]): number {
    return rows.reduce((total, row) => total + safeCount(row.credits), 0);
}

export function sumToolCalls(rows: McpToolUsage[]): number {
    return rows.reduce((total, row) => total + safeCount(row.calls), 0);
}

/** Most expensive tools first; ties keep the busier tool on top. */
export function sortToolUsage(rows: McpToolUsage[]): McpToolUsage[] {
    return [...rows].sort((a, b) => b.credits - a.credits || b.calls - a.calls || a.tool.localeCompare(b.tool));
}

export function outcomeMeta(outcome: McpCallOutcome): { label: string; tone: DashboardChipTone } {
    if (outcome === 'ok') return { label: 'OK', tone: 'success' };
    if (outcome === 'limit_reached') return { label: 'Limit reached', tone: 'warning' };
    return { label: 'Error', tone: 'danger' };
}

const SCOPE_LABELS: Record<McpScope, string> = {
    'sessions:read': 'Read sessions and timelines',
    'replay:read': 'View replay frames',
    'issues:read': 'Read crashes, ANRs and errors',
    'analytics:read': 'Read project health and analytics',
};

export function scopeLabel(scope: string): string {
    return SCOPE_LABELS[scope as McpScope] ?? scope;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago"; `Never` without a timestamp. */
export function formatRelativeTime(value: string | null | undefined, now: number): string {
    if (!value) return 'Never';
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return 'Unknown';
    const seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function formatDate(value: string | null | undefined): string {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Case-insensitive match of a search box value against any of the given fields. */
export function matchesSearch(search: string, fields: Array<string | null | undefined>): boolean {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return fields.some((field) => String(field ?? '').toLowerCase().includes(needle));
}

/** The text a user pastes to connect each client. */
export function buildConnectSnippet(kind: McpClientKind, serverUrl: string): string {
    if (kind === 'claude-code') {
        return `claude mcp add --transport http --scope user rejourney ${serverUrl}`;
    }
    return serverUrl;
}

/** Chip for the team's identifier-masking switch. `null` while the setting is unknown. */
export function maskingChip(masking: boolean | null): { label: string; tone: DashboardChipTone } {
    if (masking === null) return { label: 'Masking set by your team admin', tone: 'neutral' };
    return masking
        ? { label: 'Identifier masking on', tone: 'success' }
        : { label: 'Identifier masking off', tone: 'warning' };
}
