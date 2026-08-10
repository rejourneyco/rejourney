export interface JourneySelectableLink {
    id: string;
    step: number;
    from: string;
    to: string;
    count: number;
    isAggregate?: boolean;
    isTerminal?: boolean;
}

export function resolveJourneySelectionIds(storedIds: string[], links: JourneySelectableLink[]): string[] {
    const available = new Map(links.map((link) => [link.id, link]));
    return storedIds.flatMap((id) => {
        if (available.has(id)) return [id];
        const [from, to] = id.split('→');
        if (!from || !to) return [];
        const match = links
            .filter((link) => link.from === from && link.to === to && !link.isAggregate && !link.isTerminal)
            .sort((left, right) => right.count - left.count || left.step - right.step)[0];
        return match ? [match.id] : [];
    });
}

export function toggleContiguousJourneySelection(
    selectedIds: string[],
    clicked: JourneySelectableLink,
    links: JourneySelectableLink[],
): string[] {
    const linksById = new Map(links.map((link) => [link.id, link]));
    const selected = selectedIds
        .map((id) => linksById.get(id))
        .filter((link): link is JourneySelectableLink => Boolean(link))
        .sort((left, right) => left.step - right.step);
    const selectedIndex = selected.findIndex((link) => link.id === clicked.id);
    if (selectedIndex >= 0) return selected.slice(0, selectedIndex).map((link) => link.id);
    if (selected.length === 0) return [clicked.id];
    const first = selected[0];
    const last = selected[selected.length - 1];
    if (clicked.step === last.step + 1 && clicked.from === last.to) return [...selected.map((link) => link.id), clicked.id];
    if (clicked.step === first.step - 1 && clicked.to === first.from) return [clicked.id, ...selected.map((link) => link.id)];
    return [clicked.id];
}

export function buildSelectedJourneyPath(selectedIds: string[], links: JourneySelectableLink[]): string[] | null {
    const linksById = new Map(links.map((link) => [link.id, link]));
    const selected = selectedIds
        .map((id) => linksById.get(id))
        .filter((link): link is JourneySelectableLink => Boolean(link))
        .sort((left, right) => left.step - right.step);
    if (selected.length === 0) return null;
    const path = [selected[0].from, selected[0].to];
    for (let index = 1; index < selected.length; index += 1) {
        const previous = selected[index - 1];
        const current = selected[index];
        if (current.step !== previous.step + 1 || current.from !== previous.to) return null;
        path.push(current.to);
    }
    return path;
}
