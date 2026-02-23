import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTabs } from '../../context/TabContext';
import { useSessionData } from '../../context/SessionContext';
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

type TabCategory = 'issues' | 'replays' | 'analytics' | 'stability' | 'alerts' | 'settings' | 'search' | 'other';

type TabTheme = {
    shortLabel: string;
    accent: string;
    badgeBg: string;
    badgeText: string;
    idleBg: string;
    idleHoverBg: string;
};

const TAB_THEME_MAP: Record<TabCategory, TabTheme> = {
    issues: {
        shortLabel: 'GEN',
        accent: '#2563eb',
        badgeBg: '#dbeafe',
        badgeText: '#1d4ed8',
        idleBg: '#eff6ff',
        idleHoverBg: '#dbeafe',
    },
    replays: {
        shortLabel: 'RPL',
        accent: '#0f766e',
        badgeBg: '#ccfbf1',
        badgeText: '#0f766e',
        idleBg: '#ecfeff',
        idleHoverBg: '#cffafe',
    },
    analytics: {
        shortLabel: 'ANL',
        accent: '#0e7490',
        badgeBg: '#d1f4ff',
        badgeText: '#0e7490',
        idleBg: '#e0f2fe',
        idleHoverBg: '#bae6fd',
    },
    stability: {
        shortLabel: 'STB',
        accent: '#dc2626',
        badgeBg: '#fee2e2',
        badgeText: '#b91c1c',
        idleBg: '#fef2f2',
        idleHoverBg: '#fee2e2',
    },
    alerts: {
        shortLabel: 'ALT',
        accent: '#b45309',
        badgeBg: '#fef3c7',
        badgeText: '#b45309',
        idleBg: '#fffbeb',
        idleHoverBg: '#fef3c7',
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

function getTabCategory(path: string, tabId: string): TabCategory {
    const normalizedPath = stripPathPrefix(path);

    if (normalizedPath.startsWith('/analytics')) return 'analytics';
    if (normalizedPath.startsWith('/stability')) return 'stability';
    if (normalizedPath.startsWith('/sessions')) return 'replays';
    if (normalizedPath.startsWith('/alerts')) return 'alerts';
    if (
        normalizedPath.startsWith('/settings')
        || normalizedPath.startsWith('/team')
        || normalizedPath.startsWith('/account')
        || normalizedPath.startsWith('/billing')
    ) return 'settings';
    if (normalizedPath.startsWith('/search')) return 'search';
    if (normalizedPath.startsWith('/general') || normalizedPath.startsWith('/issues')) return 'issues';

    if (tabId.startsWith('session-')) return 'replays';
    if (tabId.startsWith('crash-') || tabId.startsWith('anr-') || tabId.startsWith('error-')) return 'stability';
    if (tabId.startsWith('issue-')) return 'issues';

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
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    const closableTabs = tabs.filter((tab) => tab.isClosable).length;
    const canReopen = recentlyClosed.length > 0;
    const canCloseStale = closableTabs > STALE_TAB_KEEP_COUNT;

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

    return (
        <div
            className="dashboard-tabbar flex items-end gap-1 overflow-x-auto no-scrollbar border-b bg-slate-100 px-2 pt-2"
            style={{ borderColor: '#cbd5e1' }}
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
            <div className="flex flex-1 items-end gap-1 overflow-hidden min-w-0">
                {groupTabs.map((tab, index) => {
                    const isActive = tab.id === activeId;
                    const isDraggingOver = dragOverIndex === index;
                    const projectLabel = compactLabel(tab.projectName || selectedProject?.name, 'Project');
                    const TabIcon = tab.icon || FileText;
                    const category = getTabCategory(tab.path, tab.id);
                    const tabTheme = TAB_THEME_MAP[category];

                    const tabStyle: React.CSSProperties = isActive
                        ? {
                            borderColor: '#cbd5e1',
                            background: 'linear-gradient(180deg, #ffffff 0%, #ffffff 68%, #f8fafc 100%)',
                            boxShadow: `inset 0 3px 0 0 ${tabTheme.accent}`,
                        }
                        : {
                            borderColor: '#d7e0eb',
                            backgroundColor: tabTheme.idleBg,
                            boxShadow: `inset 0 2px 0 0 ${tabTheme.accent}99`,
                        };

                    if (isDraggingOver) {
                        tabStyle.borderColor = tabTheme.accent;
                        tabStyle.backgroundColor = tabTheme.idleHoverBg;
                    }

                    return (
                        <div
                            key={tab.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, index, tab.id)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={(e) => handleDrop(e, index)}
                            onDragEnd={handleDragEnd}
                            onClick={() => handleTabClick(tab)}
                            onContextMenu={(e) => handleContextMenu(e, tab.id)}
                            className={[
                                'group relative flex flex-1 min-w-0 max-w-[260px] cursor-pointer select-none items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-xs transition-all duration-150',
                                isActive ? 'z-20 -mb-px text-slate-900' : 'text-slate-600 hover:-translate-y-[1px] hover:text-slate-900',
                            ].join(' ')}
                            style={tabStyle}
                            title={`Project: ${projectLabel}\n${tab.title}`}
                        >
                            <div
                                className="absolute left-2 right-2 top-0 h-[3px] rounded-full"
                                style={{ backgroundColor: tabTheme.accent, opacity: isActive ? 1 : 0.75 }}
                            />

                            <div className="min-w-0 flex-1 flex items-center gap-2">
                                <TabIcon className="h-3.5 w-3.5 shrink-0" style={{ color: tabTheme.accent }} />
                                <div className="truncate text-[12px] leading-tight font-semibold">{tab.title}</div>
                                <span
                                    className="hidden shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-[0.08em] text-inherit sm:inline-flex"
                                    style={{ backgroundColor: tabTheme.badgeBg, color: tabTheme.badgeText }}
                                >
                                    {tabTheme.shortLabel}
                                </span>
                            </div>

                            <div className={`flex items-center gap-0.5 shrink-0 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                {tab.isClosable && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            closeTab(tab.id, e);
                                        }}
                                        className="flex h-4 w-4 items-center justify-center rounded-sm text-slate-500 hover:bg-red-100 hover:text-red-600 transition-colors"
                                        title="Close tab"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
                {groupTabs.length === 0 && (
                    <div className="px-4 py-2 text-sm text-slate-500 italic">No open tabs</div>
                )}
                {group === 'primary' && (
                    <button
                        onClick={handleNewTab}
                        className="flex h-[35px] shrink-0 items-center justify-center rounded-t-lg border border-b-0 px-3 text-slate-600 transition-colors hover:text-slate-900"
                        style={{ borderColor: '#d7e0eb', backgroundColor: '#e2e8f0' }}
                        title="New tab"
                    >
                        <Plus className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* Controls Area */}
            <div className="flex items-center gap-1 border-l border-slate-300 pl-2 ml-1 shrink-0 pb-1">
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
