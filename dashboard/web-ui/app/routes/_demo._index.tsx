/**
 * Demo Index Route
 * 
 * Redirects to /demo/issues as the default demo dashboard view.
 */

import { redirect } from "react-router";
import type { Route } from "./+types/_demo._index";

export function loader({ request }: Route.LoaderArgs) {
    // Redirect /demo to /demo/issues
    return redirect("/demo/issues");
}

export default function DemoIndex() {
    return null;
}
