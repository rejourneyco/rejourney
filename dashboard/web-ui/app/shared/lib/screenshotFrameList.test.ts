import { describe, expect, it } from 'vitest';
import { mergeScreenshotFrameLists, screenshotFrameKey, type ScreenshotFrameRef } from './screenshotFrameList';

const frame = (timestamp: number, signature = 'a', index = 0): ScreenshotFrameRef => ({
    timestamp,
    url: `https://bucket.example/frames/${timestamp}.jpg?sig=${signature}`,
    proxyUrl: `/api/session/frame/session-1/${timestamp}`,
    index,
});

describe('mergeScreenshotFrameLists', () => {
    it('never wipes frames when a poll comes back empty', () => {
        const current = [frame(1_000), frame(2_000)];

        expect(mergeScreenshotFrameLists(current, [])).toBe(current);
        expect(mergeScreenshotFrameLists(current, undefined)).toBe(current);
    });

    it('never shrinks when a rebuild answers with a partial list', () => {
        const current = [frame(1_000), frame(2_000), frame(3_000)];
        const merged = mergeScreenshotFrameLists(current, [frame(1_000, 'b')]);

        expect(merged.map((item) => item.timestamp)).toEqual([1_000, 2_000, 3_000]);
        expect(merged[0].url).toContain('sig=b');
    });

    it('appends new frames in timestamp order, including segments that land out of order', () => {
        const current = [frame(1_000), frame(3_000)];
        const merged = mergeScreenshotFrameLists(current, [frame(4_000), frame(2_000)]);

        expect(merged.map((item) => item.timestamp)).toEqual([1_000, 2_000, 3_000, 4_000]);
    });

    it('takes the newer signed URLs for frames it already has', () => {
        const current = [frame(1_000, 'old'), frame(2_000, 'old')];
        const merged = mergeScreenshotFrameLists(current, [frame(1_000, 'new'), frame(2_000, 'new')]);

        expect(merged).not.toBe(current);
        expect(merged.every((item) => item.url.endsWith('sig=new'))).toBe(true);
    });

    it('returns the same list when nothing changed so callers can skip a re-render', () => {
        const current = [frame(1_000), frame(2_000)];

        expect(mergeScreenshotFrameLists(current, [frame(1_000), frame(2_000)])).toBe(current);
    });

    it('uses the incoming list as-is when there was nothing on screen yet', () => {
        const incoming = [frame(2_000), frame(1_000)];
        const merged = mergeScreenshotFrameLists([], incoming);

        expect(merged).toEqual(incoming);
        expect(merged).not.toBe(incoming);
    });
});

describe('screenshotFrameKey', () => {
    it('ignores the re-signed URL so a loaded frame stays cached across polls', () => {
        expect(screenshotFrameKey('session-1', frame(1_000, 'a'))).toBe(screenshotFrameKey('session-1', frame(1_000, 'b')));
    });

    it('keeps frames from different replays apart', () => {
        expect(screenshotFrameKey('session-1', frame(1_000))).not.toBe(screenshotFrameKey('share:token', frame(1_000)));
    });
});
