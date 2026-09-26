import { Button } from "./Button";
import { dashboardButtonClass } from "./dashboardStyles";

interface AuthServiceUnavailableProps {
  detail?: string | null;
  isRetrying?: boolean;
  onRetry?: () => void;
  // "screen" is the dashboard's full-page state; "panel" sits inside the public login card
  // and keeps that page's styling.
  variant?: "screen" | "panel";
  label?: string;
  title?: string;
  message?: string;
}

export function AuthServiceUnavailable({
  detail,
  isRetrying = false,
  onRetry,
  variant = "screen",
  label = "Auth service unavailable",
  title = "Sign-in error",
  message = "Rejourney cannot reach the authentication service right now.",
}: AuthServiceUnavailableProps) {
  if (variant === "panel") {
    return (
      <div className="w-full max-w-md border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="mb-4 inline-flex border-2 border-amber-500 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
          {label}
        </div>
        <h1 className="mb-3 text-2xl font-black uppercase tracking-tight text-slate-950">
          {title}
        </h1>
        <p className="mb-4 text-sm font-semibold leading-6 text-slate-700">
          {message}
        </p>
        {detail && (
          <p className="mb-4 border border-slate-200 bg-slate-50 p-3 text-xs font-mono text-slate-600">
            {detail}
          </p>
        )}
        {onRetry && (
          <Button
            type="button"
            variant="primary"
            onClick={onRetry}
            disabled={isRetrying}
            className="w-full rounded-none bg-black text-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all h-12 font-black uppercase tracking-widest text-sm hover:bg-gray-900"
          >
            {isRetrying ? "Checking..." : "Retry"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8fafd] flex items-center justify-center p-4 font-sans text-[#202124]">
      <div className="w-full max-w-md rounded-none border border-[#dadce0] bg-white p-6 shadow-[0_1px_3px_rgba(60,64,67,0.12)]">
        <div className="mb-3 inline-flex rounded-none bg-[#fef7e0] px-2 py-0.5 text-[11px] font-medium text-[#b06000]">
          {label}
        </div>
        <h1 className="mb-2 text-xl font-normal text-[#202124]">
          {title}
        </h1>
        <p className="mb-4 text-sm leading-6 text-[#3c4043]">
          {message}
        </p>
        {detail && (
          <p className="mb-4 rounded-none border border-[#e8eaed] bg-[#f8fafd] p-3 text-xs leading-5 text-[#5f6368]">
            {detail}
          </p>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className={`${dashboardButtonClass("primary", "lg")} w-full`}
          >
            {isRetrying ? "Checking..." : "Retry"}
          </button>
        )}
      </div>
    </main>
  );
}
