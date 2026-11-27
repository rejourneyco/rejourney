import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_MCP_CREDIT_LIMIT, DEMO_MCP_CREDITS_USED } from '~/features/app/mcp/demoData';
import { McpApiError } from '~/features/app/mcp/mcpApi';
import type { McpOverview, McpUsage } from '~/features/app/mcp/types';
import { McpCreditsUsageBar, loadMcpCreditsUsage } from './McpCreditsUsage';

const usage = (overrides: Partial<McpUsage> = {}): McpUsage => ({
  planName: 'Starter',
  creditLimit: 2000,
  creditsUsed: 1500,
  periodStart: '2026-11-01T00:00:00.000Z',
  resetsAt: '2026-12-01T12:00:00.000Z',
  byTool: [],
  ...overrides,
});

const overview = (u: McpUsage): McpOverview => ({
  usage: u,
  connections: [],
  settings: { mcpEnabled: true, maskEndUserIdentifiers: false },
  canManageSettings: true,
});

function render(u: McpUsage): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(McpCreditsUsageBar, { usage: u, mcpHref: '/dashboard/mcp' })),
  );
}

describe('loadMcpCreditsUsage', () => {
  it('hides the bar (null) when MCP is not enabled on the server (404)', async () => {
    const fetchOverview = vi.fn().mockRejectedValue(new McpApiError('MCP is not enabled on this server.', 404));
    await expect(loadMcpCreditsUsage('team-1', { isDemoMode: false, fetchOverview })).resolves.toBeNull();
    expect(fetchOverview).toHaveBeenCalledWith('team-1', undefined);
  });

  it('hides the bar (null) on any other failure', async () => {
    const fetchOverview = vi.fn().mockRejectedValue(new McpApiError('boom', 500));
    await expect(loadMcpCreditsUsage('team-1', { isDemoMode: false, fetchOverview })).resolves.toBeNull();
    const networkDown = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loadMcpCreditsUsage('team-1', { isDemoMode: false, fetchOverview: networkDown })).resolves.toBeNull();
  });

  it('returns the usage from the overview', async () => {
    const fetchOverview = vi.fn().mockResolvedValue(overview(usage()));
    await expect(loadMcpCreditsUsage('team-1', { isDemoMode: false, fetchOverview })).resolves.toMatchObject({
      creditLimit: 2000,
      creditsUsed: 1500,
    });
  });

  it('uses the MCP demo data in demo mode without calling the API', async () => {
    const fetchOverview = vi.fn();
    const demo = await loadMcpCreditsUsage('team-1', { isDemoMode: true, fetchOverview });
    expect(fetchOverview).not.toHaveBeenCalled();
    expect(demo).toMatchObject({ creditLimit: DEMO_MCP_CREDIT_LIMIT, creditsUsed: DEMO_MCP_CREDITS_USED });
  });
});

describe('McpCreditsUsageBar', () => {
  it('shows used / limit, the percentage, remaining credits, reset date and a link to the MCP page', () => {
    const html = render(usage());
    expect(html).toContain('75% of MCP credits used');
    expect(html).toContain('1,500 / 2,000');
    expect(html).toContain('500 MCP credits remaining');
    expect(html).toContain('Resets Dec 1');
    expect(html).toContain('width:75%');
    expect(html).toContain('href="/dashboard/mcp"');
  });

  it('turns red at the limit', () => {
    const html = render(usage({ creditsUsed: 2000 }));
    expect(html).toContain('100% of MCP credits used');
    expect(html).toContain('bg-[#d93025]');
    expect(html).toContain('0 MCP credits remaining');
  });

  it('shows the unlimited case without a progress bar', () => {
    const html = render(usage({ creditLimit: null, creditsUsed: 4321 }));
    expect(html).toContain('4,321 / No limit');
    expect(html).toContain('No monthly limit');
    expect(html).not.toContain('billing-progress-track');
    expect(html).not.toContain('% of MCP credits used');
  });
});
