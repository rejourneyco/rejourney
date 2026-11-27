import { describe, expect, it } from "vitest";
import { normalizeLegacyAnalyticsAppPath, stripDashboardPathPrefix } from "~/shell/routing/dashboardRouteAliases";
import { loader } from "./AutomationsLeaksRedirect";

function redirectTarget(url: string): string | null {
    const response = loader({ request: new Request(url) });
    expect(response.status).toBe(302);
    return response.headers.get("Location");
}

describe("old Leaks addresses", () => {
    it("redirect to the MCP page in dashboard and demo modes", () => {
        expect(redirectTarget("https://rejourney.co/dashboard/leaks")).toBe("/dashboard/mcp");
        expect(redirectTarget("https://rejourney.co/dashboard/automations/leaks")).toBe("/dashboard/mcp");
        expect(redirectTarget("https://rejourney.co/demo/leaks")).toBe("/demo/mcp");
        expect(redirectTarget("https://rejourney.co/demo/automations/leaks/")).toBe("/demo/mcp");
    });

    it("drop query strings that addressed Leaks settings", () => {
        expect(redirectTarget("https://rejourney.co/dashboard/leaks?settings=leak-alerts")).toBe("/dashboard/mcp");
    });

    it("resolve to the MCP tab for saved tabs and links", () => {
        expect(normalizeLegacyAnalyticsAppPath("/dashboard/leaks")).toBe("/dashboard/mcp");
        expect(normalizeLegacyAnalyticsAppPath("/demo/automations/leaks")).toBe("/demo/mcp");
        expect(stripDashboardPathPrefix("/demo/leaks")).toBe("/mcp");
        expect(stripDashboardPathPrefix("/dashboard/mcp")).toBe("/mcp");
    });
});
