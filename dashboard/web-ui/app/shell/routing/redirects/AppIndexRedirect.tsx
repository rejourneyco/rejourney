import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, "");
  return redirect(`${pathname}/general${url.search}`);
}

export default function AppIndexRedirect() {
  return null;
}
