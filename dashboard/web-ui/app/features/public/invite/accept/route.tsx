/**
 * Rejourney Dashboard - Invite Accept Route
 */

import type { Route } from "./+types/route";
import { useParams } from "react-router";

export const meta: Route.MetaFunction = () => [
    { title: "Accept Invitation - Rejourney" },
    { name: "robots", content: "noindex" },
];

// This page is handled client-side because it depends on auth state.
export { InviteAccept as default } from "./InviteAcceptScreen";
