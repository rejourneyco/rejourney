/**
 * Rejourney Dashboard - Invite Accept Route
 */

import type { Route } from "./+types/invite.accept.$token";
import { useParams } from "react-router";

export const meta: Route.MetaFunction = () => [
    { title: "Accept Invitation - Rejourney" },
    { name: "robots", content: "noindex" },
];

// This page will be handled client-side since it requires auth
export { InviteAccept as default } from "~/pages/InviteAccept";
