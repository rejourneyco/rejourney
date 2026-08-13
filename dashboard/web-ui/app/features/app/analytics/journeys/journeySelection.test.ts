import { describe, expect, it } from 'vitest';
import { buildSelectedJourneyPath, resolveJourneySelectionIds, toggleContiguousJourneySelection, type JourneySelectableLink } from './journeySelection';

const links: JourneySelectableLink[] = [
    { id: 'p0:A→B', step: 0, from: 'A', to: 'B', count: 40 },
    { id: 'p1:B→A', step: 1, from: 'B', to: 'A', count: 30 },
    { id: 'p2:A→C', step: 2, from: 'A', to: 'C', count: 20 },
    { id: 'p4:A→B', step: 4, from: 'A', to: 'B', count: 10 },
];

describe('journey path selection', () => {
    it('extends forward and backward while preserving repeated screens', () => {
        let selected = toggleContiguousJourneySelection([], links[1], links);
        selected = toggleContiguousJourneySelection(selected, links[0], links);
        selected = toggleContiguousJourneySelection(selected, links[2], links);
        expect(selected).toEqual(['p0:A→B', 'p1:B→A', 'p2:A→C']);
        expect(buildSelectedJourneyPath(selected, links)).toEqual(['A', 'B', 'A', 'C']);
    });

    it('starts a new path for a disconnected transition and truncates selected paths', () => {
        expect(toggleContiguousJourneySelection(['p0:A→B', 'p1:B→A', 'p2:A→C'], links[1], links)).toEqual(['p0:A→B']);
        expect(toggleContiguousJourneySelection(['p0:A→B'], links[3], links)).toEqual(['p4:A→B']);
    });

    it('clears the path when its sole selected transition is toggled', () => {
        expect(toggleContiguousJourneySelection(['p0:A→B'], links[0], links)).toEqual([]);
    });

    it('restores legacy transition ids to the highest-volume occurrence', () => {
        expect(resolveJourneySelectionIds(['A→B', 'missing→path'], links)).toEqual(['p0:A→B']);
    });
});
