import React, { useMemo, useState } from 'react';

export interface SankeyFlow {
    from: string;
    to: string;
    count: number;
    crashCount: number;
    anrCount: number;
    apiErrorRate: number;
    rageTapCount: number;
    apiErrors?: number;
    avgApiLatencyMs?: number;
    health?: 'healthy' | 'degraded' | 'problematic';
    replayCount?: number;
    sampleSessionIds?: string[];
    isAggregate?: boolean;
    aggregateFlowCount?: number;
}

export interface SankeyEvidenceSession {
    sessionId: string;
    source: string;
    signal: string;
    priority?: 'high' | 'medium' | 'low';
}

interface SankeyNode {
    id: string;
    name: string;
    level: number;
    y: number;
    cardY: number;
    barY: number;
    barHeight: number;
    outValue: number;
    inValue: number;
    totalValue: number;
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
    selectedTransitionIds?: string[];
    onFlowToggle?: (flow: SankeyFlow) => void;
}

const interpolateChannel = (from: number, to: number, amount: number): number => Math.round(from + (to - from) * amount);

const volumeColorStops = [
    { at: 0, rgb: [251, 113, 133] },
    { at: 0.2, rgb: [251, 146, 60] },
    { at: 0.42, rgb: [250, 204, 21] },
    { at: 0.58, rgb: [134, 239, 172] },
    { at: 1, rgb: [34, 197, 94] },
] as const;

const getVolumeColor = (ratio: number, alpha: number): string => {
    const normalized = Math.max(0, Math.min(1, ratio));
    const upperIndex = volumeColorStops.findIndex((stop) => normalized <= stop.at);
    const upper = volumeColorStops[upperIndex === -1 ? volumeColorStops.length - 1 : upperIndex];
    const lower = volumeColorStops[Math.max(0, (upperIndex === -1 ? volumeColorStops.length - 1 : upperIndex) - 1)];
    const span = Math.max(upper.at - lower.at, 0.001);
    const amount = (normalized - lower.at) / span;
    const [r1, g1, b1] = lower.rgb;
    const [r2, g2, b2] = upper.rgb;

    return `rgba(${interpolateChannel(r1, r2, amount)}, ${interpolateChannel(g1, g2, amount)}, ${interpolateChannel(b1, b2, amount)}, ${alpha})`;
};

export const SankeyJourney: React.FC<SankeyJourneyProps> = ({
    flows,
    width: propWidth,
    height = 560,
    happyPath,
    selectedTransitionIds = [],
    onFlowToggle,
}) => {
    const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);

    const happyNodeSet = useMemo(() => new Set(happyPath || []), [happyPath]);

    const selectedTransitionSet = useMemo(() => new Set(selectedTransitionIds), [selectedTransitionIds]);

    const selectedNodeSet = useMemo(() => {
        const nodes = new Set<string>();
        for (const transitionId of selectedTransitionIds) {
            const [from, to] = transitionId.split('→');
            if (from) nodes.add(from);
            if (to) nodes.add(to);
        }
        return nodes;
    }, [selectedTransitionIds]);

    const { nodes, links, nodeLookup, calculatedWidth, calculatedHeight } = useMemo(() => {
        if (flows.length === 0) {
            return {
                nodes: [],
                links: [],
                nodeLookup: new Map<string, SankeyNode>(),
                calculatedWidth: propWidth || 1200,
                calculatedHeight: height,
            };
        }

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

        nodesByLevel.forEach((levelNodes) => {
            levelNodes.sort((a, b) => {
                const aData = nodeMap.get(a)!;
                const bData = nodeMap.get(b)!;
                return Math.max(bData.in, bData.out) - Math.max(aData.in, aData.out);
            });
        });

        const cardHeight = 30;
        const nodePadding = 34;
        const paddingX = 44;
        const paddingY = 52;
        const barMinHeight = 54;
        const barMaxHeight = 220;
        const minLevelSpacing = 360;
        const maxNodeValue = Math.max(...Array.from(nodeMap.values()).map((node) => Math.max(node.in, node.out)), 1);

        const calculatedWidth = propWidth || Math.max(1120, paddingX * 2 + maxLevel * minLevelSpacing + 260);

        const sankeyNodes: SankeyNode[] = [];
        nodesByLevel.forEach((levelNodes, level) => {
            const desiredNodes = levelNodes.map((id) => {
                const nodeData = nodeMap.get(id)!;
                const totalValue = Math.max(nodeData.in, nodeData.out);
                const barHeight = Math.max(
                    barMinHeight,
                    Math.min(barMaxHeight, Math.sqrt(totalValue / maxNodeValue) * barMaxHeight),
                );
                return { id, nodeData, totalValue, barHeight };
            });
            const desiredHeight = desiredNodes.reduce((sum, node) => sum + Math.max(node.barHeight, cardHeight), 0)
                + Math.max(0, desiredNodes.length - 1) * nodePadding;
            const availableHeight = Math.max(260, height - paddingY * 2);
            const scale = desiredHeight > availableHeight ? availableHeight / desiredHeight : 1;
            const effectivePadding = Math.max(12, nodePadding * scale);
            const actualHeight = desiredNodes.reduce((sum, node) => sum + Math.max(node.barHeight * scale, cardHeight), 0)
                + Math.max(0, desiredNodes.length - 1) * effectivePadding;
            let startY = Math.max(24, (height - actualHeight) / 2);

            desiredNodes.forEach(({ id, nodeData, totalValue, barHeight }) => {
                const scaledBarHeight = Math.max(barMinHeight * 0.68, barHeight * scale);
                const slotHeight = Math.max(scaledBarHeight, cardHeight);
                const barY = startY + (slotHeight - scaledBarHeight) / 2;
                const cardY = startY + (slotHeight - cardHeight) / 2;
                sankeyNodes.push({
                    id,
                    name: id.replace(/Activity$/, '').replace(/ViewController$/, '').replace(/Screen$/, ''),
                    level,
                    y: startY,
                    cardY,
                    barY,
                    barHeight: scaledBarHeight,
                    inValue: nodeData.in,
                    outValue: nodeData.out,
                    totalValue,
                });
                startY += slotHeight + effectivePadding;
            });
        });

        const nodeLookup = new Map(sankeyNodes.map((node) => [node.id, node]));
        const maxFlow = Math.max(...flows.map((flow) => flow.count), 1);

        const sankeyLinks = flows
            .map((flow) => {
                const sourceNode = nodeLookup.get(flow.from);
                const targetNode = nodeLookup.get(flow.to);
                if (!sourceNode || !targetNode) return null;

                return {
                    id: `${flow.from}→${flow.to}`,
                    source: flow.from,
                    target: flow.to,
                    value: flow.count,
                    ySource: sourceNode.barY + sourceNode.barHeight / 2,
                    yTarget: targetNode.barY + targetNode.barHeight / 2,
                    thickness: Math.max(5, Math.sqrt(flow.count / maxFlow) * 42),
                    data: flow,
                };
            })
            .filter((link): link is SankeyLink => Boolean(link));

        const getNodeStackLinks = (nodeId: string, direction: 'source' | 'target') => (
            sankeyLinks
                .filter((link) => direction === 'source' ? link.source === nodeId : link.target === nodeId)
                .sort((a, b) => {
                    const aOther = nodeLookup.get(direction === 'source' ? a.target : a.source);
                    const bOther = nodeLookup.get(direction === 'source' ? b.target : b.source);
                    return (aOther?.barY || 0) - (bOther?.barY || 0);
                })
        );

        for (let pass = 0; pass < 3; pass += 1) {
            for (const node of sankeyNodes) {
                for (const direction of ['source', 'target'] as const) {
                    const nodeLinks = getNodeStackLinks(node.id, direction);
                    if (nodeLinks.length === 0) continue;

                    const linkGap = nodeLinks.length > 6 ? 1 : 2;
                    const totalGap = Math.max(0, nodeLinks.length - 1) * linkGap;
                    const availableThickness = Math.max(node.barHeight - totalGap, nodeLinks.length * 2.25);
                    const currentThickness = nodeLinks.reduce((sum, link) => sum + link.thickness, 0);

                    if (currentThickness > availableThickness) {
                        const scale = availableThickness / currentThickness;
                        for (const link of nodeLinks) {
                            link.thickness = Math.max(2.25, link.thickness * scale);
                        }
                    }
                }
            }
        }

        const stackLinks = (nodeId: string, direction: 'source' | 'target') => {
            const node = nodeLookup.get(nodeId);
            if (!node) return;

            const nodeLinks = getNodeStackLinks(nodeId, direction);

            if (nodeLinks.length === 0) return;

            const linkGap = nodeLinks.length > 6 ? 1 : 2;
            const totalThickness = nodeLinks.reduce((sum, link) => sum + link.thickness, 0)
                + Math.max(0, nodeLinks.length - 1) * linkGap;
            let cursor = node.barY + Math.max(0, (node.barHeight - totalThickness) / 2);

            for (const link of nodeLinks) {
                const centerY = cursor + link.thickness / 2;
                if (direction === 'source') {
                    link.ySource = centerY;
                } else {
                    link.yTarget = centerY;
                }
                cursor += link.thickness + linkGap;
            }
        };

        for (const node of sankeyNodes) {
            stackLinks(node.id, 'source');
            stackLinks(node.id, 'target');
        }

        const nodeBottom = sankeyNodes.reduce(
            (bottom, node) => Math.max(bottom, node.barY + node.barHeight, node.cardY + cardHeight),
            height,
        );
        const linkBottom = sankeyLinks.reduce(
            (bottom, link) => Math.max(
                bottom,
                link.ySource + link.thickness / 2,
                link.yTarget + link.thickness / 2,
            ),
            height,
        );
        const contentBottom = Math.max(nodeBottom, linkBottom);
        const calculatedHeight = Math.ceil(contentBottom > height ? contentBottom + 24 : height);

        return { nodes: sankeyNodes, links: sankeyLinks, nodeLookup, calculatedWidth, calculatedHeight };
    }, [flows, propWidth, height]);

    if (nodes.length === 0) {
        return (
            <div className="journey-sankey-empty w-full h-80 flex items-center justify-center border-2 border-black bg-white">
                <p className="text-slate-500 text-sm font-medium">No flow data available for this filter.</p>
            </div>
        );
    }

    const cardWidth = 132;
    const cardHeight = 30;
    const barWidth = 16;
    const cardGap = 8;
    const padding = 44;
    const maxLevel = Math.max(...nodes.map((node) => node.level), 1);
    const levelSpacing = maxLevel > 0 ? (calculatedWidth - padding * 2 - cardWidth - barWidth - cardGap) / maxLevel : 0;
    const maxLinkValue = Math.max(...links.map((link) => link.value), 1);

    const formatCompact = (value: number): string => {
        if (!Number.isFinite(value)) return '0';
        if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
        if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
        return value.toLocaleString();
    };

    const getLinkColor = (link: SankeyLink, isHovered: boolean, isSelected: boolean) => {
        const ratio = link.value / maxLinkValue;
        if (isSelected) return getVolumeColor(ratio, isHovered ? 0.98 : 0.9);
        return getVolumeColor(ratio, isHovered ? 0.9 : 0.58);
    };

    const getNodeBarColor = (node: SankeyNode, isHovered: boolean, isSelectedNode: boolean, isHappyNode: boolean): string => {
        if (isSelectedNode) return isHovered ? '#0891b2' : '#67e8f9';
        if (isHappyNode) return isHovered ? '#22c55e' : '#86efac';
        return isHovered ? '#5dadec' : '#dbeafe';
    };

    const hoveredLink = hoveredLinkId ? links.find((link) => link.id === hoveredLinkId) || null : null;
    const activeLink = hoveredLink;

    const hasSelectedPaths = selectedTransitionSet.size > 0;

    return (
        <div className="journey-sankey-card relative overflow-hidden border-2 border-black bg-white shadow-neo">
            <div className="flex flex-col gap-2 border-b-2 border-black bg-[#f8fafc] px-5 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <div className="text-[11px] font-black uppercase text-black">
                        Journey lanes
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-500">
                        Transition volume by screen path
                    </div>
                </div>
                <div className="inline-flex items-center self-start border-2 border-black bg-white px-3 py-1.5 text-[10px] font-black uppercase text-black shadow-neo-sm md:self-auto">
                    {hasSelectedPaths
                        ? `${selectedTransitionSet.size} query path${selectedTransitionSet.size === 1 ? '' : 's'}`
                        : 'No query paths'}
                </div>
            </div>

            <div
                className="relative overflow-auto overscroll-contain bg-white focus:outline-none focus:ring-2 focus:ring-black focus:ring-inset"
                style={{ maxHeight: height }}
                tabIndex={0}
                role="region"
                aria-label="Scrollable journey lanes map"
            >
                <div className="relative" style={{ width: calculatedWidth, height: calculatedHeight }}>
                    <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-white via-[#f8fafc] to-white" />
                    <svg width={calculatedWidth} height={calculatedHeight} viewBox={`0 0 ${calculatedWidth} ${calculatedHeight}`} className="relative block overflow-visible">
                    <g>
                        {[...links].sort((a, b) => b.thickness - a.thickness).map((link) => {
                            const sourceNode = nodeLookup.get(link.source);
                            const targetNode = nodeLookup.get(link.target);
                            if (!sourceNode || !targetNode) return null;

                            const xStart = padding + sourceNode.level * levelSpacing + barWidth + cardGap;
                            const xEnd = padding + targetNode.level * levelSpacing;
                            const cp1x = xStart + Math.max(80, (xEnd - xStart) * 0.46);
                            const cp2x = xEnd - Math.max(80, (xEnd - xStart) * 0.46);

                            const isSelected = selectedTransitionSet.has(link.id);
                            const isHovered = hoveredLinkId === link.id;
                            const hasActiveFocus = Boolean(hoveredLinkId || hasSelectedPaths);
                            const isOther = hasActiveFocus && !isHovered && !isSelected;
                            const isAggregate = Boolean(link.data.isAggregate);

                            const t = isSelected ? link.thickness + 6 : isHovered ? link.thickness + 4 : link.thickness;
                            const ht = t / 2;
                            const y0t = link.ySource - ht;
                            const y0b = link.ySource + ht;
                            const y1t = link.yTarget - ht;
                            const y1b = link.yTarget + ht;

                            // Filled ribbon: top bezier forward, bottom bezier backward
                            const d = [
                                `M ${xStart} ${y0t}`,
                                `C ${cp1x} ${y0t}, ${cp2x} ${y1t}, ${xEnd} ${y1t}`,
                                `L ${xEnd} ${y1b}`,
                                `C ${cp2x} ${y1b}, ${cp1x} ${y0b}, ${xStart} ${y0b}`,
                                'Z',
                            ].join(' ');

                            return (
                                <path
                                    key={link.id}
                                    d={d}
                                    fill={getLinkColor(link, isHovered, isSelected)}
                                    stroke="none"
                                    strokeDasharray={isAggregate ? '14 10' : undefined}
                                    opacity={isOther ? 0.16 : 1}
                                    onMouseEnter={() => setHoveredLinkId(link.id)}
                                    onMouseLeave={() => setHoveredLinkId(null)}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        if (!isAggregate) {
                                            onFlowToggle?.(link.data);
                                        }
                                    }}
                                    className={isAggregate ? 'cursor-default' : 'cursor-pointer'}
                                    style={{
                                        filter: isHovered || isSelected ? 'drop-shadow(0 4px 7px rgba(15,23,42,0.16))' : 'none',
                                        transition: 'opacity 180ms ease, filter 180ms ease',
                                    }}
                                />
                            );
                        })}
                    </g>

                    <g>
                        {nodes.map((node) => {
                            const x = padding + node.level * levelSpacing;
                            const cardX = x + barWidth + cardGap;
                            const transitionHover = activeLink && (activeLink.source === node.id || activeLink.target === node.id);
                            const isSelectedNode = selectedNodeSet.has(node.id);
                            const isHovered = hoveredNode === node.id || Boolean(transitionHover) || isSelectedNode;
                            const isOther = (hoveredLinkId || hasSelectedPaths) && !isHovered;
                            const isHappyNode = happyNodeSet.has(node.id);
                            const visibleValue = Math.max(node.inValue, node.outValue);

                            return (
                                <g
                                    key={node.id}
                                    onMouseEnter={() => setHoveredNode(node.id)}
                                    onMouseLeave={() => setHoveredNode(null)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <rect
                                        x={x}
                                        y={node.barY}
                                        width={barWidth}
                                        height={node.barHeight}
                                        rx="3"
                                        fill={getNodeBarColor(node, isHovered, isSelectedNode, isHappyNode)}
                                        stroke="#0f172a"
                                        strokeWidth={isHovered || isSelectedNode ? 2 : 1}
                                        opacity={isOther ? 0.34 : 1}
                                        style={{
                                            filter: isHovered || isSelectedNode ? 'drop-shadow(0 5px 7px rgba(15,23,42,0.14))' : 'none',
                                            transition: 'opacity 180ms ease, stroke 180ms ease, stroke-width 180ms ease, filter 180ms ease, fill 180ms ease',
                                        }}
                                    />
                                    <rect
                                        x={cardX}
                                        y={node.cardY}
                                        width={cardWidth}
                                        height={cardHeight}
                                        rx="4"
                                        fill={isSelectedNode ? '#ecfeff' : '#ffffff'}
                                        stroke={isSelectedNode ? '#0891b2' : isHappyNode ? '#22c55e' : isHovered ? '#5dadec' : '#cbd5e1'}
                                        strokeWidth={isHovered || isSelectedNode ? 2 : 1}
                                        opacity={isOther ? 0.36 : 1}
                                        pointerEvents="none"
                                        style={{
                                            filter: isHovered || isSelectedNode ? 'drop-shadow(0 3px 6px rgba(15,23,42,0.14))' : 'drop-shadow(0 2px 4px rgba(15,23,42,0.08))',
                                            transition: 'opacity 180ms ease, stroke 180ms ease, stroke-width 180ms ease, filter 180ms ease, fill 180ms ease',
                                        }}
                                    />
                                    <foreignObject x={cardX + 8} y={node.cardY + 6} width={cardWidth - 16} height={18} pointerEvents="none">
                                        <div className="flex h-full min-w-0 items-center overflow-hidden pointer-events-none">
                                            <div className="flex w-full min-w-0 items-center justify-between gap-2">
                                                <div
                                                    className={`min-w-0 truncate text-[10px] font-black leading-tight ${isHappyNode ? 'text-emerald-800' : 'text-slate-800'}`}
                                                    title={node.name}
                                                >
                                                    {node.name}
                                                </div>
                                                <div className="shrink-0 font-mono text-[10px] font-black text-slate-700">
                                                    {formatCompact(visibleValue)}
                                                </div>
                                            </div>
                                        </div>
                                    </foreignObject>
                                </g>
                            );
                        })}
                    </g>
                    </svg>
                </div>

            </div>

            <div className="flex flex-wrap items-center gap-4 border-t-2 border-black bg-[#f8fafc] px-5 py-3 text-[11px] font-semibold text-slate-600">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-4 border border-black bg-[#86efac]"></div>
                    <span>Highest volume</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="h-2 w-4 border border-black bg-[#facc15]"></div>
                    <span>Mid volume</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="h-2 w-4 border border-black bg-[#fb923c]"></div>
                    <span>Thin path</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="h-2 w-4 border border-black bg-[#fb7185]"></div>
                    <span>Lowest volume</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-7 border-t-2 border-dashed border-black"></div>
                    <span>Aggregated tail</span>
                </div>
            </div>
        </div>
    );
};
