import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Cookie, ShieldCheck, ShieldX } from "lucide-react";
import { useAuth } from "~/shared/providers/AuthContext";
import { useSafeTeam } from "~/shared/providers/TeamContext";
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
    const { currentTeam, teams } = useSafeTeam();
    const [consentState, setConsentState] = useState<ConsentState>("loading");
    const [startSource, setStartSource] = useState<"stored_consent" | "banner_accept">("stored_consent");
    const [isMounted, setIsMounted] = useState(false);
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
        if (consentState === "pending") {
            const timer = setTimeout(() => {
                setIsMounted(true);
            }, 1000); // 1.0 second delay for better noticeability and cognitive ease
            return () => clearTimeout(timer);
        } else {
            setIsMounted(false);
        }
    }, [consentState]);

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
        <aside
            className={`fixed bottom-0 left-0 right-0 z-[90] w-full border-t border-slate-200/50 dark:border-slate-800/40 bg-white/85 dark:bg-slate-950/85 backdrop-blur-xl shadow-[0_-10px_40px_rgba(0,0,0,0.06)] transition-all duration-700 ease-out transform ${
                isMounted ? "translate-y-0" : "translate-y-full"
            }`}
        >
            {/* Sleek top accent line */}
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
            
            <div className="max-w-7xl mx-auto px-4 py-4 md:px-8 md:py-5 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-start md:items-center gap-4 w-full md:w-auto">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100/50 dark:border-indigo-900/30 bg-gradient-to-tr from-indigo-500/10 via-purple-500/10 to-pink-500/10 text-indigo-650 dark:text-indigo-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)] dark:shadow-none animate-float">
                        <Cookie className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight leading-none md:leading-snug">
                            Optimize your experience
                        </h2>
                        <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-500 dark:text-slate-400 max-w-3xl">
                            We use first-party cookies to measure page speed and bug fixes. Sessions are masked and secure.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between md:justify-end gap-4 w-full md:w-auto shrink-0 border-t border-slate-100 dark:border-slate-900/40 md:border-t-0 pt-3 md:pt-0">
                    <div className="flex items-center gap-3">
                        <a
                            href="/privacy-policy"
                            className="text-xs font-bold text-slate-400 hover:text-indigo-650 dark:hover:text-indigo-400 uppercase tracking-wider border-b border-dashed border-slate-300 dark:border-slate-800 hover:border-indigo-650 dark:hover:border-indigo-400 transition-colors"
                        >
                            Privacy policy
                        </a>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <button
                            type="button"
                            onClick={rejectAnalytics}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-100/80 dark:bg-slate-900/60 hover:bg-slate-200/80 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-350 hover:text-slate-900 dark:hover:text-white border border-slate-200/60 dark:border-slate-800/50 hover:border-slate-300 dark:hover:border-slate-700 hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 text-xs font-bold tracking-wide uppercase px-4 py-2 shadow-sm"
                        >
                            <ShieldX className="h-4 w-4" aria-hidden="true" />
                            Essential Only
                        </button>
                        <button
                            type="button"
                            onClick={acceptAnalytics}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/10 hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 text-xs font-bold tracking-wide uppercase px-4 py-2"
                        >
                            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            Allow Cookies
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    );
}
