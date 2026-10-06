import type { CompressedBackgroundGap } from './replayTimeCompression';

/** Keep the session clock still during the short, synthetic “Away” pauses. */
export function createReplaySessionClock(input: {
    startedAt: number;
    playbackDurationSeconds: number;
    sessionDurationSeconds: number;
    backgroundGaps: CompressedBackgroundGap[];
}) {
    const playbackDuration = Number.isFinite(input.playbackDurationSeconds)
        ? Math.max(0, input.playbackDurationSeconds)
        : 0;
    const activeSecondsAt = (seconds: number) => {
        const elapsed = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, playbackDuration));
        const removed = input.backgroundGaps.reduce((sum, gap) => {
            const start = Math.max(0, (gap.compressedStartAt - input.startedAt) / 1000);
            const end = Math.max(start, (gap.compressedEndAt - input.startedAt) / 1000);
            return sum + Math.max(0, Math.min(elapsed, end) - start);
        }, 0);
        return Math.max(0, elapsed - removed);
    };
    const activeDuration = activeSecondsAt(playbackDuration);
    // The API and list share the authoritative duration, rounded at ingest.
    // Normalize fractional lifecycle timestamps to that same endpoint.
    const durationSeconds = Number.isFinite(input.sessionDurationSeconds) && input.sessionDurationSeconds >= 0
        ? input.sessionDurationSeconds
        : activeDuration;
    return {
        durationSeconds,
        secondsAt: (playbackSeconds: number) => {
            if (activeDuration > 0) {
                return Math.min(1, activeSecondsAt(playbackSeconds) / activeDuration) * durationSeconds;
            }
            return playbackDuration > 0
                ? Math.max(0, Math.min(Number.isFinite(playbackSeconds) ? playbackSeconds : 0, playbackDuration)) * durationSeconds / playbackDuration
                : 0;
        },
    };
}

/** rrweb offsets start at its first event; our timeline starts at session start. */
export function rrwebPlaybackOffsetMs(input: {
    timeSeconds: number;
    durationSeconds: number;
    firstEventTimestamp: number;
    sessionStartedAt: number;
}): number {
    const elapsed = Math.max(0, Math.min(input.timeSeconds, input.durationSeconds || input.timeSeconds)) * 1000;
    const initialDelay = input.firstEventTimestamp - input.sessionStartedAt;
    return Math.max(0, elapsed - initialDelay);
}
