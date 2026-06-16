import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Cookie, ShieldCheck, ShieldX } from "lucide-react";
import { useAuth } from "~/shared/providers/AuthContext";
import { useTeam } from "~/shared/providers/TeamContext";
import {
    disableRejourneyWebsiteTelemetry,
    isEmbeddedFrame,
    isOfficialWebsiteHost,
    readStoredRejourneyConsent,
    startRejourneyWebsiteTelemetry,
    trackRejourneyConsentAccepted,
    trackRejourneyRouteView,
    writeStoredRejourneyConsent,
} from "~/shared/compliance/rejourneyWebsiteTelemetry";

type ConsentState = "loading" | "pending" | "accepted" | "rejected" | "disabled";

export function RejourneyConsentBanner() {
    const location = useLocation();
    const { user } = useAuth();
    const { currentTeam, teams } = useTeam();
    const [consentState, setConsentState] = useState<ConsentState>("loading");
    const [startSource, setStartSource] = useState<"stored_consent" | "banner_accept">("stored_consent");
    const isAppShellPath = location.pathname.startsWith("/dashboard") || location.pathname.startsWith("/demo");

    useEffect(() => {
        if (typeof window === "undefined") return;

        if (isAppShellPath) {
            setConsentState("disabled");
            disableRejourneyWebsiteTelemetry();
            return;
        }

        if (isEmbeddedFrame() || !isOfficialWebsiteHost(window.location.hostname)) {
            setConsentState("disabled");
            disableRejourneyWebsiteTelemetry();
            return;
        }

        const storedValue = readStoredRejourneyConsent();

        if (storedValue === "accepted") {
            setStartSource("stored_consent");
            setConsentState("accepted");
            return;
        }

        disableRejourneyWebsiteTelemetry();

        if (storedValue === "rejected") {
            setConsentState("rejected");
            return;
        }

        setConsentState("pending");
    }, [isAppShellPath]);

    useEffect(() => {
        if (consentState !== "accepted") return;

        void startRejourneyWebsiteTelemetry({
            pathname: location.pathname,
            search: location.search,
            userId: user?.id ?? null,
            currentTeam,
            teams,
            source: startSource,
        })
            .then((started) => {
                if (!started) return;
                if (startSource === "banner_accept") {
                    trackRejourneyConsentAccepted();
                }
                trackRejourneyRouteView({
                    pathname: location.pathname,
                    search: location.search,
                    userId: user?.id ?? null,
                    currentTeam,
                    teams,
                });
            })
            .catch(() => {
                // The SDK logs its own startup diagnostics when debug logging is enabled.
            });
    }, [consentState, currentTeam, location.pathname, location.search, startSource, teams, user?.id]);

    useEffect(() => {
        if (consentState !== "accepted") return;

        trackRejourneyRouteView({
            pathname: location.pathname,
            search: location.search,
            userId: user?.id ?? null,
            currentTeam,
            teams,
        });
    }, [consentState, currentTeam, location.pathname, location.search, teams, user?.id]);

    const acceptAnalytics = () => {
        writeStoredRejourneyConsent("accepted");
        setStartSource("banner_accept");
        setConsentState("accepted");
    };

    const rejectAnalytics = () => {
        writeStoredRejourneyConsent("rejected");
        setConsentState("rejected");
        disableRejourneyWebsiteTelemetry();
    };

    if (consentState !== "pending") {
        return null;
    }

    return (
        <aside className="fixed bottom-4 left-4 right-4 z-[90] sm:bottom-5 sm:left-auto sm:right-5 sm:w-[min(26rem,calc(100vw-2rem))]">
            <div className="overflow-hidden border border-white/50 dark:border-slate-900/40 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl shadow-xl shadow-slate-100/50 dark:shadow-none hover:shadow-2xl hover:border-indigo-500/30 transition-all duration-300 rounded-2xl">
                {/* Sleek top accent line */}
                <div className="h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
                
                <div className="p-5">
                    <div className="flex items-start gap-3.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/40 dark:border-slate-800/40 bg-indigo-500/10 text-indigo-650 dark:text-indigo-400 shadow-sm backdrop-blur-md">
                            <Cookie className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Allow website analytics?</p>
                            <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-500 dark:text-slate-400">
                                We use our own Rejourney web SDK to understand page flows, performance, and product friction. It is optional, masked by default, and the site works without it.
                            </p>
                        </div>
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
                        <button
                            type="button"
                            onClick={rejectAnalytics}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-white/50 dark:bg-slate-900/50 hover:bg-white/80 dark:hover:bg-slate-900/80 text-slate-700 dark:text-slate-300 hover:text-indigo-650 dark:hover:text-indigo-400 backdrop-blur-md border border-slate-200/60 dark:border-slate-800/60 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide text-xs px-3 py-2 uppercase"
                        >
                            <ShieldX className="h-4 w-4" aria-hidden="true" />
                            Essential only
                        </button>
                        <button
                            type="button"
                            onClick={acceptAnalytics}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 font-bold tracking-wide text-xs px-3 py-2 uppercase"
                        >
                            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            All
                        </button>
                    </div>
                    <div className="mt-4 flex justify-between items-center">
                        <a
                            href="/privacy-policy"
                            className="text-xs font-bold text-slate-400 hover:text-indigo-650 dark:hover:text-indigo-400 uppercase tracking-wider border-b border-dashed border-slate-300 dark:border-slate-800 hover:border-indigo-650 dark:hover:border-indigo-400 transition-colors"
                        >
                            Privacy policy
                        </a>
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase">
                            First-party Only
                        </span>
                    </div>
                </div>
            </div>
        </aside>
    );
}
