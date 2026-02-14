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
    id: string;
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
    happyPath?: string[] | null;
}

export const SankeyJourney: React.FC<SankeyJourneyProps> = ({ flows, width: propWidth, height = 500, happyPath }) => {
    const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);

    const happyTransitionSet = useMemo(() => {
        const transitions = new Set<string>();
        if (!happyPath || happyPath.length < 2) return transitions;

        for (let i = 0; i < happyPath.length - 1; i++) {
            transitions.add(`${happyPath[i]}→${happyPath[i + 1]}`);
        }
        return transitions;
    }, [happyPath]);

    const happyNodeSet = useMemo(() => new Set(happyPath || []), [happyPath]);

    const { nodes, links, nodeLookup, calculatedWidth } = useMemo(() => {
        if (flows.length === 0) return { nodes: [], links: [], nodeLookup: new Map<string, SankeyNode>(), calculatedWidth: propWidth || 1200 };

        const nodeMap = new Map<string, { in: number; out: number }>();
        const connections = new Map<string, Set<string>>();

        flows.forEach((flow) => {
            if (!nodeMap.has(flow.from)) nodeMap.set(flow.from, { in: 0, out: 0 });
            if (!nodeMap.has(flow.to)) nodeMap.set(flow.to, { in: 0, out: 0 });
            nodeMap.get(flow.from)!.out += flow.count;
            nodeMap.get(flow.to)!.in += flow.count;
            if (!connections.has(flow.from)) connections.set(flow.from, new Set());
            connections.get(flow.from)!.add(flow.to);
        });

        // Assign levels with BFS so flows run left-to-right.
        const levels = new Map<string, number>();
        const queue: string[] = [];
        const allNodes = Array.from(nodeMap.keys());

        let root = allNodes.find((id) => id.toLowerCase() === 'index')
            || allNodes.find((id) => id.toLowerCase().includes('launch'))
            || allNodes.find((id) => nodeMap.get(id)!.in === 0);

        if (!root && allNodes.length > 0) {
            root = allNodes.reduce((best, id) => nodeMap.get(id)!.out > nodeMap.get(best)!.out ? id : best, allNodes[0]);
        }

        if (root) {
            levels.set(root, 0);
            queue.push(root);
        }

        while (queue.length > 0) {
            const current = queue.shift()!;
            const currentLevel = levels.get(current)!;
            connections.get(current)?.forEach((target) => {
                if (!levels.has(target)) {
                    levels.set(target, currentLevel + 1);
                    queue.push(target);
                }
            });
        }

        nodeMap.forEach((_, id) => {
            if (!levels.has(id)) levels.set(id, 0);
        });

        const maxLevel = Math.max(...Array.from(levels.values()), 0);
        const nodesByLevel: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
        levels.forEach((level, id) => nodesByLevel[level].push(id));

        const nodeWidth = 156;
        const nodeHeight = 38;
        const nodePadding = 16;
        const padding = 56;
        const minLevelSpacing = 210;

        const calculatedWidth = propWidth || Math.max(1200, padding * 2 + nodeWidth + maxLevel * minLevelSpacing);
        const levelSpacing = maxLevel > 0 ? (calculatedWidth - padding * 2 - nodeWidth) / maxLevel : 0;

        const sankeyNodes: SankeyNode[] = [];
        nodesByLevel.forEach((levelNodes, level) => {
            const totalNodesHeight = levelNodes.length * nodeHeight + (levelNodes.length - 1) * nodePadding;
            let startY = (height - totalNodesHeight) / 2;

            levelNodes.forEach((id) => {
                const nodeData = nodeMap.get(id)!;
                sankeyNodes.push({
                    id,
                    name: id.replace(/Activity$/, '').replace(/ViewController$/, '').replace(/Screen$/, ''),
                    level,
                    y: startY,
                    height: nodeHeight,
                    inValue: nodeData.in,
                    outValue: nodeData.out,
                });
                startY += nodeHeight + nodePadding;
            });
        });

        const nodeLookup = new Map(sankeyNodes.map((node) => [node.id, node]));
        const maxFlow = Math.max(...flows.map((flow) => flow.count), 1);

        const sankeyLinks: SankeyLink[] = flows
            .map((flow) => {
                const sourceNode = nodeLookup.get(flow.from);
                const targetNode = nodeLookup.get(flow.to);
                if (!sourceNode || !targetNode) return null;

                return {
                    id: `${flow.from}→${flow.to}`,
                    source: flow.from,
                    target: flow.to,
                    value: flow.count,
                    ySource: sourceNode.y + sourceNode.height / 2,
                    yTarget: targetNode.y + targetNode.height / 2,
                    thickness: Math.max(2, (flow.count / maxFlow) * 22),
                    data: flow,
                };
            })
            .filter((link): link is SankeyLink => Boolean(link));

        return { nodes: sankeyNodes, links: sankeyLinks, nodeLookup, calculatedWidth };
    }, [flows, propWidth, height]);

    if (nodes.length === 0) {
        return (
            <div className="w-full h-80 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-slate-500 text-sm font-medium">No flow data available for this filter.</p>
            </div>
        );
    }

    const nodeWidth = 156;
    const padding = 56;
    const maxLevel = Math.max(...nodes.map((node) => node.level), 1);
    const levelSpacing = maxLevel > 0 ? (calculatedWidth - padding * 2 - nodeWidth) / maxLevel : 0;

    const getLinkColor = (link: SankeyLink, isHovered: boolean) => {
        const transitionKey = `${link.source}→${link.target}`;
        if (happyTransitionSet.has(transitionKey)) {
            return isHovered ? 'rgba(34, 197, 94, 0.95)' : 'rgba(34, 197, 94, 0.72)';
        }
        if (link.data.crashCount > 0 || link.data.anrCount > 0) {
            return isHovered ? 'rgba(239, 68, 68, 0.86)' : 'rgba(239, 68, 68, 0.46)';
        }
        if (link.data.rageTapCount > 0) {
            return isHovered ? 'rgba(244, 63, 94, 0.78)' : 'rgba(244, 63, 94, 0.38)';
        }
        if (link.data.apiErrorRate > 10) {
            return isHovered ? 'rgba(245, 158, 11, 0.84)' : 'rgba(245, 158, 11, 0.36)';
        }
        return isHovered ? 'rgba(37, 99, 235, 0.72)' : 'rgba(37, 99, 235, 0.24)';
    };

    const activeLink = hoveredLinkId ? links.find((link) => link.id === hoveredLinkId) || null : null;

    return (
        <div className="relative rounded-2xl border border-slate-200 bg-gradient-to-b from-white via-white to-slate-50/60 shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="text-xs font-semibold text-slate-700">
                    Flow map by transition volume
                </div>
                <div className="text-xs text-slate-500">
                    Green links represent your configured happy path.
                </div>
            </div>

            <div className="relative overflow-x-auto p-4">
                <div className="absolute inset-0 pointer-events-none opacity-25" style={{
                    backgroundImage: 'linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px)',
                    backgroundSize: '28px 28px',
                }} />
                <svg width={calculatedWidth} height={height} viewBox={`0 0 ${calculatedWidth} ${height}`} className="relative overflow-visible">
                    <g>
                        {links.map((link, index) => {
                            const sourceNode = nodeLookup.get(link.source);
                            const targetNode = nodeLookup.get(link.target);
                            if (!sourceNode || !targetNode) return null;

                            const xStart = padding + sourceNode.level * levelSpacing + nodeWidth;
                            const xEnd = padding + targetNode.level * levelSpacing;
                            const cp1x = xStart + (xEnd - xStart) * 0.42;
                            const cp2x = xEnd - (xEnd - xStart) * 0.42;

                            const isHovered = hoveredLinkId === link.id || hoveredNode === link.source || hoveredNode === link.target;
                            const isOther = (hoveredLinkId || hoveredNode) && !isHovered;

                            return (
                                <motion.path
                                    key={link.id}
                                    d={`M ${xStart} ${link.ySource} C ${cp1x} ${link.ySource}, ${cp2x} ${link.yTarget}, ${xEnd} ${link.yTarget}`}
                                    fill="none"
                                    stroke={getLinkColor(link, isHovered)}
                                    strokeWidth={link.thickness}
                                    strokeLinecap="round"
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{
                                        pathLength: 1,
                                        opacity: isOther ? 0.18 : 1,
                                        strokeWidth: isHovered ? link.thickness + 2 : link.thickness,
                                    }}
                                    transition={{ duration: 0.55, delay: index * 0.018 }}
                                    onMouseEnter={() => setHoveredLinkId(link.id)}
                                    onMouseLeave={() => setHoveredLinkId(null)}
                                    className="cursor-pointer"
                                    style={{ filter: isHovered ? 'drop-shadow(0 3px 6px rgba(15,23,42,0.14))' : 'none' }}
                                />
                            );
                        })}
                    </g>

                    <g>
                        {nodes.map((node, index) => {
                            const x = padding + node.level * levelSpacing;
                            const transitionHover = activeLink && (activeLink.source === node.id || activeLink.target === node.id);
                            const isHovered = hoveredNode === node.id || Boolean(transitionHover);
                            const isOther = (hoveredLinkId || hoveredNode) && !isHovered;
                            const isHappyNode = happyNodeSet.has(node.id);

                            return (
                                <g
                                    key={node.id}
                                    onMouseEnter={() => setHoveredNode(node.id)}
                                    onMouseLeave={() => setHoveredNode(null)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <motion.rect
                                        x={x}
                                        y={node.y}
                                        width={nodeWidth}
                                        height={node.height}
                                        rx="8"
                                        fill={isHappyNode ? (isHovered ? '#ecfdf3' : '#f0fdf4') : (isHovered ? '#ffffff' : '#f8fafc')}
                                        stroke={isHappyNode ? (isHovered ? '#16a34a' : '#86efac') : (isHovered ? '#2563eb' : '#cbd5e1')}
                                        strokeWidth={isHovered ? 2 : 1.2}
                                        initial={{ scaleX: 0, opacity: 0 }}
                                        animate={{
                                            scaleX: 1,
                                            opacity: isOther ? 0.42 : 1,
                                        }}
                                        transition={{ duration: 0.35, delay: 0.1 + index * 0.025 }}
                                        style={{
                                            transformOrigin: `${x}px ${node.y + node.height / 2}px`,
                                            filter: isHovered ? 'drop-shadow(0 6px 8px rgba(15,23,42,0.12))' : 'none',
                                        }}
                                    />
                                    <foreignObject x={x + 8} y={node.y + 4} width={nodeWidth - 16} height={node.height - 8}>
                                        <div className="h-full flex flex-col justify-center overflow-hidden">
                                            <div
                                                className={`text-[11px] font-semibold truncate leading-tight ${isHappyNode ? 'text-emerald-800' : 'text-slate-700'}`}
                                                title={node.name}
                                            >
                                                {node.name}
                                            </div>
                                            <div className={`text-[10px] ${isHappyNode ? 'text-emerald-600' : 'text-slate-500'} font-medium`}>
                                                {(node.inValue + node.outValue).toLocaleString()} transitions
                                            </div>
                                        </div>
                                    </foreignObject>
                                </g>
                            );
                        })}
                    </g>
                </svg>

                <AnimatePresence>
                    {activeLink && (
                        <motion.div
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 5 }}
                            className="absolute bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs pointer-events-none z-20"
                            style={{
                                left: `calc(${((nodeLookup.get(activeLink.source)?.level || 0) + (nodeLookup.get(activeLink.target)?.level || 0)) / 2 / Math.max(...nodes.map((node) => node.level), 1) * 100}% + 42px)`,
                                top: `${(activeLink.ySource + activeLink.yTarget) / 2 / height * 100}%`,
                                transform: 'translate(-50%, -50%)',
                            }}
                        >
                            <div className="font-semibold text-slate-800 mb-1">{activeLink.value.toLocaleString()} sessions</div>
                            <div className="text-slate-600">{activeLink.source} → {activeLink.target}</div>
                            <div className="mt-1 text-slate-500">{activeLink.data.apiErrorRate.toFixed(1)}% API error rate</div>
                            {activeLink.data.crashCount > 0 && <div className="text-red-600 mt-1">{activeLink.data.crashCount} crashes</div>}
                            {activeLink.data.anrCount > 0 && <div className="text-red-600">{activeLink.data.anrCount} ANRs</div>}
                            {activeLink.data.rageTapCount > 0 && <div className="text-rose-600">{activeLink.data.rageTapCount} rage taps</div>}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="border-t border-slate-200 px-5 py-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-1.5 rounded-full bg-emerald-500/70"></div>
                    <span>Happy path</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-1.5 rounded-full bg-red-500/60"></div>
                    <span>Crash/ANR risk</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-1.5 rounded-full bg-rose-500/60"></div>
                    <span>Rage-tap friction</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-1.5 rounded-full bg-blue-500/35"></div>
                    <span>Normal traffic</span>
                </div>
            </div>
        </div>
    );
};
