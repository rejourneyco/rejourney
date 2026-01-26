/**
 * DOMInspector - Comprehensive view hierarchy inspector for session replays
 * 
 * Features:
 * - Wireframe View: Visual blueprint of the UI with clickable elements
 * - Tree View: Hierarchical component tree like React DevTools/Chrome DevTools
 * - Property Inspector: Detailed properties panel for selected node
 * 
 * Synchronized selection between wireframe and tree views
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Eye,
  EyeOff,
  LayoutGrid,
  List,
  Square,
  Type,
  Image,
  MousePointer,
  ScrollText,
  Lock,
  Box,
  Layers,
  Copy,
  Check,
} from 'lucide-react';
import WireframeView, { ViewNode } from './WireframeView';

export interface HierarchySnapshot {
  timestamp: number;
  screen: {
    width: number;
    height: number;
    scale: number;
  };
  root: ViewNode;
}

interface DOMInspectorProps {
  hierarchySnapshots: HierarchySnapshot[];
  currentTime: number;
  sessionStartTime: number;
  deviceWidth?: number;
  deviceHeight?: number;
  onClose?: () => void;
  className?: string;
}

type ViewMode = 'wireframe' | 'tree';

// Get icon for view type
const getViewIcon = (node: ViewNode) => {
  const type = (node?.type || '').toLowerCase();

  if (type.includes('button') || type.includes('touchable') || type.includes('pressable') || node.interactive) {
    return MousePointer;
  }
  if (type.includes('text') || type.includes('label')) {
    return Type;
  }
  if (type.includes('image')) {
    return Image;
  }
  if (type.includes('scroll') || type.includes('flatlist')) {
    return ScrollText;
  }
  if (node.masked) {
    return Lock;
  }
  return Box;
};

// Get color for view type
const getViewTypeColor = (node: ViewNode): string => {
  const type = (node?.type || '').toLowerCase();

  if (type.includes('button') || type.includes('touchable') || node.interactive) return 'text-blue-500';
  if (type.includes('text') || type.includes('label')) return 'text-emerald-500';
  if (type.includes('image')) return 'text-purple-500';
  if (type.includes('scroll') || type.includes('flatlist')) return 'text-amber-500';
  if (type.includes('input')) return 'text-pink-500';
  if (node.masked) return 'text-red-500';
  return 'text-slate-500';
};

export const DOMInspector: React.FC<DOMInspectorProps> = ({
  hierarchySnapshots,
  currentTime,
  sessionStartTime,
  deviceWidth = 375,
  deviceHeight = 812,
  onClose,
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('wireframe');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root', 'root.0']));
  const [selectedNode, setSelectedNode] = useState<ViewNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<ViewNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedProperty, setCopiedProperty] = useState<string | null>(null);

  // Find the hierarchy snapshot closest to current time
  const currentHierarchy = useMemo(() => {
    if (hierarchySnapshots.length === 0) return null;

    const absoluteTime = sessionStartTime + currentTime * 1000;
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

  const screenWidth = currentHierarchy?.screen?.width || deviceWidth;
  const screenHeight = currentHierarchy?.screen?.height || deviceHeight;

  const toggleNode = useCallback((path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleNodeSelect = useCallback((node: ViewNode | null) => {
    setSelectedNode(node);
    // If selecting via wireframe, expand parents in tree
    // This could be enhanced to auto-expand path to selected node
  }, []);

  const handleNodeHover = useCallback((node: ViewNode | null) => {
    setHoveredNode(node);
  }, []);

  const matchesSearch = useCallback((node: ViewNode, query: string): boolean => {
    if (!query) return true;
    if (!node) return false;
    const lowerQuery = query.toLowerCase();
    return (
      (node.type || '').toLowerCase().includes(lowerQuery) ||
      node.accessibilityLabel?.toLowerCase().includes(lowerQuery) ||
      node.accessibilityIdentifier?.toLowerCase().includes(lowerQuery) ||
      node.testID?.toLowerCase().includes(lowerQuery) ||
      node.text?.toLowerCase().includes(lowerQuery) ||
      false
    );
  }, []);

  const copyToClipboard = useCallback(async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedProperty(key);
      setTimeout(() => setCopiedProperty(null), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // Count visible nodes for stats
  const nodeCount = useMemo(() => {
    if (!currentHierarchy?.root) return 0;

    const count = (node: ViewNode): number => {
      let total = 1;
      if (node.children) {
        for (const child of node.children) {
          total += count(child);
        }
      }
      return total;
    };

    return count(currentHierarchy.root);
  }, [currentHierarchy]);

  // Render tree node recursively
  const renderTreeNode = (node: ViewNode, path: string = 'root', depth: number = 0): React.ReactNode => {
    if (!node) return null;

    const isExpanded = expandedNodes.has(path);
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedNode === node;
    const isHovered = hoveredNode === node;
    const matches = matchesSearch(node, searchQuery);

    const Icon = getViewIcon(node);
    const typeColor = getViewTypeColor(node);

    // Skip non-matching nodes (but still show children if they match)
    let childrenMatch = false;
    if (hasChildren && searchQuery) {
      const checkChildren = (n: ViewNode): boolean => {
        if (matchesSearch(n, searchQuery)) return true;
        return n.children?.some(c => checkChildren(c)) || false;
      };
      childrenMatch = node.children!.some(c => checkChildren(c));
    }

    if (!matches && !childrenMatch && searchQuery) return null;

    // Extract simple class name
    const simpleType = (node.type || 'View').split('.').pop() || node.type || 'View';
    const displayLabel = node.testID || node.accessibilityLabel || node.text;

    return (
      <div key={path}>
        <div
          className={`
            flex items-center gap-1 py-1.5 px-2 cursor-pointer transition-colors
            ${isSelected ? 'bg-blue-100 border-l-2 border-blue-500' : isHovered ? 'bg-slate-100' : 'hover:bg-slate-50'}
            ${!matches && childrenMatch ? 'opacity-50' : ''}
          `}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => handleNodeSelect(node)}
          onMouseEnter={() => handleNodeHover(node)}
          onMouseLeave={() => handleNodeHover(null)}
        >
          {/* Expand/collapse button */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(path);
              }}
              className="p-0.5 hover:bg-slate-200 rounded flex-shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-slate-500" />
              ) : (
                <ChevronRight className="w-3 h-3 text-slate-500" />
              )}
            </button>
          ) : (
            <div className="w-4 flex-shrink-0" />
          )}

          {/* Icon */}
          <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${typeColor}`} />

          {/* Type name */}
          <span className={`text-xs font-mono font-semibold ${typeColor}`}>
            {simpleType}
          </span>

          {/* Display label */}
          {displayLabel && (
            <span className="text-xs text-slate-500 truncate flex-1">
              "{displayLabel.length > 25 ? displayLabel.substring(0, 22) + '...' : displayLabel}"
            </span>
          )}

          {/* Visibility indicators */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {(node.hidden || node.visible === false) && (
              <span title="Hidden">
                <EyeOff className="w-3 h-3 text-slate-400" />
              </span>
            )}
            {node.alpha !== undefined && node.alpha < 1 && node.alpha > 0 && (
              <span className="text-[9px] text-slate-400 font-mono">
                {Math.round(node.alpha * 100)}%
              </span>
            )}
            {node.masked && (
              <span title="Masked (Privacy)">
                <Lock className="w-3 h-3 text-red-400" />
              </span>
            )}
          </div>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {node.children!.map((child, idx) =>
              renderTreeNode(child, `${path}.${idx}`, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  if (!currentHierarchy) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 text-slate-400 ${className}`}>
        <Layers className="w-12 h-12 mb-4 opacity-30" />
        <p className="font-medium">No Hierarchy Data</p>
        <p className="text-sm mt-2 text-center">
          View hierarchy snapshots were not captured for this session.
          <br />
          Enable hierarchy capture in your SDK configuration.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-white h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Layers className="w-4 h-4 text-slate-600" />
          <div>
            <h3 className="font-bold text-sm text-slate-900">DOM Inspector</h3>
            <p className="text-[10px] text-slate-500">
              {nodeCount} elements • {screenWidth}×{screenHeight}
            </p>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-slate-200 p-0.5 rounded">
          <button
            onClick={() => setViewMode('wireframe')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'wireframe'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Wireframe
          </button>
          <button
            onClick={() => setViewMode('tree')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${viewMode === 'tree'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            <List className="w-3.5 h-3.5" />
            Tree
          </button>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 text-slate-600" />
          </button>
        )}
      </div>

      {/* Search (Tree view only) */}
      {viewMode === 'tree' && (
        <div className="p-3 border-b border-slate-200 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by type, testID, label, or text..."
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
      )}

      {/* Main content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* View area */}
        <div className="flex-1 min-w-0 overflow-auto">
          {viewMode === 'wireframe' ? (
            <WireframeView
              root={currentHierarchy.root}
              screenWidth={screenWidth}
              screenHeight={screenHeight}
              selectedNode={selectedNode}
              hoveredNode={hoveredNode}
              onNodeSelect={handleNodeSelect}
              onNodeHover={handleNodeHover}
              className="h-full w-full"
            />
          ) : (
            <div className="p-1 min-w-0">
              {renderTreeNode(currentHierarchy.root)}
            </div>
          )}
        </div>

        {/* Property Inspector Panel */}
        {selectedNode && (
          <div className="w-72 max-w-[40%] border-l border-slate-200 bg-slate-50 flex-shrink-0 overflow-y-auto">
            <div className="p-3 border-b border-slate-200 bg-white sticky top-0">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-slate-900 uppercase tracking-wide">
                  Properties
                </h4>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="p-1 hover:bg-slate-100 rounded"
                >
                  <X className="w-3 h-3 text-slate-400" />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1 font-mono truncate">
                {selectedNode.type}
              </p>
            </div>

            <div className="p-3 space-y-4">
              {/* Identity */}
              <PropertySection title="Identity">
                <PropertyRow
                  label="Type"
                  value={selectedNode.type}
                  onCopy={(v) => copyToClipboard(v, 'type')}
                  copied={copiedProperty === 'type'}
                />
                {selectedNode.testID && (
                  <PropertyRow
                    label="testID"
                    value={selectedNode.testID}
                    highlight
                    onCopy={(v) => copyToClipboard(v, 'testID')}
                    copied={copiedProperty === 'testID'}
                  />
                )}
                {selectedNode.accessibilityLabel && (
                  <PropertyRow
                    label="a11y Label"
                    value={selectedNode.accessibilityLabel}
                    onCopy={(v) => copyToClipboard(v, 'a11yLabel')}
                    copied={copiedProperty === 'a11yLabel'}
                  />
                )}
                {selectedNode.accessibilityIdentifier && (
                  <PropertyRow
                    label="a11y ID"
                    value={selectedNode.accessibilityIdentifier}
                    onCopy={(v) => copyToClipboard(v, 'a11yId')}
                    copied={copiedProperty === 'a11yId'}
                  />
                )}
                {selectedNode.text && (
                  <PropertyRow label="Text" value={selectedNode.text} />
                )}
              </PropertySection>

              {/* Frame */}
              {selectedNode.frame && (
                <PropertySection title="Frame">
                  <div className="grid grid-cols-2 gap-2">
                    <PropertyRow label="X" value={(selectedNode.frame.x ?? 0).toFixed(1)} compact />
                    <PropertyRow label="Y" value={(selectedNode.frame.y ?? 0).toFixed(1)} compact />
                    <PropertyRow label="Width" value={(selectedNode.frame.w ?? selectedNode.frame.width ?? 0).toFixed(1)} compact />
                    <PropertyRow label="Height" value={(selectedNode.frame.h ?? selectedNode.frame.height ?? 0).toFixed(1)} compact />
                  </div>
                </PropertySection>
              )}

              {/* Appearance */}
              <PropertySection title="Appearance">
                <PropertyRow
                  label="Visible"
                  value={selectedNode.hidden ? 'No' : selectedNode.visible === false ? 'No' : 'Yes'}
                  valueColor={selectedNode.hidden || selectedNode.visible === false ? 'text-red-600' : 'text-emerald-600'}
                />
                {selectedNode.alpha !== undefined && (
                  <PropertyRow
                    label="Alpha"
                    value={selectedNode.alpha.toFixed(2)}
                    valueColor={selectedNode.alpha < 1 ? 'text-amber-600' : undefined}
                  />
                )}
                {selectedNode.bg && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 min-w-[70px]">Background:</span>
                    <div
                      className="w-4 h-4 rounded border border-slate-300"
                      style={{ backgroundColor: selectedNode.bg }}
                    />
                    <span className="font-mono text-slate-700">{selectedNode.bg}</span>
                  </div>
                )}
                {selectedNode.cornerRadius !== undefined && selectedNode.cornerRadius > 0 && (
                  <PropertyRow label="Corner Radius" value={selectedNode.cornerRadius.toString()} />
                )}
                {selectedNode.borderWidth !== undefined && selectedNode.borderWidth > 0 && (
                  <PropertyRow label="Border Width" value={selectedNode.borderWidth.toString()} />
                )}
              </PropertySection>

              {/* Interaction */}
              <PropertySection title="Interaction">
                <PropertyRow
                  label="Interactive"
                  value={selectedNode.interactive ? 'Yes' : 'No'}
                  valueColor={selectedNode.interactive ? 'text-blue-600' : undefined}
                />
                {selectedNode.enabled !== undefined && (
                  <PropertyRow
                    label="Enabled"
                    value={selectedNode.enabled ? 'Yes' : 'No'}
                    valueColor={!selectedNode.enabled ? 'text-red-600' : undefined}
                  />
                )}
                {selectedNode.masked && (
                  <PropertyRow
                    label="Privacy Masked"
                    value="Yes"
                    valueColor="text-red-600"
                  />
                )}
              </PropertySection>

              {/* Children count */}
              {selectedNode.children && selectedNode.children.length > 0 && (
                <PropertySection title="Children">
                  <PropertyRow label="Count" value={selectedNode.children.length.toString()} />
                </PropertySection>
              )}

              {/* Additional properties */}
              {selectedNode.properties && Object.keys(selectedNode.properties).length > 0 && (
                <PropertySection title="Other Properties">
                  {Object.entries(selectedNode.properties).map(([key, value]) => (
                    <PropertyRow
                      key={key}
                      label={key}
                      value={typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    />
                  ))}
                </PropertySection>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex-shrink-0">
        <span>
          {hierarchySnapshots.length} snapshot{hierarchySnapshots.length !== 1 ? 's' : ''} captured
        </span>
        {selectedNode && (
          <span className="font-mono text-slate-400">
            {selectedNode.type.split('.').pop()}
          </span>
        )}
      </div>
    </div>
  );
};

// Property Section Component
const PropertySection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
      {title}
    </h5>
    <div className="space-y-1.5">
      {children}
    </div>
  </div>
);

// Property Row Component
interface PropertyRowProps {
  label: string;
  value: string;
  highlight?: boolean;
  compact?: boolean;
  valueColor?: string;
  onCopy?: (value: string) => void;
  copied?: boolean;
}

const PropertyRow: React.FC<PropertyRowProps> = ({
  label,
  value,
  highlight,
  compact,
  valueColor,
  onCopy,
  copied,
}) => (
  <div className={`flex items-start gap-2 text-xs ${compact ? 'text-[11px]' : ''}`}>
    <span className={`text-slate-500 ${compact ? 'min-w-[45px]' : 'min-w-[70px]'} flex-shrink-0`}>
      {label}:
    </span>
    <span
      className={`
        font-mono flex-1 break-all
        ${highlight ? 'text-blue-600 font-semibold bg-blue-50 px-1 rounded' : valueColor || 'text-slate-800'}
      `}
    >
      {value}
    </span>
    {onCopy && (
      <button
        onClick={() => onCopy(value)}
        className="p-0.5 hover:bg-slate-200 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy"
      >
        {copied ? (
          <Check className="w-3 h-3 text-emerald-500" />
        ) : (
          <Copy className="w-3 h-3 text-slate-400" />
        )}
      </button>
    )}
  </div>
);

export default DOMInspector;
