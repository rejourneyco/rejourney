/**
 * ViewHierarchyInspector - Interactive view hierarchy tree inspector
 * 
 * Shows the view tree structure similar to Xcode's view debugger:
 * - Collapsible tree view
 * - Property inspection panel
 * - Highlight selected view on replay
 * - Search/filter capabilities
 */

import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Search, X, Eye, EyeOff } from 'lucide-react';
import { dashboardButtonClass } from './dashboardStyles';

interface ViewNode {
  type: string;
  frame?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  properties?: Record<string, any>;
  children?: ViewNode[];
  accessibilityLabel?: string;
  accessibilityIdentifier?: string;
  text?: string;
  visible?: boolean;
  alpha?: number;
}

interface HierarchySnapshot {
  timestamp: number;
  screen: {
    width: number;
    height: number;
    scale: number;
  };
  root: ViewNode;
}

interface ViewHierarchyInspectorProps {
  hierarchySnapshots: HierarchySnapshot[];
  currentTime: number;
  sessionStartTime: number;
  onViewSelect?: (node: ViewNode) => void;
  className?: string;
}

const ViewHierarchyInspector: React.FC<ViewHierarchyInspectorProps> = ({
  hierarchySnapshots,
  currentTime,
  sessionStartTime,
  onViewSelect,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']));
  const [selectedNode, setSelectedNode] = useState<ViewNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Find the hierarchy snapshot closest to current time
  const currentHierarchy = useMemo(() => {
    if (hierarchySnapshots.length === 0) return null;
    
    const absoluteTime = sessionStartTime + currentTime;
    let closest = hierarchySnapshots[0];
    let minDiff = Math.abs(hierarchySnapshots[0].timestamp - absoluteTime);
    
    for (const snapshot of hierarchySnapshots) {
      const diff = Math.abs(snapshot.timestamp - absoluteTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snapshot;
      }
    }
    
    return closest;
  }, [hierarchySnapshots, currentTime, sessionStartTime]);

  const toggleNode = (path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleNodeClick = (node: ViewNode) => {
    setSelectedNode(node);
    onViewSelect?.(node);
  };

  const matchesSearch = (node: ViewNode, query: string): boolean => {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    return (
      node.type.toLowerCase().includes(lowerQuery) ||
      node.accessibilityLabel?.toLowerCase().includes(lowerQuery) ||
      node.accessibilityIdentifier?.toLowerCase().includes(lowerQuery) ||
      node.text?.toLowerCase().includes(lowerQuery) ||
      false
    );
  };

  const renderViewNode = (node: ViewNode, path: string = 'root', depth: number = 0): React.ReactNode => {
    if (!node) return null;

    const isExpanded = expandedNodes.has(path);
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedNode === node;
    const matches = matchesSearch(node, searchQuery);

    if (!matches && !searchQuery) return null;

    // Simple class name (last component)
    const className = node.type.split('.').pop() || node.type;
    const displayName = node.accessibilityLabel || node.text || className;

    return (
      <div key={path}>
        <div
          className={`flex cursor-pointer items-center gap-1 rounded-none px-2 py-1 ${
            isSelected ? 'bg-[#e8f0fe]' : 'hover:bg-[#f1f3f4]'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleNodeClick(node)}
        >
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(path);
              }}
              className="rounded-none p-0.5 hover:bg-[#e8eaed]"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-[#5f6368]" />
              ) : (
                <ChevronRight className="w-3 h-3 text-[#5f6368]" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-4" />}
          
          <div className="flex items-center gap-1.5 flex-1 min-w-0 text-xs">
            <span className="font-mono font-medium text-[#1a73e8]">{className}</span>
            {node.accessibilityLabel && (
              <span className="truncate text-[#5f6368]">"{node.accessibilityLabel}"</span>
            )}
            {node.text && !node.accessibilityLabel && (
              <span className="truncate text-[#188038]">"{node.text.substring(0, 30)}"</span>
            )}
            {node.visible === false && (
              <EyeOff className="w-3 h-3 text-[#9aa0a6]" />
            )}
            {node.alpha !== undefined && node.alpha < 1 && (
              <span className="text-[10px] tabular-nums text-[#80868b]">{Math.round(node.alpha * 100)}%</span>
            )}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div>
            {node.children!.map((child, idx) => 
              renderViewNode(child, `${path}.${idx}`, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-32 right-4 z-40 ${dashboardButtonClass('primary', 'md')}`}
      >
        View hierarchy
      </button>
    );
  }

  if (!currentHierarchy) {
    return (
      <div className={`fixed bottom-0 right-0 top-0 z-50 flex w-96 items-center justify-center rounded-none border-l border-[#dadce0] bg-white shadow-[0_4px_16px_rgba(60,64,67,0.2)] ${className}`}>
        <div className="p-8 text-center text-[#5f6368]">
          <Eye className="mx-auto mb-4 h-12 w-12 text-[#bdc1c6]" />
          <p className="font-medium text-[#202124]">No hierarchy data</p>
          <p className="mt-2 text-sm">View hierarchy was not captured for this session</p>
          <button
            onClick={() => setIsOpen(false)}
            className={`mt-4 ${dashboardButtonClass('secondary', 'sm')}`}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed bottom-0 right-0 top-0 z-50 flex w-96 flex-col rounded-none border-l border-[#dadce0] bg-white shadow-[0_4px_16px_rgba(60,64,67,0.2)] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e8eaed] bg-[#f8fafd] p-4">
        <div>
          <h3 className="text-[15px] font-medium text-[#202124]">View hierarchy</h3>
          <p className="mt-0.5 text-xs tabular-nums text-[#5f6368]">
            {currentHierarchy.screen.width} × {currentHierarchy.screen.height}
          </p>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="rounded-none p-1.5 transition-colors hover:bg-[#f1f3f4]"
          title="Close"
          aria-label="Close"
        >
          <X className="h-4 w-4 text-[#5f6368]" />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-[#e8eaed] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#80868b]" />
          <input
            type="text"
            placeholder="Search views..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-none border border-[#dadce0] bg-white pl-8 pr-8 text-xs text-[#202124] placeholder:text-[#80868b] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-1.5 my-auto flex h-5 w-5 items-center justify-center rounded-none hover:bg-[#f1f3f4]"
              aria-label="Clear search"
            >
              <X className="h-3 w-3 text-[#80868b]" />
            </button>
          )}
        </div>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-y-auto p-2">
        {renderViewNode(currentHierarchy.root)}
      </div>

      {/* Properties Panel */}
      {selectedNode && (
        <div className="max-h-64 overflow-y-auto border-t border-[#e8eaed] bg-[#f8fafd] p-4">
          <h4 className="mb-2 text-sm font-medium text-[#202124]">Properties</h4>
          <div className="space-y-1.5">
            <PropertyRow label="Type" value={selectedNode.type} />
            {selectedNode.frame && (
              <>
                <PropertyRow label="X" value={selectedNode.frame.x.toFixed(1)} />
                <PropertyRow label="Y" value={selectedNode.frame.y.toFixed(1)} />
                <PropertyRow label="Width" value={selectedNode.frame.width.toFixed(1)} />
                <PropertyRow label="Height" value={selectedNode.frame.height.toFixed(1)} />
              </>
            )}
            {selectedNode.accessibilityLabel && (
              <PropertyRow label="A11y Label" value={selectedNode.accessibilityLabel} />
            )}
            {selectedNode.accessibilityIdentifier && (
              <PropertyRow label="A11y ID" value={selectedNode.accessibilityIdentifier} />
            )}
            {selectedNode.text && (
              <PropertyRow label="Text" value={selectedNode.text} />
            )}
            {selectedNode.alpha !== undefined && (
              <PropertyRow label="Alpha" value={selectedNode.alpha.toFixed(2)} />
            )}
            {selectedNode.visible !== undefined && (
              <PropertyRow label="Visible" value={selectedNode.visible ? 'Yes' : 'No'} />
            )}
            {selectedNode.properties && Object.entries(selectedNode.properties).map(([key, value]) => (
              <PropertyRow key={key} label={key} value={String(value)} />
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="border-t border-[#e8eaed] bg-[#f8fafd] px-4 py-2 text-xs tabular-nums text-[#5f6368]">
        {hierarchySnapshots.length} snapshot{hierarchySnapshots.length !== 1 ? 's' : ''} available
      </div>
    </div>
  );
};

const PropertyRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-start gap-2 text-xs">
    <span className="min-w-[80px] text-[#5f6368]">{label}:</span>
    <span className="flex-1 break-all font-mono text-[#202124]">{value}</span>
  </div>
);

export default ViewHierarchyInspector;
