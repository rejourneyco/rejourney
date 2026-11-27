import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { demoMcpOverview } from '~/features/app/mcp/demoData';
import { getMcpOverview } from '~/features/app/mcp/mcpApi';
import { creditsRemaining, formatCredits, usageBarClass, usagePercent } from '~/features/app/mcp/presentation';
import type { McpOverview, McpUsage } from '~/features/app/mcp/types';

type FetchOverview = (teamId: string, signal?: AbortSignal) => Promise<McpOverview>;

/**
 * MCP usage for the billing page. Demo mode uses the MCP page's demo data and
 * makes no request. Any failure (404 when MCP is not enabled on this server, or
 * any other error) resolves to null so the billing page hides the bar.
 */
export async function loadMcpCreditsUsage(
  teamId: string,
  options: { isDemoMode: boolean; signal?: AbortSignal; fetchOverview?: FetchOverview },
): Promise<McpUsage | null> {
  if (options.isDemoMode) return demoMcpOverview.usage;
  const fetchOverview = options.fetchOverview ?? getMcpOverview;
  try {
    const overview = await fetchOverview(teamId, options.signal);
    return overview?.usage ?? null;
  } catch {
    return null;
  }
}

function formatResetDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const McpCreditsUsageBar: React.FC<{ usage: McpUsage; mcpHref: string }> = ({ usage, mcpHref }) => {
  const limit = usage.creditLimit;
  const unlimited = limit === null;
  const percent = usagePercent(usage.creditsUsed, limit);
  const remaining = creditsRemaining(usage.creditsUsed, limit);
  const resetsOn = formatResetDate(usage.resetsAt);
  const toneClass = percent >= 100 ? 'text-[#c5221f]' : percent >= 80 ? 'text-[#b06000]' : 'text-[#202124]';

  return (
    <div className="space-y-2 border-t border-[#e8eaed] pt-4" data-testid="billing-mcp-credits">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-sm font-medium tabular-nums ${unlimited ? 'text-[#3c4043]' : toneClass}`}>
          {unlimited ? 'MCP credits used' : `${percent}% of MCP credits used`}
        </span>
        <span className="text-xs tabular-nums text-[#5f6368]">
          {unlimited
            ? `${formatCredits(usage.creditsUsed)} / No limit`
            : `${formatCredits(usage.creditsUsed)} / ${formatCredits(limit)}`}
        </span>
      </div>
      {!unlimited && (
        <div className="billing-progress-track">
          <div className={`billing-progress-fill ${usageBarClass(percent)}`} style={{ width: `${percent}%` }} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums text-[#5f6368]">
        <span>
          {unlimited ? 'No monthly limit' : `${formatCredits(remaining)} MCP credits remaining`}
          {resetsOn ? ` · Resets ${resetsOn}` : ''}
        </span>
        <Link to={mcpHref} className="font-medium text-[#1a73e8] hover:underline">
          View MCP usage
        </Link>
      </div>
    </div>
  );
};

/** Loads the team's MCP usage and renders the bar, or nothing when MCP is unavailable. */
export const McpCreditsUsage: React.FC<{
  teamId: string;
  isDemoMode: boolean;
  mcpHref: string;
  refreshKey?: unknown;
}> = ({ teamId, isDemoMode, mcpHref, refreshKey }) => {
  const [usage, setUsage] = useState<McpUsage | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void loadMcpCreditsUsage(teamId, { isDemoMode, signal: controller.signal }).then((next) => {
      if (active) setUsage(next);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [teamId, isDemoMode, refreshKey]);

  if (!usage) return null;
  return <McpCreditsUsageBar usage={usage} mcpHref={mcpHref} />;
};
