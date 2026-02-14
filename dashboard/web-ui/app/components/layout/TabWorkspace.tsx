import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeftRight, PanelRightClose, SplitSquareVertical } from 'lucide-react';
import { TabRegistry } from '../../config/TabRegistry';
import { useTabs } from '../../context/TabContext';

interface TabWorkspaceProps {
    children: React.ReactNode;
}

const TAB_DRAG_MIME = 'application/x-rejourney-tab-id';

function stripPathPrefix(pathname: string): string {
    return pathname.replace(/^\/(dashboard|demo)/, '') || '/issues';
}

function extractDraggedTabId(event: React.DragEvent): string {
    return event.dataTransfer.getData(TAB_DRAG_MIME) || event.dataTransfer.getData('text/plain');
}

function compactLabel(label: string): string {
    return label.length > 28 ? `${label.slice(0, 25)}...` : label;
}

export const TabWorkspace: React.FC<TabWorkspaceProps> = ({ children }) => {
    const {
        tabs,
        activeTabId,
        setActiveTabId,
        isSplitView,
        secondaryTabId,
        splitRatio,
        openTabInSplit,
        closeSplitView,
        setSplitRatio,
    } = useTabs();

    const navigate = useNavigate();
    const splitContainerRef = useRef<HTMLDivElement | null>(null);
    const [isResizing, setIsResizing] = useState(false);
    const [isSplitDropActive, setIsSplitDropActive] = useState(false);
    const [isPrimaryDropActive, setIsPrimaryDropActive] = useState(false);
    const [isSecondaryDropActive, setIsSecondaryDropActive] = useState(false);

    const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
    const secondaryTab = secondaryTabId ? tabs.find((tab) => tab.id === secondaryTabId) || null : null;
    const canSplit = tabs.length > 1;

    const secondaryTabDefinition = useMemo(() => {
        if (!secondaryTab) return null;
        return TabRegistry.resolve(stripPathPrefix(secondaryTab.path));
    }, [secondaryTab]);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (event: MouseEvent) => {
            const container = splitContainerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0) return;
            const ratio = (event.clientX - rect.left) / rect.width;
            setSplitRatio(ratio);
        };

        const handleMouseUp = () => setIsResizing(false);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, setSplitRatio]);

    const handleDropToSplit = (event: React.DragEvent) => {
        event.preventDefault();
        const tabId = extractDraggedTabId(event);
        if (!tabId) return;
        openTabInSplit(tabId);
        setIsSplitDropActive(false);
    };

    const handleDropToPrimary = (event: React.DragEvent) => {
        event.preventDefault();
        const tabId = extractDraggedTabId(event);
        if (!tabId) return;
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) return;
        setActiveTabId(tab.id);
        navigate(tab.path);
        setIsPrimaryDropActive(false);
    };

    const handleDropToSecondary = (event: React.DragEvent) => {
        event.preventDefault();
        const tabId = extractDraggedTabId(event);
        if (!tabId) return;
        openTabInSplit(tabId);
        setIsSecondaryDropActive(false);
    };

    const focusSecondaryAsPrimary = () => {
        if (!secondaryTab) return;
        setActiveTabId(secondaryTab.id);
        navigate(secondaryTab.path);
    };

    const focusPrimaryTab = (tabId: string) => {
        const tab = tabs.find((entry) => entry.id === tabId);
        if (!tab) return;
        setActiveTabId(tab.id);
        navigate(tab.path);
    };

    const focusSecondaryTab = (tabId: string) => {
        if (tabId === activeTabId) return;
        openTabInSplit(tabId);
    };

    const paneTabStrip = (mode: 'primary' | 'secondary') => {
        const selectedId = mode === 'primary' ? activeTabId : secondaryTabId;

        return (
            <div className="mt-2 flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
                {tabs.map((tab) => {
                    const isSelected = tab.id === selectedId;
                    const disabledForSecondary = mode === 'secondary' && tab.id === activeTabId;

                    return (
                        <button
                            key={`${mode}-${tab.id}`}
                            onClick={() => (mode === 'primary' ? focusPrimaryTab(tab.id) : focusSecondaryTab(tab.id))}
                            disabled={disabledForSecondary}
                            className={[
                                'inline-flex max-w-[210px] items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors',
                                isSelected
                                    ? 'border-sky-300 bg-sky-50 text-sky-700'
                                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100',
                                disabledForSecondary ? 'cursor-not-allowed opacity-55' : '',
                            ].join(' ')}
                            title={disabledForSecondary ? 'Already shown in primary pane' : tab.title}
                        >
                            <span className="truncate">{compactLabel(tab.title)}</span>
                            {disabledForSecondary && <span className="rounded bg-slate-200 px-1 py-0.5 text-[9px] text-slate-600">Primary</span>}
                        </button>
                    );
                })}
            </div>
        );
    };

    if (!isSplitView || !secondaryTab) {
        return (
            <div
                className="relative flex-1 min-h-0"
                onDragOver={(event) => {
                    const tabId = extractDraggedTabId(event);
                    if (!tabId || !canSplit) return;
                    event.preventDefault();
                    setIsSplitDropActive(true);
                }}
                onDragLeave={() => setIsSplitDropActive(false)}
                onDrop={handleDropToSplit}
            >
                <div className="h-full overflow-y-auto">{children}</div>
                {isSplitDropActive && canSplit && (
                    <div className="absolute inset-0 z-20 border-2 border-dashed border-blue-600 bg-blue-50/70 pointer-events-none">
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex items-center gap-2 rounded-md border border-blue-300 bg-white px-5 py-3 text-xs font-semibold text-blue-700 shadow-sm">
                                <SplitSquareVertical className="h-4 w-4" />
                                Drop tab to create split view
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const SecondaryComponent = secondaryTabDefinition?.Component;

    return (
        <div ref={splitContainerRef} className="flex flex-1 min-h-0 bg-background">
            <section className="flex min-w-0 flex-col border-r border-slate-300" style={{ width: `${splitRatio * 100}%` }}>
                <header
                    className={[
                        'border-b border-slate-300 bg-slate-50 px-3 py-2',
                        isPrimaryDropActive ? 'border-blue-500 text-blue-700' : 'text-slate-700',
                    ].join(' ')}
                    onDragOver={(event) => {
                        const tabId = extractDraggedTabId(event);
                        if (!tabId) return;
                        event.preventDefault();
                        setIsPrimaryDropActive(true);
                    }}
                    onDragLeave={() => setIsPrimaryDropActive(false)}
                    onDrop={handleDropToPrimary}
                >
                    <div className="flex items-center justify-between text-[11px] font-medium">
                        <span className="truncate">Primary pane: {activeTab?.title || 'Active tab'}</span>
                        <span className="opacity-70">Drop tab here to focus</span>
                    </div>
                    {paneTabStrip('primary')}
                </header>
                <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
            </section>

            <div
                className={`w-2 cursor-col-resize border-l border-r border-slate-300 bg-slate-100 hover:bg-blue-100 ${isResizing ? 'bg-blue-200' : ''}`}
                onMouseDown={() => setIsResizing(true)}
                title="Drag to resize panes"
            />

            <section className="flex min-w-0 flex-col" style={{ width: `${(1 - splitRatio) * 100}%` }}>
                <header
                    className={[
                        'border-b border-slate-300 bg-slate-50 px-3 py-2',
                        isSecondaryDropActive ? 'border-blue-500 text-blue-700' : 'text-slate-700',
                    ].join(' ')}
                    onDragOver={(event) => {
                        const tabId = extractDraggedTabId(event);
                        if (!tabId) return;
                        event.preventDefault();
                        setIsSecondaryDropActive(true);
                    }}
                    onDragLeave={() => setIsSecondaryDropActive(false)}
                    onDrop={handleDropToSecondary}
                >
                    <div className="flex items-center justify-between text-[11px] font-medium">
                        <span className="truncate">Secondary pane: {secondaryTab.title}</span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={focusSecondaryAsPrimary}
                                className="h-7 px-2 rounded border border-slate-300 transition-colors hover:bg-slate-900 hover:text-white"
                                title="Focus this tab in primary pane"
                            >
                                <ArrowLeftRight className="h-3 w-3" />
                            </button>
                            <button
                                onClick={closeSplitView}
                                className="h-7 px-2 rounded border border-slate-300 transition-colors hover:bg-red-500 hover:text-white"
                                title="Close split view"
                            >
                                <PanelRightClose className="h-3 w-3" />
                            </button>
                        </div>
                    </div>
                    {paneTabStrip('secondary')}
                </header>

                <div className="flex-1 min-h-0 overflow-y-auto bg-background">
                    {SecondaryComponent && secondaryTabDefinition ? (
                        <SecondaryComponent key={secondaryTab.id} {...(secondaryTabDefinition.props || {})} />
                    ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-500">
                            Unable to render secondary tab. Open it as primary and retry.
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
};
