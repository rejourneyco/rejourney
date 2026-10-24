import React, { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
    Activity,
    BookText,
    Bug,
    CreditCard,
    Download,
    PieChart,
    type LucideIcon,
} from 'lucide-react';
import { useSessionData } from '~/shared/providers/SessionContext';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useTeam } from '~/shared/providers/TeamContext';
import { useSharedRejourneyTimeRange } from '~/shared/hooks/useSharedRejourneyTimeRange';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { TimeFilter } from '~/shared/ui/core/TimeFilter';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { downloadCsv, todayDateKey } from './booksData';
import { BooksJournal } from './BooksJournal';
import {
    AnalyticsReport,
    BillingReport,
    ExportCenter,
    RevenueSummaryReport,
    StabilityReport,
    type BooksContext,
} from './BooksReports';

type BooksView = 'journal' | 'revenue' | 'billing' | 'analytics' | 'stability' | 'exports';

const NAV: Array<{ group: string; items: Array<{ view: BooksView; label: string; icon: LucideIcon }> }> = [
    { group: 'Ledger', items: [{ view: 'journal', label: 'Revenue journal', icon: BookText }] },
    {
        group: 'Reports',
        items: [
            { view: 'revenue', label: 'Revenue summary', icon: PieChart },
            { view: 'billing', label: 'Billing & usage', icon: CreditCard },
            { view: 'analytics', label: 'Product analytics', icon: Activity },
            { view: 'stability', label: 'Stability', icon: Bug },
        ],
    },
    { group: 'Tools', items: [{ view: 'exports', label: 'Export center', icon: Download }] },
];

const VIEWS = new Set<BooksView>(NAV.flatMap((group) => group.items.map((item) => item.view)));

export const BooksPage: React.FC = () => {
    const { selectedProject } = useSessionData();
    const { currentTeam } = useTeam();
    const { isDemoMode } = useDemoMode();
    const pathPrefix = usePathPrefix();
    const [searchParams, setSearchParams] = useSearchParams();
    const projectId = selectedProject?.id ?? null;
    const { timeRange, setTimeRange } = useSharedRejourneyTimeRange(projectId ?? undefined);
    const [exportingKey, setExportingKey] = useState<string | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    const requestedView = searchParams.get('view') as BooksView | null;
    const view: BooksView = requestedView && VIEWS.has(requestedView) ? requestedView : 'journal';
    const setView = (next: BooksView) => {
        const params = new URLSearchParams(searchParams);
        if (next === 'journal') params.delete('view'); else params.set('view', next);
        setSearchParams(params, { replace: true });
    };

    const projectName = selectedProject?.name || (isDemoMode ? 'ShopFlow Mobile' : 'this project');
    const ctx: BooksContext = {
        projectId,
        projectName,
        teamId: currentTeam?.id ?? null,
        isDemoMode,
        timeRange,
    };

    const handleExport = useCallback(async (key: string, build: () => Promise<string>) => {
        setExportingKey(key);
        setExportError(null);
        try {
            const csv = await build();
            const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
            downloadCsv(`${slug}-${key}-${timeRange}-${todayDateKey()}.csv`, csv);
        } catch (error) {
            setExportError(error instanceof Error ? error.message : 'Export failed. Try again.');
        } finally {
            setExportingKey(null);
        }
    }, [projectName, timeRange]);

    const exportProps = { onExport: handleExport, exportingKey };

    return (
        <div className="rejourney-general-page min-h-screen bg-[#f8fafd] pb-12 font-sans text-[#202124]">
            <DashboardPageHeader
                title="Books"
                subtitle="Your records, reports and exports."
                {...dashboardPageHeaderProps('books')}
            >
                <TimeFilter value={timeRange} onChange={setTimeRange} />
            </DashboardPageHeader>

            <div className="mx-auto w-full max-w-[1560px] px-4 py-5 sm:px-6 sm:py-6">
                {!projectId && !isDemoMode ? (
                    <div className="border border-[#d2e3fc] bg-[#e8f0fe] px-4 py-3 text-sm text-[#1967d2]">Select a project to open its books.</div>
                ) : (
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                        <nav aria-label="Books sections" className="shrink-0 lg:sticky lg:top-4 lg:w-[208px]">
                            <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-4 lg:overflow-visible">
                                {NAV.map((group) => (
                                    <div key={group.group} className="flex shrink-0 gap-1 lg:block">
                                        <div className="hidden px-3 pb-1 text-xs text-[#80868b] lg:block">{group.group}</div>
                                        {group.items.map((item) => {
                                            const Icon = item.icon;
                                            const active = view === item.view;
                                            return (
                                                <button
                                                    key={item.view}
                                                    type="button"
                                                    onClick={() => setView(item.view)}
                                                    aria-current={active ? 'page' : undefined}
                                                    className={`flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap px-3 text-left text-[13px] transition-colors lg:w-full ${active ? 'bg-[#e8f0fe] text-[#1967d2]' : 'text-[#3c4043] hover:bg-[#eef1f5]'}`}
                                                >
                                                    <Icon className={`h-4 w-4 ${active ? 'text-[#1967d2]' : 'text-[#5f6368]'}`} aria-hidden />
                                                    {item.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </nav>

                        <main className="min-w-0 flex-1 border border-[#dadce0] bg-white">
                            {exportError && (
                                <div className="border-b border-[#f6aea9] bg-[#fce8e6] px-5 py-2.5 text-sm text-[#a50e0e]" role="alert">{exportError}</div>
                            )}
                            {view === 'journal' && (
                                <BooksJournal
                                    projectId={projectId}
                                    projectName={projectName}
                                    isDemoMode={isDemoMode}
                                    timeRange={timeRange}
                                    pathPrefix={pathPrefix}
                                    {...exportProps}
                                />
                            )}
                            {view === 'revenue' && <RevenueSummaryReport ctx={ctx} {...exportProps} />}
                            {view === 'billing' && <BillingReport ctx={ctx} {...exportProps} />}
                            {view === 'analytics' && <AnalyticsReport ctx={ctx} {...exportProps} />}
                            {view === 'stability' && <StabilityReport ctx={ctx} {...exportProps} />}
                            {view === 'exports' && <ExportCenter ctx={ctx} {...exportProps} />}
                        </main>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BooksPage;
