import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    config: { MCP_CREDIT_LIMIT: undefined as number | undefined },
    teamRow: null as Record<string, unknown> | null,
    select: vi.fn(),
    update: vi.fn(),
    updateSet: vi.fn(),
    updateWhere: vi.fn(),
    getTeamSubscription: vi.fn(),
    isStripeEnabled: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../config.js', () => ({ config: mocks.config }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({ sql: 'eq' })) }));
vi.mock('../db/client.js', () => ({
    db: { select: mocks.select, update: mocks.update },
    teams: {
        id: 'teams.id',
        mcpCreditLimit: 'teams.mcpCreditLimit',
        mcpPlanName: 'teams.mcpPlanName',
        mcpLimitsSyncedAt: 'teams.mcpLimitsSyncedAt',
    },
}));
vi.mock('../logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: mocks.error } }));
vi.mock('../services/stripeProducts.js', () => ({
    FREE_TIER_MCP_CREDITS: 300,
    getTeamSubscription: mocks.getTeamSubscription,
    isStripeEnabled: mocks.isStripeEnabled,
}));

import { mcpRateLimitPerMinute, syncTeamMcpLimits } from '../services/mcpEntitlement.js';

const HOUR = 60 * 60 * 1000;

function subscription(planName: string, mcpCreditLimit: number, priceId: string | null = `price_${planName}`) {
    return { teamId: 'team_1', planName, priceId, mcpCreditLimit };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.MCP_CREDIT_LIMIT = undefined;
    mocks.teamRow = { mcpCreditLimit: null, mcpPlanName: null, mcpLimitsSyncedAt: null };
    mocks.select.mockImplementation(() => ({
        from: () => ({ where: () => ({ limit: async () => (mocks.teamRow ? [mocks.teamRow] : []) }) }),
    }));
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.isStripeEnabled.mockReturnValue(true);
});

describe('syncTeamMcpLimits', () => {
    it('gives a free team 300 credits and stores it', async () => {
        mocks.getTeamSubscription.mockResolvedValue(subscription('free', 300, null));
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: 300, planName: 'free' });
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
            mcpCreditLimit: 300, mcpPlanName: 'free', mcpLimitsSyncedAt: expect.any(Date),
        }));
    });

    it('treats an unpaid or incomplete subscription (free limits, no price) as free', async () => {
        mocks.getTeamSubscription.mockResolvedValue({ ...subscription('free', 300, null), subscriptionStatus: 'unpaid' });
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: 300, planName: 'free' });
    });

    it('uses the paid plan value', async () => {
        mocks.getTeamSubscription.mockResolvedValue(subscription('pro', 20000));
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: 20000, planName: 'pro' });
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ mcpCreditLimit: 20000, mcpPlanName: 'pro' }));
    });

    it('is unlimited (null) when billing is disabled and MCP_CREDIT_LIMIT is unset', async () => {
        mocks.isStripeEnabled.mockReturnValue(false);
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: null, planName: 'self-hosted' });
        expect(mocks.getTeamSubscription).not.toHaveBeenCalled();
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ mcpCreditLimit: null, mcpPlanName: 'self-hosted' }));
    });

    it('uses MCP_CREDIT_LIMIT when billing is disabled and it is set', async () => {
        mocks.isStripeEnabled.mockReturnValue(false);
        mocks.config.MCP_CREDIT_LIMIT = 5000;
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: 5000, planName: 'self-hosted' });
    });

    it('does not write when nothing changed and the last sync is recent', async () => {
        mocks.teamRow = { mcpCreditLimit: 6000, mcpPlanName: 'growth', mcpLimitsSyncedAt: new Date(Date.now() - 10 * 60 * 1000) };
        mocks.getTeamSubscription.mockResolvedValue(subscription('growth', 6000));
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: 6000, planName: 'growth' });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('writes when the plan changed even if the last sync is recent', async () => {
        mocks.teamRow = { mcpCreditLimit: 2000, mcpPlanName: 'starter', mcpLimitsSyncedAt: new Date() };
        mocks.getTeamSubscription.mockResolvedValue(subscription('growth', 6000));
        await syncTeamMcpLimits('team_1');
        expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ mcpCreditLimit: 6000, mcpPlanName: 'growth' }));
    });

    it('refreshes the synced-at time when the last sync is older than an hour', async () => {
        mocks.teamRow = { mcpCreditLimit: 6000, mcpPlanName: 'growth', mcpLimitsSyncedAt: new Date(Date.now() - 2 * HOUR) };
        mocks.getTeamSubscription.mockResolvedValue(subscription('growth', 6000));
        await syncTeamMcpLimits('team_1');
        expect(mocks.update).toHaveBeenCalledTimes(1);
    });

    it('returns the stored values without throwing when Stripe is unreachable', async () => {
        mocks.teamRow = { mcpCreditLimit: 20000, mcpPlanName: 'pro', mcpLimitsSyncedAt: new Date(Date.now() - 3 * HOUR) };
        mocks.getTeamSubscription.mockRejectedValue(Object.assign(new Error('unavailable'), { statusCode: 503 }));
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: 20000, planName: 'pro' });
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalled();
    });

    it('returns free defaults when Stripe is unreachable and the team was never synced', async () => {
        mocks.getTeamSubscription.mockRejectedValue(new Error('ECONNRESET'));
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: 300, planName: 'free' });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('still returns the resolved values when the write fails', async () => {
        mocks.getTeamSubscription.mockResolvedValue(subscription('scale', 75000));
        mocks.updateWhere.mockRejectedValue(new Error('db down'));
        await expect(syncTeamMcpLimits('team_1')).resolves.toEqual({ creditLimit: 75000, planName: 'scale' });
        expect(mocks.error).toHaveBeenCalled();
    });
});

describe('mcpRateLimitPerMinute', () => {
    it.each([
        [0, 10], [300, 10], [301, 20], [2000, 20], [2001, 30], [6000, 30], [6001, 60],
        [20000, 60], [20001, 120], [75000, 120], [null, 120],
    ])('limit %s -> %s per minute', (creditLimit, expected) => {
        expect(mcpRateLimitPerMinute(creditLimit)).toBe(expected);
    });
});
