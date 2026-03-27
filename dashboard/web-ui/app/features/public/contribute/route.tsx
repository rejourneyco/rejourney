import { redirect } from "react-router";
import type { Route } from "./+types/route";

export async function loader() {
    return redirect("/docs/community/contributing");
}

export default function Redirect() {
    return null;
}
