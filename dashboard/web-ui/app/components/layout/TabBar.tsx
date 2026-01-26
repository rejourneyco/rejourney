import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTabs } from '../../context/TabContext';
import { Plus, X } from 'lucide-react';

interface TabBarProps {
    pathPrefix?: string;
}

export const TabBar: React.FC<TabBarProps> = ({ pathPrefix = '' }) => {
    const { tabs, activeTabId, setActiveTabId, closeTab, reorderTabs } = useTabs();
    const navigate = useNavigate();
    const draggedItem = useRef<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        draggedItem.current = index;
        e.dataTransfer.effectAllowed = 'move';
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

    const handleNewTab = () => {
        navigate(`${pathPrefix}/search`);
    };

    if (tabs.length === 0) return null;

    return (
        <div className="flex items-end bg-slate-50 border-b-2 border-slate-900 px-2 pt-2 gap-1 overflow-x-auto no-scrollbar">
            {tabs.map((tab, index) => {
                const isActive = tab.id === activeTabId;
                const isDraggingOver = dragOverIndex === index;

                return (
                    <div
                        key={tab.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        onClick={() => handleTabClick(tab)}
                        className={`
                            group flex items-center gap-2 px-4 py-2 min-w-[140px] max-w-[220px] 
                            cursor-pointer select-none transition-all text-xs font-bold font-mono border-t-2 border-x-2
                            relative
                            ${isActive
                                ? 'bg-white text-slate-900 border-slate-900 z-10 -mb-[2px] pb-[10px]'
                                : 'bg-slate-200 text-slate-500 border-transparent hover:bg-slate-100 hover:text-slate-900 hover:border-slate-300'
                            }
                            ${isDraggingOver ? 'bg-blue-50 border-blue-500' : ''}
                        `}
                    >
                        <span className="truncate flex-1 uppercase tracking-tight">
                            {tab.title}
                        </span>
                        {tab.isClosable && (
                            <button
                                onClick={(e) => closeTab(tab.id, e)}
                                className={`
                                    w-4 h-4 flex items-center justify-center rounded-none border border-transparent
                                    hover:bg-red-500 hover:text-white hover:border-slate-900 transition-all text-slate-400
                                    ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                                `}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                );
            })}

            {/* New Tab Button */}
            <button
                onClick={handleNewTab}
                className="flex items-center justify-center w-8 h-8 hover:bg-slate-900 hover:text-white transition-colors ml-1 mb-1 border-2 border-transparent hover:border-slate-900"
                title="New Tab"
            >
                <Plus className="w-4 h-4" />
            </button>
        </div>
    );
};
