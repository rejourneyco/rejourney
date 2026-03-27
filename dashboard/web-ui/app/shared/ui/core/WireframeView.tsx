/**
 * WireframeView - Visual blueprint/wireframe rendering of the view hierarchy
 * 
 * Renders the view hierarchy as a visual representation:
 * - Shows view bounds as rectangles
 * - Color-coded by view type (text, buttons, images, containers)
 * - Hover highlights and selection
 * - Synchronized with the Tree View selection
 */

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';

export interface ViewNode {
  type: string;
  frame?: {
    x: number;
    y: number;
    w?: number;      // width (SDK uses 'w')
    h?: number;      // height (SDK uses 'h')
    width?: number;  // alternative naming
    height?: number; // alternative naming
  };
  properties?: Record<string, any>;
  children?: ViewNode[];
  accessibilityLabel?: string;
  accessibilityIdentifier?: string;
  testID?: string;
  text?: string;
  visible?: boolean;
  hidden?: boolean;
  alpha?: number;
  masked?: boolean;
  bg?: string;
  cornerRadius?: number;
  borderWidth?: number;
  interactive?: boolean;
  enabled?: boolean;
}

interface WireframeViewProps {
  root: ViewNode | null;
  screenWidth: number;
  screenHeight: number;
  selectedNode: ViewNode | null;
  hoveredNode: ViewNode | null;
  onNodeSelect: (node: ViewNode | null) => void;
  onNodeHover: (node: ViewNode | null) => void;
  className?: string;
}

// Get view color based on type
const getViewColor = (node: ViewNode): { fill: string; stroke: string; textColor: string } => {
  const type = (node?.type || '').toLowerCase();

  // Interactive elements (buttons, touchables)
  if (type.includes('button') || type.includes('touchable') || type.includes('pressable') || node.interactive) {
    return { fill: 'rgba(59, 130, 246, 0.15)', stroke: '#3b82f6', textColor: '#1d4ed8' };
  }

  // Text elements
  if (type.includes('text') || type.includes('label') || type.includes('uilabel') || type.includes('uitextview')) {
    return { fill: 'rgba(16, 185, 129, 0.1)', stroke: '#10b981', textColor: '#047857' };
  }

  // Images
  if (type.includes('image') || type.includes('uiimageview') || type.includes('rnc')) {
    return { fill: 'rgba(168, 85, 247, 0.1)', stroke: '#a855f7', textColor: '#7c3aed' };
  }

  // ScrollViews
  if (type.includes('scroll') || type.includes('flatlist') || type.includes('sectionlist')) {
    return { fill: 'rgba(245, 158, 11, 0.1)', stroke: '#f59e0b', textColor: '#b45309' };
  }

  // TextInputs
  if (type.includes('input') || type.includes('textfield') || type.includes('uitextfield')) {
    return { fill: 'rgba(236, 72, 153, 0.1)', stroke: '#ec4899', textColor: '#be185d' };
  }

  // Masked/privacy views
  if (node.masked) {
    return { fill: 'rgba(239, 68, 68, 0.15)', stroke: '#ef4444', textColor: '#dc2626' };
  }

  // Hidden/low alpha views
  if (node.hidden || (node.alpha !== undefined && node.alpha < 0.5)) {
    return { fill: 'rgba(148, 163, 184, 0.05)', stroke: '#94a3b8', textColor: '#64748b' };
  }

  // Default container/view
  return { fill: 'rgba(100, 116, 139, 0.05)', stroke: '#64748b', textColor: '#475569' };
};

// Get display label for a view
const getViewLabel = (node: ViewNode): string => {
  if (!node) return 'Unknown';

  // Priority: testID > accessibilityLabel > accessibilityIdentifier > text > type
  if (node.testID) return node.testID;
  if (node.accessibilityLabel) return node.accessibilityLabel;
  if (node.accessibilityIdentifier) return node.accessibilityIdentifier;
  if (node.text && node.text.length <= 20) return node.text;
  if (node.text) return node.text.substring(0, 17) + '...';

  // Extract simple class name
  const type = (node.type || 'View').split('.').pop() || node.type || 'View';
  // Remove common prefixes
  return type.replace(/^(RCT|RN|UI|RJ)/, '');
};

// Flatten view tree with their absolute positions
interface FlattenedView {
  node: ViewNode;
  absoluteFrame: { x: number; y: number; width: number; height: number };
  depth: number;
  path: string;
}

const flattenViews = (
  node: ViewNode,
  parentX: number = 0,
  parentY: number = 0,
  depth: number = 0,
  path: string = 'root'
): FlattenedView[] => {
  const views: FlattenedView[] = [];

  if (!node || !node.frame) return views;

  // Support both w/h and width/height naming
  const frameWidth = node.frame.w ?? node.frame.width ?? 0;
  const frameHeight = node.frame.h ?? node.frame.height ?? 0;

  if (frameWidth < 1 || frameHeight < 1) return views;

  const absoluteFrame = {
    x: parentX + (node.frame.x || 0),
    y: parentY + (node.frame.y || 0),
    width: frameWidth,
    height: frameHeight,
  };

  views.push({ node, absoluteFrame, depth, path });

  if (node.children) {
    node.children.forEach((child, idx) => {
      views.push(...flattenViews(
        child,
        absoluteFrame.x,
        absoluteFrame.y,
        depth + 1,
        `${path}.${idx}`
      ));
    });
  }

  return views;
};

export const WireframeView: React.FC<WireframeViewProps> = ({
  root,
  screenWidth,
  screenHeight,
  selectedNode,
  hoveredNode,
  onNodeSelect,
  onNodeHover,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Calculate container size on mount and resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Calculate scale to fit screen in container
  const scale = useMemo(() => {
    if (containerSize.width === 0 || containerSize.height === 0) return 0.5; // Default scale

    const paddingX = 80; // More padding for better fit
    const paddingY = 80;
    const scaleX = (containerSize.width - paddingX) / screenWidth;
    const scaleY = (containerSize.height - paddingY) / screenHeight;
    return Math.min(scaleX, scaleY, 1); // Don't scale up beyond 1
  }, [containerSize, screenWidth, screenHeight]);

  // Flatten the view tree
  const flattenedViews = useMemo(() => {
    if (!root) return [];
    return flattenViews(root);
  }, [root]);

  // Sort by depth (render parents first, then children on top)
  const sortedViews = useMemo(() => {
    return [...flattenedViews].sort((a, b) => a.depth - b.depth);
  }, [flattenedViews]);

  const handleViewClick = useCallback((e: React.MouseEvent, view: FlattenedView) => {
    e.stopPropagation();
    onNodeSelect(view.node);
  }, [onNodeSelect]);

  const handleViewHover = useCallback((view: FlattenedView | null) => {
    onNodeHover(view?.node || null);
  }, [onNodeHover]);

  if (!root) {
    return (
      <div className={`flex items-center justify-center text-slate-400 ${className}`}>
        <p className="text-sm">No hierarchy data available</p>
      </div>
    );
  }

  const scaledWidth = screenWidth * scale;
  const scaledHeight = screenHeight * scale;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-auto bg-slate-100/50 flex items-center justify-center ${className}`}
      onClick={() => onNodeSelect(null)}
    >
      {/* Device frame */}
      <div
        className="relative bg-white shadow-lg rounded-lg border border-slate-200 overflow-hidden flex-shrink-0"
        style={{
          width: Math.max(scaledWidth, 100),
          height: Math.max(scaledHeight, 100),
          maxWidth: '100%',
          maxHeight: '100%',
        }}
      >
        {/* Render views */}
        {sortedViews.map((view, index) => {
          const { node, absoluteFrame, depth } = view;
          const colors = getViewColor(node);
          const isSelected = selectedNode === node;
          const isHovered = hoveredNode === node;
          const label = getViewLabel(node);

          // Scale the frame
          const scaledFrame = {
            x: absoluteFrame.x * scale,
            y: absoluteFrame.y * scale,
            width: absoluteFrame.width * scale,
            height: absoluteFrame.height * scale,
          };

          // Skip if too small to see
          if (scaledFrame.width < 2 || scaledFrame.height < 2) return null;

          // Determine if we should show the label
          const showLabel = scaledFrame.width >= 30 && scaledFrame.height >= 14;

          return (
            <div
              key={view.path}
              className="absolute cursor-pointer transition-all duration-75"
              style={{
                left: scaledFrame.x,
                top: scaledFrame.y,
                width: scaledFrame.width,
                height: scaledFrame.height,
                backgroundColor: isSelected ? colors.fill.replace('0.1', '0.3').replace('0.15', '0.4')
                  : isHovered ? colors.fill.replace('0.1', '0.2').replace('0.15', '0.25')
                    : colors.fill,
                borderWidth: isSelected ? 2 : 1,
                borderStyle: 'solid',
                borderColor: isSelected || isHovered ? colors.stroke : 'rgba(100, 116, 139, 0.2)',
                borderRadius: node.cornerRadius ? Math.min(node.cornerRadius * scale, 8) : 0,
                zIndex: isSelected ? 1000 : isHovered ? 999 : depth,
                boxShadow: isSelected
                  ? `0 0 0 2px ${colors.stroke}, 0 4px 12px rgba(0,0,0,0.1)`
                  : isHovered
                    ? `0 0 0 1px ${colors.stroke}`
                    : 'none',
              }}
              onClick={(e) => handleViewClick(e, view)}
              onMouseEnter={() => handleViewHover(view)}
              onMouseLeave={() => handleViewHover(null)}
              title={`${node.type}\n${label}`}
            >
              {/* View label */}
              {showLabel && (isSelected || isHovered || depth <= 2) && (
                <div
                  className="absolute inset-0 flex items-center justify-center overflow-hidden"
                  style={{ pointerEvents: 'none' }}
                >
                  <span
                    className="text-[9px] font-medium truncate px-1 rounded"
                    style={{
                      color: colors.textColor,
                      backgroundColor: isSelected || isHovered ? 'rgba(255,255,255,0.9)' : 'transparent',
                      maxWidth: '100%',
                    }}
                  >
                    {label}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-2 justify-center text-[10px]">
        <LegendItem color="#3b82f6" label="Interactive" />
        <LegendItem color="#10b981" label="Text" />
        <LegendItem color="#a855f7" label="Image" />
        <LegendItem color="#f59e0b" label="ScrollView" />
        <LegendItem color="#ec4899" label="Input" />
        <LegendItem color="#ef4444" label="Masked" />
      </div>
    </div>
  );
};

const LegendItem: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-1 bg-white/80 px-1.5 py-0.5 rounded">
    <div
      className="w-2 h-2 rounded-sm border"
      style={{ backgroundColor: `${color}20`, borderColor: color }}
    />
    <span className="text-slate-600">{label}</span>
  </div>
);

export default WireframeView;
