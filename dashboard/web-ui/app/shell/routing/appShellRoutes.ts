import { index, layout, prefix, route } from "@react-router/dev/routes";

const SHARED_APP_ROUTE_MODULES = [
  { key: "general", path: "general", file: "features/app/general/index/route.tsx" },
  { key: "general-issue", path: "general/:issueId", file: "features/app/general/detail/route.tsx" },
  { key: "sessions", path: "sessions", file: "features/app/sessions/index/route.tsx" },
  { key: "session-detail", path: "sessions/:sessionId", file: "features/app/sessions/detail/route.tsx" },
  { key: "analytics-api", path: "api", file: "features/app/analytics/api/route.tsx" },
  { key: "analytics-devices", path: "devices", file: "features/app/analytics/devices/route.tsx" },
  { key: "analytics-geo", path: "geo", file: "features/app/analytics/geo/route.tsx" },
  { key: "analytics-journeys", path: "journeys", file: "features/app/analytics/journeys/route.tsx" },
  { key: "analytics-heatmaps", path: "heatmaps", file: "features/app/analytics/heatmaps/route.tsx" },
  { key: "leaks", path: "leaks", file: "features/app/automations/leaks/route.tsx" },
  { key: "alerts-emails", path: "alerts/emails", file: "features/app/alerts/email/route.tsx" },
  { key: "setup", path: "setup", file: "features/app/setup/route.tsx" },
  { key: "stability", path: "stability", file: "features/app/stability/index/route.tsx" },
  { key: "crashes", path: "stability/crashes", file: "shell/routing/redirects/StabilityRedirect.tsx" },
  { key: "crash-detail", path: "stability/crashes/:projectId/:crashId", file: "shell/routing/redirects/StabilityRedirect.tsx" },
  { key: "anrs", path: "stability/anrs", file: "shell/routing/redirects/StabilityRedirect.tsx" },
  { key: "anr-detail", path: "stability/anrs/:projectId/:anrId", file: "shell/routing/redirects/StabilityRedirect.tsx" },
  { key: "errors", path: "stability/errors", file: "shell/routing/redirects/StabilityRedirect.tsx" },
  { key: "error-detail", path: "stability/errors/:projectId/:errorId", file: "shell/routing/redirects/StabilityRedirect.tsx" },
  { key: "team", path: "team", file: "features/app/team/route.tsx" },
  { key: "billing", path: "billing", file: "features/app/billing/route.tsx" },
  { key: "billing-return", path: "billing/return", file: "features/app/billing/return/route.tsx" },
  { key: "account", path: "account", file: "features/app/account/route.tsx" },
  { key: "project-settings", path: "settings/:projectId", file: "features/app/settings/project/route.tsx" },
  { key: "github-setup", path: "settings/:projectId/github", file: "features/app/settings/github/route.tsx" },
  { key: "search", path: "search", file: "features/app/search/route.tsx" },
] as const;

type AppShellMode = "demo" | "dashboard";

function buildAppShellChildRoutes(mode: AppShellMode) {
  return [
    index("shell/routing/redirects/AppIndexRedirect.tsx", { id: `${mode}-index` }),
    route("issues", "shell/routing/redirects/IssueListRedirect.tsx", { id: `${mode}-issues-redirect` }),
    route("issues/:issueId", "shell/routing/redirects/IssueDetailRedirect.tsx", { id: `${mode}-issue-detail-redirect` }),
    route("analytics", "shell/routing/redirects/AnalyticsRedirect.tsx", { id: `${mode}-analytics-redirect` }),
    route("analytics/*", "shell/routing/redirects/AnalyticsRedirect.tsx", { id: `${mode}-analytics-splat-redirect` }),
    route("automations/leaks", "shell/routing/redirects/AutomationsLeaksRedirect.tsx", { id: `${mode}-automations-leaks-redirect` }),
    ...SHARED_APP_ROUTE_MODULES.map(({ key, path, file }) =>
      route(path, file, { id: `${mode}-${key}` }),
    ),
  ];
}

export function buildAppShellRoutes(mode: AppShellMode) {
  return prefix(mode, [
    layout(
      mode === "demo"
        ? "shell/routing/DemoLayoutRoute.tsx"
        : "shell/routing/DashboardLayoutRoute.tsx",
      { id: `${mode}-shell` },
      buildAppShellChildRoutes(mode),
    ),
  ]);
}
