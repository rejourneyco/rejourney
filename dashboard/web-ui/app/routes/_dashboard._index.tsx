/**
 * Dashboard Index Route
 * 
 * Redirects to /app/issues as the default dashboard view.
 */

import { redirect } from "react-router";
import type { Route } from "./+types/_dashboard._index";

export function loader({ request }: Route.LoaderArgs) {
    // Redirect /dashboard to /dashboard/issues
    return redirect("/dashboard/issues");
}

export default function DashboardIndex() {
    return null;
}
