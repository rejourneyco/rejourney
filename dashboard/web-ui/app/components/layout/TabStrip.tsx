import React, { useRef, useState } from 'react';

// Tab state type (defined inline to avoid import issues)
type WorkspaceTabState = {
  id: string;
  title: string;
  path: string;
};

type Props = {
  tabs: WorkspaceTabState[];
  activeTabId: string | null;
  recentlyClosed: WorkspaceTabState[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onReopen: () => void;
};

export const TabStrip: React.FC<Props> = ({ tabs, activeTabId, onSelect, onClose, onReorder, onReopen, recentlyClosed }) => {
  const dragOverId = useRef<string | null>(null);
  const [isOverflowOpen, setOverflowOpen] = useState(false);

  const handleDragStart = (id: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', id);
    dragOverId.current = id;
  };

  const handleDrop = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === id) return;
    const order = [...tabs];
    const fromIndex = order.findIndex((t) => t.id === draggedId);
    const toIndex = order.findIndex((t) => t.id === id);
    if (fromIndex === -1 || toIndex === -1) return;
    order.splice(toIndex, 0, order.splice(fromIndex, 1)[0]);
    onReorder(order.map((t) => t.id));
  };

  return (
    <div className="flex items-center bg-slate-900 text-slate-100 px-3 border-b border-slate-800 h-11 select-none">
      <div className="flex overflow-x-auto gap-1 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            draggable
            onDragStart={handleDragStart(tab.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop(tab.id)}
            className={`group flex items-center min-w-[140px] max-w-[220px] px-3 py-1 rounded-md cursor-pointer border ${tab.id === activeTabId ? 'bg-slate-800 border-slate-600' : 'bg-slate-950 border-slate-900 hover:border-slate-700'
              }`}
            onClick={() => onSelect(tab.id)}
          >
            <span className="truncate text-sm">{tab.title}</span>
            <button
              className="ml-2 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              aria-label={`Close ${tab.title}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 ml-3">
        <button
          className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
          onClick={() => onReopen()}
          aria-label="Reopen closed tab"
        >
          Reopen
        </button>
        <div className="relative">
          <button
            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
            onClick={() => setOverflowOpen(!isOverflowOpen)}
          >
            Closed ({recentlyClosed.length})
          </button>
          {isOverflowOpen && (
            <div className="absolute right-0 mt-1 w-56 bg-slate-900 border border-slate-800 shadow-lg rounded-md z-10">
              {recentlyClosed.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">No recently closed tabs</div>
              )}
              {recentlyClosed.map((tab) => (
                <button
                  key={tab.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800"
                  onClick={() => {
                    setOverflowOpen(false);
                    onReopen();
                  }}
                >
                  {tab.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
