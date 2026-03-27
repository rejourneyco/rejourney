import { useEffect } from "react";

import { usePathPrefix } from "~/shell/routing/usePathPrefix";

export default function BillingPortalReturn() {
  const pathPrefix = usePathPrefix();

  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage({ type: "STRIPE_PORTAL_CLOSED" }, window.location.origin);
      window.close();
      return;
    }

    window.location.href = `${pathPrefix}/billing`;
  }, [pathPrefix]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="text-center">
        <div className="mb-2 text-lg font-bold text-slate-700">Completing...</div>
        <div className="text-sm text-slate-500">Please wait while we update your billing information.</div>
      </div>
    </div>
  );
}
