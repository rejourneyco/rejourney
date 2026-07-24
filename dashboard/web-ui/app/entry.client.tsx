/**
 * Rejourney Dashboard - Client Entry
 * 
 * This file hydrates the React application on the client side.
 */

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

function removeInjectedHydrationArtifacts() {
    for (const iframe of Array.from(document.body.querySelectorAll<HTMLIFrameElement>(":scope > iframe"))) {
        const isInjectedDetectionFrame =
            iframe.getAttribute("height") === "1"
            && iframe.getAttribute("width") === "1"
            && iframe.style.visibility === "hidden"
            && !iframe.getAttribute("src");
        if (isInjectedDetectionFrame) {
            iframe.remove();
        }
    }

    for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>("head > script, body > script"))) {
        const src = script.getAttribute("src") ?? "";
        const body = script.textContent ?? "";
        const isCloudflareScript =
            src.includes("static.cloudflareinsights.com/")
            || src.includes("/cdn-cgi/challenge-platform/")
            || src === "/metrics/"
            || body.includes("/cdn-cgi/challenge-platform/scripts/jsd/")
            || body.includes("__CF$cv$params")
            || body.includes("google_tags_first_party");
        if (isCloudflareScript) {
            script.remove();
        }
    }
}

for (const node of Array.from(document.documentElement.childNodes)) {
    if (node !== document.head && node !== document.body) {
        node.parentNode?.removeChild(node);
    }
}
removeInjectedHydrationArtifacts();

startTransition(() => {
    hydrateRoot(
        document,
        <StrictMode>
            <HydratedRouter />
        </StrictMode>
    );
});
