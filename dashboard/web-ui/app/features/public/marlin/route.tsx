import { redirect } from "react-router";

// Rejourney Marlin, the GitHub App behind Leaks, is retired. AI clients now review
// sessions and crashes through the MCP server, so the old page points to its docs.
export function loader() {
  return redirect("/docs/mcp/getting-started", 301);
}

export default function RejourneyMarlinRedirect() {
  return null;
}
