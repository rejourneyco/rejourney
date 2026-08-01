import { describe, expect, it } from "vitest";
import { loader } from "./LightRedirect";

function captureRedirect(url: string): Response {
    try {
        loader({ request: new Request(url), params: {}, context: {} } as never);
    } catch (error) {
        return error as Response;
    }
    throw new Error("Expected /light loader to redirect");
}

describe("/light redirect", () => {
    it("permanently redirects to the homepage", () => {
        const response = captureRedirect("https://rejourney.co/light");
        expect(response.status).toBe(308);
        expect(response.headers.get("Location")).toBe("/");
    });

    it("preserves paid attribution parameters", () => {
        const response = captureRedirect("https://rejourney.co/light?gclid=test-click&utm_source=google&utm_campaign=replay");
        expect(response.status).toBe(308);
        expect(response.headers.get("Location")).toBe("/?gclid=test-click&utm_source=google&utm_campaign=replay");
    });
});
