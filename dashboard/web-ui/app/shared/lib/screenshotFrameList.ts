export type ScreenshotFrameRef = {
    timestamp: number;
    url: string;
    proxyUrl?: string | null;
    index: number;
};

/**
 * Stable identity for a replay frame image. Frame URLs are re-signed on every server
 * response, so keying loaded images by URL turned each poll into a fresh download.
 * Within one replay a frame is uniquely identified by its capture timestamp.
 */
export function screenshotFrameKey(scope: string, frame: Pick<ScreenshotFrameRef, 'timestamp'>): string {
    return `${scope}:${frame.timestamp}`;
}

/**
 * Merges a newer frame list into the one already on screen.
 *
 * While frames are still being prepared the server can answer with an empty or partial
 * list (a rebuild publishes an empty index first), so a response never removes frames
 * the viewer already has. Frames present in both keep their position and take the newer
 * URLs. Returns `previous` unchanged when nothing new arrived, so callers can skip work.
 */
export function mergeScreenshotFrameLists<T extends ScreenshotFrameRef>(
    previous: readonly T[] | null | undefined,
    next: readonly T[] | null | undefined,
): T[] {
    const current = (previous ?? []) as T[];
    const incoming = next ?? [];
    if (incoming.length === 0) return current;
    if (current.length === 0) return [...incoming];

    const byTimestamp = new Map<number, T>();
    for (const frame of current) byTimestamp.set(frame.timestamp, frame);

    let changed = false;
    for (const frame of incoming) {
        const existing = byTimestamp.get(frame.timestamp);
        if (
            !existing
            || existing.url !== frame.url
            || (existing.proxyUrl ?? null) !== (frame.proxyUrl ?? null)
        ) {
            byTimestamp.set(frame.timestamp, frame);
            changed = true;
        }
    }

    if (!changed) return current;
    return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}
