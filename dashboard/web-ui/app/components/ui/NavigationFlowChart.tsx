import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { RecordingSession } from '../../types';
import { TruncatedText } from './TruncatedText';

interface FlowNode {
  id: string;
  label: string;
  count: number;
  percentage: number;
  depth: number;
  // Visual props calculated during layout
  x?: number;
  y?: number;
  height?: number;
}

interface FlowEdge {
  from: string;
  to: string;
  count: number;
  percentage: number;
  sourceDepth: number;
  targetDepth: number;
}

interface NavigationFlowChartProps {
  sessions: RecordingSession[];
  maxDepth?: number;
  className?: string;
}

// Build navigation flow graph from real session data
function buildNavigationFlow(sessions: RecordingSession[], maxDepth: number = 6) {
  const totalSessions = sessions.length;
  if (totalSessions === 0) {
    return { nodes: [], edges: [], paths: [], entryPoints: new Map<string, number>(), screensByDepth: new Map<number, Map<string, number>>(), totalSessions: 0 };
  }

  // Track transitions between screens
  const transitions: Map<string, Map<string, number>> = new Map();
  // Track screen visits by position in journey
  const screensByDepth: Map<number, Map<string, number>> = new Map();
  // Track unique paths
  const pathCounts: Map<string, number> = new Map();
  // Track first screen (entry points)
  const entryPoints: Map<string, number> = new Map();

  for (const session of sessions) {
    const screens = session.screensVisited || [];
    if (screens.length === 0) continue;

    // Track entry point
    const firstScreen = screens[0];
    entryPoints.set(firstScreen, (entryPoints.get(firstScreen) || 0) + 1);

    // Track path (up to maxDepth)
    const pathKey = screens.slice(0, maxDepth).join(';;'); // Use safer separator
    pathCounts.set(pathKey, (pathCounts.get(pathKey) || 0) + 1);

    // Track screens by depth
    for (let i = 0; i < Math.min(screens.length, maxDepth); i++) {
      const screen = screens[i];
      if (!screensByDepth.has(i)) {
        screensByDepth.set(i, new Map());
      }
      const depthMap = screensByDepth.get(i)!;
      depthMap.set(screen, (depthMap.get(screen) || 0) + 1);
    }

    // Track transitions
    for (let i = 0; i < Math.min(screens.length - 1, maxDepth - 1); i++) {
      const from = `${i}_${screens[i]}`; // Unique ID by depth
      const to = `${i + 1}_${screens[i + 1]}`;

      if (!transitions.has(from)) {
        transitions.set(from, new Map());
      }
      const toMap = transitions.get(from)!;
      toMap.set(to, (toMap.get(to) || 0) + 1);
    }
  }

  // Build nodes with depth info
  const nodes: FlowNode[] = [];
  const nodeIdMap: Map<string, FlowNode> = new Map();

  Array.from(screensByDepth.entries()).forEach(([depth, screenCounts]) => {
    // Top N nodes per depth to keep it readable
    const sortedScreens = Array.from(screenCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    sortedScreens.forEach(([screen, count]) => {
      const nodeId = `${depth}_${screen}`;
      const node = {
        id: nodeId,
        label: screen,
        count,
        percentage: (count / totalSessions) * 100,
        depth,
      };
      nodes.push(node);
      nodeIdMap.set(nodeId, node);
    });
  });

  // Build edges - only between nodes that exist (filtered by top N)
  const edges: FlowEdge[] = [];
  Array.from(transitions.entries()).forEach(([fromId, toMap]) => {
    if (!nodeIdMap.has(fromId)) return;

    Array.from(toMap.entries()).forEach(([toId, count]) => {
      if (!nodeIdMap.has(toId)) return;

      const sourceNode = nodeIdMap.get(fromId)!;
      const targetNode = nodeIdMap.get(toId)!;

      edges.push({
        from: fromId,
        to: toId,
        count,
        percentage: (count / totalSessions) * 100,
        sourceDepth: sourceNode.depth,
        targetDepth: targetNode.depth
      });
    });
  });

  // Build top paths
  const paths = Array.from(pathCounts.entries())
    .map(([path, count]) => ({
      path: path.split(';;'),
      count,
      percentage: (count / totalSessions) * 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { nodes, edges, paths, entryPoints, screensByDepth, totalSessions };
}

export const NavigationFlowChart: React.FC<NavigationFlowChartProps> = ({
  sessions,
  maxDepth = 5,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgLines, setSvgLines] = useState<React.ReactNode[]>([]);
  const flowData = useMemo(() => buildNavigationFlow(sessions, maxDepth), [sessions, maxDepth]);

  // Group nodes by depth
  const nodesByDepth = useMemo(() => {
    const grouped: Map<number, FlowNode[]> = new Map();
    // Initialize all depths
    for (let i = 0; i < maxDepth; i++) grouped.set(i, []);

    for (const node of flowData.nodes) {
      if (grouped.has(node.depth)) {
        grouped.get(node.depth)!.push(node);
      }
    }
    // Sort by count
    Array.from(grouped.values()).forEach(list => list.sort((a, b) => b.count - a.count));
    return grouped;
  }, [flowData.nodes, maxDepth]);

  // Calculate connections on layout
  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const lines: React.ReactNode[] = [];
    const containerRect = containerRef.current.getBoundingClientRect();
    const nodeElements = containerRef.current.querySelectorAll('[data-node-id]');

    const nodePositions = new Map<string, { right: { x: number, y: number }, left: { x: number, y: number } }>();

    nodeElements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const id = el.getAttribute('data-node-id');
      if (id) {
        // Relative coordinates to container
        const relX = rect.left - containerRect.left;
        const relY = rect.top - containerRect.top;

        nodePositions.set(id, {
          left: { x: relX, y: relY + rect.height / 2 },
          right: { x: relX + rect.width, y: relY + rect.height / 2 }
        });
      }
    });

    flowData.edges.forEach((edge, idx) => {
      const source = nodePositions.get(edge.from);
      const target = nodePositions.get(edge.to);

      if (source && target) {
        const start = source.right;
        const end = target.left;

        // Control points for bezier curve
        const dist = Math.abs(end.x - start.x);
        const cp1 = { x: start.x + dist * 0.5, y: start.y };
        const cp2 = { x: end.x - dist * 0.5, y: end.y };

        // Stroke width based on traffic
        const strokeWidth = Math.max(1, Math.min(10, (edge.count / flowData.totalSessions) * 20)); // Scale for visibility
        const opacity = Math.max(0.6, Math.min(1.0, (edge.count / flowData.totalSessions) * 2)); // Increased minimum opacity for better visibility

        // Color based on percentage: Green (high), Yellow (medium), Red (low)
        const getStrokeColor = (p: number) => {
          if (p >= 10) return '#22C55E'; // Green for highest percentage paths
          if (p >= 5) return '#EAB308'; // Yellow for medium percentage paths
          return '#EF4444'; // Red for lowest percentage paths
        };

        const strokeColor = getStrokeColor(edge.percentage);

        lines.push(
          <path
            key={`${edge.from}-${edge.to}`}
            d={`M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={opacity}
            strokeLinecap="round"
          />
        );
      }
    });

    setSvgLines(lines);
  }, [flowData, nodesByDepth, sessions]); // Re-run when data changes

  if (sessions.length === 0) {
    return <div className={`text-center py-12 text-gray-400 font-mono text-xs uppercase ${className}`}>No navigation data</div>;
  }

  // Re-calculate unique screen reach correctly
  const uniqueScreenReach = new Map<string, number>();
  sessions.forEach(s => {
    const visited = new Set(s.screensVisited || []);
    visited.forEach(screen => {
      uniqueScreenReach.set(screen, (uniqueScreenReach.get(screen) || 0) + 1);
    });
  });

  const sortedReach = Array.from(uniqueScreenReach.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([screen, count]) => ({ screen, count, percentage: (count / sessions.length) * 100 }));


  return (
    <div className={className}>

      {/* 1. Flow Diagram */}
      <div className="relative mb-8" ref={containerRef}>
        <div className="text-xs text-gray-500 font-mono uppercase mb-4 tracking-wider">Session Flow Map</div>

        {/* SVG Layer */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ overflow: 'visible' }}>
          {svgLines}
        </svg>

        {/* Nodes Layer */}
        <div className="grid grid-cols-5 gap-12 relative z-10">
          {Array.from(nodesByDepth.entries()).slice(0, 5).map(([depth, nodes]) => (
            <div key={depth} className="flex flex-col gap-4">
              <div className="text-[10px] font-black uppercase text-center text-gray-400 mb-2">
                {depth === 0 ? 'Entry' : `Step ${depth + 1}`}
              </div>
              {nodes.map(node => (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  className="bg-white border-2 border-black p-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 transition-all cursor-default group"
                >
                  <div className="text-[10px] font-bold truncate leading-tight mb-1" title={node.label}>
                    <TruncatedText text={node.label} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-mono text-gray-500">{node.count}</span>
                    <span className="text-[9px] font-black bg-black text-white px-1 rounded-sm">{node.percentage.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 border-t-2 border-dashed border-gray-200 pt-6">
        {/* 2. Top Journeys (Metro Style) */}
        <div>
          <div className="text-xs text-gray-500 font-mono uppercase mb-4 tracking-wider">Top User Journeys</div>
          <div className="space-y-4">
            {flowData.paths.map((pathItem, idx) => (
              <div key={idx} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-black text-white text-[10px] font-bold px-1.5 py-0.5">#{idx + 1}</span>
                  <span className="text-[10px] font-mono text-gray-500">{pathItem.count} sessions ({pathItem.percentage.toFixed(0)}%)</span>
                </div>
                {/* Breadcrumbs */}
                <div className="flex flex-wrap items-center gap-1">
                  {pathItem.path.map((step, stepIdx) => (
                    <React.Fragment key={stepIdx}>
                      {stepIdx > 0 && <span className="text-gray-300 text-[10px]">→</span>}
                      <div className="border border-black bg-gray-50 px-1.5 py-0.5 text-[9px] font-bold truncate max-w-[120px]" title={step}>
                        {step}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Screen Reach (Bar Chart) */}
        <div>
          <div className="text-xs text-gray-500 font-mono uppercase mb-4 tracking-wider">Most Visited Screens</div>
          <div className="space-y-3">
            {sortedReach.map((item, idx) => (
              <div key={item.screen} className="group">
                <div className="flex justify-between text-[10px] font-bold mb-1">
                  <span className="truncate pr-2">{item.screen}</span>
                  <span className="font-mono text-gray-500">{item.percentage.toFixed(0)}%</span>
                </div>
                <div className="w-full h-3 bg-gray-100 border border-black relative overflow-hidden">
                  <div
                    className="h-full bg-black absolute top-0 left-0 transition-all duration-500"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NavigationFlowChart;
