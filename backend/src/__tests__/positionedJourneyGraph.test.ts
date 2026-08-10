import { describe, expect, it } from 'vitest';
import { buildPositionedJourneyGraph, type PositionedJourneySession } from '../services/positionedJourneyGraph.js';

const session = (id: string, screensVisited: string[], overrides: Partial<PositionedJourneySession> = {}): PositionedJourneySession => ({
    id,
    screensVisited,
    replayAvailable: true,
    crashCount: 0,
    anrCount: 0,
    rageTapCount: 0,
    apiErrorCount: 0,
    apiTotalCount: 10,
    apiAvgResponseMs: 200,
    ...overrides,
});

describe('positioned journey graph', () => {
    it('represents revisited screens as separate step nodes', () => {
        const graph = buildPositionedJourneyGraph([
            session('one', ['Feed', 'Detail', 'Feed', 'Checkout']),
            session('two', ['Feed', 'Detail', 'Feed']),
        ]);

        expect(graph.nodes.filter((node) => node.screen === 'Feed' && node.kind === 'screen').map((node) => node.step)).toEqual([0, 2]);
        expect(graph.links.filter((link) => !link.isTerminal).map((link) => [link.step, link.from, link.to, link.count])).toEqual([
            [0, 'Feed', 'Detail', 2],
            [1, 'Detail', 'Feed', 2],
            [2, 'Feed', 'Checkout', 1],
        ]);
    });

    it('conserves traffic through exits and continuation at the render limit', () => {
        const graph = buildPositionedJourneyGraph([
            session('short', ['A', 'B']),
            session('long', Array.from({ length: 14 }, (_, index) => `S${index}`)),
        ], null, { maxSteps: 10 });

        expect(graph.sampledSessions).toBe(2);
        expect(graph.maxAvailableStep).toBe(14);
        expect(graph.links.find((link) => link.from === 'B' && link.to === 'Exit')?.count).toBe(1);
        expect(graph.links.find((link) => link.from === 'S9' && link.to === 'Continues')?.count).toBe(1);
        for (const node of graph.nodes.filter((candidate) => candidate.kind === 'screen' || candidate.kind === 'other')) {
            const outgoing = graph.links.filter((link) => link.sourceId === node.id).reduce((sum, link) => sum + link.count, 0);
            expect(outgoing).toBe(node.count);
        }
    });

    it('aggregates tail screens without dropping their counts and keeps happy-path screens visible', () => {
        const sessions = Array.from({ length: 12 }, (_, index) => session(`s${index}`, ['Entry', `Screen ${index}`]));
        const graph = buildPositionedJourneyGraph(sessions, ['Entry', 'Screen 11'], { maxScreensPerStep: 3 });
        const stepTwo = graph.nodes.filter((node) => node.step === 1 && (node.kind === 'screen' || node.kind === 'other'));

        expect(stepTwo.some((node) => node.screen === 'Screen 11')).toBe(true);
        expect(stepTwo.reduce((sum, node) => sum + node.count, 0)).toBe(12);
        expect(stepTwo.find((node) => node.kind === 'other')?.count).toBe(9);
    });

    it('keeps issue and replay evidence on the exact positioned transition', () => {
        const graph = buildPositionedJourneyGraph([
            session('bad', ['Home', 'Pay'], { crashCount: 1, apiErrorCount: 3, apiTotalCount: 5, replayAvailable: true }),
        ]);
        const link = graph.links.find((candidate) => candidate.from === 'Home' && candidate.to === 'Pay');

        expect(link).toMatchObject({ health: 'problematic', crashCount: 1, replayCount: 1, sampleSessionIds: ['bad'] });
        expect(link?.apiErrorRate).toBe(60);
    });
});
