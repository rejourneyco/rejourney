import { redirect } from "react-router";

export function loader({
    params,
    request,
}: {
    params: { issueId?: string };
    request: Request;
}) {
    const url = new URL(request.url);
    const issueId = params.issueId || "";
    return redirect(`/dashboard/general/${issueId}${url.search}`);
}

export default function DashboardIssueDetailRedirect() {
    return null;
}
