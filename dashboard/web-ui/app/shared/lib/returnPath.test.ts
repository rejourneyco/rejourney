import { describe, expect, it } from "vitest";

import { buildLoginPath, safeReturnPath } from "./returnPath";

describe("safeReturnPath", () => {
    it("accepts same-origin relative paths", () => {
        expect(safeReturnPath("/dashboard")).toBe("/dashboard");
        expect(safeReturnPath("/oauth/consent?uid=abc")).toBe("/oauth/consent?uid=abc");
        expect(safeReturnPath("/invite/accept/t%2Fk")).toBe("/invite/accept/t%2Fk");
    });

    it("rejects anything a browser could resolve to another origin", () => {
        for (const value of [
            null,
            undefined,
            "",
            "dashboard",
            "https://evil.example/",
            "//evil.example/",
            "/\\evil.example/",
            "\\\\evil.example",
            "/\t/evil.example",
            "/\n/evil.example",
            "/ok\\..\\x",
        ]) {
            expect(safeReturnPath(value)).toBeNull();
        }
    });
});

describe("buildLoginPath", () => {
    it("encodes a safe return target", () => {
        expect(buildLoginPath("/oauth/consent?uid=a&b")).toBe("/login?returnTo=%2Foauth%2Fconsent%3Fuid%3Da%26b");
    });

    it("drops an unsafe return target", () => {
        expect(buildLoginPath("//evil.example")).toBe("/login");
    });
});
