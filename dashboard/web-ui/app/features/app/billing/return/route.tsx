import { useEffect } from "react";
import { useSearchParams } from "react-router";

import {
  buildBillingCheckoutRedirectUrl,
  buildBillingCheckoutReturnMessage,
} from "~/features/app/billing/checkoutFlow";
import { usePathPrefix } from "~/shell/routing/usePathPrefix";

export default function BillingPortalReturn() {
  const [searchParams] = useSearchParams();
  const pathPrefix = usePathPrefix();

  useEffect(() => {
    const flow = searchParams.get("flow");
    const status = searchParams.get("status");
    const sessionId = searchParams.get("session_id");

    if (flow === "checkout" && (status === "success" || status === "canceled")) {
      if (window.opener) {
        window.opener.postMessage(
          buildBillingCheckoutReturnMessage(status, sessionId),
          window.location.origin,
        );
        window.close();
        return;
      }

      window.location.href = buildBillingCheckoutRedirectUrl(pathPrefix, status, sessionId);
      return;
    }

    if (window.opener) {
      window.opener.postMessage({ type: "STRIPE_PORTAL_CLOSED" }, window.location.origin);
      window.close();
      return;
    }

    window.location.href = `${pathPrefix}/billing`;
  }, [pathPrefix, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="text-center">
        <div className="mb-2 text-lg font-bold text-slate-700">Completing...</div>
        <div className="text-sm text-slate-500">Please wait while we update your billing information.</div>
      </div>
    </div>
  );
}
