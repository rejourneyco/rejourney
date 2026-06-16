import { redirect } from "react-router";
import type { Route } from "./+types/SetupRedirect";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect(`/dashboard/setup${url.search}`);
}

export default function SetupRedirect() {
  return null;
}
