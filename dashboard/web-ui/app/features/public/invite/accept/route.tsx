/**
 * Rejourney Dashboard - Invite Accept Route
 */

import type { Route } from "./+types/route";
import { InviteAccept } from "./InviteAcceptScreen";
import { TeamProvider } from "~/shared/providers/TeamContext";

export const meta: Route.MetaFunction = () => [
    { title: "Accept Invitation - Rejourney" },
    { name: "robots", content: "noindex" },
];

// This page is handled client-side because it depends on auth and team state.
export default function InviteAcceptRoute() {
    return (
        <TeamProvider>
            <InviteAccept />
        </TeamProvider>
    );
}
