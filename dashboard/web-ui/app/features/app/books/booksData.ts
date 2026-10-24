import type {
    RevenueDailyRow,
    RevenueLedgerEntry,
    RevenueManualEntry,
    RevenueOverview,
} from '~/shared/api/client';

export const EXCLUSION_REASON_PRESETS = ['Test purchase', 'Duplicate', 'Internal account', 'Refunded outside provider'] as const;

export function formatMoney(amountMinor: number, currency: string | null | undefined): string {
    const currencyCode = (currency || 'usd').toUpperCase();
    const amount = amountMinor / 100;
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode, maximumFractionDigits: 2 }).format(amount);
    } catch {
        return `${currencyCode} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
}

/** "1,299.50" → 129950. Returns null for anything that is not a plain positive amount. */
export function parseMoneyInput(value: string): number | null {
    const normalized = value.trim().replace(/[,$\s]/g, '');
    if (!normalized || !/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
    const cents = Math.round(Number(normalized) * 100);
    return Number.isFinite(cents) ? cents : null;
}

export function formatMoneyInput(amountMinor: number): string {
    const amount = Math.abs(amountMinor) / 100;
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function formatBookDate(dateKey: string): string {
    const date = new Date(`${dateKey.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function todayDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export function manualEntryKind(entry: RevenueManualEntry): 'starting_balance' | 'adjustment' {
    return entry.kind === 'adjustment' ? 'adjustment' : 'starting_balance';
}

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

function csvCell(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    // Neutralize spreadsheet formula injection from user-entered notes.
    const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

const major = (amountMinor: number) => (amountMinor / 100).toFixed(2);

export function buildDailyRevenueCsv(daily: RevenueDailyRow[]): string {
    return toCsv(
        ['date', 'currency', 'gross', 'refunds', 'fees', 'net', 'transactions', 'refund_count', 'trials', 'subscription_starts', 'cancellations', 'conversions'],
        daily.map((row) => [
            row.date,
            row.currency.toUpperCase(),
            major(row.grossAmountCents),
            major(row.refundAmountCents),
            major(row.feeAmountCents),
            major(row.netAmountCents),
            row.transactionCount,
            row.refundCount,
            row.trialCount,
            row.subscriptionStartCount,
            row.cancellationCount,
            row.conversionCount,
        ]),
    );
}

export function downloadCsv(filename: string, csv: string): void {
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Demo books (public /demo): edits stay in the viewer's page state.
// ---------------------------------------------------------------------------

const DEMO_PRODUCTS = [
    { label: 'pro_monthly', cents: 1299 },
    { label: 'pro_annual', cents: 9999 },
    { label: 'credits_pack', cents: 499 },
    { label: 'pro_monthly', cents: 1299 },
];

export type DemoBooks = {
    overview: RevenueOverview;
    ledger: RevenueLedgerEntry[];
};

export function buildDemoBooks(days = 30): DemoBooks {
    const today = new Date(`${todayDateKey()}T00:00:00Z`);
    const ledger: RevenueLedgerEntry[] = [];
    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - dayOffset);
        const perDay = 1 + ((dayOffset * 7) % 3);
        for (let index = 0; index < perDay; index += 1) {
            const product = DEMO_PRODUCTS[(dayOffset + index) % DEMO_PRODUCTS.length];
            const occurredAt = new Date(date);
            occurredAt.setUTCHours(9 + index * 3, (dayOffset * 13) % 60);
            const isRefund = dayOffset % 9 === 4 && index === 0;
            ledger.push({
                id: `demo-tx-${dayOffset}-${index}`,
                externalTransactionId: `custom_events:purchase:demo_${dayOffset}_${index}`,
                occurredAt: occurredAt.toISOString(),
                date: occurredAt.toISOString().slice(0, 10),
                currency: 'usd',
                amountCents: isRefund ? -product.cents : product.cents,
                category: isRefund ? 'refund' : 'revenue',
                label: isRefund ? 'refund' : product.label,
                sessionId: `session_demo_${(dayOffset * 31 + index).toString(16).padStart(6, '0')}`,
                transactionCount: 1,
                exclusion: null,
            });
        }
    }
    // A QA purchase someone already removed from the books.
    if (ledger[2]) {
        ledger[2] = {
            ...ledger[2],
            label: 'pro_annual',
            amountCents: 9999,
            exclusion: { id: 'demo-exclusion-1', reason: 'Test purchase', createdAt: new Date().toISOString() },
        };
    }

    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    const now = new Date().toISOString();
    const manualEntries: RevenueManualEntry[] = [
        {
            id: 'demo-starting-balance',
            kind: 'starting_balance',
            date: startDate.toISOString().slice(0, 10),
            currency: 'usd',
            amountCents: 249900,
            transactionCount: 1,
            note: 'Revenue before Rejourney tracking',
            createdAt: now,
            updatedAt: now,
        },
        {
            id: 'demo-adjustment-1',
            kind: 'adjustment',
            date: ledger[10]?.date ?? todayDateKey(),
            currency: 'usd',
            amountCents: -1299,
            transactionCount: 1,
            note: 'Sandbox purchase from App Review',
            createdAt: now,
            updatedAt: now,
        },
    ];

    return {
        ledger,
        overview: recomputeDemoOverview({
            configured: true,
            activeProvider: 'custom_events',
            providers: [],
            connection: {
                provider: 'custom_events',
                label: 'Custom events',
                configured: true,
                status: 'connected',
                accountId: null,
                accountName: 'Custom events and historical revenue',
                connectedAt: now,
                lastSyncStartedAt: now,
                lastSyncCompletedAt: now,
                lastSyncError: null,
                canManage: true,
            },
            customEventConfig: null,
            syncPreview: null,
            manualEntries,
            exclusionSummary: { count: 0, netAmountCents: 0 },
            currencies: [{ currency: 'usd', grossAmountCents: 0 }],
            selectedCurrency: 'usd',
            summary: {
                grossAmountCents: 0,
                refundAmountCents: 0,
                feeAmountCents: 0,
                netAmountCents: 0,
                transactionCount: 0,
                refundCount: 0,
                subscriberCount: 0,
                trialCount: 0,
                subscriptionStartCount: 0,
                cancellationCount: 0,
                conversionCount: 0,
                previousGrossAmountCents: null,
                grossChangePercent: null,
            },
            daily: [],
        }, ledger),
    };
}

/** Rebuilds demo daily rows and totals the same way the server rollup does. */
export function recomputeDemoOverview(overview: RevenueOverview, ledger: RevenueLedgerEntry[]): RevenueOverview {
    const byDate = new Map<string, RevenueDailyRow>();
    const rowFor = (date: string): RevenueDailyRow => {
        const existing = byDate.get(date);
        if (existing) return existing;
        const row: RevenueDailyRow = {
            date,
            currency: 'usd',
            grossAmountCents: 0,
            refundAmountCents: 0,
            feeAmountCents: 0,
            netAmountCents: 0,
            transactionCount: 0,
            refundCount: 0,
            subscriberCount: 0,
            trialCount: 0,
            subscriptionStartCount: 0,
            cancellationCount: 0,
            conversionCount: 0,
            customEventCounts: {},
        };
        byDate.set(date, row);
        return row;
    };
    for (const entry of ledger) {
        if (entry.exclusion) continue;
        const row = rowFor(entry.date);
        if (entry.amountCents >= 0) {
            row.grossAmountCents += entry.amountCents;
            row.transactionCount += entry.transactionCount;
        } else {
            row.refundAmountCents += Math.abs(entry.amountCents);
            row.refundCount += 1;
        }
        row.netAmountCents += entry.amountCents;
    }
    for (const entry of overview.manualEntries) {
        const row = rowFor(entry.date);
        row.grossAmountCents += entry.amountCents;
        row.netAmountCents += entry.amountCents;
        if (manualEntryKind(entry) === 'starting_balance') row.transactionCount += entry.transactionCount;
    }
    const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    const sum = (pick: (row: RevenueDailyRow) => number) => daily.reduce((total, row) => total + pick(row), 0);
    const excluded = ledger.filter((entry) => entry.exclusion);
    const grossAmountCents = sum((row) => row.grossAmountCents);
    return {
        ...overview,
        daily,
        currencies: [{ currency: 'usd', grossAmountCents }],
        exclusionSummary: {
            count: excluded.length,
            netAmountCents: excluded.reduce((total, entry) => total + entry.amountCents, 0),
        },
        summary: {
            ...overview.summary,
            grossAmountCents,
            refundAmountCents: sum((row) => row.refundAmountCents),
            netAmountCents: sum((row) => row.netAmountCents),
            transactionCount: sum((row) => row.transactionCount),
            refundCount: sum((row) => row.refundCount),
        },
    };
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export type JournalCategory = 'sale' | 'refund' | 'adjustment' | 'opening_balance';

export type JournalRow = {
    key: string;
    date: string;
    occurredAt: string;
    description: string;
    detail: string | null;
    category: JournalCategory;
    source: 'synced' | 'manual';
    amountCents: number;
    currency: string;
    counted: boolean;
    /** Running balance after this row, newest first. Null for rows that don't count. */
    balanceCents: number | null;
    ledger: RevenueLedgerEntry | null;
    manual: RevenueManualEntry | null;
};

export function rangeStartKey(timeRange: string): string | null {
    if (timeRange === 'all') return null;
    const days = timeRange === '24h' ? 1 : timeRange === '1y' ? 365 : Number(/^(\d+)d$/.exec(timeRange)?.[1] ?? 30);
    const start = new Date(`${todayDateKey()}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return start.toISOString().slice(0, 10);
}

/**
 * Merges synced transactions (newest first, possibly a partial page) with manual
 * book entries and walks a running balance down from the period's closing balance.
 */
export function buildJournalRows(input: {
    ledger: RevenueLedgerEntry[];
    manualEntries: RevenueManualEntry[];
    closingBalanceCents: number;
    hasMoreLedger: boolean;
    rangeStart: string | null;
}): JournalRow[] {
    const oldestLoaded = input.ledger[input.ledger.length - 1]?.date ?? null;
    const rows: JournalRow[] = [
        ...input.ledger.map((entry): JournalRow => ({
            key: `tx:${entry.id}`,
            date: entry.date,
            occurredAt: entry.occurredAt,
            description: entry.label,
            detail: entry.sessionId,
            category: entry.amountCents < 0 || entry.category === 'refund' ? 'refund' : 'sale',
            source: 'synced',
            amountCents: entry.amountCents,
            currency: entry.currency,
            counted: !entry.exclusion,
            balanceCents: null,
            ledger: entry,
            manual: null,
        })),
        ...input.manualEntries
            .filter((entry) => !input.rangeStart || entry.date >= input.rangeStart)
            .filter((entry) => !input.hasMoreLedger || !oldestLoaded || entry.date >= oldestLoaded)
            .map((entry): JournalRow => ({
                key: `manual:${entry.id}`,
                date: entry.date,
                occurredAt: `${entry.date}T12:00:00.000Z`,
                description: entry.note || (manualEntryKind(entry) === 'adjustment' ? 'Manual adjustment' : 'Opening balance'),
                detail: null,
                category: manualEntryKind(entry) === 'adjustment' ? 'adjustment' : 'opening_balance',
                source: 'manual',
                amountCents: entry.amountCents,
                currency: entry.currency,
                counted: true,
                balanceCents: null,
                ledger: null,
                manual: entry,
            })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.key.localeCompare(b.key));

    let balance = input.closingBalanceCents;
    for (const row of rows) {
        if (!row.counted) continue;
        row.balanceCents = balance;
        balance -= row.amountCents;
    }
    return rows;
}

export function monthKey(dateKey: string): string {
    return dateKey.slice(0, 7);
}

export function formatMonth(month: string): string {
    const date = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return month;
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatCount(value: number | null | undefined): string {
    return Number.isFinite(value) ? Number(value).toLocaleString('en-US') : '—';
}

export function buildJournalCsv(rows: JournalRow[]): string {
    return toCsv(
        ['date', 'description', 'category', 'source', 'status', 'currency', 'debit', 'credit', 'balance', 'note', 'session_id', 'transaction_id'],
        rows.map((row) => [
            row.date,
            row.description,
            row.category,
            row.source,
            row.counted ? 'posted' : 'excluded',
            row.currency.toUpperCase(),
            row.amountCents < 0 ? major(-row.amountCents) : '',
            row.amountCents >= 0 ? major(row.amountCents) : '',
            row.balanceCents === null ? '' : major(row.balanceCents),
            row.ledger?.exclusion?.reason ?? row.manual?.note ?? '',
            row.ledger?.sessionId ?? '',
            row.ledger?.externalTransactionId ?? '',
        ]),
    );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type MonthlyRevenueRow = {
    month: string;
    grossAmountCents: number;
    refundAmountCents: number;
    feeAmountCents: number;
    netAmountCents: number;
    transactionCount: number;
    refundCount: number;
};

export function groupRevenueByMonth(daily: RevenueDailyRow[]): MonthlyRevenueRow[] {
    const byMonth = new Map<string, MonthlyRevenueRow>();
    for (const row of daily) {
        const month = monthKey(row.date);
        const current = byMonth.get(month) ?? {
            month,
            grossAmountCents: 0,
            refundAmountCents: 0,
            feeAmountCents: 0,
            netAmountCents: 0,
            transactionCount: 0,
            refundCount: 0,
        };
        current.grossAmountCents += row.grossAmountCents;
        current.refundAmountCents += row.refundAmountCents;
        current.feeAmountCents += row.feeAmountCents;
        current.netAmountCents += row.netAmountCents;
        current.transactionCount += row.transactionCount;
        current.refundCount += row.refundCount;
        byMonth.set(month, current);
    }
    return Array.from(byMonth.values()).sort((a, b) => b.month.localeCompare(a.month));
}

export function buildMonthlyRevenueCsv(rows: MonthlyRevenueRow[], currency: string): string {
    return toCsv(
        ['month', 'currency', 'gross', 'refunds', 'fees', 'net', 'transactions', 'refund_count'],
        rows.map((row) => [row.month, currency.toUpperCase(), major(row.grossAmountCents), major(row.refundAmountCents), major(row.feeAmountCents), major(row.netAmountCents), row.transactionCount, row.refundCount]),
    );
}

export type BillingPeriodRow = {
    period: string;
    sessions: number;
    sessionReplays: number;
    storageBytes: number;
    requests: number;
    invoiceStatus: string | null;
    invoiceUrl: string | null;
};

export function buildBillingCsv(rows: BillingPeriodRow[]): string {
    return toCsv(
        ['period', 'sessions', 'session_replays', 'storage_bytes', 'requests', 'invoice_status', 'invoice_url'],
        rows.map((row) => [row.period, row.sessions, row.sessionReplays, row.storageBytes, row.requests, row.invoiceStatus, row.invoiceUrl]),
    );
}

export type ProjectUsageRow = { id: string; name: string; platform: string | null; sessions: number; sessionReplays: number; storageBytes: number; requests: number };

export function buildProjectUsageCsv(period: string, rows: ProjectUsageRow[]): string {
    return toCsv(
        ['period', 'project', 'platform', 'sessions', 'session_replays', 'storage_bytes', 'requests'],
        rows.map((row) => [period, row.name, row.platform, row.sessions, row.sessionReplays, row.storageBytes, row.requests]),
    );
}

export type AnalyticsDayRow = {
    date: string;
    sessions: number;
    dau: number;
    mau: number | null;
    avgDurationSeconds: number;
    errorCount: number;
    crashes: number;
    rageTaps: number;
    totalApiCalls: number;
    apiErrorRate: number;
};

export type AnalyticsGrouping = 'day' | 'week' | 'month';

function weekStartKey(dateKey: string): string {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
}

/** Sums counts per bucket; DAU becomes the bucket's average DAU, MAU its latest value. */
export function groupAnalytics(rows: AnalyticsDayRow[], grouping: AnalyticsGrouping): Array<AnalyticsDayRow & { days: number }> {
    const bucketKey = (date: string) => grouping === 'day' ? date : grouping === 'week' ? weekStartKey(date) : monthKey(date);
    const buckets = new Map<string, AnalyticsDayRow & { days: number; durationWeight: number; apiErrors: number }>();
    for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
        const key = bucketKey(row.date);
        const bucket = buckets.get(key) ?? { date: key, sessions: 0, dau: 0, mau: null, avgDurationSeconds: 0, errorCount: 0, crashes: 0, rageTaps: 0, totalApiCalls: 0, apiErrorRate: 0, days: 0, durationWeight: 0, apiErrors: 0 };
        bucket.days += 1;
        bucket.sessions += row.sessions;
        bucket.dau += row.dau;
        bucket.mau = row.mau ?? bucket.mau;
        bucket.durationWeight += row.avgDurationSeconds * row.sessions;
        bucket.errorCount += row.errorCount;
        bucket.crashes += row.crashes;
        bucket.rageTaps += row.rageTaps;
        bucket.totalApiCalls += row.totalApiCalls;
        bucket.apiErrors += row.apiErrorRate * row.totalApiCalls;
        buckets.set(key, bucket);
    }
    return Array.from(buckets.values())
        .map(({ durationWeight, apiErrors, ...bucket }) => ({
            ...bucket,
            dau: Math.round(bucket.dau / Math.max(1, bucket.days)),
            avgDurationSeconds: bucket.sessions ? durationWeight / bucket.sessions : 0,
            apiErrorRate: bucket.totalApiCalls ? apiErrors / bucket.totalApiCalls : 0,
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
}

export function buildAnalyticsCsv(rows: Array<AnalyticsDayRow & { days?: number }>, grouping: AnalyticsGrouping): string {
    return toCsv(
        [grouping === 'day' ? 'date' : `${grouping}_start`, 'sessions', 'avg_dau', 'mau', 'avg_session_seconds', 'errors', 'crashes', 'rage_taps', 'api_calls', 'api_error_rate_pct'],
        rows.map((row) => [row.date, row.sessions, row.dau, row.mau, Math.round(row.avgDurationSeconds), row.errorCount, row.crashes, row.rageTaps, row.totalApiCalls, row.apiErrorRate.toFixed(2)]),
    );
}

export type StabilityRow = {
    id: string;
    type: string;
    title: string;
    culprit: string | null;
    status: string;
    eventCount: number;
    userCount: number;
    sessionCount: number;
    firstSeen: string;
    lastSeen: string;
};

export function buildStabilityCsv(rows: StabilityRow[]): string {
    return toCsv(
        ['type', 'title', 'culprit', 'status', 'events', 'users', 'sessions', 'first_seen', 'last_seen', 'issue_id'],
        rows.map((row) => [row.type, row.title, row.culprit, row.status, row.eventCount, row.userCount, row.sessionCount, row.firstSeen, row.lastSeen, row.id]),
    );
}

export function buildDemoBillingRecords(): { history: BillingPeriodRow[]; projects: ProjectUsageRow[]; period: string } {
    const now = new Date(`${todayDateKey()}T00:00:00Z`);
    const history = Array.from({ length: 8 }, (_, index) => {
        const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
        const period = date.toISOString().slice(0, 7);
        const sessions = 4567 - index * 310 + (index % 3) * 120;
        return {
            period,
            sessions,
            sessionReplays: Math.round(sessions * 0.82),
            storageBytes: (6.4 - index * 0.5) * 1024 ** 3,
            requests: sessions * 41,
            invoiceStatus: index === 0 ? 'open' : 'paid',
            invoiceUrl: null,
        };
    });
    return {
        period: history[0].period,
        history,
        projects: [
            { id: 'demo-mobile', name: 'ShopFlow Mobile', platform: 'ios', sessions: 3120, sessionReplays: 2604, storageBytes: 4.1 * 1024 ** 3, requests: 128_400 },
            { id: 'demo-web', name: 'ShopFlow Web', platform: 'web', sessions: 1447, sessionReplays: 1141, storageBytes: 2.3 * 1024 ** 3, requests: 58_847 },
        ],
    };
}

export function buildDemoStabilityRows(): StabilityRow[] {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    return [
        { id: 'demo-crash-1', type: 'crash', title: 'NullPointerException', culprit: 'CheckoutViewModel.applyCoupon', status: 'unresolved', eventCount: 214, userCount: 87, sessionCount: 132, firstSeen: daysAgo(26), lastSeen: daysAgo(0) },
        { id: 'demo-anr-1', type: 'anr', title: 'Main thread blocked for 6.2s', culprit: 'ImageCache.decodeSync', status: 'unresolved', eventCount: 96, userCount: 54, sessionCount: 71, firstSeen: daysAgo(19), lastSeen: daysAgo(1) },
        { id: 'demo-error-1', type: 'error', title: "TypeError: Cannot read properties of undefined (reading 'price')", culprit: 'ProductCard.tsx', status: 'unresolved', eventCount: 412, userCount: 160, sessionCount: 203, firstSeen: daysAgo(12), lastSeen: daysAgo(0) },
        { id: 'demo-crash-2', type: 'crash', title: 'EXC_BAD_ACCESS', culprit: 'PaymentSheetController.present', status: 'resolved', eventCount: 38, userCount: 21, sessionCount: 25, firstSeen: daysAgo(29), lastSeen: daysAgo(9) },
        { id: 'demo-error-2', type: 'error', title: 'Unhandled promise rejection: Network request failed', culprit: 'api/cart.ts', status: 'unresolved', eventCount: 177, userCount: 92, sessionCount: 110, firstSeen: daysAgo(7), lastSeen: daysAgo(0) },
    ];
}
