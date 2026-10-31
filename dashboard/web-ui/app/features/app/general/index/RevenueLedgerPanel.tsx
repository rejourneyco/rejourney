import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, Copy, Play } from 'lucide-react';

import { buildDemoBooks, formatMoney } from '~/features/app/books/booksData';
import { ReplayLink } from '~/features/app/sessions/index/ReplayLink';
import { getRevenueLedger, REVENUE_USD_TOTAL, type RevenueLedgerEntry } from '~/shared/api/client';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { DEMO_REPLAY_SESSION_IDS } from '~/shared/data/demoData';
import { formatDeviceModel } from '~/shared/lib/deviceModelNames';
import { formatGeoDisplay } from '~/shared/lib/geoDisplay';
import { AnimalAvatar, getAnimalAvatarSeed, getAnimalForIdentity } from '~/shared/ui/core/AnimalAvatar';
import { CountryFlag } from '~/shared/ui/core/CountryFlag';
import { MobilePlatformBrandIcon } from '~/shared/ui/core/MobilePlatformBrandIcon';
import { NeoBadge } from '~/shared/ui/core/neo/NeoBadge';
import { dashboardButtonClass } from '~/shared/ui/core/dashboardStyles';

/** The ledger preview stops here and links to the Revenue journal for the rest. */
const PAGE_SIZE = 50;
const ROW_ICON_BUTTON_CLASS = 'inline-flex h-8 w-8 items-center justify-center rounded-none border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40';
const TH_CLASS = 'text-left py-2.5 px-2.5 text-[11px] font-medium text-[#5f6368] uppercase';

function platformLabel(platform: string | null | undefined): string {
    const value = String(platform || '').toLowerCase();
    if (value === 'web') return 'Web';
    if (value === 'android') return 'Android';
    if (value === 'ios') return 'iOS';
    return 'Mobile';
}

function formatDuration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) return '—';
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Revenue transactions shown like replay rows: who paid, on what device, from
 * where, and a link to the session the purchase happened in.
 */
export const RevenueLedgerPanel: React.FC<{
    projectId: string | null;
    timeRange: string;
    pathPrefix: string;
    isDemoMode: boolean;
    /** Changes whenever the revenue overview reloads, so the ledger follows sync and edits. */
    refreshKey: string;
}> = ({ projectId, timeRange, pathPrefix, isDemoMode, refreshKey }) => {
    const [entries, setEntries] = useState<RevenueLedgerEntry[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const demoLedger = useMemo(() => (isDemoMode ? buildDemoBooks().ledger : []), [isDemoMode]);

    // The top-bar refresh reloads the ledger even when the totals it is keyed on did not move.
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const loadPage = useCallback(async () => {
        if (!projectId) return;
        setIsLoading(true);
        setError(null);
        try {
            const page = await getRevenueLedger(projectId, { timeRange, currency: REVENUE_USD_TOTAL, limit: PAGE_SIZE });
            setEntries(page.entries);
            setTotalCount(page.totalCount);
            setHasMore(page.hasMore);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Could not load the ledger');
        } finally {
            setIsLoading(false);
        }
    }, [projectId, timeRange]);

    useEffect(() => {
        if (isDemoMode) return;
        void loadPage();
    }, [isDemoMode, loadPage, manualRefreshVersion, refreshKey]);

    const rows = isDemoMode ? demoLedger.slice(0, PAGE_SIZE) : entries;
    const count = isDemoMode ? demoLedger.length : totalCount;
    const showViewMore = isDemoMode ? demoLedger.length > PAGE_SIZE : hasMore;

    const handleCopy = (event: React.MouseEvent, value: string) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(value);
        setCopiedId(value);
        window.setTimeout(() => setCopiedId((current) => (current === value ? null : current)), 1500);
    };

    return (
        <div className="mt-3">
            <div className="dashboard-mobile-scroll overflow-x-auto pb-1">
                <div className="w-full min-w-[760px] overflow-hidden border border-[#dadce0] bg-white">
                    <table className="w-full table-fixed border-collapse">
                        <thead>
                            <tr className="border-b border-[#dadce0] bg-[#f8fafd]">
                                <th className="w-9 py-2.5 pl-3 pr-1" />
                                <th className={TH_CLASS}>User</th>
                                <th className={`${TH_CLASS} w-[104px]`}>Date</th>
                                <th className={`${TH_CLASS} hidden 2xl:table-cell w-[150px]`}>Device</th>
                                <th className={`${TH_CLASS} w-[124px]`}>Location</th>
                                <th className={`${TH_CLASS} w-[140px]`}>Transaction</th>
                                <th className={`${TH_CLASS} !text-right w-[96px]`}>Amount</th>
                                <th className={`${TH_CLASS} hidden 2xl:table-cell !text-right w-[76px]`}>Duration</th>
                                <th className={`${TH_CLASS} !text-right w-[96px]`}>Notes</th>
                                <th className="w-[52px] py-2.5 pl-1 pr-3" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e8eaed]">
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="py-10 text-center text-sm text-[#5f6368]">
                                        {isLoading ? 'Loading transactions…' : error ? `Couldn't load the ledger: ${error}` : 'No transactions in this range.'}
                                    </td>
                                </tr>
                            )}
                            {rows.map((entry, index) => {
                                const session = entry.session ?? null;
                                const userId = session?.userId || session?.anonymousDisplayName || 'Anonymous';
                                const displayUserId = userId.length > 20 ? `${userId.substring(0, 20)}…` : userId;
                                const identity = {
                                    id: entry.sessionId,
                                    userId: session?.userId,
                                    anonymousDisplayName: session?.anonymousDisplayName,
                                    deviceId: session?.deviceId,
                                };
                                const geo = formatGeoDisplay(session ? { country: session.country, countryCode: session.countryCode, city: session.city } : null);
                                const platform = platformLabel(session?.platform);
                                const sessionId = isDemoMode && DEMO_REPLAY_SESSION_IDS.length
                                    ? DEMO_REPLAY_SESSION_IDS[index % DEMO_REPLAY_SESSION_IDS.length]
                                    : entry.sessionId;
                                const canOpen = Boolean(sessionId && session);
                                const occurredAt = new Date(entry.occurredAt);
                                const isRefund = entry.amountCents < 0 || entry.category === 'refund';
                                const muted = entry.exclusion ? 'opacity-50' : '';
                                return (
                                    <tr key={entry.id} className="bg-white transition-colors hover:bg-[#f8fafd]">
                                        <td className="w-9 py-2.5 pl-3 pr-1 align-middle text-center">
                                            <div className={`mx-auto inline-flex h-7 w-7 items-center justify-center ${muted}`}>
                                                <AnimalAvatar animal={getAnimalForIdentity(identity)} seed={getAnimalAvatarSeed(identity)} size={24} neutral />
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-2.5 align-middle overflow-hidden min-w-0">
                                            <div className={`flex items-center gap-2 min-w-0 ${muted}`}>
                                                <span className="font-mono text-sm font-medium text-[#202124] truncate shrink min-w-0" title={userId}>
                                                    {displayUserId}
                                                </span>
                                                {userId !== 'Anonymous' && (
                                                    <button
                                                        type="button"
                                                        onClick={(event) => handleCopy(event, userId)}
                                                        className="text-[#5f6368] transition-colors hover:text-[#202124]"
                                                        title="Copy user ID"
                                                    >
                                                        {copiedId === userId ? <Check size={12} className="text-[#1e8e3e]" /> : <Copy size={12} />}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-2.5 align-middle">
                                            <div className="text-xs tabular-nums text-[#202124]">{occurredAt.toLocaleDateString()}</div>
                                            <div className="text-[11px] tabular-nums text-[#5f6368]">{occurredAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                        </td>
                                        <td className="hidden 2xl:table-cell py-2.5 px-2.5 align-middle">
                                            {session ? (
                                                <div className={`flex min-w-0 items-center gap-2 ${muted}`} title={`${formatDeviceModel(session.deviceModel)}${session.osVersion ? ` · ${session.osVersion}` : ''}`}>
                                                    <MobilePlatformBrandIcon platformName={platform} className="h-4 w-4 shrink-0 text-[#5f6368]" />
                                                    <div className="min-w-0 leading-tight">
                                                        <div className="truncate text-sm text-[#202124]">{formatDeviceModel(session.deviceModel)}</div>
                                                        <div className="truncate text-[11px] text-[#5f6368]">
                                                            {[session.osVersion ? `${platform} ${session.osVersion}` : platform, session.appVersion ? `v${session.appVersion}` : null].filter(Boolean).join(' · ')}
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-[#80868b]">—</span>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-2.5 align-middle overflow-hidden">
                                            <div className={`leading-tight ${muted}`}>
                                                {geo.hasLocation ? (
                                                    <>
                                                        <div className="flex items-center gap-1.5 text-xs text-[#202124]">
                                                            <CountryFlag countryCode={geo.countryCode} countryLabel={geo.countryLabel} decorative />
                                                            <span className="truncate">{geo.countryLabel}</span>
                                                        </div>
                                                        <div className="pl-5 text-[11px] text-[#5f6368] truncate">{geo.cityLabel || 'City unknown'}</div>
                                                    </>
                                                ) : (
                                                    <span className="text-xs text-[#80868b]">—</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-2.5 align-middle overflow-hidden">
                                            <div className={`truncate text-sm text-[#202124] ${muted}`} title={entry.externalTransactionId}>{entry.label}</div>
                                            <div className="truncate text-[11px] text-[#5f6368]">
                                                {entry.transactionCount > 1
                                                    ? `${entry.transactionCount} transactions`
                                                    : session ? <span className="2xl:hidden">{`${platform} · ${formatDeviceModel(session.deviceModel)}`}</span> : null}
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-2.5 align-middle text-right">
                                            <span className={`text-sm font-medium tabular-nums ${entry.exclusion ? 'text-[#80868b] line-through' : isRefund ? 'text-[#c5221f]' : 'text-[#202124]'}`}>
                                                {formatMoney(entry.amountCents, entry.currency)}
                                            </span>
                                        </td>
                                        <td className="hidden 2xl:table-cell py-2.5 px-2 align-middle text-right">
                                            <span className="text-sm tabular-nums text-[#3c4043]">{formatDuration(session?.durationSeconds)}</span>
                                        </td>
                                        <td className="py-2.5 px-2.5 align-middle text-right">
                                            <div className="flex min-h-[28px] flex-wrap items-center justify-end gap-1.5">
                                                {entry.exclusion && (
                                                    <span title={entry.exclusion.reason || 'Excluded from the books'}>
                                                        <NeoBadge variant="neutral" size="sm">Excluded</NeoBadge>
                                                    </span>
                                                )}
                                                {isRefund && <NeoBadge variant="danger" size="sm">Refund</NeoBadge>}
                                            </div>
                                        </td>
                                        <td className="w-[52px] py-2.5 pl-1 pr-3 align-middle">
                                            <div className="flex items-center justify-end">
                                                <ReplayLink
                                                    to={`${pathPrefix}/sessions/${sessionId}`}
                                                    disabled={!canOpen}
                                                    aria-label={canOpen ? 'Open replay' : 'Replay unavailable'}
                                                    title={canOpen ? (session?.replayAvailable || isDemoMode ? 'Open replay' : 'Open session — no visual replay') : 'No session linked to this transaction'}
                                                    className={`${ROW_ICON_BUTTON_CLASS} group/play ${canOpen ? 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]' : 'cursor-not-allowed text-[#bdc1c6]'}`}
                                                >
                                                    <Play size={16} className={canOpen ? 'group-hover/play:fill-current' : ''} />
                                                </ReplayLink>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-[#5f6368]">
                <span className="tabular-nums">
                    {rows.length > 0 ? `Showing ${rows.length} of ${count} ${count === 1 ? 'transaction' : 'transactions'}` : ''}
                </span>
                {showViewMore && (
                    <Link to={`${pathPrefix}/books`} className={dashboardButtonClass('secondary', 'sm')}>
                        View more in Revenue journal
                        <ArrowRight className="h-3 w-3" />
                    </Link>
                )}
            </div>
        </div>
    );
};
