import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disposeScreenshotImage, loadScreenshotImage, screenshotImagesOnFallback } from './screenshotImageLoader';
class TestImage extends EventTarget {
    src = '';
    decoding = '';
    fetchPriority = '';
    removeAttribute() { this.src = ''; }
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('Image', TestImage); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('replay image recovery', () => {
    it('recovers a hanging signed request through the proxy without another play press', () => {
        const loaded = vi.fn(), failed = vi.fn();
        const img = loadScreenshotImage({ url: 'signed', proxyUrl: 'proxy' }, 'high', loaded, failed);
        vi.advanceTimersByTime(6000);
        expect(img.src).toBe('proxy');
        expect(screenshotImagesOnFallback.has(img)).toBe(true);
        img.dispatchEvent(new Event('load'));
        vi.advanceTimersByTime(20000);
        expect(loaded).toHaveBeenCalledOnce();
        expect(failed).not.toHaveBeenCalled();
    });
    it('evicts a frame when both requests stall instead of caching it forever', () => {
        const failed = vi.fn();
        const img = loadScreenshotImage({ url: 'signed', proxyUrl: 'proxy' }, 'low', vi.fn(), failed);
        vi.advanceTimersByTime(12000);
        expect(failed).toHaveBeenCalledOnce();
        expect(screenshotImagesOnFallback.has(img)).toBe(false);
        expect(img.src).toBe('');
    });
    it('handles actual network failures and clears deadlines when disposed', () => {
        const failed = vi.fn();
        const img = loadScreenshotImage({ url: 'signed', proxyUrl: 'proxy' }, 'auto', vi.fn(), failed);
        img.dispatchEvent(new Event('error'));
        expect(img.src).toBe('proxy');
        disposeScreenshotImage(img);
        vi.advanceTimersByTime(20000);
        expect(failed).not.toHaveBeenCalled();
    });
});
