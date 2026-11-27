import { describe, expect, it } from 'vitest';
import { demoProjects } from '~/shared/data/demoData';
import { MCP_COHORT_TOOL_COSTS, MCP_CONNECT_GUIDES, MCP_PROMPT_GUIDES, MCP_REVIEW_TOOL_COSTS } from './content';
import {
  DEMO_MCP_CREDITS_USED,
  DEMO_MCP_CREDIT_LIMIT,
  DEMO_MCP_NOW,
  demoMcpActivity,
  demoMcpConnections,
  demoMcpOverview,
  demoMcpToolUsage,
} from './demoData';
import { sumToolCalls, sumToolCredits, usagePercent } from './presentation';

const DAY = 24 * 60 * 60 * 1000;

describe('MCP demo data', () => {
  it('shows a part-used Growth allowance that resets about two weeks ahead', () => {
    const { usage } = demoMcpOverview;
    expect(usage.planName).toBe('Growth');
    expect(usage.creditLimit).toBe(6000);
    expect(usage.creditsUsed).toBe(2340);
    expect(DEMO_MCP_CREDIT_LIMIT).toBe(6000);
    expect(DEMO_MCP_CREDITS_USED).toBe(2340);
    expect(usagePercent(usage.creditsUsed, usage.creditLimit)).toBe(39);

    const daysToReset = (new Date(usage.resetsAt).getTime() - DEMO_MCP_NOW) / DAY;
    expect(daysToReset).toBeGreaterThanOrEqual(12);
    expect(daysToReset).toBeLessThanOrEqual(16);
    expect(new Date(usage.periodStart).getTime()).toBeLessThan(DEMO_MCP_NOW);
  });

  it('has a per-tool breakdown that sums to the used credits', () => {
    expect(sumToolCredits(demoMcpToolUsage)).toBe(DEMO_MCP_CREDITS_USED);
    expect(demoMcpOverview.usage.byTool).toBe(demoMcpToolUsage);
    expect(new Set(demoMcpToolUsage.map((row) => row.tool)).size).toBe(demoMcpToolUsage.length);
  });

  it('only charges tools that the cost reference lists, and never charges the free ones', () => {
    const known = new Set(MCP_REVIEW_TOOL_COSTS.map((row) => row.tool));
    const free = new Set(MCP_REVIEW_TOOL_COSTS.filter((row) => row.cost === '0').map((row) => row.tool));
    for (const row of demoMcpToolUsage) {
      expect(known.has(row.tool)).toBe(true);
      if (free.has(row.tool)) expect(row.credits).toBe(0);
      else expect(row.credits).toBeGreaterThanOrEqual(row.calls);
    }
  });

  it('has three connections from three different members and clients', () => {
    expect(demoMcpConnections).toHaveLength(3);
    expect(demoMcpConnections.map((connection) => connection.clientName)).toEqual(['Claude Code', 'Claude Code', 'Claude Code']);
    expect(new Set(demoMcpConnections.map((connection) => connection.connectedBy.userId)).size).toBe(3);
    expect(new Set(demoMcpConnections.map((connection) => connection.id)).size).toBe(3);
    expect(new Set(demoMcpConnections.map((connection) => connection.lastUsedAt)).size).toBe(3);
  });

  it('shares only projects that exist in the demo projects', () => {
    const projectsById = new Map(demoProjects.map((project) => [project.id, project.name]));
    for (const connection of demoMcpConnections) {
      expect(connection.projects.length).toBeGreaterThan(0);
      for (const project of connection.projects) {
        expect(projectsById.get(project.id)).toBe(project.name);
      }
    }
  });

  it('keeps connection totals in step with the tool breakdown', () => {
    const credits = demoMcpConnections.reduce((total, connection) => total + connection.creditsThisPeriod, 0);
    const calls = demoMcpConnections.reduce((total, connection) => total + connection.callsThisPeriod, 0);
    expect(credits).toBe(DEMO_MCP_CREDITS_USED);
    expect(calls).toBe(sumToolCalls(demoMcpToolUsage));
  });

  it('connects each app before it was last used, and never in the future', () => {
    for (const connection of demoMcpConnections) {
      const connectedAt = new Date(connection.connectedAt).getTime();
      const lastUsedAt = new Date(connection.lastUsedAt ?? '').getTime();
      expect(connectedAt).toBeLessThan(lastUsedAt);
      expect(lastUsedAt).toBeLessThanOrEqual(DEMO_MCP_NOW);
    }
  });

  it('has about twelve activity rows across the last week, newest first', () => {
    const { items } = demoMcpActivity;
    expect(items).toHaveLength(12);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);

    const times = items.map((item) => new Date(item.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(Math.max(...times)).toBeLessThanOrEqual(DEMO_MCP_NOW);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(DEMO_MCP_NOW - 7 * DAY);
  });

  it('includes exactly one limit-reached call and one error, each with a note', () => {
    const { items } = demoMcpActivity;
    const limited = items.filter((item) => item.outcome === 'limit_reached');
    const failed = items.filter((item) => item.outcome === 'error');
    expect(limited).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(limited[0].detail).toBeTruthy();
    expect(failed[0].detail).toBeTruthy();
    expect(limited[0].credits).toBe(0);
    expect(failed[0].credits).toBe(0);
  });

  it('attributes every activity row to a connected app, its member, and a known tool', () => {
    // Every connection is Claude Code, one per member, so the member identifies the connection.
    const connectionByMember = new Map(demoMcpConnections.map((connection) => [connection.connectedBy.name, connection]));
    const tools = new Set(MCP_REVIEW_TOOL_COSTS.map((row) => row.tool));
    for (const item of demoMcpActivity.items) {
      const connection = connectionByMember.get(item.userName);
      expect(item.clientName).toBe(connection?.clientName);
      expect(connection).toBeDefined();
      expect(item.userName).toBe(connection?.connectedBy.name);
      expect(new Date(item.at).getTime()).toBeGreaterThanOrEqual(new Date(connection?.connectedAt ?? '').getTime());
      expect(tools.has(item.tool)).toBe(true);
    }
  });
});

describe('MCP page content', () => {
  it('offers Claude Code only: the terminal and the desktop app', () => {
    expect(MCP_CONNECT_GUIDES.map((guide) => guide.title)).toEqual([
      'Claude Code in the terminal',
      'Claude Code in the desktop app',
    ]);
    expect(MCP_CONNECT_GUIDES.every((guide) => guide.kind === 'claude-code')).toBe(true);
    expect(new Set(MCP_CONNECT_GUIDES.map((guide) => guide.id)).size).toBe(2);
    expect(JSON.stringify(MCP_CONNECT_GUIDES)).not.toMatch(/cursor|claude\.ai|custom connector/i);
  });

  it('marks only the cohort guide and the cohort tools as coming soon', () => {
    expect(MCP_PROMPT_GUIDES.map((guide) => guide.title)).toEqual(['Review a session', 'Triage a crash', 'Analyse a cohort']);
    expect(MCP_PROMPT_GUIDES.filter((guide) => guide.comingSoon).map((guide) => guide.title)).toEqual(['Analyse a cohort']);
    expect(MCP_COHORT_TOOL_COSTS.every((row) => row.comingSoon)).toBe(true);
    expect(MCP_REVIEW_TOOL_COSTS.some((row) => row.comingSoon)).toBe(false);
  });

  it('gives each guide three or four prompts and only tools from the cost reference', () => {
    const tools = new Set([...MCP_REVIEW_TOOL_COSTS, ...MCP_COHORT_TOOL_COSTS].map((row) => row.tool));
    for (const guide of MCP_PROMPT_GUIDES) {
      expect(guide.prompts.length).toBeGreaterThanOrEqual(3);
      expect(guide.prompts.length).toBeLessThanOrEqual(4);
      for (const tool of guide.tools) expect(tools.has(tool)).toBe(true);
    }
  });
});
