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
          className={`flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-slate-100 rounded ${
            isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''
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
              className="p-0.5 hover:bg-slate-200 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-slate-600" />
              ) : (
                <ChevronRight className="w-3 h-3 text-slate-600" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-4" />}
          
          <div className="flex items-center gap-1.5 flex-1 min-w-0 text-xs">
            <span className="font-mono text-blue-600 font-semibold">{className}</span>
            {node.accessibilityLabel && (
              <span className="text-slate-500 truncate">"{node.accessibilityLabel}"</span>
            )}
            {node.text && !node.accessibilityLabel && (
              <span className="text-emerald-600 truncate">"{node.text.substring(0, 30)}"</span>
            )}
            {node.visible === false && (
              <EyeOff className="w-3 h-3 text-slate-400" />
            )}
            {node.alpha !== undefined && node.alpha < 1 && (
              <span className="text-slate-400 text-[10px]">{Math.round(node.alpha * 100)}%</span>
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
        className="fixed right-4 bottom-32 z-40 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-blue-700 transition-colors text-sm font-medium"
      >
        View Hierarchy
      </button>
    );
  }

  if (!currentHierarchy) {
    return (
      <div className={`fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-slate-200 shadow-xl z-50 flex items-center justify-center ${className}`}>
        <div className="text-center text-slate-500 p-8">
          <Eye className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="font-medium">No Hierarchy Data</p>
          <p className="text-sm mt-2">View hierarchy was not captured for this session</p>
          <button
            onClick={() => setIsOpen(false)}
            className="mt-4 text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-slate-200 shadow-xl z-50 flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
        <div>
          <h3 className="font-bold text-sm text-slate-900">View Hierarchy</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {currentHierarchy.screen.width} × {currentHierarchy.screen.height}
          </p>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1.5 hover:bg-slate-200 rounded transition-colors"
          title="Close"
        >
          <X className="w-4 h-4 text-slate-600" />
        </button>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-slate-200">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search views..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1.5 p-0.5 hover:bg-slate-200 rounded"
            >
              <X className="w-3 h-3 text-slate-400" />
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
        <div className="border-t border-slate-200 p-4 bg-slate-50 max-h-64 overflow-y-auto">
          <h4 className="font-semibold text-xs text-slate-700 mb-2 uppercase tracking-wide">Properties</h4>
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
      <div className="border-t border-slate-200 px-4 py-2 bg-slate-50 text-xs text-slate-500">
        {hierarchySnapshots.length} snapshot{hierarchySnapshots.length !== 1 ? 's' : ''} available
      </div>
    </div>
  );
};

const PropertyRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-start gap-2 text-xs">
    <span className="font-mono text-slate-500 min-w-[80px]">{label}:</span>
    <span className="font-mono text-slate-900 flex-1 break-all">{value}</span>
  </div>
);

export default ViewHierarchyInspector;
