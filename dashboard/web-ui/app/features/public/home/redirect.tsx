import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
    const url = new URL(request.url);
    const [, , ...rest] = url.pathname.split("/");
    const englishPath = `/${rest.join("/")}`.replace(/\/$/, "") || "/";
    return redirect(`${englishPath}${url.search}${url.hash}`);
}

export default function LocalizedHomeRedirect() {
    return null;
}
