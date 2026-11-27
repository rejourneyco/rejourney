import { redirect } from "react-router";

// The Leaks page became the MCP page. /leaks and /automations/leaks both land on /mcp.
// Query strings are dropped: they addressed Leaks settings that no longer exist.
export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const prefix = url.pathname.startsWith("/demo") ? "/demo" : "/dashboard";
  return redirect(`${prefix}/mcp`);
}

export default function AutomationsLeaksRedirect() {
  return null;
}
