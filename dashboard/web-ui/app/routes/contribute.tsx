import { redirect } from "react-router";
import type { Route } from "./+types/contribute";

export async function loader() {
    return redirect("/docs/community/contributing");
}

export default function Redirect() {
    return null;
}
