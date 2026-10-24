import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
    AlertCircle,
    Check,
    ChevronDown,
    EyeOff,
    Lock,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import {
    createManualRevenueEntry,
    deleteManualRevenueEntry,
    excludeRevenueTransaction,
    getRevenueLedger,
    getRevenueOverview,
    restoreRevenueTransaction,
    updateManualRevenueEntry,
    type RevenueLedgerEntry,
    type RevenueManualEntry,
    type RevenueOverview,
} from '~/shared/api/client';
import {
    dashboardButtonClass,
    dashboardChipClass,
    dashboardFieldClass,
    dashboardLabelClass,
} from '~/shared/ui/core/dashboardStyles';
import {
    buildDemoBooks,
    buildJournalCsv,
    buildJournalRows,
    EXCLUSION_REASON_PRESETS,
    formatBookDate,
    formatMoney,
    formatMoneyInput,
    formatMonth,
    manualEntryKind,
    monthKey,
    parseMoneyInput,
    rangeStartKey,
    recomputeDemoOverview,
    todayDateKey,
    type DemoBooks,
    type JournalCategory,
    type JournalRow,
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

const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_ROWS = 20_000;

const PROVIDER_LABELS: Record<string, string> = {
    custom_events: 'Custom events',
    revenuecat: 'RevenueCat',
    superwall: 'Superwall',
};

const CATEGORY_META: Record<JournalCategory, { label: string; tone: 'success' | 'warning' | 'purple' | 'info' }> = {
    sale: { label: 'Sale', tone: 'success' },
    refund: { label: 'Refund', tone: 'warning' },
    adjustment: { label: 'Adjustment', tone: 'purple' },
    opening_balance: { label: 'Opening balance', tone: 'info' },
};

type TypeFilter = 'all' | 'sale' | 'refund' | 'manual' | 'excluded';

const TYPE_FILTERS: Array<[TypeFilter, string]> = [
    ['all', 'All records'],
    ['sale', 'Sales'],
    ['refund', 'Refunds'],
    ['manual', 'Manual entries'],
    ['excluded', 'Excluded'],
];

type SaveState =
    | { status: 'idle' }
    | { status: 'saving'; label: string }
    | { status: 'saved' }
    | { status: 'error'; message: string };

type EntryDraft = {
    entryId: string | null;
    kind: 'starting_balance' | 'adjustment';
    direction: 'remove' | 'add';
    amount: string;
    currency: string;
    date: string;
    note: string;
    error: string | null;
};

type DrawerState =
    | { mode: 'record'; key: string }
    | { mode: 'create'; draft: EntryDraft }
    | null;

function draftFor(kind: EntryDraft['kind'], currency: string, entry?: RevenueManualEntry | null): EntryDraft {
    if (entry) {
        return {
            entryId: entry.id,
            kind: manualEntryKind(entry),
            direction: entry.amountCents < 0 ? 'remove' : 'add',
            amount: formatMoneyInput(entry.amountCents),
            currency: entry.currency.toUpperCase(),
            date: entry.date,
            note: entry.note ?? '',
            error: null,
        };
    }
    return {
        entryId: null,
        kind,
        direction: kind === 'adjustment' ? 'remove' : 'add',
        amount: '',
        currency: currency.toUpperCase(),
        date: todayDateKey(),
        note: kind === 'starting_balance' ? 'Revenue before Rejourney tracking' : '',
        error: null,
    };
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export const BooksJournal: React.FC<{
    projectId: string | null;
    projectName: string;
    isDemoMode: boolean;
    timeRange: string;
    pathPrefix: string;
    onExport: (key: string, build: () => Promise<string>) => Promise<void>;
    exportingKey: string | null;
}> = ({ projectId, projectName, isDemoMode, timeRange, pathPrefix, onExport, exportingKey }) => {
    const [currency, setCurrency] = useState<string | null>(null);
    const [overview, setOverview] = useState<RevenueOverview | null>(null);
    const [ledger, setLedger] = useState<RevenueLedgerEntry[]>([]);
    const [ledgerMeta, setLedgerMeta] = useState({ totalCount: 0, excludedCount: 0, hasMore: false });
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [drawer, setDrawer] = useState<DrawerState>(null);
    const [newMenuOpen, setNewMenuOpen] = useState(false);
    const [demoBooks, setDemoBooks] = useState<DemoBooks>(() => buildDemoBooks());
    const loadedCountRef = useRef(PAGE_SIZE);
    const serverFilter = typeFilter === 'excluded' ? 'excluded' : 'all';

    useEffect(() => {
        setCurrency(null);
        setDrawer(null);
        setSaveState({ status: 'idle' });
    }, [projectId]);

    const loadLedgerPage = useCallback(async (selectedCurrency: string | null, options: { append?: boolean; limit?: number } = {}) => {
        if (!projectId || isDemoMode) return;
        const page = await getRevenueLedger(projectId, {
            timeRange,
            currency: selectedCurrency,
            filter: serverFilter,
            offset: options.append ? loadedCountRef.current : 0,
            limit: options.limit ?? PAGE_SIZE,
        });
        setLedger((current) => {
            const next = options.append ? [...current, ...page.entries] : page.entries;
            loadedCountRef.current = Math.max(PAGE_SIZE, next.length);
            return next;
        });
        setLedgerMeta({ totalCount: page.totalCount, excludedCount: page.excludedCount, hasMore: page.hasMore });
    }, [isDemoMode, projectId, serverFilter, timeRange]);

    const loadBooks = useCallback(async (options: { silent?: boolean } = {}) => {
        if (!projectId || isDemoMode) return;
        if (!options.silent) setIsLoading(true);
        setLoadError(null);
        try {
            const data = await getRevenueOverview(projectId, timeRange, currency);
            setOverview(data);
            if (data.connection.canManage) {
                await loadLedgerPage(data.selectedCurrency, { limit: options.silent ? Math.min(loadedCountRef.current, 100) : PAGE_SIZE });
            } else {
                setLedger([]);
                setLedgerMeta({ totalCount: 0, excludedCount: 0, hasMore: false });
            }
        } catch (error) {
            setLoadError(errorMessage(error, 'Unable to load the revenue journal.'));
        } finally {
            setIsLoading(false);
        }
    }, [currency, isDemoMode, loadLedgerPage, projectId, timeRange]);

    useEffect(() => {
        loadedCountRef.current = PAGE_SIZE;
        void loadBooks();
    }, [loadBooks]);

    const books = isDemoMode ? demoBooks.overview : overview;
    const ledgerRows = isDemoMode
        ? (serverFilter === 'excluded' ? demoBooks.ledger.filter((entry) => entry.exclusion) : demoBooks.ledger)
        : ledger;
    const meta = isDemoMode
        ? { totalCount: ledgerRows.length, excludedCount: demoBooks.ledger.filter((entry) => entry.exclusion).length, hasMore: false }
        : ledgerMeta;
    const selectedCurrency = books?.selectedCurrency ?? 'usd';
    const canManage = isDemoMode || Boolean(books?.connection.canManage);
    const provider = books?.activeProvider ?? null;
    const manualEntries = books?.manualEntries ?? [];
    const startingBalance = manualEntries.find((entry) => manualEntryKind(entry) === 'starting_balance') ?? null;
    const rangeStart = rangeStartKey(timeRange);
    const isSaving = saveState.status === 'saving';

    const journal = useMemo(() => buildJournalRows({
        ledger: ledgerRows,
        manualEntries: serverFilter === 'excluded' ? [] : manualEntries,
        closingBalanceCents: books?.summary.netAmountCents ?? 0,
        hasMoreLedger: meta.hasMore,
        rangeStart,
    }), [books?.summary.netAmountCents, ledgerRows, manualEntries, meta.hasMore, rangeStart, serverFilter]);

    const filteredJournal = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return journal.filter((row) => {
            if (typeFilter === 'sale' && row.category !== 'sale') return false;
            if (typeFilter === 'refund' && row.category !== 'refund') return false;
            if (typeFilter === 'manual' && row.source !== 'manual') return false;
            if (!needle) return true;
            return [
                row.description,
                row.detail,
                row.ledger?.externalTransactionId,
                row.ledger?.exclusion?.reason,
                row.manual?.note,
                formatMoney(row.amountCents, row.currency),
            ].some((value) => value?.toLowerCase().includes(needle));
        });
    }, [journal, search, typeFilter]);

    const monthGroups = useMemo(() => {
        const groups: Array<{ month: string; rows: JournalRow[]; netCents: number }> = [];
        for (const row of filteredJournal) {
            const month = monthKey(row.date);
            let group = groups[groups.length - 1];
            if (!group || group.month !== month) {
                group = { month, rows: [], netCents: 0 };
                groups.push(group);
            }
            group.rows.push(row);
            if (row.counted) group.netCents += row.amountCents;
        }
        return groups;
    }, [filteredJournal]);

    const totals = useMemo(() => {
        const moneyIn = journal.filter((row) => row.counted && row.amountCents > 0 && row.category !== 'opening_balance').reduce((sum, row) => sum + row.amountCents, 0);
        const moneyOut = journal.filter((row) => row.counted && row.amountCents < 0).reduce((sum, row) => sum + row.amountCents, 0);
        return { moneyIn, moneyOut };
    }, [journal]);

    const drawerRow = drawer?.mode === 'record' ? journal.find((row) => row.key === drawer.key) ?? null : null;

    /** One book change: local in the demo, server-confirmed live, then totals refresh. */
    const commit = useCallback(async (label: string, live: () => Promise<unknown>, demo: (current: DemoBooks) => DemoBooks) => {
        setSaveState({ status: 'saving', label });
        if (isDemoMode) {
            setDemoBooks((current) => {
                const next = demo(current);
                return { ...next, overview: recomputeDemoOverview(next.overview, next.ledger) };
            });
            setSaveState({ status: 'saved' });
            return true;
        }
        try {
            await live();
            await loadBooks({ silent: true });
            setSaveState({ status: 'saved' });
            return true;
        } catch (error) {
            setSaveState({ status: 'error', message: errorMessage(error, 'Change was not saved. Try again.') });
            return false;
        }
    }, [isDemoMode, loadBooks]);

    const handleExclude = useCallback(async (entry: RevenueLedgerEntry, reason: string) => {
        const trimmed = reason.trim() || null;
        await commit(
            'Excluding',
            () => excludeRevenueTransaction(projectId!, entry.id, trimmed),
            (current) => ({
                ...current,
                ledger: current.ledger.map((row) => row.id === entry.id
                    ? { ...row, exclusion: { id: `demo-exclusion-${Date.now()}`, reason: trimmed, createdAt: new Date().toISOString() } }
                    : row),
            }),
        );
    }, [commit, projectId]);

    const handleRestore = useCallback(async (entry: RevenueLedgerEntry) => {
        if (!entry.exclusion) return;
        const exclusionId = entry.exclusion.id;
        await commit(
            'Restoring',
            () => restoreRevenueTransaction(projectId!, exclusionId),
            (current) => ({ ...current, ledger: current.ledger.map((row) => row.id === entry.id ? { ...row, exclusion: null } : row) }),
        );
    }, [commit, projectId]);

    const handleSaveDraft = useCallback(async (draft: EntryDraft): Promise<string | null> => {
        const cents = parseMoneyInput(draft.amount);
        const currencyCode = draft.currency.trim().toLowerCase();
        if (cents === null || cents === 0) return 'Enter an amount greater than 0, for example 12.99.';
        if (!/^[a-z]{3}$/.test(currencyCode)) return 'Use a three-letter currency code like USD.';
        if (!draft.date) return 'Choose a date.';
        const payload = {
            kind: draft.kind,
            date: draft.date,
            amountCents: draft.kind === 'adjustment' && draft.direction === 'remove' ? -cents : cents,
            currency: currencyCode,
            transactionCount: 1,
            note: draft.note.trim() || null,
        };
        const entryId = draft.entryId;
        const saved = await commit(
            draft.kind === 'starting_balance' ? 'Saving opening balance' : 'Saving adjustment',
            () => entryId ? updateManualRevenueEntry(projectId!, entryId, payload) : createManualRevenueEntry(projectId!, payload),
            (current) => {
                const now = new Date().toISOString();
                const others = current.overview.manualEntries.filter((entry) => entry.id !== entryId
                    && !(draft.kind === 'starting_balance' && manualEntryKind(entry) === 'starting_balance'));
                const nextEntry: RevenueManualEntry = { id: entryId ?? `demo-entry-${Date.now()}`, ...payload, createdAt: now, updatedAt: now };
                return { ...current, overview: { ...current.overview, manualEntries: [...others, nextEntry] } };
            },
        );
        return saved ? null : 'Not saved. Check the values and try again.';
    }, [commit, projectId]);

    const handleDeleteEntry = useCallback(async (entry: RevenueManualEntry) => {
        const isOpening = manualEntryKind(entry) === 'starting_balance';
        const confirmed = window.confirm(isOpening
            ? 'Delete the opening balance? Revenue from before tracking will no longer be counted.'
            : 'Delete this adjustment from the books?');
        if (!confirmed) return;
        const saved = await commit(
            isOpening ? 'Deleting opening balance' : 'Deleting adjustment',
            () => deleteManualRevenueEntry(projectId!, entry.id),
            (current) => ({ ...current, overview: { ...current.overview, manualEntries: current.overview.manualEntries.filter((row) => row.id !== entry.id) } }),
        );
        if (saved) setDrawer(null);
    }, [commit, projectId]);

    const handleLoadMore = useCallback(async () => {
        setIsLoadingMore(true);
        try {
            await loadLedgerPage(selectedCurrency, { append: true });
        } catch (error) {
            setLoadError(errorMessage(error, 'Unable to load more records.'));
        } finally {
            setIsLoadingMore(false);
        }
    }, [loadLedgerPage, selectedCurrency]);

    const exportJournal = useCallback(() => onExport('revenue-journal', async () => {
        if (isDemoMode || !projectId) return buildJournalCsv(journal);
        const all: RevenueLedgerEntry[] = [];
        for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
            const page = await getRevenueLedger(projectId, { timeRange, currency: selectedCurrency, offset, limit: EXPORT_PAGE_SIZE });
            all.push(...page.entries);
            if (!page.hasMore) break;
        }
        return buildJournalCsv(buildJournalRows({
            ledger: all,
            manualEntries,
            closingBalanceCents: books?.summary.netAmountCents ?? 0,
            hasMoreLedger: false,
            rangeStart,
        }));
    }), [books?.summary.netAmountCents, isDemoMode, journal, manualEntries, onExport, projectId, rangeStart, selectedCurrency, timeRange]);

    const saveIndicator = saveState.status === 'saving'
        ? <span className="inline-flex items-center gap-1 text-xs text-[#5f6368]" aria-live="polite"><RefreshCw className="h-3 w-3 animate-spin" />Saving…</span>
        : saveState.status === 'error'
            ? <span className="inline-flex items-center gap-1 text-xs text-[#c5221f]" aria-live="polite"><AlertCircle className="h-3 w-3" />Not saved</span>
            : saveState.status === 'saved'
                ? <span className="inline-flex items-center gap-1 text-xs text-[#137333]" aria-live="polite"><Check className="h-3 w-3" />Saved</span>
                : null;


    return (
        <div className="min-w-0">
            <BooksSectionHeader
                title="Revenue journal"
                description={canManage ? 'Click any record to edit, exclude or restore it.' : 'View only. Owners, admins and billing admins can edit.'}
            >
                {saveIndicator}
                {books?.currencies && books.currencies.length > 1 && (
                    <select
                        value={selectedCurrency}
                        onChange={(event) => setCurrency(event.target.value || null)}
                        aria-label="Journal currency"
                        className="h-8 rounded-none border border-[#dadce0] bg-white px-2 text-xs text-[#3c4043] outline-none focus:border-[#1a73e8]"
                    >
                        {books.currencies.map((row) => <option key={row.currency} value={row.currency}>{row.currency.toUpperCase()}</option>)}
                    </select>
                )}
                <BooksExportButton onClick={() => void exportJournal()} isExporting={exportingKey === 'revenue-journal'} disabled={journal.length === 0} />
                {canManage && (
                    <div className="relative">
                        <button type="button" onClick={() => setNewMenuOpen((open) => !open)} className={dashboardButtonClass('primary', 'sm')} aria-expanded={newMenuOpen}>
                            <Plus className="h-3.5 w-3.5" />
                            New entry
                            <ChevronDown className="h-3 w-3" />
                        </button>
                        {newMenuOpen && (
                            <div className="absolute right-0 z-20 mt-1 w-64 border border-[#dadce0] bg-white py-1 shadow-[0_2px_8px_rgba(60,64,67,0.15)]">
                                {([
                                    ['adjustment', 'Adjustment', 'Add or remove an amount on a day'],
                                    ['starting_balance', startingBalance ? 'Edit opening balance' : 'Opening balance', 'Revenue from before tracking'],
                                ] as const).map(([kind, label, hint]) => (
                                    <button
                                        key={kind}
                                        type="button"
                                        onClick={() => {
                                            setNewMenuOpen(false);
                                            if (kind === 'starting_balance' && startingBalance) {
                                                setDrawer({ mode: 'record', key: `manual:${startingBalance.id}` });
                                            } else {
                                                setDrawer({ mode: 'create', draft: draftFor(kind, selectedCurrency) });
                                            }
                                        }}
                                        className="block w-full px-3 py-2 text-left hover:bg-[#f1f3f4]"
                                    >
                                        <div className="text-sm text-[#202124]">{label}</div>
                                        <div className="text-xs text-[#5f6368]">{hint}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </BooksSectionHeader>

            <BooksStatStrip
                isLoading={isLoading && !books}
                stats={[
                    { label: 'Money in', value: formatMoney(totals.moneyIn, selectedCurrency) },
                    { label: 'Money out', value: formatMoney(Math.abs(totals.moneyOut), selectedCurrency) },
                    { label: 'Closing balance', value: formatMoney(books?.summary.netAmountCents ?? 0, selectedCurrency) },
                ]}
            />

            <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                <label className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#80868b]" aria-hidden />
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search records"
                        aria-label="Search records"
                        className={`${dashboardFieldClass} h-8 pl-8 text-[13px]`}
                    />
                </label>
                <div className="relative">
                    <select
                        value={typeFilter}
                        onChange={(event) => { loadedCountRef.current = PAGE_SIZE; setTypeFilter(event.target.value as TypeFilter); }}
                        aria-label="Record type"
                        className="h-8 appearance-none rounded-none border border-[#dadce0] bg-white pl-3 pr-8 text-[13px] text-[#3c4043] outline-none focus:border-[#1a73e8]"
                    >
                        {TYPE_FILTERS.map(([key, label]) => (
                            <option key={key} value={key}>{label}{key === 'excluded' && meta.excludedCount ? ` (${meta.excludedCount})` : ''}</option>
                        ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5f6368]" aria-hidden />
                </div>
            </div>

            {(loadError || saveState.status === 'error') && (
                <div className="flex items-center justify-between gap-3 border-b border-[#f6aea9] bg-[#fce8e6] px-5 py-2.5 text-sm text-[#a50e0e]" role="alert">
                    <span>{saveState.status === 'error' ? `${saveState.message} Nothing was changed.` : loadError}</span>
                    {loadError
                        ? <button type="button" onClick={() => void loadBooks()} className={dashboardButtonClass('secondary', 'sm')}>Retry</button>
                        : <button type="button" onClick={() => setSaveState({ status: 'idle' })} aria-label="Dismiss"><X className="h-4 w-4" /></button>}
                </div>
            )}
            {!canManage ? (
                <BooksEmpty><Lock className="mx-auto mb-2 h-5 w-5 text-[#80868b]" />Only project owners, admins and billing admins can open the revenue journal.</BooksEmpty>
            ) : !provider && manualEntries.length === 0 && !isLoading ? (
                <BooksEmpty>
                    No revenue records yet. <Link to={`${pathPrefix}/general`} className="font-medium text-[#1a73e8] hover:underline">Connect a revenue source</Link> or add an opening balance.
                </BooksEmpty>
            ) : (
                <div className="overflow-x-auto">
                    <table className={`${booksTableClass} min-w-[600px] table-fixed`}>
                        <thead>
                            <tr>
                                <th className={`${booksThClass} w-[120px]`}>Date</th>
                                <th className={booksThClass}>Description</th>
                                <th className={`${booksThClass} w-[128px]`}>Type</th>
                                <th className={`${booksThClass} ${booksNumClass} w-[112px]`}>Amount</th>
                                <th className={`${booksThClass} ${booksNumClass} w-[124px]`}>Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading && journal.length === 0 && <BooksLoadingRows columns={5} />}
                            {monthGroups.map((group) => (
                                <React.Fragment key={group.month}>
                                    <tr>
                                        <td colSpan={5} className="px-5 pb-1.5 pt-5 text-xs text-[#5f6368]">
                                            {formatMonth(group.month)}
                                        </td>
                                    </tr>
                                    {group.rows.map((row) => {
                                        const isSelected = drawer?.mode === 'record' && drawer.key === row.key;
                                        return (
                                            <tr
                                                key={row.key}
                                                onClick={() => setDrawer({ mode: 'record', key: row.key })}
                                                onKeyDown={(event) => { if (event.key === 'Enter') setDrawer({ mode: 'record', key: row.key }); }}
                                                tabIndex={0}
                                                className={`cursor-pointer outline-none transition-colors focus-visible:bg-[#e8f0fe] ${isSelected ? 'bg-[#e8f0fe]' : 'hover:bg-[#f8fafd]'}`}
                                            >
                                                <td className={`${booksTdClass} whitespace-nowrap text-[#5f6368]`}>{formatBookDate(row.date)}</td>
                                                <td className={`${booksTdClass} max-w-0`}>
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <span className={`truncate ${row.counted ? 'text-[#202124]' : 'text-[#80868b]'}`}>{row.description}</span>
                                                        {!row.counted && <span className="shrink-0 text-xs text-[#c5221f]">Excluded</span>}
                                                    </div>
                                                </td>
                                                <td className={`${booksTdClass} text-[#5f6368]`}>{CATEGORY_META[row.category].label}</td>
                                                <td className={`${booksTdClass} ${booksNumClass} ${!row.counted ? 'text-[#80868b] line-through' : row.amountCents < 0 ? 'text-[#c5221f]' : 'text-[#202124]'}`}>
                                                    {formatMoney(row.amountCents, row.currency)}
                                                </td>
                                                <td className={`${booksTdClass} ${booksNumClass} text-[#80868b]`}>
                                                    {row.balanceCents === null ? '' : formatMoney(row.balanceCents, row.currency)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                    {!isLoading && filteredJournal.length === 0 && (
                        <BooksEmpty>{search ? 'No records match your search.' : typeFilter === 'excluded' ? 'Nothing excluded in this period.' : 'No records in this period. Try a longer time range.'}</BooksEmpty>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-[#80868b]">
                        <span>
                            {filteredJournal.length.toLocaleString()} records
                            {search && meta.hasMore ? ' · search covers loaded records' : ''}
                        </span>
                        {meta.hasMore && (
                            <button type="button" onClick={() => void handleLoadMore()} disabled={isLoadingMore} className={dashboardButtonClass('secondary', 'sm')}>
                                {isLoadingMore && <RefreshCw className="h-3 w-3 animate-spin" />}
                                Load more
                            </button>
                        )}
                    </div>
                </div>
            )}

            {drawer && (
                <RecordDrawer
                    key={drawer.mode === 'record' ? drawer.key : `create:${drawer.draft.kind}`}
                    row={drawerRow}
                    createDraft={drawer.mode === 'create' ? drawer.draft : null}
                    canManage={canManage}
                    isSaving={isSaving}
                    pathPrefix={pathPrefix}
                    onClose={() => setDrawer(null)}
                    onExclude={handleExclude}
                    onRestore={handleRestore}
                    onSaveDraft={async (draft) => {
                        const error = await handleSaveDraft(draft);
                        if (!error && !draft.entryId) setDrawer(null);
                        return error;
                    }}
                    onDelete={handleDeleteEntry}
                />
            )}
        </div>
    );
};

const RecordDrawer: React.FC<{
    row: JournalRow | null;
    createDraft: EntryDraft | null;
    canManage: boolean;
    isSaving: boolean;
    pathPrefix: string;
    onClose: () => void;
    onExclude: (entry: RevenueLedgerEntry, reason: string) => Promise<void>;
    onRestore: (entry: RevenueLedgerEntry) => Promise<void>;
    onSaveDraft: (draft: EntryDraft) => Promise<string | null>;
    onDelete: (entry: RevenueManualEntry) => Promise<void>;
}> = ({ row, createDraft, canManage, isSaving, pathPrefix, onClose, onExclude, onRestore, onSaveDraft, onDelete }) => {
    const [draft, setDraft] = useState<EntryDraft | null>(() => createDraft ?? (row?.manual ? draftFor(manualEntryKind(row.manual), row.currency, row.manual) : null));
    const [reason, setReason] = useState<string>(EXCLUSION_REASON_PRESETS[0]);

    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const category = row ? CATEGORY_META[row.category] : createDraft ? CATEGORY_META[createDraft.kind === 'adjustment' ? 'adjustment' : 'opening_balance'] : null;
    const title = row ? row.description : createDraft?.kind === 'adjustment' ? 'New adjustment' : 'Opening balance';

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!draft) return;
        const error = await onSaveDraft(draft);
        setDraft((current) => current ? { ...current, error } : current);
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
            <button type="button" className="absolute inset-0 bg-[#202124]/20" onClick={onClose} aria-label="Close record" />
            <aside className="relative flex h-full w-full max-w-[440px] flex-col border-l border-[#dadce0] bg-white shadow-[-4px_0_16px_rgba(60,64,67,0.12)]">
                <div className="flex items-start justify-between gap-3 border-b border-[#e8eaed] px-5 py-4">
                    <div className="min-w-0">
                        {category && <span className={dashboardChipClass(category.tone)}>{category.label}</span>}
                        <h3 className="mt-1.5 truncate text-lg font-normal text-[#202124]">{title}</h3>
                    </div>
                    <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center border border-[#dadce0] text-[#5f6368] hover:bg-[#f1f3f4]" aria-label="Close">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {row && (
                        <>
                            <div className={`text-3xl font-normal tabular-nums ${!row.counted ? 'text-[#80868b] line-through' : row.amountCents < 0 ? 'text-[#c5221f]' : 'text-[#202124]'}`}>
                                {formatMoney(row.amountCents, row.currency)}
                            </div>
                            <dl className="mt-4 grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-2.5 border-t border-[#e8eaed] pt-4 text-[13px]">
                                <dt className="text-[#5f6368]">Date</dt>
                                <dd className="text-[#202124]">{formatBookDate(row.date)}</dd>
                                <dt className="text-[#5f6368]">Status</dt>
                                <dd className={row.counted ? 'text-[#137333]' : 'text-[#c5221f]'}>
                                    {row.counted ? 'Posted · counted in revenue' : `Excluded${row.ledger?.exclusion?.reason ? ` · ${row.ledger.exclusion.reason}` : ''}`}
                                </dd>
                                <dt className="text-[#5f6368]">Source</dt>
                                <dd className="text-[#202124]">{row.source === 'manual' ? 'Manual entry' : 'Synced from revenue source'}</dd>
                                {row.ledger && row.ledger.transactionCount > 1 && (
                                    <>
                                        <dt className="text-[#5f6368]">Purchases</dt>
                                        <dd className="text-[#202124]">{row.ledger.transactionCount} in this daily record</dd>
                                    </>
                                )}
                                {row.ledger?.sessionId && (
                                    <>
                                        <dt className="text-[#5f6368]">Session</dt>
                                        <dd className="truncate">
                                            <Link to={`${pathPrefix}/sessions/${row.ledger.sessionId}`} className="font-mono text-xs text-[#1a73e8] hover:underline">{row.ledger.sessionId}</Link>
                                        </dd>
                                    </>
                                )}
                                {row.ledger && (
                                    <>
                                        <dt className="text-[#5f6368]">Transaction ID</dt>
                                        <dd className="break-all font-mono text-xs text-[#3c4043]">{row.ledger.externalTransactionId}</dd>
                                    </>
                                )}
                                {row.ledger?.exclusion && (
                                    <>
                                        <dt className="text-[#5f6368]">Excluded on</dt>
                                        <dd className="text-[#202124]">{formatBookDate(row.ledger.exclusion.createdAt)}</dd>
                                    </>
                                )}
                                {row.manual && (
                                    <>
                                        <dt className="text-[#5f6368]">Last edited</dt>
                                        <dd className="text-[#202124]">{formatBookDate(row.manual.updatedAt)}</dd>
                                    </>
                                )}
                            </dl>
                        </>
                    )}

                    {row?.ledger && canManage && (
                        <div className="mt-5 border-t border-[#e8eaed] pt-4">
                            {row.ledger.exclusion ? (
                                <>
                                    <div className="text-sm font-medium text-[#202124]">Count this record again</div>
                                    <p className="mt-1 text-xs leading-5 text-[#5f6368]">Restoring adds it back to revenue totals, charts and exports.</p>
                                    <button type="button" disabled={isSaving} onClick={() => void onRestore(row.ledger!)} className={`${dashboardButtonClass('secondary', 'sm')} mt-3`}>
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        Restore record
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div className="text-sm font-medium text-[#202124]">Exclude from the books</div>
                                    <p className="mt-1 text-xs leading-5 text-[#5f6368]">
                                        {row.ledger.transactionCount > 1
                                            ? `This is one day's total of ${row.ledger.transactionCount} purchases. To remove a single test purchase, add a negative adjustment instead.`
                                            : 'Use this for test purchases or duplicates. The record stays here and can be restored any time.'}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {EXCLUSION_REASON_PRESETS.map((preset) => (
                                            <button
                                                key={preset}
                                                type="button"
                                                onClick={() => setReason(preset)}
                                                className={`h-7 border px-2.5 text-xs font-medium transition-colors ${reason === preset ? 'border-[#d2e3fc] bg-[#e8f0fe] text-[#1967d2]' : 'border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f1f3f4]'}`}
                                            >
                                                {preset}
                                            </button>
                                        ))}
                                    </div>
                                    <label className="mt-2 block space-y-1">
                                        <span className={`block ${dashboardLabelClass}`}>Reason</span>
                                        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} className={dashboardFieldClass} />
                                    </label>
                                    <button type="button" disabled={isSaving} onClick={() => void onExclude(row.ledger!, reason)} className={`${dashboardButtonClass('danger', 'sm')} mt-3`}>
                                        <EyeOff className="h-3.5 w-3.5" />
                                        Exclude {formatMoney(row.amountCents, row.currency)}
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {draft && canManage && (
                        <form onSubmit={(event) => void handleSubmit(event)} className={`${row ? 'mt-5 border-t border-[#e8eaed] pt-4' : ''} space-y-3`}>
                            {row && <div className="text-sm font-medium text-[#202124]">Edit entry</div>}
                            {draft.kind === 'adjustment' && (
                                <div className="grid grid-cols-2 border border-[#dadce0] text-xs font-medium" role="radiogroup" aria-label="Direction">
                                    {(['remove', 'add'] as const).map((direction) => (
                                        <button
                                            key={direction}
                                            type="button"
                                            role="radio"
                                            aria-checked={draft.direction === direction}
                                            onClick={() => setDraft({ ...draft, direction, error: null })}
                                            className={`h-8 transition-colors ${draft.direction === direction ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#3c4043] hover:bg-[#f8fafd]'}`}
                                        >
                                            {direction === 'remove' ? 'Debit (remove revenue)' : 'Credit (add revenue)'}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                                <label className="space-y-1">
                                    <span className={`block ${dashboardLabelClass}`}>Amount</span>
                                    <input
                                        value={draft.amount}
                                        onChange={(event) => setDraft({ ...draft, amount: event.target.value, error: null })}
                                        placeholder={draft.kind === 'adjustment' ? '12.99' : '1299.00'}
                                        inputMode="decimal"
                                        autoFocus={!row}
                                        className={`${dashboardFieldClass} tabular-nums`}
                                    />
                                </label>
                                <label className="space-y-1">
                                    <span className={`block ${dashboardLabelClass}`}>Currency</span>
                                    <input value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase(), error: null })} maxLength={3} className={`${dashboardFieldClass} uppercase`} />
                                </label>
                            </div>
                            <label className="block space-y-1">
                                <span className={`block ${dashboardLabelClass}`}>Date</span>
                                <input type="date" value={draft.date} max={todayDateKey()} onChange={(event) => setDraft({ ...draft, date: event.target.value, error: null })} className={dashboardFieldClass} />
                            </label>
                            <label className="block space-y-1">
                                <span className={`block ${dashboardLabelClass}`}>Memo</span>
                                <input
                                    value={draft.note}
                                    onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                                    placeholder={draft.kind === 'adjustment' ? 'Sandbox purchase from App Review' : 'Revenue before Rejourney tracking'}
                                    maxLength={200}
                                    className={dashboardFieldClass}
                                />
                            </label>
                            {draft.error && <div className="border border-[#f6aea9] bg-[#fce8e6] px-3 py-2 text-xs text-[#a50e0e]">{draft.error}</div>}
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="submit" disabled={isSaving} className={dashboardButtonClass('primary', 'sm')}>
                                    <Check className="h-3.5 w-3.5" />
                                    {draft.entryId ? 'Save changes' : 'Post entry'}
                                </button>
                                {row?.manual && (
                                    <button type="button" disabled={isSaving} onClick={() => void onDelete(row.manual!)} className={`${dashboardButtonClass('ghost', 'sm')} ml-auto text-[#c5221f]`}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Delete
                                    </button>
                                )}
                            </div>
                        </form>
                    )}
                </div>
                <div className="border-t border-[#e8eaed] bg-[#f8fafd] px-5 py-2.5 text-[11px] text-[#5f6368]">
                    Changes save to the server immediately and are recorded in the team audit log.
                </div>
            </aside>
        </div>
    );
};
