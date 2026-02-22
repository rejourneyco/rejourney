/**
 * Dashboard Index Route
 * 
 * Redirects to /dashboard/general as the default dashboard view.
 */

import { redirect } from "react-router";
import type { Route } from "./+types/_dashboard._index";

export function loader({ request }: Route.LoaderArgs) {
    // Redirect /dashboard to /dashboard/general
    return redirect("/dashboard/general");
}

export default function DashboardIndex() {
    return null;
}
