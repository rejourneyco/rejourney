import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTabs } from '../../context/TabContext';
import { useSessionData } from '../../context/SessionContext';
import { useSafeTeam } from '../../context/TeamContext';
import {
    Plus,
    X,
    Trash2,
    Layers,
    Undo2,
    PanelRightClose,
    SplitSquareVertical,
    LayoutTemplate,
    FileText
} from 'lucide-react';

interface TabBarProps {
    pathPrefix?: string;
    group?: 'primary' | 'secondary';
}

const STALE_TAB_KEEP_COUNT = 6;
const TAB_DRAG_MIME = 'application/x-rejourney-tab-id';

function compactLabel(value?: string | null, fallback: string = 'Unknown'): string {
    if (!value) return fallback;
    return value.length > 22 ? `${value.slice(0, 20)}...` : value;
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
        maxTabs,
        isSplitView,
        closeSplitView,
    } = useTabs();
    const { selectedProject } = useSessionData();
    const { currentTeam } = useSafeTeam();
    const navigate = useNavigate();

    const groupTabs = tabs.filter(t => t.group === group);
    const activeId = group === 'primary' ? activeTabId : secondaryTabId;

    const draggedItem = useRef<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    const closableTabs = tabs.filter((tab) => tab.isClosable).length;
    const canReopen = recentlyClosed.length > 0;
    const canCloseStale = closableTabs > STALE_TAB_KEEP_COUNT;
    const tabsNearLimit = tabs.length >= maxTabs - 2;
    const tabCounterClass = tabs.length >= maxTabs
        ? 'text-red-600 border-red-300 bg-red-50'
        : tabsNearLimit
            ? 'text-amber-700 border-amber-300 bg-amber-50'
            : 'text-slate-600 border-slate-300 bg-white';

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
            className="dashboard-tabbar flex items-end gap-1 overflow-x-auto no-scrollbar border-b border-slate-200 bg-slate-50/80 px-2 pt-2"
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

                    // Style logic
                    let baseClasses = "group relative flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-xs transition-all select-none min-w-0";
                    // Shrinking behavior: allow shrinking but clamp at a minimum usable width if possible, 
                    // or just let flex handle it with text-overflow.
                    // We use flex-1 to allow equal growth, but shrink-1 to allow fitting.
                    // min-w-0 allows it to shrink below content size if needed, but we probably want a visual min-w.
                    // Let's use a dynamic width approach: flex-1 but with a max-width constraint.

                    let stateClasses = "";

                    if (isActive) {
                        stateClasses = "z-10 -mb-px border-slate-300 bg-white text-slate-900 font-medium shadow-sm";
                    } else {
                        stateClasses = "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-200/50";
                    }

                    if (isDraggingOver) {
                        stateClasses += " border-blue-500 bg-blue-50";
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
                            className={`${baseClasses} ${stateClasses} flex-1 max-w-[240px]`}
                            title={`Project: ${projectLabel}\n${tab.title}`}
                        >

                            {isActive && (
                                <div className={`absolute left-0 right-0 top-0 h-[2px] rounded-t-sm ${group === 'primary' ? 'bg-blue-500' : 'bg-purple-500'}`} />
                            )}

                            <div className="min-w-0 flex-1 flex items-center gap-2">
                                <TabIcon className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-slate-600' : 'text-slate-400'}`} />
                                <div className="truncate text-[13px] leading-tight">{tab.title}</div>
                            </div>

                            <div className={`flex items-center gap-0.5 shrink-0 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                {group === 'primary' && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openTabInSplit(tab.id);
                                        }}
                                        className="flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-sky-100 hover:text-sky-600"
                                        title="Open in split pane"
                                    >
                                        <LayoutTemplate className="h-3 w-3" />
                                    </button>
                                )}

                                {tab.isClosable && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            closeTab(tab.id, e);
                                        }}
                                        className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-red-100 hover:text-red-600 transition-colors"
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
                        className="flex h-[35px] shrink-0 items-center justify-center rounded-t-md border border-b-0 border-transparent px-2 text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-800"
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
