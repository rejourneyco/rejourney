import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface SankeyFlow {
    from: string;
    to: string;
    count: number;
    crashCount: number;
    anrCount: number;
    apiErrorRate: number;
    rageTapCount: number;
}

interface SankeyNode {
    id: string;
    name: string;
    level: number;
    y: number;
    height: number;
    outValue: number;
    inValue: number;
}

interface SankeyLink {
    source: string;
    target: string;
    value: number;
    ySource: number;
    yTarget: number;
    thickness: number;
    data: SankeyFlow;
}

interface SankeyJourneyProps {
    flows: SankeyFlow[];
    width?: number;
    height?: number;
}

export const SankeyJourney: React.FC<SankeyJourneyProps> = ({ flows, width: propWidth, height = 500 }) => {
    const [hoveredLink, setHoveredLink] = useState<SankeyLink | null>(null);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);

    const { nodes, links, nodeLookup, calculatedWidth } = useMemo(() => {
        if (flows.length === 0) return { nodes: [], links: [], nodeLookup: new Map(), calculatedWidth: propWidth || 1200 };

        const nodeMap = new Map<string, { in: number, out: number }>();
        const connections = new Map<string, Set<string>>();

        flows.forEach(flow => {
            if (!nodeMap.has(flow.from)) nodeMap.set(flow.from, { in: 0, out: 0 });
            if (!nodeMap.has(flow.to)) nodeMap.set(flow.to, { in: 0, out: 0 });
            nodeMap.get(flow.from)!.out += flow.count;
            nodeMap.get(flow.to)!.in += flow.count;
            if (!connections.has(flow.from)) connections.set(flow.from, new Set());
            connections.get(flow.from)!.add(flow.to);
        });

        // BFS level assignment
        const levels = new Map<string, number>();
        const queue: string[] = [];
        const allNodes = Array.from(nodeMap.keys());

        let root = allNodes.find(id => id.toLowerCase() === 'index')
            || allNodes.find(id => id.toLowerCase().includes('launch'))
            || allNodes.find(id => nodeMap.get(id)!.in === 0);

        if (!root && allNodes.length > 0) {
            root = allNodes.reduce((best, id) =>
                nodeMap.get(id)!.out > nodeMap.get(best)!.out ? id : best, allNodes[0]);
        }

        if (root) {
            levels.set(root, 0);
            queue.push(root);
        }

        while (queue.length > 0) {
            const current = queue.shift()!;
            const currentLevel = levels.get(current)!;
            connections.get(current)?.forEach(target => {
                if (!levels.has(target)) {
                    levels.set(target, currentLevel + 1);
                    queue.push(target);
                }
            });
        }

        nodeMap.forEach((_, id) => { if (!levels.has(id)) levels.set(id, 0); });

        const maxLevel = Math.max(...Array.from(levels.values()), 0);
        const nodesByLevel: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
        levels.forEach((level, id) => nodesByLevel[level].push(id));

        // Layout with fixed node size
        const nodeWidth = 140;
        const nodeHeight = 36;
        const nodePadding = 16;
        const padding = 60; // Padding on each side
        const minLevelSpacing = 200; // Minimum space between levels

        // Calculate required width based on number of levels
        const calculatedWidth = propWidth || Math.max(1200, padding * 2 + nodeWidth + maxLevel * minLevelSpacing);
        const levelSpacing = maxLevel > 0 ? (calculatedWidth - padding * 2 - nodeWidth) / maxLevel : 0;

        const sankeyNodes: SankeyNode[] = [];

        nodesByLevel.forEach((levelNodes, level) => {
            const totalNodesHeight = levelNodes.length * nodeHeight + (levelNodes.length - 1) * nodePadding;
            let startY = (height - totalNodesHeight) / 2;

            levelNodes.forEach(id => {
                const nodeData = nodeMap.get(id)!;
                sankeyNodes.push({
                    id,
                    name: id.replace(/Activity$/, '').replace(/ViewController$/, '').replace(/Screen$/, ''),
                    level,
                    y: startY,
                    height: nodeHeight,
                    inValue: nodeData.in,
                    outValue: nodeData.out
                });
                startY += nodeHeight + nodePadding;
            });
        });

        const nodeLookup = new Map(sankeyNodes.map(n => [n.id, n]));

        // Build links
        const sankeyLinks: SankeyLink[] = [];
        const sourceOffsets = new Map<string, number>();
        const targetOffsets = new Map<string, number>();

        flows.forEach(flow => {
            const sourceNode = nodeLookup.get(flow.from);
            const targetNode = nodeLookup.get(flow.to);
            if (!sourceNode || !targetNode) return;

            const maxFlow = Math.max(...flows.map(f => f.count));
            const thickness = Math.max(2, (flow.count / maxFlow) * 20);

            const sOffset = sourceOffsets.get(flow.from) || 0;
            const tOffset = targetOffsets.get(flow.to) || 0;

            sankeyLinks.push({
                source: flow.from,
                target: flow.to,
                value: flow.count,
                ySource: sourceNode.y + sourceNode.height / 2,
                yTarget: targetNode.y + targetNode.height / 2,
                thickness,
                data: flow
            });

            sourceOffsets.set(flow.from, sOffset + thickness);
            targetOffsets.set(flow.to, tOffset + thickness);
        });

        return { nodes: sankeyNodes, links: sankeyLinks, nodeLookup, calculatedWidth };
    }, [flows, propWidth, height]);

    const getLinkColor = (link: SankeyLink, isHovered: boolean) => {
        if (link.data.crashCount > 0) return isHovered ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.35)';
        if (link.data.rageTapCount > 0) return isHovered ? 'rgba(244, 63, 94, 0.8)' : 'rgba(244, 63, 94, 0.35)';
        if (link.data.apiErrorRate > 10) return isHovered ? 'rgba(245, 158, 11, 0.8)' : 'rgba(245, 158, 11, 0.35)';
        return isHovered ? 'rgba(99, 102, 241, 0.7)' : 'rgba(99, 102, 241, 0.25)';
    };

    if (nodes.length === 0) {
        return (
            <div className="w-full h-80 flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-slate-400 text-sm">No flow data available</p>
            </div>
        );
    }

    const nodeWidth = 140;
    const padding = 60;
    const maxLevel = Math.max(...nodes.map(n => n.level), 1);
    const levelSpacing = maxLevel > 0 ? (calculatedWidth - padding * 2 - nodeWidth) / maxLevel : 0;

    return (
        <div className="relative bg-slate-50/50 rounded-xl border border-slate-200 p-6 overflow-x-auto">
            <svg width={calculatedWidth} height={height} viewBox={`0 0 ${calculatedWidth} ${height}`} className="overflow-visible">
                {/* Links */}
                <g>
                    {links.map((link, i) => {
                        const sourceNode = nodeLookup.get(link.source);
                        const targetNode = nodeLookup.get(link.target);
                        if (!sourceNode || !targetNode) return null;

                        const xStart = padding + sourceNode.level * levelSpacing + nodeWidth;
                        const xEnd = padding + targetNode.level * levelSpacing;

                        const cp1x = xStart + (xEnd - xStart) * 0.4;
                        const cp2x = xEnd - (xEnd - xStart) * 0.4;

                        const isHovered = hoveredLink === link || hoveredNode === link.source || hoveredNode === link.target;
                        const isOther = (hoveredLink || hoveredNode) && !isHovered;

                        return (
                            <motion.path
                                key={`link-${i}`}
                                d={`M ${xStart} ${link.ySource} C ${cp1x} ${link.ySource}, ${cp2x} ${link.yTarget}, ${xEnd} ${link.yTarget}`}
                                fill="none"
                                stroke={getLinkColor(link, isHovered)}
                                strokeWidth={link.thickness}
                                initial={{ pathLength: 0, opacity: 0 }}
                                animate={{
                                    pathLength: 1,
                                    opacity: isOther ? 0.15 : 1,
                                    strokeWidth: isHovered ? link.thickness + 2 : link.thickness
                                }}
                                transition={{ duration: 0.6, delay: i * 0.02 }}
                                onMouseEnter={() => setHoveredLink(link)}
                                onMouseLeave={() => setHoveredLink(null)}
                                className="cursor-pointer"
                                style={{ filter: isHovered ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' : 'none' }}
                            />
                        );
                    })}
                </g>

                {/* Nodes */}
                <g>
                    {nodes.map((node, i) => {
                        const x = padding + node.level * levelSpacing;
                        const isHovered = hoveredNode === node.id || (hoveredLink && (hoveredLink.source === node.id || hoveredLink.target === node.id));
                        const isOther = (hoveredLink || hoveredNode) && !isHovered;

                        return (
                            <g
                                key={`node-${node.id}`}
                                onMouseEnter={() => setHoveredNode(node.id)}
                                onMouseLeave={() => setHoveredNode(null)}
                                style={{ cursor: 'pointer' }}
                            >
                                <motion.rect
                                    x={x}
                                    y={node.y}
                                    width={nodeWidth}
                                    height={node.height}
                                    rx="6"
                                    fill={isHovered ? '#ffffff' : '#f8fafc'}
                                    stroke={isHovered ? '#6366f1' : '#e2e8f0'}
                                    strokeWidth={isHovered ? 2 : 1}
                                    initial={{ scaleX: 0, opacity: 0 }}
                                    animate={{
                                        scaleX: 1,
                                        opacity: isOther ? 0.4 : 1,
                                    }}
                                    transition={{ duration: 0.4, delay: 0.1 + i * 0.03 }}
                                    style={{
                                        transformOrigin: `${x}px ${node.y + node.height / 2}px`,
                                        filter: isHovered ? 'drop-shadow(0 4px 6px rgba(99, 102, 241, 0.15))' : 'none'
                                    }}
                                />
                                <foreignObject x={x + 8} y={node.y + 4} width={nodeWidth - 16} height={node.height - 8}>
                                    <div className="h-full flex flex-col justify-center overflow-hidden">
                                        <div
                                            className="text-[11px] font-semibold text-slate-700 truncate leading-tight"
                                            title={node.name}
                                        >
                                            {node.name}
                                        </div>
                                        <div className="text-[10px] text-slate-400 font-medium">
                                            {(node.inValue + node.outValue).toLocaleString()}
                                        </div>
                                    </div>
                                </foreignObject>
                            </g>
                        );
                    })}
                </g>
            </svg>

            {/* Hover Tooltip */}
            <AnimatePresence>
                {hoveredLink && (
                    <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs pointer-events-none z-20"
                        style={{
                            left: `calc(${((nodeLookup.get(hoveredLink.source)?.level || 0) + (nodeLookup.get(hoveredLink.target)?.level || 0)) / 2 / Math.max(...nodes.map(n => n.level), 1) * 100}% + 40px)`,
                            top: `${(hoveredLink.ySource + hoveredLink.yTarget) / 2 / height * 100}%`,
                            transform: 'translate(-50%, -50%)'
                        }}
                    >
                        <div className="font-semibold text-slate-700 mb-1">{hoveredLink.value.toLocaleString()} users</div>
                        <div className="text-slate-500">{hoveredLink.source} → {hoveredLink.target}</div>
                        {hoveredLink.data.crashCount > 0 && <div className="text-red-500 mt-1">{hoveredLink.data.crashCount} crashes</div>}
                        {hoveredLink.data.rageTapCount > 0 && <div className="text-rose-500">{hoveredLink.data.rageTapCount} rage taps</div>}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Legend */}
            <div className="absolute bottom-4 right-4 flex items-center gap-4 text-[10px] text-slate-500">
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-1 rounded-full bg-indigo-400/50"></div>
                    <span>Healthy</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-1 rounded-full bg-red-400/50"></div>
                    <span>Issues</span>
                </div>
            </div>
        </div>
    );
};
