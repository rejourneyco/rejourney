import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/issues\/([^/]+)$/, "/general/$1");
  return redirect(`${pathname}${url.search}`);
}

export default function IssueDetailRedirect() {
  return null;
}
