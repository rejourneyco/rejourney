import { describe, expect, it, vi } from 'vitest';
const { fetchOverview, loadRoute } = vi.hoisted(() => ({ fetchOverview: vi.fn(async () => ({})), loadRoute: vi.fn(() => null) }));
vi.mock('~/shared/api/client', () => ({
    getDashboardOverview: fetchOverview, getApiOverview: vi.fn(), getDevicesOverview: vi.fn(),
    getGeoOverview: vi.fn(), getJourneysOverview: vi.fn(), getHeatmapsOverview: vi.fn(),
    getErrorsOverview: vi.fn(), getCrashesOverview: vi.fn(), getANRsOverview: vi.fn(), getSessionsPaginated: vi.fn(),
}));
vi.mock('~/features/app/general/index/route', () => ({ GeneralOverview: loadRoute }));
import { TabRegistry } from './TabRegistry';

describe('navigation prefetch', () => {
    it('restores a replay tab without treating its seek target as part of the session ID', () => {
        const info = TabRegistry.getTabInfo('/dashboard/sessions/session-123?seekToType=crash#timeline');
        expect(info?.id).toBe('session-session-123');
        expect(TabRegistry.resolve('/demo/sessions/session-123?seekToType=crash')?.props?.sessionId).toBe('session-123');
        expect(TabRegistry.getTabInfo('/dashboard/account#dashboard-preferences')?.id).toBe('account');
    });
    it('does not start analytics requests for unopened pages', async () => {
        TabRegistry.prefetch('/general', { projectId: 'project-a', timeRange: '7d' });
        await Promise.resolve();
        expect(fetchOverview).not.toHaveBeenCalled();
    });
    it('allows explicit data prefetch when requested', async () => {
        TabRegistry.prefetch('/general', { projectId: 'project-a', timeRange: '7d', includeData: true });
        expect(fetchOverview).toHaveBeenCalledWith('project-a', '7d');
    });
});
