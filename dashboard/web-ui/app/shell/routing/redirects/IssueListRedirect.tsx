import { redirect } from "react-router";

export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/issues$/, "/general");
  return redirect(`${pathname}${url.search}`);
}

export default function IssueListRedirect() {
  return null;
}
