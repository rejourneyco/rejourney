import { redirectDocument } from "react-router";
import type { Route } from "./+types/route";

const GITHUB_RELEASES_URL = "https://github.com/rejourneyco/rejourney/releases";

export function loader(_args: Route.LoaderArgs) {
    return redirectDocument(GITHUB_RELEASES_URL, { status: 302 });
}

export default function ChangelogRedirect() {
    return null;
}
