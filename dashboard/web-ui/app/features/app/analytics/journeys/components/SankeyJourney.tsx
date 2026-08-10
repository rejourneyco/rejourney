import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Focus, RotateCcw } from 'lucide-react';
import type { ObservabilityJourneySummary } from '~/shared/api/client';

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

export interface SankeyVersionOption {
    version: string;
    count: number;
}

export type StepJourneyGraph = NonNullable<ObservabilityJourneySummary['positionedGraph']>;
export type StepJourneyNode = StepJourneyGraph['nodes'][number];
export type StepJourneyLink = StepJourneyGraph['links'][number];

interface SankeyJourneyProps {
    graph: StepJourneyGraph;
    happyPath?: string[] | null;
    selectedTransitionIds?: string[];
    onFlowToggle?: (flow: StepJourneyLink) => void;
    appVersions?: SankeyVersionOption[];
    selectedAppVersion?: string | null;
    onAppVersionChange?: (version: string | null) => void;
}

type LayoutNode = StepJourneyNode & { x: number; y: number };
type LayoutLink = StepJourneyLink & { source: LayoutNode; target: LayoutNode; thickness: number };

const ALL_APP_VERSIONS_VALUE = '__all_app_versions__';
const NODE_WIDTH = 194;
const NODE_HEIGHT = 62;
const COLUMN_WIDTH = 264;
const COLUMN_GAP_TOP = 72;
const NODE_GAP = 18;
const CANVAS_PADDING_X = 32;
const MAX_VISIBLE_STEPS = 10;

const formatCompact = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString();
};

const getIssueLabel = (value: Pick<StepJourneyNode, 'crashCount' | 'anrCount' | 'rageTapCount' | 'apiErrorCount'>): string | null => {
    if (value.crashCount + value.anrCount > 0) return `${value.crashCount + value.anrCount} critical`;
    if (value.rageTapCount > 0) return `${value.rageTapCount} rage`;
    if (value.apiErrorCount > 0) return `${value.apiErrorCount} API`;
    return null;
};

const orderNodesByBarycenter = (nodes: StepJourneyNode[], links: StepJourneyLink[]): StepJourneyNode[][] => {
    const maxStep = Math.max(0, ...nodes.map((node) => node.step));
    const columns = Array.from({ length: maxStep + 1 }, (_, step) => nodes
        .filter((node) => node.step === step)
        .sort((left, right) => {
            const terminalDelta = Number(left.kind === 'exit' || left.kind === 'continue') - Number(right.kind === 'exit' || right.kind === 'continue');
            return terminalDelta || right.count - left.count || left.screen.localeCompare(right.screen);
        }));

    const positionMap = () => new Map(columns.flatMap((column) => column.map((node, index) => [node.id, index] as const)));
    for (let pass = 0; pass < 4; pass += 1) {
        let positions = positionMap();
        for (let step = 1; step < columns.length; step += 1) {
            columns[step].sort((left, right) => {
                const center = (node: StepJourneyNode) => {
                    const inbound = links.filter((link) => link.targetId === node.id);
                    const weight = inbound.reduce((sum, link) => sum + link.count, 0);
                    return weight > 0 ? inbound.reduce((sum, link) => sum + (positions.get(link.sourceId) || 0) * link.count, 0) / weight : Number.MAX_SAFE_INTEGER;
                };
                return center(left) - center(right) || right.count - left.count;
            });
        }
        positions = positionMap();
        for (let step = columns.length - 2; step >= 0; step -= 1) {
            columns[step].sort((left, right) => {
                const center = (node: StepJourneyNode) => {
                    const outbound = links.filter((link) => link.sourceId === node.id);
                    const weight = outbound.reduce((sum, link) => sum + link.count, 0);
                    return weight > 0 ? outbound.reduce((sum, link) => sum + (positions.get(link.targetId) || 0) * link.count, 0) / weight : Number.MAX_SAFE_INTEGER;
                };
                return center(left) - center(right) || right.count - left.count;
            });
        }
    }
    return columns;
};

export const SankeyJourney: React.FC<SankeyJourneyProps> = ({
    graph,
    happyPath = null,
    selectedTransitionIds = [],
    onFlowToggle,
    appVersions = [],
    selectedAppVersion = null,
    onAppVersionChange,
}) => {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [stepCount, setStepCount] = useState(6);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
    const [fitScale, setFitScale] = useState<number | null>(null);
    const dragState = useRef<{ pointerId: number; startX: number; startScrollLeft: number } | null>(null);
    const selectedSet = useMemo(() => new Set(selectedTransitionIds), [selectedTransitionIds]);

    const visibleGraph = useMemo(() => {
        const nodes = graph.nodes.filter((node) => node.step < stepCount || ((node.kind === 'exit' || node.kind === 'continue') && node.step === stepCount));
        const nodeIds = new Set(nodes.map((node) => node.id));
        const links = graph.links.filter((link) => link.step < stepCount && nodeIds.has(link.sourceId) && nodeIds.has(link.targetId));
        return { nodes, links };
    }, [graph.links, graph.nodes, stepCount]);

    const { nodes, links, canvasWidth, canvasHeight } = useMemo(() => {
        const columns = orderNodesByBarycenter(visibleGraph.nodes, visibleGraph.links);
        const maxColumnLength = Math.max(1, ...columns.map((column) => column.length));
        const canvasHeight = Math.max(500, COLUMN_GAP_TOP + maxColumnLength * (NODE_HEIGHT + NODE_GAP) + 44);
        const canvasWidth = Math.max(1080, CANVAS_PADDING_X * 2 + Math.max(1, columns.length - 1) * COLUMN_WIDTH + NODE_WIDTH);
        const positioned = columns.flatMap((column, step) => {
            const columnHeight = column.length * NODE_HEIGHT + Math.max(0, column.length - 1) * NODE_GAP;
            const startY = COLUMN_GAP_TOP + Math.max(0, (canvasHeight - COLUMN_GAP_TOP - 32 - columnHeight) / 2);
            return column.map<LayoutNode>((node, index) => ({
                ...node,
                x: CANVAS_PADDING_X + step * COLUMN_WIDTH,
                y: startY + index * (NODE_HEIGHT + NODE_GAP),
            }));
        });
        const lookup = new Map(positioned.map((node) => [node.id, node]));
        const maxCount = Math.max(1, ...visibleGraph.links.map((link) => link.count));
        const positionedLinks = visibleGraph.links.flatMap<LayoutLink>((link) => {
            const source = lookup.get(link.sourceId);
            const target = lookup.get(link.targetId);
            return source && target ? [{ ...link, source, target, thickness: Math.max(2, Math.min(28, (link.count / maxCount) * 28)) }] : [];
        });
        return { nodes: positioned, links: positionedLinks, canvasWidth, canvasHeight };
    }, [visibleGraph.links, visibleGraph.nodes]);

    useEffect(() => {
        setFitScale(null);
    }, [stepCount]);

    const happyNodeIds = useMemo(() => new Set(nodes
        .filter((node) => node.kind === 'screen' && happyPath?.[node.step] === node.screen)
        .map((node) => node.id)), [happyPath, nodes]);
    const happyLinkIds = useMemo(() => new Set(links
        .filter((link) => happyPath?.[link.step] === link.from && happyPath?.[link.step + 1] === link.to)
        .map((link) => link.id)), [happyPath, links]);
    const activeNodeId = hoveredNodeId || focusedNodeId;
    const hoveredNodeLinkIds = useMemo(() => new Set(links
        .filter((link) => link.sourceId === activeNodeId || link.targetId === activeNodeId)
        .map((link) => link.id)), [activeNodeId, links]);
    const selectedLinks = useMemo(() => links.filter((link) => selectedSet.has(link.id)).sort((a, b) => a.step - b.step), [links, selectedSet]);
    const selectedPath = selectedLinks.length > 0 ? [selectedLinks[0].from, ...selectedLinks.map((link) => link.to)] : [];
    const hoveredLink = links.find((link) => link.id === hoveredLinkId) || null;

    const fitJourney = () => {
        const host = scrollRef.current;
        if (!host) return;
        setFitScale(Math.min(1, Math.max(0.22, (host.clientWidth - 20) / canvasWidth)));
        host.scrollTo({ left: 0, behavior: 'smooth' });
    };

    const resetJourney = () => {
        setFitScale(null);
        scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
    };

    const maxStepOption = Math.min(MAX_VISIBLE_STEPS, Math.max(3, graph.maxAvailableStep || 3));
    const versionSelectId = 'journey-version-filter';
    const stepSelectId = 'journey-step-filter';

    return (
        <section className="journey-sankey-card rejourney-general-card overflow-hidden border border-[#dadce0] bg-white shadow-none" aria-label="User journey paths">
            <div className="h-1 bg-[#3b82f6]" />
            <header className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="text-[15px] font-semibold text-slate-950">Journey paths</h2>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">Each column is the next screen users visited. Select connected paths to query exact replays.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={stepSelectId} className="sr-only">Journey steps</label>
                    <div className="relative">
                        <select id={stepSelectId} value={Math.min(stepCount, maxStepOption)} onChange={(event) => setStepCount(Number(event.target.value))} className="h-11 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-xs font-semibold text-slate-700 outline-none hover:border-slate-400 focus:ring-2 focus:ring-blue-500 sm:h-9">
                            {Array.from({ length: maxStepOption - 2 }, (_, index) => index + 3).map((count) => <option key={count} value={count}>{count} steps</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    </div>
                    <label htmlFor={versionSelectId} className="sr-only">Journey app version</label>
                    <div className="relative">
                        <select id={versionSelectId} value={selectedAppVersion || ALL_APP_VERSIONS_VALUE} onChange={(event) => onAppVersionChange?.(event.target.value === ALL_APP_VERSIONS_VALUE ? null : event.target.value)} className="h-11 min-w-[160px] appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-xs font-semibold text-slate-700 outline-none hover:border-slate-400 focus:ring-2 focus:ring-blue-500 sm:h-9">
                            <option value={ALL_APP_VERSIONS_VALUE}>All versions</option>
                            {appVersions.map((option) => <option key={option.version} value={option.version}>{option.version === 'UNKNOWN' ? 'Unknown version' : `v${option.version}`} ({formatCompact(option.count)})</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    </div>
                    <button type="button" onClick={fitJourney} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:h-9"><Focus className="h-3.5 w-3.5" />Fit</button>
                    <button type="button" onClick={resetJourney} aria-label="Reset journey position" className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:h-9 sm:w-9"><RotateCcw className="h-3.5 w-3.5" /></button>
                </div>
            </header>

            {selectedPath.length > 0 && (
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-b border-blue-100 bg-blue-50/70 px-4 py-2.5 text-xs" aria-live="polite">
                    <span className="shrink-0 font-bold text-blue-900">Selected exact path</span>
                    {selectedPath.map((screen, index) => <React.Fragment key={`${screen}:${index}`}>{index > 0 && <span className="text-blue-400">→</span>}<span className="max-w-48 shrink-0 truncate rounded-md border border-blue-200 bg-white px-2 py-1 font-semibold text-blue-950" title={screen}>{screen}</span></React.Fragment>)}
                </div>
            )}

            {nodes.length === 0 ? (
                <div className="grid h-80 place-items-center text-sm font-medium text-slate-500">No journey activity is available for this filter.</div>
            ) : (
                <div
                    ref={scrollRef}
                    className="relative overflow-x-auto overflow-y-hidden bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                    style={{ overscrollBehavior: 'contain', touchAction: 'pan-x pan-y', cursor: dragState.current ? 'grabbing' : 'grab' }}
                    tabIndex={0}
                    role="region"
                    aria-label="Scrollable step-based journey map"
                    onWheel={(event) => { if (event.shiftKey && scrollRef.current) { event.preventDefault(); scrollRef.current.scrollLeft += event.deltaY; } }}
                    onPointerDown={(event) => {
                        if ((event.target as Element).closest('button, [role="button"], select')) return;
                        setFocusedNodeId(null);
                        dragState.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: event.currentTarget.scrollLeft };
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => { const drag = dragState.current; if (drag?.pointerId === event.pointerId) event.currentTarget.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX); }}
                    onPointerUp={(event) => { if (dragState.current?.pointerId === event.pointerId) dragState.current = null; }}
                >
                    <div style={{ width: canvasWidth * (fitScale || 1), height: canvasHeight * (fitScale || 1), minWidth: fitScale ? undefined : canvasWidth }}>
                        <div className="relative origin-top-left" style={{ width: canvasWidth, height: canvasHeight, transform: fitScale ? `scale(${fitScale})` : undefined }}>
                            {Array.from(new Set(nodes.map((node) => node.step))).map((step) => (
                                <div key={step} className="absolute top-0 border-b border-slate-200 pb-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400" style={{ left: CANVAS_PADDING_X + step * COLUMN_WIDTH, width: NODE_WIDTH }}>
                                    {step === 0 ? 'Entry' : `Step ${step + 1}`}
                                </div>
                            ))}

                            <svg className="absolute inset-0 overflow-visible" width={canvasWidth} height={canvasHeight} aria-hidden="true">
                                {links.map((link) => {
                                    const x1 = link.source.x + NODE_WIDTH;
                                    const y1 = link.source.y + NODE_HEIGHT / 2;
                                    const x2 = link.target.x;
                                    const y2 = link.target.y + NODE_HEIGHT / 2;
                                    const bend = Math.max(40, (x2 - x1) * 0.45);
                                    const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
                                    const selected = selectedSet.has(link.id);
                                    const related = hoveredLinkId === link.id || hoveredNodeLinkIds.has(link.id);
                                    const dimmed = Boolean(activeNodeId || hoveredLinkId || selectedSet.size) && !selected && !related;
                                    const happy = happyLinkIds.has(link.id);
                                    return <path key={link.id} d={d} fill="none" stroke={selected ? '#0f172a' : happy ? '#10b981' : link.isAggregate ? '#94a3b8' : '#75a7e8'} strokeWidth={selected ? link.thickness + 4 : related ? link.thickness + 2 : link.thickness} strokeDasharray={link.isAggregate || link.isTerminal ? '7 5' : undefined} strokeLinecap="round" opacity={dimmed ? 0.08 : selected ? 0.88 : related ? 0.78 : 0.34} style={{ transition: 'opacity 150ms ease, stroke-width 150ms ease' }} />;
                                })}
                            </svg>
                            <svg className="absolute inset-0 overflow-visible" width={canvasWidth} height={canvasHeight}>
                                {links.filter((link) => !link.isAggregate && !link.isTerminal).map((link) => {
                                    const x1 = link.source.x + NODE_WIDTH;
                                    const y1 = link.source.y + NODE_HEIGHT / 2;
                                    const x2 = link.target.x;
                                    const y2 = link.target.y + NODE_HEIGHT / 2;
                                    const bend = Math.max(40, (x2 - x1) * 0.45);
                                    const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
                                    return <path key={link.id} d={d} fill="none" stroke="transparent" strokeWidth={Math.max(16, link.thickness + 10)} role="button" tabIndex={0} aria-label={`${link.from} to ${link.to}, ${link.count.toLocaleString()} sessions, ${(link.trafficShare * 100).toFixed(1)} percent of source traffic`} className="cursor-pointer focus:outline-none" onMouseEnter={() => setHoveredLinkId(link.id)} onMouseLeave={() => setHoveredLinkId(null)} onFocus={() => setHoveredLinkId(link.id)} onBlur={() => setHoveredLinkId(null)} onClick={() => onFlowToggle?.(link)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onFlowToggle?.(link); } }} />;
                                })}
                            </svg>

                            {nodes.map((node) => {
                                const hovered = activeNodeId === node.id;
                                const selectedNode = links.some((link) => selectedSet.has(link.id) && (link.sourceId === node.id || link.targetId === node.id));
                                const dimmed = Boolean(activeNodeId || hoveredLinkId || selectedSet.size) && !hovered && !selectedNode && !links.some((link) => (hoveredLinkId === link.id) && (link.sourceId === node.id || link.targetId === node.id));
                                const issueLabel = getIssueLabel(node);
                                const terminal = node.kind === 'exit' || node.kind === 'continue';
                                return (
                                    <button key={node.id} type="button" aria-pressed={focusedNodeId === node.id} style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT, opacity: dimmed ? 0.28 : 1 }} className={`absolute flex overflow-hidden rounded-xl border bg-white text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${happyNodeIds.has(node.id) ? 'border-emerald-400 ring-1 ring-emerald-200' : hovered || selectedNode ? 'border-slate-500 shadow-md' : 'border-slate-200'} ${terminal ? 'border-dashed bg-slate-50' : ''}`} onMouseEnter={() => setHoveredNodeId(node.id)} onMouseLeave={() => setHoveredNodeId(null)} onFocus={() => setHoveredNodeId(node.id)} onBlur={() => setHoveredNodeId(null)} onClick={() => setFocusedNodeId((current) => current === node.id ? null : node.id)} aria-label={`${node.screen}, step ${node.step + 1}, ${node.count.toLocaleString()} sessions, ${(node.share * 100).toFixed(1)} percent share${issueLabel ? `, ${issueLabel}` : ''}`}>
                                        <span className={`w-1.5 shrink-0 ${terminal ? 'bg-slate-400' : happyNodeIds.has(node.id) ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                                        <span className="flex min-w-0 flex-1 flex-col justify-center px-3">
                                            <span className="flex min-w-0 items-center justify-between gap-2">
                                                <span className="truncate text-xs font-bold text-slate-950" title={node.screen}>{node.screen}</span>
                                                <span className="shrink-0 font-mono text-xs font-black text-slate-900">{formatCompact(node.count)}</span>
                                            </span>
                                            <span className="mt-1 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-500">
                                                <span>{(node.share * 100).toFixed(1)}% at this step</span>
                                                {issueLabel && <span className={`inline-flex items-center gap-1 ${node.health === 'problematic' ? 'text-rose-700' : 'text-amber-700'}`}><AlertTriangle className="h-3 w-3" />{issueLabel}</span>}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}

                            {hoveredLink && (
                                <div className="pointer-events-none absolute z-30 w-56 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl" style={{ left: Math.min(canvasWidth - 240, (hoveredLink.source.x + hoveredLink.target.x + NODE_WIDTH) / 2 - 112), top: Math.max(44, (hoveredLink.source.y + hoveredLink.target.y) / 2 - 72) }} role="tooltip">
                                    <div className="truncate font-bold text-slate-950">{hoveredLink.from} → {hoveredLink.to}</div>
                                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-500"><span>Sessions</span><span className="text-right font-mono font-bold text-slate-900">{hoveredLink.count.toLocaleString()}</span><span>Source share</span><span className="text-right font-mono font-bold text-slate-900">{(hoveredLink.trafficShare * 100).toFixed(1)}%</span><span>Replay ready</span><span className="text-right font-mono font-bold text-slate-900">{hoveredLink.replayCount.toLocaleString()}</span><span>API latency</span><span className="text-right font-mono font-bold text-slate-900">{hoveredLink.avgApiLatencyMs > 0 ? `${hoveredLink.avgApiLatencyMs.toLocaleString()} ms` : '—'}</span></div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200 bg-white px-4 py-3 text-[11px] font-semibold text-slate-500 sm:px-5">
                <span><strong className="text-slate-900">{graph.sampledSessions.toLocaleString()}</strong> journey sessions sampled</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-6 rounded-full bg-blue-400/70" />Width = traffic volume</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-emerald-500 bg-white" />Happy path</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-6 border-t-2 border-dashed border-slate-400" />Exit or aggregated traffic</span>
            </footer>
        </section>
    );
};
