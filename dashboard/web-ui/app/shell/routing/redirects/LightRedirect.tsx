import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
    const requestUrl = new URL(request.url);
    throw redirect(`/${requestUrl.search}`, { status: 308 });
}

export default function LightRedirect() {
    return null;
}
