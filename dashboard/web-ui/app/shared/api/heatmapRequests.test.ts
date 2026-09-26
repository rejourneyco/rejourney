import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHeatmapsOverview } from './client';

afterEach(() => { vi.unstubAllGlobals(); });

describe('progressive heatmap requests', () => {
    it('keeps fast metrics separate from the enriched preview cache', async () => {
        const metrics = { screens: [{ name: 'Home', screenshotUrl: null }], failedSections: [] };
        const enriched = { screens: [{ name: 'Home', screenshotUrl: '/frame.jpg' }], failedSections: [] };
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(metrics)))
            .mockResolvedValueOnce(new Response(JSON.stringify(enriched)));
        vi.stubGlobal('fetch', fetcher);
        expect(await getHeatmapsOverview('progressive-test', '30d', 'mobile', false)).toEqual(metrics);
        expect(String(fetcher.mock.calls[0][0])).toContain('previews=false');
        expect(await getHeatmapsOverview('progressive-test', '30d', 'mobile')).toEqual(enriched);
        expect(String(fetcher.mock.calls[1][0])).not.toContain('previews=false');
        expect(await getHeatmapsOverview('progressive-test', '30d', 'mobile', false)).toEqual(metrics);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
