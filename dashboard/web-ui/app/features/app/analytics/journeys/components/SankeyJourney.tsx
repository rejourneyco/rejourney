import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Focus, Minus, MousePointerClick, RotateCcw, X } from 'lucide-react';
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
    onClearSelection?: () => void;
    onUndoSelection?: () => void;
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
    onClearSelection,
    onUndoSelection,
    appVersions = [],
    selectedAppVersion = null,
    onAppVersionChange,
}) => {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [stepCount, setStepCount] = useState(6);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
    const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
    const [fitScale, setFitScale] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [horizontalScrollState, setHorizontalScrollState] = useState({
        canScrollLeft: false,
        canScrollRight: false,
    });
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

    useEffect(() => {
        setSelectionNotice(null);
    }, [selectedTransitionIds]);

    useEffect(() => {
        const host = scrollRef.current;
        if (!host) return;

        const updateScrollState = () => {
            const nextState = {
                canScrollLeft: host.scrollLeft > 2,
                canScrollRight: host.scrollLeft < host.scrollWidth - host.clientWidth - 2,
            };
            setHorizontalScrollState((current) => (
                current.canScrollLeft === nextState.canScrollLeft
                && current.canScrollRight === nextState.canScrollRight
                    ? current
                    : nextState
            ));
        };

        const handleWheel = (event: WheelEvent) => {
            setHoveredNodeId(null);
            setHoveredLinkId(null);
            if (!event.shiftKey || event.deltaY === 0) return;
            event.preventDefault();
            host.scrollLeft += event.deltaY;
        };

        updateScrollState();
        host.addEventListener('scroll', updateScrollState, { passive: true });
        host.addEventListener('wheel', handleWheel, { passive: false });
        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(updateScrollState)
            : null;
        resizeObserver?.observe(host);

        return () => {
            host.removeEventListener('scroll', updateScrollState);
            host.removeEventListener('wheel', handleWheel);
            resizeObserver?.disconnect();
        };
    }, [canvasWidth, fitScale, nodes.length]);

    const happyNodeIds = useMemo(() => new Set(nodes
        .filter((node) => node.kind === 'screen' && happyPath?.[node.step] === node.screen)
        .map((node) => node.id)), [happyPath, nodes]);
    const happyLinkIds = useMemo(() => new Set(links
        .filter((link) => happyPath?.[link.step] === link.from && happyPath?.[link.step + 1] === link.to)
        .map((link) => link.id)), [happyPath, links]);
    const hoveredNodeLinkIds = useMemo(() => new Set(links
        .filter((link) => link.sourceId === hoveredNodeId || link.targetId === hoveredNodeId)
        .map((link) => link.id)), [hoveredNodeId, links]);
    const selectedLinks = useMemo(() => graph.links
        .filter((link) => selectedSet.has(link.id))
        .sort((left, right) => left.step - right.step), [graph.links, selectedSet]);
    const visibleSelectedLinks = useMemo(() => links.filter((link) => selectedSet.has(link.id)), [links, selectedSet]);
    const hasVisibleSelection = visibleSelectedLinks.length > 0;
    const selectedPath = selectedLinks.length > 0 ? [selectedLinks[0].from, ...selectedLinks.map((link) => link.to)] : [];
    const hoveredLink = links.find((link) => link.id === hoveredLinkId) || null;
    const continuationLinkIds = useMemo(() => {
        const selectableLinks = graph.links.filter((link) => !link.isAggregate && !link.isTerminal);
        if (selectedLinks.length === 0) return new Set(selectableLinks.map((link) => link.id));
        const first = selectedLinks[0];
        const last = selectedLinks[selectedLinks.length - 1];
        return new Set(selectableLinks
            .filter((link) => selectedSet.has(link.id)
                || (link.step === last.step + 1 && link.from === last.to)
                || (link.step === first.step - 1 && link.to === first.from))
            .map((link) => link.id));
    }, [graph.links, selectedLinks, selectedSet]);

    const toggleFlow = (link: StepJourneyLink) => {
        if (selectedSet.has(link.id) || continuationLinkIds.has(link.id)) {
            setSelectionNotice(null);
            onFlowToggle?.(link);
            return;
        }
        setSelectionNotice('Choose a highlighted connected line, or clear the current path to start somewhere else.');
    };

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

    const scrollJourney = (direction: 'left' | 'right') => {
        const host = scrollRef.current;
        if (!host) return;
        host.scrollBy({
            left: direction === 'left' ? -COLUMN_WIDTH : COLUMN_WIDTH,
            behavior: 'smooth',
        });
    };

    const maxStepOption = Math.min(MAX_VISIBLE_STEPS, Math.max(3, graph.maxAvailableStep || 3));
    const requiredSelectedSteps = selectedLinks.reduce((maximum, link) => Math.max(maximum, link.step + 2), 0);
    const selectedPathIsClipped = requiredSelectedSteps > stepCount && requiredSelectedSteps <= maxStepOption;
    const versionSelectId = 'journey-version-filter';
    const stepSelectId = 'journey-step-filter';

    const getFlowActionLabel = (link: StepJourneyLink): string => {
        if (selectedSet.has(link.id)) return 'Activate to shorten the selected path here';
        if (!continuationLinkIds.has(link.id)) return 'Not connected to the selected path';
        return selectedLinks.length > 0 ? 'Activate to extend the selected path' : 'Activate to start a path';
    };

    return (
        <section className="journey-sankey-card rejourney-general-card overflow-hidden border border-[#dadce0] bg-white shadow-none" aria-label="User journey paths">
            <div className="journey-sankey-accent h-1" />
            <header className="journey-sankey-header flex flex-col gap-4 border-b px-4 py-4 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 max-w-xl xl:max-w-[340px]">
                    <h2 className="text-[15px] font-medium text-[#202124]">Journey explorer</h2>
                    <p className="mt-1 text-sm font-medium text-[#5f6368]">Follow traffic between screens, then select connected lines to find exact replays.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
                    <div className="flex items-center gap-2 rounded-md bg-[#f8fafd] p-1">
                        <label htmlFor={stepSelectId} className="pl-1 text-[11px] font-semibold text-[#5f6368]">Steps</label>
                        <div className="relative">
                            <select id={stepSelectId} value={Math.min(stepCount, maxStepOption)} onChange={(event) => setStepCount(Number(event.target.value))} className="h-9 appearance-none rounded-md border border-[#dadce0] bg-white pl-3 pr-8 text-xs font-semibold text-[#3c4043] outline-none hover:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]">
                                {Array.from({ length: maxStepOption - 2 }, (_, index) => index + 3).map((count) => <option key={count} value={count}>{count}</option>)}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5f6368]" />
                        </div>
                        <label htmlFor={versionSelectId} className="pl-1 text-[11px] font-semibold text-[#5f6368]">Version</label>
                        <div className="relative">
                            <select id={versionSelectId} value={selectedAppVersion || ALL_APP_VERSIONS_VALUE} onChange={(event) => onAppVersionChange?.(event.target.value === ALL_APP_VERSIONS_VALUE ? null : event.target.value)} className="h-9 min-w-[150px] appearance-none rounded-md border border-[#dadce0] bg-white pl-3 pr-8 text-xs font-semibold text-[#3c4043] outline-none hover:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]">
                                <option value={ALL_APP_VERSIONS_VALUE}>All versions</option>
                                {appVersions.map((option) => <option key={option.version} value={option.version}>{option.version === 'UNKNOWN' ? 'Unknown version' : `v${option.version}`} ({formatCompact(option.count)})</option>)}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5f6368]" />
                        </div>
                    </div>
                    <span className="hidden h-6 w-px bg-[#e8eaed] sm:block" aria-hidden="true" />
                    <div className="flex items-center" role="group" aria-label="Move across journey steps">
                        <button type="button" onClick={() => scrollJourney('left')} disabled={!horizontalScrollState.canScrollLeft} aria-label="Previous journey steps" title="Previous journey steps" className="grid h-9 w-9 place-items-center rounded-l-md border border-r-0 border-[#dadce0] bg-white text-[#3c4043] hover:border-[#1a73e8] hover:bg-[#eef4ff] focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] disabled:cursor-not-allowed disabled:text-[#bdc1c6] disabled:hover:border-[#dadce0] disabled:hover:bg-white"><ChevronLeft className="h-4 w-4" /></button>
                        <button type="button" onClick={() => scrollJourney('right')} disabled={!horizontalScrollState.canScrollRight} aria-label="Next journey steps" title="Next journey steps" className="grid h-9 w-9 place-items-center rounded-r-md border border-[#dadce0] bg-white text-[#3c4043] hover:border-[#1a73e8] hover:bg-[#eef4ff] focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] disabled:cursor-not-allowed disabled:text-[#bdc1c6] disabled:hover:border-[#dadce0] disabled:hover:bg-white"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                    <button type="button" onClick={fitJourney} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#dadce0] bg-white px-3 text-xs font-semibold text-[#3c4043] hover:border-[#1a73e8] hover:bg-[#eef4ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"><Focus className="h-3.5 w-3.5" />Fit to width</button>
                    <button type="button" onClick={resetJourney} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#dadce0] bg-white px-3 text-xs font-semibold text-[#3c4043] hover:border-[#1a73e8] hover:bg-[#eef4ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]"><RotateCcw className="h-3.5 w-3.5" />Reset view</button>
                </div>
            </header>

            {selectedTransitionIds.length > 0 && (
                <div className="journey-sankey-selection flex flex-col gap-2 border-b px-4 py-3 text-xs sm:px-5 lg:flex-row lg:items-center lg:justify-between" aria-live="polite">
                    <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                        <span className="shrink-0 font-semibold text-[#831843]">Selected path</span>
                        <span className="shrink-0 rounded-full border border-[#fbcfe8] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#9d174d]">{selectedTransitionIds.length} {selectedTransitionIds.length === 1 ? 'transition' : 'transitions'}</span>
                        {selectedPath.length > 0 ? selectedPath.map((screen, index) => (
                            <React.Fragment key={`${screen}:${index}`}>
                                {index > 0 && <span className="shrink-0 text-[#db2777]">→</span>}
                                <span className="max-w-44 shrink-0 truncate rounded-md border border-[#fbcfe8] bg-white px-2 py-1 font-medium text-[#831843]" title={screen}>{screen}</span>
                            </React.Fragment>
                        )) : <span className="text-[#9d174d]">This path is outside the current filter.</span>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {selectedPathIsClipped && <button type="button" onClick={() => setStepCount(requiredSelectedSteps)} className="h-8 rounded-md border border-[#fbcfe8] bg-white px-3 font-semibold text-[#9d174d] hover:bg-[#fff7fa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#db2777]">Show full path</button>}
                        <button type="button" onClick={() => { setSelectionNotice(null); onUndoSelection?.(); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#fbcfe8] bg-white px-3 font-semibold text-[#9d174d] hover:bg-[#fff7fa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#db2777]"><Minus className="h-3.5 w-3.5" />Remove end</button>
                        <button type="button" onClick={() => { setSelectionNotice(null); onClearSelection?.(); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#f9a8d4] bg-white px-3 font-semibold text-[#9d174d] hover:bg-[#fff7fa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#db2777]"><X className="h-3.5 w-3.5" />Clear path</button>
                    </div>
                </div>
            )}

            {nodes.length === 0 ? (
                <div className="grid h-80 place-items-center text-sm font-medium text-[#5f6368]">No journey activity is available for this filter.</div>
            ) : (
                <>
                    <div className="flex min-h-[54px] flex-wrap items-center gap-x-5 gap-y-1 border-b border-[#e8eaed] bg-white px-4 py-2.5 text-xs sm:px-5" aria-live={selectionNotice ? 'polite' : 'off'}>
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${selectionNotice ? 'bg-amber-50 text-amber-700' : hoveredLink ? 'bg-[#eef4ff] text-[#1a73e8]' : selectedLinks.length > 0 ? 'bg-[#fdf2f8] text-[#db2777]' : 'bg-[#f8fafd] text-[#5f6368]'}`}>
                            {selectionNotice ? <AlertTriangle className="h-3.5 w-3.5" /> : <MousePointerClick className="h-3.5 w-3.5" />}
                        </span>
                        {selectionNotice ? (
                            <span className="font-medium text-amber-800">{selectionNotice}</span>
                        ) : hoveredLink ? (
                            <>
                                <span className="font-semibold text-[#202124]">{hoveredLink.from} → {hoveredLink.to}</span>
                                <span className="text-[#5f6368]"><strong className="tabular-nums text-[#202124]">{hoveredLink.count.toLocaleString()}</strong> sessions</span>
                                <span className="text-[#5f6368]"><strong className="tabular-nums text-[#202124]">{(hoveredLink.trafficShare * 100).toFixed(1)}%</strong> of source</span>
                                <span className="text-[#5f6368]"><strong className="tabular-nums text-[#202124]">{hoveredLink.replayCount.toLocaleString()}</strong> replay ready</span>
                                <span className="ml-auto font-medium text-[#1a73e8]">{getFlowActionLabel(hoveredLink)}</span>
                            </>
                        ) : selectedLinks.length > 0 ? (
                            <><span className="font-semibold text-[#831843]">Path selected</span><span className="text-[#5f6368]">Choose a highlighted connected line to continue, or use Remove end/Clear path above.</span></>
                        ) : (
                            <><span className="font-semibold text-[#202124]">Select a line to build a path</span><span className="text-[#5f6368]">Hover previews details here without covering the map.</span></>
                        )}
                    </div>
                    <div
                        ref={scrollRef}
                        className="journey-sankey-canvas relative overflow-x-auto overflow-y-hidden border-b focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1a73e8]"
                        style={{
                            overscrollBehaviorX: 'contain',
                            overscrollBehaviorY: 'auto',
                            touchAction: 'pan-x pan-y',
                            cursor: isDragging ? 'grabbing' : 'grab',
                        }}
                        tabIndex={0}
                        role="region"
                        aria-label="Scrollable step-based journey map"
                        onPointerDown={(event) => {
                            if (!event.isPrimary || event.pointerType !== 'mouse' || event.button !== 0) return;
                            if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                            if ((event.target as Element).closest('button, [role="button"], select')) return;
                            setHoveredNodeId(null);
                            setHoveredLinkId(null);
                            setIsDragging(true);
                            dragState.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: event.currentTarget.scrollLeft };
                            event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={(event) => { const drag = dragState.current; if (drag?.pointerId === event.pointerId) event.currentTarget.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX); }}
                        onPointerUp={(event) => { if (dragState.current?.pointerId === event.pointerId) { dragState.current = null; setIsDragging(false); } }}
                        onPointerCancel={() => { dragState.current = null; setIsDragging(false); }}
                        onLostPointerCapture={() => { dragState.current = null; setIsDragging(false); }}
                    >
                        <div style={{ width: canvasWidth * (fitScale || 1), height: canvasHeight * (fitScale || 1), minWidth: fitScale ? undefined : canvasWidth }}>
                            <div className="relative origin-top-left" style={{ width: canvasWidth, height: canvasHeight, transform: fitScale ? `scale(${fitScale})` : undefined }}>
                                {Array.from(new Set(nodes.map((node) => node.step))).map((step) => (
                                    <div key={step} className="absolute top-0 border-b border-[#e8eaed] pb-2 text-[11px] font-semibold text-[#5f6368]" style={{ left: CANVAS_PADDING_X + step * COLUMN_WIDTH, width: NODE_WIDTH }}>
                                        {step === 0 ? 'Entry' : `Step ${step + 1}`}
                                    </div>
                                ))}

                                <svg className="pointer-events-none absolute inset-0 overflow-visible" width={canvasWidth} height={canvasHeight} aria-hidden="true">
                                    {links.map((link) => {
                                        const x1 = link.source.x + NODE_WIDTH;
                                        const y1 = link.source.y + NODE_HEIGHT / 2;
                                        const x2 = link.target.x;
                                        const y2 = link.target.y + NODE_HEIGHT / 2;
                                        const bend = Math.max(40, (x2 - x1) * 0.45);
                                        const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
                                        const selected = selectedSet.has(link.id);
                                        const related = hoveredLinkId === link.id || hoveredNodeLinkIds.has(link.id);
                                        const continuation = continuationLinkIds.has(link.id);
                                        const dimmed = hasVisibleSelection && !selected && !continuation && !related;
                                        const happy = happyLinkIds.has(link.id);
                                        return <path key={link.id} d={d} fill="none" stroke={selected ? '#db2777' : happy ? '#1e8e3e' : link.isAggregate ? '#9aa0a6' : '#5dadec'} strokeWidth={selected ? link.thickness + 4 : related ? link.thickness + 2 : continuation && hasVisibleSelection ? link.thickness + 1 : link.thickness} strokeDasharray={link.isAggregate || link.isTerminal ? '7 5' : undefined} strokeLinecap="round" opacity={dimmed ? 0.17 : selected ? 0.92 : related ? 0.78 : continuation && hasVisibleSelection ? 0.5 : 0.34} style={{ transition: 'opacity 150ms ease, stroke-width 150ms ease, stroke 150ms ease' }} />;
                                    })}
                                </svg>
                                <svg className="absolute inset-0 overflow-visible" width={canvasWidth} height={canvasHeight}>
                                    {links
                                        .filter((link) => !link.isAggregate && !link.isTerminal)
                                        .sort((left, right) => right.thickness - left.thickness)
                                        .map((link) => {
                                            const x1 = link.source.x + NODE_WIDTH;
                                            const y1 = link.source.y + NODE_HEIGHT / 2;
                                            const x2 = link.target.x;
                                            const y2 = link.target.y + NODE_HEIGHT / 2;
                                            const bend = Math.max(40, (x2 - x1) * 0.45);
                                            const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
                                            const selected = selectedSet.has(link.id);
                                            const connected = continuationLinkIds.has(link.id);
                                            return <path key={link.id} d={d} fill="none" stroke="transparent" strokeWidth={Math.max(link.thickness + 4, Math.min(20, link.thickness + 8))} role="button" tabIndex={selected || connected ? 0 : -1} aria-pressed={selected} aria-disabled={!selected && !connected} aria-label={`${link.from} to ${link.to}, ${link.count.toLocaleString()} sessions, ${(link.trafficShare * 100).toFixed(1)} percent of source traffic, ${link.replayCount.toLocaleString()} replay ready. ${getFlowActionLabel(link)}`} className={`${selected || connected ? 'cursor-pointer' : 'cursor-not-allowed'} focus:outline-none`} onMouseEnter={() => { setSelectionNotice(null); setHoveredLinkId(link.id); }} onMouseLeave={() => setHoveredLinkId(null)} onFocus={() => { setSelectionNotice(null); setHoveredLinkId(link.id); }} onBlur={() => setHoveredLinkId(null)} onClick={() => toggleFlow(link)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleFlow(link); } }} />;
                                        })}
                                </svg>

                                {nodes.map((node) => {
                                    const hovered = hoveredNodeId === node.id;
                                    const selectedNode = visibleSelectedLinks.some((link) => link.sourceId === node.id || link.targetId === node.id);
                                    const relatedToHoveredLink = links.some((link) => hoveredLinkId === link.id && (link.sourceId === node.id || link.targetId === node.id));
                                    const dimmed = hasVisibleSelection && !hovered && !selectedNode && !relatedToHoveredLink;
                                    const issueLabel = getIssueLabel(node);
                                    const terminal = node.kind === 'exit' || node.kind === 'continue';
                                    return (
                                        <article key={node.id} style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT, opacity: dimmed ? 0.62 : 1 }} className={`journey-node absolute flex overflow-hidden border text-left transition ${selectedNode ? 'journey-node-selected' : ''} ${happyNodeIds.has(node.id) ? 'ring-1 ring-emerald-200' : ''} ${terminal ? 'border-dashed' : ''}`} onMouseEnter={() => setHoveredNodeId(node.id)} onMouseLeave={() => setHoveredNodeId(null)} aria-label={`${node.screen}, step ${node.step + 1}, ${node.count.toLocaleString()} sessions, ${(node.share * 100).toFixed(1)} percent share${issueLabel ? `, ${issueLabel}` : ''}`}>
                                            <span className={`w-1 shrink-0 ${terminal ? 'bg-[#9aa0a6]' : selectedNode ? 'bg-[#db2777]' : happyNodeIds.has(node.id) ? 'bg-[#1e8e3e]' : 'bg-[#1a73e8]'}`} />
                                            <span className="flex min-w-0 flex-1 flex-col justify-center px-3">
                                                <span className="flex min-w-0 items-center justify-between gap-2">
                                                    <span className="truncate text-xs font-semibold text-[#202124]" title={node.screen}>{node.screen}</span>
                                                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[#202124]">{formatCompact(node.count)}</span>
                                                </span>
                                                <span className="mt-1 flex items-center justify-between gap-2 text-[10px] font-medium text-[#5f6368]">
                                                    <span>{(node.share * 100).toFixed(1)}% at this step</span>
                                                    {issueLabel && <span className={`inline-flex items-center gap-1 ${node.health === 'problematic' ? 'text-rose-700' : 'text-amber-700'}`}><AlertTriangle className="h-3 w-3" />{issueLabel}</span>}
                                                </span>
                                            </span>
                                        </article>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </>
            )}

            <footer className="journey-sankey-footer flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-3 text-[11px] font-medium sm:px-5">
                <span><strong className="font-semibold text-[#202124]">{graph.sampledSessions.toLocaleString()}</strong> journey sessions sampled</span>
                <span className="hidden lg:inline">Drag horizontally, use the arrows, or Shift + scroll to explore</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-6 rounded-full bg-[#5dadec] opacity-70" />Width = traffic volume</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-[#1e8e3e] bg-white" />Happy path</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-6 border-t-2 border-dashed border-[#9aa0a6]" />Exit or aggregate</span>
            </footer>
        </section>
    );
};
