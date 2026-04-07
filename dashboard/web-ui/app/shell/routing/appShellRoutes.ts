import { index, layout, prefix, route } from "@react-router/dev/routes";

const SHARED_APP_ROUTE_MODULES = [
  { key: "general", path: "general", file: "features/app/general/index/route.tsx" },
  { key: "general-issue", path: "general/:issueId", file: "features/app/general/detail/route.tsx" },
  { key: "sessions", path: "sessions", file: "features/app/sessions/index/route.tsx" },
  { key: "session-detail", path: "sessions/:sessionId", file: "features/app/sessions/detail/route.tsx" },
  { key: "analytics-api", path: "analytics/api", file: "features/app/analytics/api/route.tsx" },
  { key: "analytics-devices", path: "analytics/devices", file: "features/app/analytics/devices/route.tsx" },
  { key: "analytics-geo", path: "analytics/geo", file: "features/app/analytics/geo/route.tsx" },
  { key: "analytics-journeys", path: "analytics/journeys", file: "features/app/analytics/journeys/route.tsx" },
  { key: "analytics-heatmaps", path: "analytics/heatmaps", file: "features/app/analytics/heatmaps/route.tsx" },
  { key: "alerts-emails", path: "alerts/emails", file: "features/app/alerts/email/route.tsx" },
  { key: "crashes", path: "stability/crashes", file: "features/app/stability/crashes/index/route.tsx" },
  { key: "crash-detail", path: "stability/crashes/:projectId/:crashId", file: "features/app/stability/crashes/detail/route.tsx" },
  { key: "anrs", path: "stability/anrs", file: "features/app/stability/anrs/index/route.tsx" },
  { key: "anr-detail", path: "stability/anrs/:projectId/:anrId", file: "features/app/stability/anrs/detail/route.tsx" },
  { key: "errors", path: "stability/errors", file: "features/app/stability/errors/index/route.tsx" },
  { key: "error-detail", path: "stability/errors/:projectId/:errorId", file: "features/app/stability/errors/detail/route.tsx" },
  { key: "team", path: "team", file: "features/app/team/route.tsx" },
  { key: "warehouse", path: "warehouse", file: "features/app/workspace/warehouse/route.tsx" },
  { key: "billing", path: "billing", file: "features/app/billing/route.tsx" },
  { key: "billing-return", path: "billing/return", file: "features/app/billing/return/route.tsx" },
  { key: "account", path: "account", file: "features/app/account/route.tsx" },
  { key: "project-settings", path: "settings/:projectId", file: "features/app/settings/project/route.tsx" },
  { key: "search", path: "search", file: "features/app/search/route.tsx" },
] as const;

type AppShellMode = "demo" | "dashboard";

function buildAppShellChildRoutes(mode: AppShellMode) {
  return [
    index("shell/routing/redirects/AppIndexRedirect.tsx", { id: `${mode}-index` }),
    route("issues", "shell/routing/redirects/IssueListRedirect.tsx", { id: `${mode}-issues-redirect` }),
    route("issues/:issueId", "shell/routing/redirects/IssueDetailRedirect.tsx", { id: `${mode}-issue-detail-redirect` }),
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
