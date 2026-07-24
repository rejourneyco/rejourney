import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { AuthProvider, useAuth } from "./AuthContext";

function AuthStatus() {
  const { isAuthenticated } = useAuth();
  return createElement("span", null, isAuthenticated ? "dashboard" : "login");
}

describe("AuthProvider session hint", () => {
  it("renders signed-in navigation immediately when the session cookie is present", () => {
    const html = renderToStaticMarkup(
      createElement(AuthProvider, {
        children: createElement(AuthStatus),
        initialSessionPresent: true,
      }),
    );

    expect(html).toContain("dashboard");
  });

  it("keeps anonymous public pages anonymous without an auth request", () => {
    const html = renderToStaticMarkup(
      createElement(AuthProvider, { children: createElement(AuthStatus) }),
    );

    expect(html).toContain("login");
  });

  it("uses an authoritative hydrated logout over the cookie hint", () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        {
          children: createElement(AuthStatus),
          initialHydrated: true,
          initialSessionPresent: true,
          initialUser: null,
        },
      ),
    );

    expect(html).toContain("login");
  });
});
