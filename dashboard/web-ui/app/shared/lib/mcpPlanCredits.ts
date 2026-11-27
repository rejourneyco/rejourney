/**
 * MCP credits included per month on each standard plan. The billing plans API
 * sends `mcpCreditLimit` per plan; these values cover plans without it (for
 * example the pricing page's fallback list before the API answers).
 */
export const MCP_PLAN_CREDITS: Record<string, number> = {
  free: 300,
  starter: 2000,
  growth: 6000,
  pro: 20000,
  scale: 75000,
};

/** The plan's monthly MCP credits, or null when unknown (custom plans). */
export function planMcpCredits(plan: { name: string; mcpCreditLimit?: number | null }): number | null {
  const fromApi = plan.mcpCreditLimit;
  if (typeof fromApi === 'number' && Number.isFinite(fromApi) && fromApi > 0) return fromApi;
  return MCP_PLAN_CREDITS[plan.name.toLowerCase().trim()] ?? null;
}
