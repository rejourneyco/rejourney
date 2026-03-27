import type { RouteConfig } from "@react-router/dev/routes";

import { buildAppShellRoutes } from "./shell/routing/appShellRoutes";
import { publicRoutes } from "./shell/routing/publicRoutes";

export default [
  ...publicRoutes,
  ...buildAppShellRoutes("demo"),
  ...buildAppShellRoutes("dashboard"),
] satisfies RouteConfig;
