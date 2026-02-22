import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
    const url = new URL(request.url);
    return redirect(`/demo/general${url.search}`);
}

export default function DemoIssuesRedirect() {
    return null;
}
