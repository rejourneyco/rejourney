import { describe, expect, it } from 'vitest';
import { MCP_PLAN_CREDITS, planMcpCredits } from './mcpPlanCredits';

describe('planMcpCredits', () => {
  it('matches the published plan allowances', () => {
    expect(MCP_PLAN_CREDITS).toEqual({ free: 300, starter: 2000, growth: 6000, pro: 20000, scale: 75000 });
  });

  it('prefers the API value when the plan has one', () => {
    expect(planMcpCredits({ name: 'growth', mcpCreditLimit: 8000 })).toBe(8000);
  });

  it('falls back by plan name, and returns null for unknown custom plans', () => {
    expect(planMcpCredits({ name: 'Pro' })).toBe(20000);
    expect(planMcpCredits({ name: 'free', mcpCreditLimit: null })).toBe(300);
    expect(planMcpCredits({ name: 'enterprise' })).toBeNull();
  });
});
