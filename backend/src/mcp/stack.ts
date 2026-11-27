/** Stack traces are returned as a capped list of frames, never as one unbounded string. */

export const MAX_STACK_FRAMES = 60;

export interface CappedStack {
    frames: string[];
    totalFrames: number;
    truncated: boolean;
}

export function capStack(stackTrace: string | null | undefined, maxFrames = MAX_STACK_FRAMES): CappedStack {
    if (typeof stackTrace !== 'string') return { frames: [], totalFrames: 0, truncated: false };
    const lines = stackTrace.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
    return { frames: lines.slice(0, maxFrames), totalFrames: lines.length, truncated: lines.length > maxFrames };
}
