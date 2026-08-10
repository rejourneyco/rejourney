export type PositionedJourneyHealth = 'healthy' | 'degraded' | 'problematic';

export interface PositionedJourneySession {
    id: string;
    screensVisited?: string[] | null;
    replayAvailable: boolean;
    crashCount?: number | null;
    anrCount?: number | null;
    rageTapCount?: number | null;
    apiErrorCount?: number | null;
    apiTotalCount?: number | null;
    apiAvgResponseMs?: number | null;
}

export interface PositionedJourneyNode {
    id: string;
    step: number;
    screen: string;
    kind: 'screen' | 'other' | 'exit' | 'continue';
    count: number;
    share: number;
    exitCount: number;
    continuationCount: number;
    replayCount: number;
    crashCount: number;
    anrCount: number;
    rageTapCount: number;
    apiErrorCount: number;
    avgApiLatencyMs: number;
    health: PositionedJourneyHealth;
    sampleSessionIds: string[];
}

export interface PositionedJourneyLink {
    id: string;
    step: number;
    sourceId: string;
    targetId: string;
    from: string;
    to: string;
    count: number;
    trafficShare: number;
    replayCount: number;
    crashCount: number;
    anrCount: number;
    rageTapCount: number;
    apiErrorCount: number;
    apiErrorRate: number;
    avgApiLatencyMs: number;
    health: PositionedJourneyHealth;
    sampleSessionIds: string[];
    isAggregate: boolean;
    isTerminal: boolean;
}

export interface PositionedJourneyGraph {
    sampledSessions: number;
    maxAvailableStep: number;
    maxRenderedSteps: number;
    nodes: PositionedJourneyNode[];
    links: PositionedJourneyLink[];
}

interface MutableStats {
    count: number;
    exitCount: number;
    continuationCount: number;
    replayCount: number;
    crashCount: number;
    anrCount: number;
    rageTapCount: number;
    apiErrorCount: number;
    apiTotalCount: number;
    latencySum: number;
    sampleSessionIds: string[];
}

type PositionedLinkMeta = Pick<PositionedJourneyLink,
    'id' | 'step' | 'sourceId' | 'targetId' | 'from' | 'to' | 'isAggregate' | 'isTerminal'>;

const OTHER_SCREEN = 'Other';
const EXIT_SCREEN = 'Exit';
const CONTINUE_SCREEN = 'Continues';

const cleanPath = (path?: string[] | null): string[] => (path || [])
    .map((screen) => String(screen || '').trim())
    .filter(Boolean);

const nodeId = (step: number, screen: string, kind: PositionedJourneyNode['kind']): string =>
    `${step}:${kind}:${encodeURIComponent(screen)}`;

const linkId = (step: number, from: string, to: string): string =>
    `p${step}:${encodeURIComponent(from)}→${encodeURIComponent(to)}`;

const createStats = (): MutableStats => ({
    count: 0,
    exitCount: 0,
    continuationCount: 0,
    replayCount: 0,
    crashCount: 0,
    anrCount: 0,
    rageTapCount: 0,
    apiErrorCount: 0,
    apiTotalCount: 0,
    latencySum: 0,
    sampleSessionIds: [],
});

const addSession = (stats: MutableStats, session: PositionedJourneySession): void => {
    stats.count += 1;
    if (session.replayAvailable) stats.replayCount += 1;
    stats.crashCount += Number(session.crashCount || 0);
    stats.anrCount += Number(session.anrCount || 0);
    stats.rageTapCount += Number(session.rageTapCount || 0);
    stats.apiErrorCount += Number(session.apiErrorCount || 0);
    stats.apiTotalCount += Number(session.apiTotalCount || 0);
    stats.latencySum += Number(session.apiAvgResponseMs || 0);
    if (session.replayAvailable && stats.sampleSessionIds.length < 8 && !stats.sampleSessionIds.includes(session.id)) {
        stats.sampleSessionIds.push(session.id);
    }
};

const getHealth = (stats: MutableStats): PositionedJourneyHealth => {
    const apiErrorRate = stats.apiTotalCount > 0 ? (stats.apiErrorCount / stats.apiTotalCount) * 100 : 0;
    const avgLatency = stats.count > 0 ? stats.latencySum / stats.count : 0;
    if (stats.crashCount > 0 || stats.anrCount > 0) return 'problematic';
    if (stats.rageTapCount >= 2 || apiErrorRate > 5 || avgLatency > 1000) return 'degraded';
    return 'healthy';
};

export function buildPositionedJourneyGraph(
    sessions: PositionedJourneySession[],
    happyPath: string[] | null = null,
    options: { maxSteps?: number; maxScreensPerStep?: number } = {},
): PositionedJourneyGraph {
    const maxSteps = Math.min(10, Math.max(3, options.maxSteps ?? 10));
    const maxScreensPerStep = Math.min(12, Math.max(1, options.maxScreensPerStep ?? 8));
    const pathRows = sessions
        .map((session) => ({ session, path: cleanPath(session.screensVisited) }))
        .filter((row) => row.path.length > 0);
    const maxAvailableStep = pathRows.reduce((max, row) => Math.max(max, row.path.length), 0);

    const screenCounts = Array.from({ length: maxSteps }, () => new Map<string, number>());
    for (const { path } of pathRows) {
        path.slice(0, maxSteps).forEach((screen, step) => {
            screenCounts[step].set(screen, (screenCounts[step].get(screen) || 0) + 1);
        });
    }

    const visibleScreens = screenCounts.map((counts, step) => {
        const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const visible = ranked.slice(0, maxScreensPerStep).map(([screen]) => screen);
        const requiredHappyScreen = happyPath?.[step];
        if (requiredHappyScreen && counts.has(requiredHappyScreen) && !visible.includes(requiredHappyScreen)) {
            if (visible.length >= maxScreensPerStep) visible.pop();
            visible.push(requiredHappyScreen);
        }
        return new Set(visible);
    });

    const mapScreen = (step: number, screen: string): { screen: string; kind: PositionedJourneyNode['kind'] } =>
        visibleScreens[step]?.has(screen)
            ? { screen, kind: 'screen' }
            : { screen: OTHER_SCREEN, kind: 'other' };

    const nodeStats = new Map<string, MutableStats>();
    const nodeMeta = new Map<string, { step: number; screen: string; kind: PositionedJourneyNode['kind'] }>();
    const linkStats = new Map<string, MutableStats>();
    const linkMeta = new Map<string, PositionedLinkMeta>();

    const ensureNode = (step: number, screen: string, kind: PositionedJourneyNode['kind']): [string, MutableStats] => {
        const id = nodeId(step, screen, kind);
        if (!nodeStats.has(id)) {
            nodeStats.set(id, createStats());
            nodeMeta.set(id, { step, screen, kind });
        }
        return [id, nodeStats.get(id)!];
    };

    const ensureLink = (
        step: number,
        source: { id: string; screen: string; kind: PositionedJourneyNode['kind'] },
        target: { id: string; screen: string; kind: PositionedJourneyNode['kind'] },
    ): MutableStats => {
        const id = linkId(step, source.screen, target.screen);
        if (!linkStats.has(id)) {
            linkStats.set(id, createStats());
            linkMeta.set(id, {
                id,
                step,
                sourceId: source.id,
                targetId: target.id,
                from: source.screen,
                to: target.screen,
                isAggregate: source.kind === 'other' || target.kind === 'other',
                isTerminal: target.kind === 'exit' || target.kind === 'continue',
            });
        }
        return linkStats.get(id)!;
    };

    for (const { session, path } of pathRows) {
        const renderedPath = path.slice(0, maxSteps).map((screen, step) => ({ step, ...mapScreen(step, screen) }));
        renderedPath.forEach((item, index) => {
            const [sourceId, stats] = ensureNode(item.step, item.screen, item.kind);
            addSession(stats, session);
            if (index === path.length - 1) stats.exitCount += 1;
            else stats.continuationCount += 1;

            if (index < renderedPath.length - 1) {
                const next = renderedPath[index + 1];
                const [targetId] = ensureNode(next.step, next.screen, next.kind);
                addSession(ensureLink(item.step, { id: sourceId, screen: item.screen, kind: item.kind }, { id: targetId, screen: next.screen, kind: next.kind }), session);
                return;
            }

            const terminalKind: PositionedJourneyNode['kind'] = path.length > maxSteps ? 'continue' : 'exit';
            const terminalScreen = terminalKind === 'continue' ? CONTINUE_SCREEN : EXIT_SCREEN;
            const [targetId, terminalStats] = ensureNode(item.step + 1, terminalScreen, terminalKind);
            addSession(terminalStats, session);
            addSession(ensureLink(item.step, { id: sourceId, screen: item.screen, kind: item.kind }, { id: targetId, screen: terminalScreen, kind: terminalKind }), session);
        });
    }

    const stepTotals = new Map<number, number>();
    for (const [id, stats] of nodeStats) {
        const meta = nodeMeta.get(id)!;
        if (meta.kind === 'screen' || meta.kind === 'other') {
            stepTotals.set(meta.step, (stepTotals.get(meta.step) || 0) + stats.count);
        }
    }

    const nodes: PositionedJourneyNode[] = [...nodeStats.entries()].map(([id, stats]) => {
        const meta = nodeMeta.get(id)!;
        const denominator = meta.kind === 'screen' || meta.kind === 'other'
            ? stepTotals.get(meta.step) || pathRows.length
            : pathRows.length;
        return {
            id,
            ...meta,
            count: stats.count,
            share: denominator > 0 ? stats.count / denominator : 0,
            exitCount: stats.exitCount,
            continuationCount: stats.continuationCount,
            replayCount: stats.replayCount,
            crashCount: Math.round(stats.crashCount),
            anrCount: Math.round(stats.anrCount),
            rageTapCount: Math.round(stats.rageTapCount),
            apiErrorCount: Math.round(stats.apiErrorCount),
            avgApiLatencyMs: stats.count > 0 ? Math.round(stats.latencySum / stats.count) : 0,
            health: getHealth(stats),
            sampleSessionIds: stats.sampleSessionIds.slice(0, 6),
        };
    });

    const nodeCountById = new Map(nodes.map((node) => [node.id, node.count]));
    const links: PositionedJourneyLink[] = [...linkStats.entries()].map(([id, stats]) => {
        const meta = linkMeta.get(id)!;
        const sourceCount = nodeCountById.get(meta.sourceId) || stats.count;
        return {
            ...meta,
            count: stats.count,
            trafficShare: sourceCount > 0 ? stats.count / sourceCount : 0,
            replayCount: stats.replayCount,
            crashCount: Math.round(stats.crashCount),
            anrCount: Math.round(stats.anrCount),
            rageTapCount: Math.round(stats.rageTapCount),
            apiErrorCount: Math.round(stats.apiErrorCount),
            apiErrorRate: stats.apiTotalCount > 0 ? Math.round((stats.apiErrorCount / stats.apiTotalCount) * 1000) / 10 : 0,
            avgApiLatencyMs: stats.count > 0 ? Math.round(stats.latencySum / stats.count) : 0,
            health: getHealth(stats),
            sampleSessionIds: stats.sampleSessionIds.slice(0, 6),
        };
    });

    return {
        sampledSessions: pathRows.length,
        maxAvailableStep,
        maxRenderedSteps: maxSteps,
        nodes,
        links,
    };
}
