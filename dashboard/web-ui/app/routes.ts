/**
 * Rejourney Dashboard - Route Configuration
 * 
 * Clean, hierarchical route structure:
 * - / - Landing page (public)
 * - /docs, /pricing, etc. - Public marketing pages
 * - /login - Authentication
 * - /demo/* - Demo dashboard with mock data
 * - /app/* - Protected dashboard (authenticated users only)
 */

import { type RouteConfig, index, route, layout, prefix } from "@react-router/dev/routes";

export default [
    // ============================================
    // PUBLIC ROUTES (SSR, SEO-critical)
    // ============================================
    index("routes/_index.tsx"),
    route("docs", "routes/docs.tsx"),
    route("docs/*", "routes/docs.$slug.tsx"),
    route("contribute", "routes/contribute.tsx"),
    route("pricing", "routes/pricing.tsx"),
    route("terms-of-service", "routes/terms-of-service.tsx"),
    route("privacy-policy", "routes/privacy-policy.tsx"),
    route("dpa", "routes/dpa.tsx"),
    route("engineering", "routes/engineering.tsx"),
    route("feed.xml", "routes/feed.xml.tsx"),
    route("login", "routes/login.tsx"),
    route("invite/accept/:token", "routes/invite.accept.$token.tsx"),

    // ============================================
    // DEMO ROUTES (/demo/*)
    // Public demo with mock data, mirrors dashboard structure
    // ============================================
    ...prefix("demo", [
        layout("routes/_demo.tsx", [
            index("routes/_demo._index.tsx"),
            route("issues", "routes/_demo.issues.tsx"),
            route("issues/:issueId", "routes/_demo.issues.$issueId.tsx"),
            route("sessions", "routes/_demo.sessions.tsx"),
            route("sessions/:sessionId", "routes/_demo.sessions.$sessionId.tsx"),
            route("analytics/api", "routes/_demo.analytics.api.tsx"),
            route("stability/crashes", "routes/_demo.stability.crashes.tsx"),
            route("stability/crashes/:projectId/:crashId", "routes/_demo.stability.crashes.$projectId.$crashId.tsx"),
            route("stability/anrs", "routes/_demo.stability.anrs.tsx"),
            route("stability/anrs/:projectId/:anrId", "routes/_demo.stability.anrs.$projectId.$anrId.tsx"),
            route("stability/errors", "routes/_demo.stability.errors.tsx"),
            route("stability/errors/:projectId/:errorId", "routes/_demo.stability.errors.$projectId.$errorId.tsx"),
            route("analytics/growth", "routes/_demo.analytics.growth.tsx"),
            route("analytics/journeys", "routes/_demo.analytics.journeys.tsx"),
            route("analytics/devices", "routes/_demo.analytics.devices.tsx"),
            route("analytics/geo", "routes/_demo.analytics.geo.tsx"),
            route("alerts/emails", "routes/_demo.alerts.emails.tsx"),
            route("team", "routes/_demo.team.tsx"),
            route("warehouse", "routes/_demo.warehouse.tsx"),
            route("billing", "routes/_demo.billing.tsx"),
            route("billing/return", "routes/_demo.billing.return.tsx"),
            route("account", "routes/_demo.account.tsx"),
            route("settings/:projectId", "routes/_demo.settings.$projectId.tsx"),
            route("search", "routes/_demo.search.tsx"),
        ]),
    ]),

    // ============================================
    // PROTECTED DASHBOARD ROUTES (/dashboard/*)
    // Requires authentication, wrapped in dashboard layout
    // ============================================
    ...prefix("dashboard", [
        layout("routes/_dashboard.tsx", [
            index("routes/_dashboard._index.tsx"),
            route("issues", "routes/_dashboard.issues.tsx"),
            route("issues/:issueId", "routes/_dashboard.issues.$issueId.tsx"),
            route("sessions", "routes/_dashboard.sessions.tsx"),
            route("sessions/:sessionId", "routes/_dashboard.sessions.$sessionId.tsx"),
            route("analytics/api", "routes/_dashboard.analytics.api.tsx"),
            route("stability/crashes", "routes/_dashboard.stability.crashes.tsx"),
            route("stability/crashes/:projectId/:crashId", "routes/_dashboard.stability.crashes.$projectId.$crashId.tsx"),
            route("stability/anrs", "routes/_dashboard.stability.anrs.tsx"),
            route("stability/anrs/:projectId/:anrId", "routes/_dashboard.stability.anrs.$projectId.$anrId.tsx"),
            route("stability/errors", "routes/_dashboard.stability.errors.tsx"),
            route("stability/errors/:projectId/:errorId", "routes/_dashboard.stability.errors.$projectId.$errorId.tsx"),
            route("analytics/growth", "routes/_dashboard.analytics.growth.tsx"),
            route("analytics/journeys", "routes/_dashboard.analytics.journeys.tsx"),
            route("analytics/devices", "routes/_dashboard.analytics.devices.tsx"),
            route("analytics/geo", "routes/_dashboard.analytics.geo.tsx"),
            route("alerts/emails", "routes/_dashboard.alerts.emails.tsx"),
            route("team", "routes/_dashboard.team.tsx"),
            route("warehouse", "routes/_dashboard.warehouse.tsx"),
            route("billing", "routes/_dashboard.billing.tsx"),
            route("billing/return", "routes/_dashboard.billing.return.tsx"),
            route("account", "routes/_dashboard.account.tsx"),
            route("settings/:projectId", "routes/_dashboard.settings.$projectId.tsx"),
            route("search", "routes/_dashboard.search.tsx"),
        ]),
    ]),
] satisfies RouteConfig;
