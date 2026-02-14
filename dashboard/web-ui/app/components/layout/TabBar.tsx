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
} from 'lucide-react';

interface TabBarProps {
    pathPrefix?: string;
}

const STALE_TAB_KEEP_COUNT = 6;
const TAB_DRAG_MIME = 'application/x-rejourney-tab-id';

function compactLabel(value?: string | null, fallback: string = 'Unknown'): string {
    if (!value) return fallback;
    return value.length > 22 ? `${value.slice(0, 20)}...` : value;
}

export const TabBar: React.FC<TabBarProps> = ({ pathPrefix = '' }) => {
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
        recentlyClosed,
        maxTabs,
        isSplitView,
        closeSplitView,
    } = useTabs();
    const { selectedProject } = useSessionData();
    const { currentTeam } = useSafeTeam();
    const navigate = useNavigate();

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
        if (draggedItem.current === null || draggedItem.current === index) return;
        setDragOverIndex(index);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        const fromIndex = draggedItem.current;
        if (fromIndex !== null && fromIndex !== index) {
            reorderTabs(fromIndex, index);
        }
        draggedItem.current = null;
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        draggedItem.current = null;
        setDragOverIndex(null);
    };

    const handleTabClick = (tab: { id: string; path: string }) => {
        setActiveTabId(tab.id);
        navigate(tab.path);
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
        navigate(`${pathPrefix}/search`);
    };

    return (
        <div
            className="dashboard-tabbar flex items-end gap-1 overflow-x-auto no-scrollbar border-b border-slate-200 bg-slate-100/60 px-2 pt-2"
            onClick={() => setContextMenu(null)}
        >
            {tabs.map((tab, index) => {
                const isActive = tab.id === activeTabId;
                const isSecondary = tab.id === secondaryTabId;
                const isDraggingOver = dragOverIndex === index;
                const projectLabel = compactLabel(tab.projectName || selectedProject?.name, 'Project');
                const teamLabel = compactLabel(tab.teamName || currentTeam?.name, 'Team');

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
                            'group relative flex min-w-[190px] max-w-[280px] cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-xs transition-colors',
                            isActive
                                ? 'z-10 -mb-px border-slate-300 bg-white pb-[10px] text-slate-900 shadow-sm'
                                : 'border-transparent bg-slate-200/70 text-slate-600 hover:border-slate-300 hover:bg-white/85 hover:text-slate-900',
                            isDraggingOver ? 'border-blue-500 bg-blue-50' : '',
                        ].join(' ')}
                        title={`Project: ${projectLabel}\nTeam: ${teamLabel}`}
                    >
                        {isActive && (
                            <div className="absolute left-0 right-0 top-0 h-[2px] rounded-t-md bg-sky-500" />
                        )}

                        <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{tab.title}</div>
                            <div className="truncate text-[10px] text-slate-500">{projectLabel} • {teamLabel}</div>
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openTabInSplit(tab.id);
                                }}
                                className={[
                                    'flex h-5 w-5 items-center justify-center rounded border border-transparent text-slate-400 transition-colors',
                                    isSecondary
                                        ? 'border-sky-300 bg-sky-50 text-sky-600'
                                        : 'opacity-0 group-hover:opacity-100 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-600',
                                ].join(' ')}
                                title={isSecondary ? 'Already in split pane' : 'Open in split pane'}
                            >
                                <SplitSquareVertical className="h-3 w-3" />
                            </button>

                            {tab.isClosable && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closeTab(tab.id, e);
                                    }}
                                    className={[
                                        'flex h-5 w-5 items-center justify-center rounded border border-transparent text-slate-400 transition-colors',
                                        isActive
                                            ? 'opacity-100 hover:border-red-500 hover:bg-red-500 hover:text-white'
                                            : 'opacity-0 group-hover:opacity-100 hover:border-red-500 hover:bg-red-500 hover:text-white',
                                    ].join(' ')}
                                    title="Close tab"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}

            {tabs.length === 0 && (
                <div className="px-4 py-2 text-[11px] text-slate-500">No open tabs</div>
            )}

            <div className="ml-4 mb-1 flex items-center gap-1 border-l border-slate-300 pl-2">
                {isSplitView && (
                    <div className="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700">
                        Split active
                    </div>
                )}

                <div className="hidden xl:flex items-center gap-1">
                    <span className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-600">
                        Team: {compactLabel(currentTeam?.name, 'No team')}
                    </span>
                    <span className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-600">
                        Project: {compactLabel(selectedProject?.name, 'No project')}
                    </span>
                </div>

                <div className={`rounded border px-2 py-1 text-[10px] font-medium ${tabCounterClass}`}>
                    {tabs.length}/{maxTabs} tabs
                </div>

                <button
                    onClick={handleReopen}
                    disabled={!canReopen}
                    className={[
                        'flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors',
                        canReopen
                            ? 'hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800'
                            : 'cursor-not-allowed opacity-40',
                    ].join(' ')}
                    title={canReopen ? 'Reopen last closed tab' : 'No recently closed tabs'}
                >
                    <Undo2 className="h-4 w-4" />
                </button>

                <button
                    onClick={handleCloseStale}
                    disabled={!canCloseStale}
                    className={[
                        'flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors',
                        canCloseStale
                            ? 'hover:border-amber-200 hover:bg-amber-100 hover:text-amber-700'
                            : 'cursor-not-allowed opacity-40',
                    ].join(' ')}
                    title={canCloseStale ? 'Close older tabs, keep recent' : 'Not enough tabs to clean up'}
                >
                    <Layers className="h-4 w-4" />
                </button>

                <button
                    onClick={handleNewTab}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    title="New tab"
                >
                    <Plus className="h-4 w-4" />
                </button>

                {isSplitView && (
                    <button
                        onClick={handleCloseSplit}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors hover:border-blue-200 hover:bg-blue-100 hover:text-blue-700"
                        title="Close split view"
                    >
                        <PanelRightClose className="h-4 w-4" />
                    </button>
                )}

                <button
                    onClick={handleCloseAll}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors hover:border-red-200 hover:bg-red-100 hover:text-red-700"
                    title="Close all tabs"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
            </div>

            {contextMenu && (
                <div
                    className="fixed z-[100] min-w-[180px] rounded-md border border-slate-200 bg-white py-1 text-xs font-medium shadow-xl"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-100"
                        onClick={() => {
                            closeTab(contextMenu.id);
                            setContextMenu(null);
                        }}
                    >
                        Close Tab
                        <X className="h-3 w-3" />
                    </button>

                    <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-sky-50"
                        onClick={() => {
                            openTabInSplit(contextMenu.id);
                            setContextMenu(null);
                        }}
                    >
                        Open In Split Pane
                        <SplitSquareVertical className="h-3 w-3" />
                    </button>

                    <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-100"
                        onClick={() => handleCloseOthers(contextMenu.id)}
                    >
                        Close Others
                        <X className="h-3 w-3" />
                    </button>

                    <button
                        className={[
                            'flex w-full items-center justify-between px-3 py-2 text-left',
                            canCloseStale ? 'hover:bg-amber-100' : 'cursor-not-allowed opacity-50',
                        ].join(' ')}
                        disabled={!canCloseStale}
                        onClick={handleCloseStale}
                    >
                        Close Stale
                        <Layers className="h-3 w-3" />
                    </button>

                    <button
                        className={[
                            'flex w-full items-center justify-between px-3 py-2 text-left',
                            canReopen ? 'hover:bg-slate-100' : 'cursor-not-allowed opacity-50',
                        ].join(' ')}
                        disabled={!canReopen}
                        onClick={handleReopen}
                    >
                        Reopen Last
                        <Undo2 className="h-3 w-3" />
                    </button>

                    {isSplitView && (
                        <button
                            className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-blue-100"
                            onClick={handleCloseSplit}
                        >
                            Close Split
                            <PanelRightClose className="h-3 w-3" />
                        </button>
                    )}

                    <div className="mx-1 my-1 h-px bg-slate-200" />

                    <button
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-red-100"
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
