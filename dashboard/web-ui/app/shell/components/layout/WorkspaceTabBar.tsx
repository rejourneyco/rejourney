import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Settings2, Undo2, X } from 'lucide-react';
import { useTabs } from '~/shared/providers/TabContext';
import { useDashboardPreferences } from '~/shared/providers/useDashboardPreferences';
import { usePathPrefix } from '~/shell/routing/usePathPrefix';

export function WorkspaceTabBar() {
    const { workspaceTabsEnabled } = useDashboardPreferences();
    const { tabs, activeTabId, closeTab, recentlyClosed, reopenTab } = useTabs();
    const pathPrefix = usePathPrefix();
    const activeLinkRef = useRef<HTMLAnchorElement>(null);

    useEffect(() => {
        activeLinkRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [activeTabId, workspaceTabsEnabled]);

    if (!workspaceTabsEnabled) return null;

    return (
        <nav aria-label="Workspace tabs" className="flex h-11 min-w-0 shrink-0 items-center border-b border-[#dadce0] bg-[#f8fafd]">
            <ul className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto">
                {tabs.map((tab) => {
                    const active = tab.id === activeTabId;
                    const Icon = tab.icon;
                    return (
                        <li key={tab.id} className={`group flex min-w-[140px] max-w-[240px] shrink-0 items-center border-r border-[#e8eaed] border-b-2 ${active ? 'border-b-[#1a73e8] bg-white text-[#1967d2]' : 'border-b-transparent text-[#5f6368] hover:bg-[#f1f3f4]'}`}>
                            <Link
                                to={tab.path}
                                ref={active ? activeLinkRef : undefined}
                                aria-current={active ? 'page' : undefined}
                                title={tab.title}
                                className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1a73e8]"
                            >
                                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                                <span className="truncate">{tab.title}</span>
                            </Link>
                            {tab.isClosable && (
                                <button
                                    type="button"
                                    aria-label={`Close ${tab.title}`}
                                    onClick={(event) => closeTab(tab.id, event)}
                                    className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center text-[#80868b] hover:bg-[#e8eaed] hover:text-[#202124] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
                                >
                                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
            <div className="flex h-full shrink-0 items-center gap-1 border-l border-[#dadce0] bg-[#f8fafd] px-2">
                <button
                    type="button"
                    aria-label="Reopen closed tab"
                    title="Reopen closed tab"
                    disabled={recentlyClosed.length === 0}
                    onClick={reopenTab}
                    className="flex h-7 w-7 items-center justify-center text-[#5f6368] hover:bg-[#e8eaed] disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
                >
                    <Undo2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <Link to={`${pathPrefix}/account#dashboard-preferences`} aria-label="Preferences" title="Preferences" className="flex h-7 w-7 items-center justify-center text-[#5f6368] hover:bg-[#e8eaed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]">
                    <Settings2 className="h-4 w-4" aria-hidden="true" />
                </Link>
            </div>
        </nav>
    );
}
