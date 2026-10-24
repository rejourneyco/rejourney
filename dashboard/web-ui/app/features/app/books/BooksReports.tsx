import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import {
    getInsightsTrends,
    getRevenueLedger,
    getRevenueOverview,
    getStabilityIssues,
    getTeamBillingDashboard,
    getTeamBillingHistory,
    getTeamProjectUsage,
    type RevenueLedgerEntry,
    type RevenueOverview,
    type TeamBillingDashboard,
} from '~/shared/api/client';
import { dashboardChipClass } from '~/shared/ui/core/dashboardStyles';
import {
    buildAnalyticsCsv,
    buildBillingCsv,
    buildDailyRevenueCsv,
    buildDemoBillingRecords,
    buildDemoBooks,
    buildDemoStabilityRows,
    buildJournalCsv,
    buildJournalRows,
    buildMonthlyRevenueCsv,
    buildProjectUsageCsv,
    buildStabilityCsv,
    formatBookDate,
    formatBytes,
    formatCount,
    formatMoney,
    formatMonth,
    groupAnalytics,
    groupRevenueByMonth,
    rangeStartKey,
    type AnalyticsDayRow,
    type AnalyticsGrouping,
    type BillingPeriodRow,
    type ProjectUsageRow,
    type StabilityRow,
} from './booksData';
import {
    BooksEmpty,
    BooksExportButton,
    BooksLoadingRows,
    BooksSectionHeader,
    BooksStatStrip,
    booksNumClass,
    booksTableClass,
    booksTdClass,
    booksThClass,
} from './BooksUi';

export type BooksContext = {
    projectId: string | null;
    projectName: string;
    teamId: string | null;
    isDemoMode: boolean;
    timeRange: string;
};

type ExportProps = {
    onExport: (key: string, build: () => Promise<string>) => Promise<void>;
    exportingKey: string | null;
};

// ---------------------------------------------------------------------------
// Loaders (shared by the report views and the export center)
// ---------------------------------------------------------------------------

async function loadRevenue(ctx: BooksContext): Promise<RevenueOverview | null> {
    if (ctx.isDemoMode) return buildDemoBooks().overview;
    if (!ctx.projectId) return null;
    return getRevenueOverview(ctx.projectId, ctx.timeRange, null);
}

async function loadJournalCsv(ctx: BooksContext): Promise<string> {
    const overview = await loadRevenue(ctx);
    let ledger: RevenueLedgerEntry[] = [];
    if (ctx.isDemoMode) {
        ledger = buildDemoBooks().ledger;
    } else if (ctx.projectId && overview?.connection.canManage) {
        for (let offset = 0; offset < 20_000; offset += 100) {
            const page = await getRevenueLedger(ctx.projectId, { timeRange: ctx.timeRange, currency: overview.selectedCurrency, offset, limit: 100 });
            ledger.push(...page.entries);
            if (!page.hasMore) break;
        }
    }
    return buildJournalCsv(buildJournalRows({
        ledger,
        manualEntries: overview?.manualEntries ?? [],
        closingBalanceCents: overview?.summary.netAmountCents ?? 0,
        hasMoreLedger: false,
        rangeStart: rangeStartKey(ctx.timeRange),
    }));
}

type BillingRecords = { dashboard: TeamBillingDashboard | null; history: BillingPeriodRow[]; projects: ProjectUsageRow[]; period: string };

async function loadBilling(ctx: BooksContext): Promise<BillingRecords> {
    if (ctx.isDemoMode) return { dashboard: null, ...buildDemoBillingRecords() };
    if (!ctx.teamId) return { dashboard: null, history: [], projects: [], period: '' };
    const [dashboard, history, usage] = await Promise.all([
        getTeamBillingDashboard(ctx.teamId).catch(() => null),
        getTeamBillingHistory(ctx.teamId),
        getTeamProjectUsage(ctx.teamId),
    ]);
    return { dashboard, history: history.history, projects: usage.projects, period: usage.period };
}

async function loadAnalytics(ctx: BooksContext): Promise<AnalyticsDayRow[]> {
    if (!ctx.projectId && !ctx.isDemoMode) return [];
    const trends = await getInsightsTrends(ctx.projectId ?? undefined, ctx.timeRange);
    return (trends.daily ?? []).map((row) => ({
        date: row.date,
        sessions: row.sessions,
        dau: row.dau,
        mau: row.mau,
        avgDurationSeconds: row.avgDurationSeconds,
        errorCount: row.errorCount,
        crashes: row.crashes,
        rageTaps: row.rageTaps,
        totalApiCalls: row.totalApiCalls,
        apiErrorRate: row.apiErrorRate,
    }));
}

type StabilityRecords = { rows: StabilityRow[]; crashFreeSessionRate: number | null; crashFreeUserRate: number | null };

async function loadStability(ctx: BooksContext): Promise<StabilityRecords> {
    if (ctx.isDemoMode) return { rows: buildDemoStabilityRows(), crashFreeSessionRate: 99.2, crashFreeUserRate: 98.7 };
    if (!ctx.projectId) return { rows: [], crashFreeSessionRate: null, crashFreeUserRate: null };
    const response = await getStabilityIssues(ctx.projectId, ctx.timeRange);
    return {
        rows: response.issues.map((issue) => ({
            id: issue.id,
            type: issue.type,
            title: issue.title,
            culprit: issue.culprit,
            status: issue.status,
            eventCount: issue.eventCount,
            userCount: issue.userCount,
            sessionCount: issue.sessionCount,
            firstSeen: issue.firstSeen,
            lastSeen: issue.lastSeen,
        })),
        crashFreeSessionRate: response.summary.crashFreeSessionRate,
        crashFreeUserRate: response.summary.crashFreeUserRate,
    };
}

function useReportData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; isLoading: boolean; error: string | null } {
    const [state, setState] = useState<{ data: T | null; isLoading: boolean; error: string | null }>({ data: null, isLoading: true, error: null });
    useEffect(() => {
        let cancelled = false;
        setState((current) => ({ ...current, isLoading: true, error: null }));
        load()
            .then((data) => { if (!cancelled) setState({ data, isLoading: false, error: null }); })
            .catch((error) => { if (!cancelled) setState({ data: null, isLoading: false, error: error instanceof Error ? error.message : 'Unable to load this report.' }); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return state;
}

const ReportError: React.FC<{ error: string | null }> = ({ error }) => error
    ? <div className="border-b border-[#f6aea9] bg-[#fce8e6] px-5 py-2.5 text-sm text-[#a50e0e]">{error}</div>
    : null;

// ---------------------------------------------------------------------------
// Revenue summary
// ---------------------------------------------------------------------------

export const RevenueSummaryReport: React.FC<{ ctx: BooksContext } & ExportProps> = ({ ctx, onExport, exportingKey }) => {
    const { data, isLoading, error } = useReportData(() => loadRevenue(ctx), [ctx.projectId, ctx.timeRange, ctx.isDemoMode]);
    const currency = data?.selectedCurrency ?? 'usd';
    const months = useMemo(() => groupRevenueByMonth(data?.daily ?? []), [data?.daily]);
    const summary = data?.summary;

    return (
        <div className="min-w-0">
            <BooksSectionHeader title="Revenue summary" description="Monthly totals, after your corrections.">
                <BooksExportButton label="Daily CSV" onClick={() => void onExport('revenue-daily', async () => buildDailyRevenueCsv(data?.daily ?? []))} isExporting={exportingKey === 'revenue-daily'} disabled={!data?.daily.length} />
                <BooksExportButton label="Monthly CSV" onClick={() => void onExport('revenue-monthly', async () => buildMonthlyRevenueCsv(months, currency))} isExporting={exportingKey === 'revenue-monthly'} disabled={!months.length} />
            </BooksSectionHeader>
            <BooksStatStrip
                isLoading={isLoading}
                stats={[
                    { label: 'Gross', value: formatMoney(summary?.grossAmountCents ?? 0, currency) },
                    { label: 'Refunds', value: formatMoney(summary?.refundAmountCents ?? 0, currency) },
                    { label: 'Net', value: formatMoney(summary?.netAmountCents ?? 0, currency) },
                ]}
            />
            <ReportError error={error} />
            <div className="overflow-x-auto">
                <table className={`${booksTableClass} min-w-[560px]`}>
                    <thead>
                        <tr>
                            <th className={booksThClass}>Month</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Gross</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Refunds</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Net</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Transactions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <BooksLoadingRows columns={5} rows={4} />}
                        {!isLoading && months.map((row) => (
                            <tr key={row.month}>
                                <td className={`${booksTdClass} text-[#202124]`}>{formatMonth(row.month)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatMoney(row.grossAmountCents, currency)}</td>
                                <td className={`${booksTdClass} ${booksNumClass} text-[#5f6368]`}>{formatMoney(row.refundAmountCents, currency)}</td>
                                <td className={`${booksTdClass} ${booksNumClass} text-[#202124]`}>{formatMoney(row.netAmountCents, currency)}</td>
                                <td className={`${booksTdClass} ${booksNumClass} text-[#5f6368]`}>{formatCount(row.transactionCount)}</td>
                            </tr>
                        ))}
                        {!isLoading && months.length > 1 && summary && (
                            <tr className="font-medium">
                                <td className={booksTdClass}>Total</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatMoney(summary.grossAmountCents, currency)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatMoney(summary.refundAmountCents, currency)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatMoney(summary.netAmountCents, currency)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(summary.transactionCount)}</td>
                            </tr>
                        )}
                    </tbody>
                </table>
                {!isLoading && !months.length && <BooksEmpty>No revenue recorded in this period.</BooksEmpty>}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Billing & usage
// ---------------------------------------------------------------------------

const INVOICE_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
    paid: 'success',
    open: 'info',
    draft: 'neutral',
    uncollectible: 'danger',
    void: 'neutral',
};

export const BillingReport: React.FC<{ ctx: BooksContext } & ExportProps> = ({ ctx, onExport, exportingKey }) => {
    const { data, isLoading, error } = useReportData(() => loadBilling(ctx), [ctx.teamId, ctx.isDemoMode]);
    const dashboard = data?.dashboard;
    const current = data?.history[0];
    const planName = ctx.isDemoMode ? 'Pro' : dashboard?.plan?.displayName ?? '—';
    const shortDate = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const cycle = dashboard
        ? `${shortDate(dashboard.billing.cycleStart)} – ${shortDate(dashboard.billing.cycleEnd)}`
        : current ? new Date(`${current.period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

    return (
        <div className="min-w-0">
            <BooksSectionHeader title="Billing & usage" description="Your plan, usage and invoices.">
                <BooksExportButton label="Periods CSV" onClick={() => void onExport('billing-periods', async () => buildBillingCsv(data?.history ?? []))} isExporting={exportingKey === 'billing-periods'} disabled={!data?.history.length} />
                <BooksExportButton label="Projects CSV" onClick={() => void onExport('billing-projects', async () => buildProjectUsageCsv(data?.period ?? '', data?.projects ?? []))} isExporting={exportingKey === 'billing-projects'} disabled={!data?.projects.length} />
            </BooksSectionHeader>
            <BooksStatStrip
                isLoading={isLoading}
                stats={[
                    { label: 'Plan', value: planName },
                    { label: 'Billing cycle', value: cycle },
                    { label: 'Sessions this period', value: formatCount(dashboard?.usage.sessionsUsed ?? current?.sessions ?? 0), hint: dashboard ? `of ${formatCount(dashboard.usage.sessionLimit)}` : undefined },
                ]}
            />
            <ReportError error={error} />
            <div className="overflow-x-auto">
                <table className={`${booksTableClass} min-w-[720px]`}>
                    <thead>
                        <tr>
                            <th className={booksThClass}>Billing period</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Sessions</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Replays</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Storage</th>
                            <th className={booksThClass}>Invoice</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <BooksLoadingRows columns={5} rows={4} />}
                        {!isLoading && data?.history.map((row, index) => (
                            <tr key={row.period} className="hover:bg-[#f8fafd]">
                                <td className={`${booksTdClass} text-[#202124]`}>
                                    {formatMonth(row.period)}
                                    {index === 0 && <span className="ml-2 text-xs text-[#80868b]">current</span>}
                                </td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.sessions)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.sessionReplays)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatBytes(row.storageBytes)}</td>
                                <td className={booksTdClass}>
                                    {row.invoiceStatus ? (
                                        <span className="inline-flex items-center gap-2">
                                            <span className={`text-xs ${INVOICE_TONES[row.invoiceStatus] === 'success' ? 'text-[#137333]' : 'text-[#5f6368]'}`}>{row.invoiceStatus[0].toUpperCase() + row.invoiceStatus.slice(1)}</span>
                                            {row.invoiceUrl && (
                                                <a href={row.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[#1a73e8] hover:underline">
                                                    View <ExternalLink className="h-3 w-3" />
                                                </a>
                                            )}
                                        </span>
                                    ) : <span className="text-xs text-[#80868b]">—</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!isLoading && !data?.history.length && <BooksEmpty>No billing periods recorded yet.</BooksEmpty>}
            </div>
            {!!data?.projects.length && (
                <>
                    <div className="px-5 pb-1 pt-6 text-sm text-[#202124]">
                        Usage by project <span className="text-xs text-[#80868b]">· {data.period ? formatMonth(data.period) : 'current period'}</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className={`${booksTableClass} min-w-[640px]`}>
                            <thead>
                                <tr>
                                    <th className={booksThClass}>Project</th>
                                    <th className={`${booksThClass} ${booksNumClass}`}>Sessions</th>
                                    <th className={`${booksThClass} ${booksNumClass}`}>Replays</th>
                                    <th className={`${booksThClass} ${booksNumClass}`}>Storage</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.projects.map((row) => (
                                    <tr key={row.id} className="hover:bg-[#f8fafd]">
                                        <td className={`${booksTdClass} text-[#202124]`}>{row.name}{row.platform && <span className="ml-2 text-xs text-[#80868b]">{row.platform}</span>}</td>
                                        <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.sessions)}</td>
                                        <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.sessionReplays)}</td>
                                        <td className={`${booksTdClass} ${booksNumClass}`}>{formatBytes(row.storageBytes)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Product analytics
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

export const AnalyticsReport: React.FC<{ ctx: BooksContext } & ExportProps> = ({ ctx, onExport, exportingKey }) => {
    const [grouping, setGrouping] = useState<AnalyticsGrouping>('week');
    const { data, isLoading, error } = useReportData(() => loadAnalytics(ctx), [ctx.projectId, ctx.timeRange, ctx.isDemoMode]);
    const rows = useMemo(() => groupAnalytics(data ?? [], grouping), [data, grouping]);
    const totals = useMemo(() => {
        const days = data ?? [];
        return {
            sessions: days.reduce((sum, row) => sum + row.sessions, 0),
            avgDau: days.length ? Math.round(days.reduce((sum, row) => sum + row.dau, 0) / days.length) : 0,
            peakMau: Math.max(0, ...days.map((row) => row.mau ?? 0)),
            errors: days.reduce((sum, row) => sum + row.errorCount, 0),
            crashes: days.reduce((sum, row) => sum + row.crashes, 0),
        };
    }, [data]);
    const bucketLabel = (date: string) => grouping === 'month' ? formatMonth(date) : formatBookDate(date);

    return (
        <div className="min-w-0">
            <BooksSectionHeader title="Product analytics" description="Usage over time. The CSV includes API and rage-tap columns.">
                <div className="flex border border-[#dadce0] bg-white text-xs font-medium" role="tablist" aria-label="Group by">
                    {(['day', 'week', 'month'] as const).map((key) => (
                        <button key={key} type="button" role="tab" aria-selected={grouping === key} onClick={() => setGrouping(key)} className={`h-8 border-r border-[#dadce0] px-3 capitalize last:border-r-0 ${grouping === key ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#3c4043] hover:bg-[#f8fafd]'}`}>
                            {key === 'day' ? 'Daily' : key === 'week' ? 'Weekly' : 'Monthly'}
                        </button>
                    ))}
                </div>
                <BooksExportButton onClick={() => void onExport(`analytics-${grouping}`, async () => buildAnalyticsCsv(rows, grouping))} isExporting={exportingKey === `analytics-${grouping}`} disabled={!rows.length} />
            </BooksSectionHeader>
            <BooksStatStrip
                isLoading={isLoading}
                stats={[
                    { label: 'Sessions', value: formatCount(totals.sessions) },
                    { label: 'Avg daily users', value: formatCount(totals.avgDau) },
                    { label: 'Crashes', value: formatCount(totals.crashes) },
                ]}
            />
            <ReportError error={error} />
            <div className="overflow-x-auto">
                <table className={`${booksTableClass} min-w-[640px]`}>
                    <thead>
                        <tr>
                            <th className={booksThClass}>{grouping === 'day' ? 'Date' : grouping === 'week' ? 'Week of' : 'Month'}</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Sessions</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Avg DAU</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>MAU</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Avg session</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Errors</th>
                            <th className={`${booksThClass} ${booksNumClass}`}>Crashes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <BooksLoadingRows columns={7} />}
                        {!isLoading && rows.map((row) => (
                            <tr key={row.date} className="hover:bg-[#f8fafd]">
                                <td className={`${booksTdClass} whitespace-nowrap text-[#202124]`}>{bucketLabel(row.date)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.sessions)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.dau)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.mau)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatDuration(row.avgDurationSeconds)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.errorCount)}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.crashes)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!isLoading && !rows.length && <BooksEmpty>No analytics recorded in this period.</BooksEmpty>}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Stability
// ---------------------------------------------------------------------------

const ISSUE_TYPE_META: Record<string, { label: string; tone: 'danger' | 'warning' | 'purple' | 'neutral' }> = {
    crash: { label: 'Crash', tone: 'danger' },
    anr: { label: 'ANR', tone: 'warning' },
    error: { label: 'Error', tone: 'purple' },
};

export const StabilityReport: React.FC<{ ctx: BooksContext } & ExportProps> = ({ ctx, onExport, exportingKey }) => {
    const [typeFilter, setTypeFilter] = useState<'all' | 'crash' | 'anr' | 'error'>('all');
    const { data, isLoading, error } = useReportData(() => loadStability(ctx), [ctx.projectId, ctx.timeRange, ctx.isDemoMode]);
    const rows = useMemo(() => (data?.rows ?? [])
        .filter((row) => typeFilter === 'all' || row.type === typeFilter)
        .sort((a, b) => b.eventCount - a.eventCount), [data?.rows, typeFilter]);
    const all = data?.rows ?? [];

    return (
        <div className="min-w-0">
            <BooksSectionHeader title="Stability" description="Crashes, ANRs and errors, most frequent first.">
                <div className="flex border border-[#dadce0] bg-white text-xs font-medium" role="tablist" aria-label="Issue type">
                    {(['all', 'crash', 'anr', 'error'] as const).map((key) => (
                        <button key={key} type="button" role="tab" aria-selected={typeFilter === key} onClick={() => setTypeFilter(key)} className={`h-8 border-r border-[#dadce0] px-3 last:border-r-0 ${typeFilter === key ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#3c4043] hover:bg-[#f8fafd]'}`}>
                            {key === 'all' ? 'All' : ISSUE_TYPE_META[key].label + 's'}
                        </button>
                    ))}
                </div>
                <BooksExportButton onClick={() => void onExport('stability-issues', async () => buildStabilityCsv(rows))} isExporting={exportingKey === 'stability-issues'} disabled={!rows.length} />
            </BooksSectionHeader>
            <BooksStatStrip
                isLoading={isLoading}
                stats={[
                    { label: 'Open issues', value: formatCount(all.filter((row) => row.status !== 'resolved').length) },
                    { label: 'Events', value: formatCount(all.reduce((sum, row) => sum + row.eventCount, 0)) },
                    { label: 'Crash-free sessions', value: data?.crashFreeSessionRate === null || data?.crashFreeSessionRate === undefined ? '—' : `${data.crashFreeSessionRate.toFixed(1)}%` },
                ]}
            />
            <ReportError error={error} />
            <div className="overflow-x-auto">
                <table className={`${booksTableClass} min-w-[620px] table-fixed`}>
                    <thead>
                        <tr>
                            <th className={booksThClass}>Issue</th>
                            <th className={`${booksThClass} w-[80px]`}>Type</th>
                            <th className={`${booksThClass} ${booksNumClass} w-[80px]`}>Events</th>
                            <th className={`${booksThClass} ${booksNumClass} w-[72px]`}>Users</th>
                            <th className={`${booksThClass} ${booksNumClass} w-[120px]`}>Last seen</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && <BooksLoadingRows columns={5} />}
                        {!isLoading && rows.map((row) => (
                            <tr key={row.id}>
                                <td className={`${booksTdClass} max-w-0`}>
                                    <div className={`truncate ${row.status === 'resolved' ? 'text-[#80868b]' : 'text-[#202124]'}`} title={row.culprit ?? row.title}>
                                        {row.title}
                                        {row.status === 'resolved' && <span className="ml-2 text-xs text-[#137333]">Resolved</span>}
                                    </div>
                                </td>
                                <td className={`${booksTdClass} text-[#5f6368]`}>{ISSUE_TYPE_META[row.type]?.label ?? row.type}</td>
                                <td className={`${booksTdClass} ${booksNumClass}`}>{formatCount(row.eventCount)}</td>
                                <td className={`${booksTdClass} ${booksNumClass} text-[#5f6368]`}>{formatCount(row.userCount)}</td>
                                <td className={`${booksTdClass} ${booksNumClass} whitespace-nowrap text-[#5f6368]`}>{formatBookDate(row.lastSeen)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!isLoading && !rows.length && <BooksEmpty>No issues recorded in this period.</BooksEmpty>}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Export center
// ---------------------------------------------------------------------------

export const ExportCenter: React.FC<{ ctx: BooksContext } & ExportProps> = ({ ctx, onExport, exportingKey }) => {
    const groups: Array<{ title: string; items: Array<{ key: string; title: string; description: string; build: () => Promise<string> }> }> = [
        {
            title: 'Revenue',
            items: [
                { key: 'revenue-journal', title: 'Revenue journal', description: 'Every record with debit, credit, running balance and status.', build: () => loadJournalCsv(ctx) },
                { key: 'revenue-monthly', title: 'Monthly revenue', description: 'Gross, refunds, fees and net per month.', build: async () => { const data = await loadRevenue(ctx); return buildMonthlyRevenueCsv(groupRevenueByMonth(data?.daily ?? []), data?.selectedCurrency ?? 'usd'); } },
                { key: 'revenue-daily', title: 'Daily revenue', description: 'One row per day with lifecycle counts.', build: async () => buildDailyRevenueCsv((await loadRevenue(ctx))?.daily ?? []) },
            ],
        },
        {
            title: 'Billing',
            items: [
                { key: 'billing-periods', title: 'Billing periods & invoices', description: 'Usage per billing period with invoice status.', build: async () => buildBillingCsv((await loadBilling(ctx)).history) },
                { key: 'billing-projects', title: 'Usage by project', description: 'Sessions, replays, storage and requests per project.', build: async () => { const data = await loadBilling(ctx); return buildProjectUsageCsv(data.period, data.projects); } },
            ],
        },
        {
            title: 'Analytics',
            items: [
                { key: 'analytics-day', title: 'Daily analytics', description: 'Sessions, DAU/MAU, duration, errors and API health per day.', build: async () => buildAnalyticsCsv(groupAnalytics(await loadAnalytics(ctx), 'day'), 'day') },
                { key: 'analytics-month', title: 'Monthly analytics', description: 'The same metrics rolled up by month.', build: async () => buildAnalyticsCsv(groupAnalytics(await loadAnalytics(ctx), 'month'), 'month') },
            ],
        },
        {
            title: 'Stability',
            items: [
                { key: 'stability-issues', title: 'Stability issues', description: 'Crashes, ANRs and errors with events and affected users.', build: async () => buildStabilityCsv((await loadStability(ctx)).rows) },
            ],
        },
    ];

    return (
        <div className="min-w-0">
            <BooksSectionHeader title="Export center" description="Every report as CSV, for the selected time range." />
            {groups.map((group) => (
                <div key={group.title}>
                    <div className="px-5 pb-1 pt-4 text-xs text-[#5f6368]">{group.title}</div>
                    <ul>
                        {group.items.map((item) => (
                            <li key={item.key} className="flex items-center justify-between gap-4 border-b border-[#f1f3f4] px-5 py-3">
                                <div className="flex min-w-0 items-start gap-3">
                                    <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-[#80868b]" aria-hidden />
                                    <div className="min-w-0">
                                        <div className="text-sm text-[#202124]">{item.title}</div>
                                        <div className="text-xs text-[#5f6368]">{item.description}</div>
                                    </div>
                                </div>
                                <BooksExportButton label="CSV" onClick={() => void onExport(item.key, item.build)} isExporting={exportingKey === item.key} disabled={exportingKey !== null && exportingKey !== item.key} />
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
};
