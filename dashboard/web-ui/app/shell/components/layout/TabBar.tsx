import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTabs } from '~/shared/providers/TabContext';
import { useSessionData } from '~/shared/providers/SessionContext';
import {
    Plus,
    X,
    Trash2,
    Layers,
    Undo2,
    PanelRightClose,
    SplitSquareVertical,
    FileText
} from 'lucide-react';

interface TabBarProps {
    pathPrefix?: string;
    group?: 'primary' | 'secondary';
}

const STALE_TAB_KEEP_COUNT = 6;
const TAB_DRAG_MIME = 'application/x-rejourney-tab-id';

type TabThemeKey =
    | 'general'
    | 'sessions'
    | 'api'
    | 'journeys'
    | 'heatmaps'
    | 'devices'
    | 'geo'
    | 'crashes'
    | 'anrs'
    | 'errors'
    | 'alerts'
    | 'settings'
    | 'search'
    | 'other';

type TabTheme = {
    shortLabel: string;
    accent: string;
    badgeBg: string;
    badgeText: string;
    idleBg: string;
    idleHoverBg: string;
};

const TAB_THEME_MAP: Record<TabThemeKey, TabTheme> = {
    general: {
        shortLabel: 'GEN',
        accent: '#5dadec',
        badgeBg: '#dbeafe',
        badgeText: '#0369a1',
        idleBg: '#eff6ff',
        idleHoverBg: '#dbeafe',
    },
    sessions: {
        shortLabel: 'RPL',
        accent: '#6366f1',
        badgeBg: '#e0e7ff',
        badgeText: '#4338ca',
        idleBg: '#eef2ff',
        idleHoverBg: '#e0e7ff',
    },
    api: {
        shortLabel: 'API',
        accent: '#10b981',
        badgeBg: '#d1fae5',
        badgeText: '#047857',
        idleBg: '#ecfdf5',
        idleHoverBg: '#d1fae5',
    },
    journeys: {
        shortLabel: 'JRN',
        accent: '#d946ef',
        badgeBg: '#fae8ff',
        badgeText: '#a21caf',
        idleBg: '#fdf4ff',
        idleHoverBg: '#fae8ff',
    },
    heatmaps: {
        shortLabel: 'HEA',
        accent: '#f43f5e',
        badgeBg: '#ffe4e6',
        badgeText: '#be123c',
        idleBg: '#fff1f2',
        idleHoverBg: '#ffe4e6',
    },
    devices: {
        shortLabel: 'DEV',
        accent: '#6366f1',
        badgeBg: '#e0e7ff',
        badgeText: '#4338ca',
        idleBg: '#eef2ff',
        idleHoverBg: '#e0e7ff',
    },
    geo: {
        shortLabel: 'GEO',
        accent: '#0284c7',
        badgeBg: '#dbeafe',
        badgeText: '#0369a1',
        idleBg: '#f0f9ff',
        idleHoverBg: '#dbeafe',
    },
    crashes: {
        shortLabel: 'CRH',
        accent: '#e11d48',
        badgeBg: '#ffe4e6',
        badgeText: '#be123c',
        idleBg: '#fff1f2',
        idleHoverBg: '#ffe4e6',
    },
    anrs: {
        shortLabel: 'ANR',
        accent: '#8b5cf6',
        badgeBg: '#ede9fe',
        badgeText: '#6d28d9',
        idleBg: '#f5f3ff',
        idleHoverBg: '#ede9fe',
    },
    errors: {
        shortLabel: 'ERR',
        accent: '#f59e0b',
        badgeBg: '#fef3c7',
        badgeText: '#b45309',
        idleBg: '#fffbeb',
        idleHoverBg: '#fef3c7',
    },
    alerts: {
        shortLabel: 'ALT',
        accent: '#ef4444',
        badgeBg: '#fee2e2',
        badgeText: '#b91c1c',
        idleBg: '#fef2f2',
        idleHoverBg: '#fee2e2',
    },
    settings: {
        shortLabel: 'CFG',
        accent: '#475569',
        badgeBg: '#e2e8f0',
        badgeText: '#334155',
        idleBg: '#f1f5f9',
        idleHoverBg: '#e2e8f0',
    },
    search: {
        shortLabel: 'NEW',
        accent: '#334155',
        badgeBg: '#e2e8f0',
        badgeText: '#1e293b',
        idleBg: '#f8fafc',
        idleHoverBg: '#e2e8f0',
    },
    other: {
        shortLabel: 'TAB',
        accent: '#64748b',
        badgeBg: '#e2e8f0',
        badgeText: '#475569',
        idleBg: '#f8fafc',
        idleHoverBg: '#e2e8f0',
    },
};

function compactLabel(value?: string | null, fallback: string = 'Unknown'): string {
    if (!value) return fallback;
    return value.length > 22 ? `${value.slice(0, 20)}...` : value;
}

function stripPathPrefix(pathname: string): string {
    return pathname.replace(/^\/(dashboard|demo)/, '');
}

function getTabThemeKey(path: string, tabId: string): TabThemeKey {
    const normalizedPath = stripPathPrefix(path);

    if (normalizedPath.startsWith('/analytics/api')) return 'api';
    if (normalizedPath.startsWith('/analytics/journeys')) return 'journeys';
    if (normalizedPath.startsWith('/analytics/heatmaps')) return 'heatmaps';
    if (normalizedPath.startsWith('/analytics/devices')) return 'devices';
    if (normalizedPath.startsWith('/analytics/geo')) return 'geo';
    if (normalizedPath.startsWith('/sessions')) return 'sessions';
    if (normalizedPath.startsWith('/alerts')) return 'alerts';
    if (normalizedPath.startsWith('/stability/crashes')) return 'crashes';
    if (normalizedPath.startsWith('/stability/anrs')) return 'anrs';
    if (normalizedPath.startsWith('/stability/errors')) return 'errors';
    if (
        normalizedPath.startsWith('/settings')
        || normalizedPath.startsWith('/team')
        || normalizedPath.startsWith('/account')
        || normalizedPath.startsWith('/billing')
    ) return 'settings';
    if (normalizedPath.startsWith('/search')) return 'search';
    if (normalizedPath.startsWith('/general') || normalizedPath.startsWith('/issues')) return 'general';

    if (tabId.startsWith('session-')) return 'sessions';
    if (tabId.startsWith('crash-')) return 'crashes';
    if (tabId.startsWith('anr-')) return 'anrs';
    if (tabId.startsWith('error-')) return 'errors';
    if (tabId.startsWith('issue-')) return 'general';

    return 'other';
}

export const TabBar: React.FC<TabBarProps> = ({ pathPrefix = '', group = 'primary' }) => {
    const {
        tabs,
        activeTabId,
        secondaryTabId,
        setActiveTabId,
        closeTab,
        reorderTabs,
        closeAllTabs,
        closeOtherTabs,
        closeStaleTabs,
        reopenTab,
        openTabInSplit,
        moveTabToGroup,
        recentlyClosed,
        isSplitView,
        closeSplitView,
    } = useTabs();
    const { selectedProject } = useSessionData();
    const navigate = useNavigate();

    const groupTabs = tabs.filter(t => t.group === group);
    const activeId = group === 'primary' ? activeTabId : secondaryTabId;

    const draggedItem = useRef<number | null>(null);
    const tabScrollRef = useRef<HTMLDivElement | null>(null);
    const tabElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    const closableTabs = tabs.filter((tab) => tab.isClosable).length;
    const canReopen = recentlyClosed.length > 0;
    const canCloseStale = closableTabs > STALE_TAB_KEEP_COUNT;
    const tabOrderKey = groupTabs.map((tab) => tab.id).join('|');

    useEffect(() => {
        if (!activeId) return;
        const activeTabElement = tabElementRefs.current[activeId];
        if (!activeTabElement) return;
        activeTabElement.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'nearest',
        });
    }, [activeId, tabOrderKey]);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number, tabId: string) => {
        draggedItem.current = index;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(TAB_DRAG_MIME, tabId);
        e.dataTransfer.setData('text/plain', tabId);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        // If we need to support dragging from simple external sources, we might need checks here.
        // But for internal tab dragging:
        setDragOverIndex(index);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
        e.preventDefault();
        const tabId = e.dataTransfer.getData(TAB_DRAG_MIME);
        if (!tabId) return;

        const draggingTab = tabs.find(t => t.id === tabId);
        if (!draggingTab) return;

        if (draggingTab.group !== group) {
            // Moved to a different group!
            moveTabToGroup(tabId, group);
        } else {
            // Reordering within same group
            const sourceIndex = groupTabs.findIndex(t => t.id === tabId);
            if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
                reorderTabs(sourceIndex, targetIndex, group);
            }
        }

        draggedItem.current = null;
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        draggedItem.current = null;
        setDragOverIndex(null);
    };

    const handleTabClick = (tab: { id: string; path: string }) => {
        if (group === 'primary') {
            setActiveTabId(tab.id);
            navigate(tab.path);
        } else {
            // For secondary, we just set the secondary focus (context handles this usually via setSecondaryTabId)
            // But we need to expose a way to set it active specific to that pane?
            // TabContext's `openTab` or similar usually handles ID setting.
            // Let's use `moveTabToGroup` logic helper or add `setSecondaryTabId` to context export?
            // Actually `activeTabId` in context is GLOBAL active.
            // We need a way to say "This secondary tab is visible".
            // `moveTabToGroup` logic handles checks.
            // We can just call `moveTabToGroup` with same group and it handles secondary ID update?
            moveTabToGroup(tab.id, 'secondary');
        }
    };

    const handleContextMenu = (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        setContextMenu({ id, x: e.clientX, y: e.clientY });
    };

    const handleCloseOthers = (id: string) => {
        closeOtherTabs(id);
        setContextMenu(null);
    };

    const handleCloseAll = () => {
        if (confirm('Are you sure you want to close all tabs?')) {
            closeAllTabs();
        }
        setContextMenu(null);
    };

    const handleReopen = () => {
        reopenTab();
        setContextMenu(null);
    };

    const handleCloseStale = () => {
        closeStaleTabs();
        setContextMenu(null);
    };

    const handleCloseSplit = () => {
        closeSplitView();
        setContextMenu(null);
    };

    const handleNewTab = () => {
        // New tab always goes to primary
        navigate(`${pathPrefix}/search`);
    };

    const handleTabStripWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const container = tabScrollRef.current;
        if (!container || container.scrollWidth <= container.clientWidth) return;

        const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
        if (Math.abs(delta) < 0.5) return;

        event.preventDefault();
        container.scrollLeft += delta;
    };

    return (
        <div
            className="flex min-w-0 items-end bg-slate-50 border-b-2 border-black"
            onClick={() => setContextMenu(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                // Handle drop on empty space (append)
                e.preventDefault();
                const tabId = e.dataTransfer.getData(TAB_DRAG_MIME);
                if (tabId) {
                    moveTabToGroup(tabId, group);
                }
            }}
        >
            <div className="min-w-0 flex-1 overflow-hidden">
                <div
                    ref={tabScrollRef}
                    className="flex w-full items-end gap-[2px] overflow-x-auto overflow-y-hidden custom-scrollbar px-2 pt-2 pb-1"
                    onWheel={handleTabStripWheel}
                >
                    {groupTabs.map((tab, index) => {
                        const isActive = tab.id === activeId;
                        const isDraggingOver = dragOverIndex === index;
                        const projectLabel = compactLabel(tab.projectName || selectedProject?.name, 'Project');
                        const TabIcon = tab.icon || FileText;
                        const theme = TAB_THEME_MAP[getTabThemeKey(tab.path, tab.id)];
                        const tabStyle: React.CSSProperties = {
                            backgroundColor: isDraggingOver ? theme.idleHoverBg : isActive ? '#ffffff' : theme.idleBg,
                            color: isActive ? '#0f172a' : theme.badgeText,
                            borderTopColor: theme.accent,
                            borderTopWidth: '4px',
                            boxShadow: isActive ? `0 -1px 0 0 ${theme.accent} inset` : undefined,
                        };

                        return (
                            <div
                                key={tab.id}
                                ref={(node) => {
                                    tabElementRefs.current[tab.id] = node;
                                }}
                                draggable
                                data-tab-id={tab.id}
                                onDragStart={(e) => handleDragStart(e, index, tab.id)}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDrop={(e) => handleDrop(e, index)}
                                onDragEnd={handleDragEnd}
                                onClick={() => handleTabClick(tab)}
                                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                                className={[
                                    'group relative flex min-w-[120px] max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs transition-all border-2 border-black border-b-0 -mb-[2px]',
                                    isActive
                                        ? 'z-10 shadow-neo-sm translate-y-0.5 pb-[10px]'
                                        : 'z-0 opacity-95 hover:-translate-y-px hover:brightness-[0.98]',
                                ].join(' ')}
                                style={tabStyle}
                                title={`Project: ${projectLabel}\n${tab.title}`}
                            >
                                <div className="min-w-0 flex flex-1 items-center gap-2">
                                    <TabIcon
                                        className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'stroke-[2.8]' : 'stroke-[2.3]'}`}
                                        style={{ color: theme.accent }}
                                    />
                                    <div className={`truncate text-xs uppercase tracking-widest ${isActive ? 'font-black text-slate-900' : 'font-bold'}`}>
                                        {tab.title}
                                    </div>
                                </div>

                                <div className={`flex shrink-0 items-center ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                    {tab.isClosable && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                closeTab(tab.id, e);
                                            }}
                                            className="flex h-5 w-5 items-center justify-center border-2 border-transparent text-slate-700 transition-all hover:border-black hover:bg-red-500 hover:text-white hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                            title="Close tab"
                                        >
                                            <X className="h-3.5 w-3.5 stroke-[3]" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {groupTabs.length === 0 && (
                        <div className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-400">No open tabs</div>
                    )}
                    {group === 'primary' && (
                        <button
                            onClick={handleNewTab}
                            className="ml-1 flex h-[34px] w-[34px] shrink-0 items-center justify-center border-2 border-black border-b-0 bg-slate-200 text-slate-500 transition-colors hover:bg-white hover:text-black -mb-[2px]"
                            title="New tab"
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Controls Area */}
            <div className="flex items-center gap-1 border-l border-slate-200 pl-2 ml-1 shrink-0 pb-1">
                {group === 'primary' && (
                    <>
                        <button
                            onClick={handleReopen}
                            disabled={!canReopen}
                            className={[
                                'flex h-7 w-7 items-center justify-center rounded transition-colors',
                                canReopen ? 'hover:bg-slate-200 text-slate-500 hover:text-slate-800' : 'text-slate-300 cursor-not-allowed'
                            ].join(' ')}
                            title={canReopen ? 'Reopen closed tab' : 'No recently closed tabs'}
                        >
                            <Undo2 className="h-4 w-4" />
                        </button>

                        <button
                            onClick={handleCloseStale}
                            disabled={!canCloseStale}
                            className={[
                                'flex h-7 w-7 items-center justify-center rounded transition-colors',
                                canCloseStale ? 'hover:bg-amber-100 text-slate-500 hover:text-amber-700' : 'text-slate-300 cursor-not-allowed'
                            ].join(' ')}
                            title={canCloseStale ? 'Close stale tabs' : 'No stale tabs'}
                        >
                            <Layers className="h-4 w-4" />
                        </button>
                    </>
                )}

                {isSplitView && group === 'secondary' && (
                    <button
                        onClick={handleCloseSplit}
                        className="flex h-7 w-7 items-center justify-center rounded hover:bg-blue-100 text-blue-600 transition-colors"
                        title="Close split view"
                    >
                        <PanelRightClose className="h-4 w-4" />
                    </button>
                )}

                <button
                    onClick={handleCloseAll}
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors"
                    title="Close all tabs"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
            </div>

            {contextMenu && (
                <div
                    className="fixed z-[100] min-w-[180px] rounded-lg border border-slate-200 bg-white py-1 text-xs font-medium shadow-xl"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => {
                            closeTab(contextMenu.id);
                            setContextMenu(null);
                        }}
                    >
                        Close Tab
                        <X className="h-3 w-3" />
                    </button>

                    <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => {
                            openTabInSplit(contextMenu.id);
                            setContextMenu(null);
                        }}
                    >
                        Open In Split Pane
                        <SplitSquareVertical className="h-3 w-3" />
                    </button>

                    <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => handleCloseOthers(contextMenu.id)}
                    >
                        Close Others
                        <X className="h-3 w-3" />
                    </button>

                    <div className="mx-1 my-1 h-px bg-slate-100" />

                    <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-red-50 text-red-600"
                        onClick={handleCloseAll}
                    >
                        Close All
                        <Trash2 className="h-3 w-3" />
                    </button>
                </div>
            )}
        </div>
    );
};
