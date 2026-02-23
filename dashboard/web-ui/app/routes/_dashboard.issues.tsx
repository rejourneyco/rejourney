import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
    const url = new URL(request.url);
    return redirect(`/dashboard/general${url.search}`);
}

export default function DashboardIssuesRedirect() {
    return null;
}
