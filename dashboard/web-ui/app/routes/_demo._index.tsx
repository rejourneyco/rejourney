/**
 * Demo Index Route
 * 
 * Redirects to /demo/general as the default demo dashboard view.
 */

import { redirect } from "react-router";
import type { Route } from "./+types/_demo._index";

export function loader({ request }: Route.LoaderArgs) {
    // Redirect /demo to /demo/general
    return redirect("/demo/general");
}

export default function DemoIndex() {
    return null;
}
