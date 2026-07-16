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
            data-rejourney-consent-banner
            className={`fixed bottom-0 left-0 right-0 z-[90] w-full border-t-2 border-black bg-white shadow-neo transition-transform duration-500 ease-out ${
                isMounted ? "translate-y-0" : "translate-y-full"
            }`}
        >
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-3 md:flex-row md:gap-5 md:px-8 md:py-4">
                <div className="flex items-start md:items-center gap-4 w-full md:w-auto">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-none border-2 border-black bg-[#fef08a] text-black shadow-neo-sm">
                        <Cookie className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-black uppercase text-slate-950 tracking-tight leading-none md:leading-snug">
                            Optimize your experience
                        </h2>
                        <p className="mt-1.5 text-xs font-bold leading-relaxed text-slate-700 max-w-3xl">
                            We use first-party cookies to measure page speed and bug fixes. Sessions are masked and secure.
                        </p>
                    </div>
                </div>

                <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-3 border-t border-black/20 pt-3 md:w-auto md:justify-end md:gap-4 md:border-t-0 md:pt-0">
                    <div className="flex items-center gap-3">
                        <a
                            href="/privacy-policy"
                            className="text-xs font-black text-slate-900 hover:text-black uppercase tracking-wider border-b-2 border-black transition-colors"
                        >
                            Privacy policy
                        </a>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <button
                            type="button"
                            onClick={rejectAnalytics}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-none bg-white hover:bg-slate-50 text-black border-2 border-black hover:-translate-y-0.5 hover:shadow-neo active:translate-y-0 active:shadow-none transition-all duration-200 text-xs font-black tracking-wide uppercase px-4 py-2 shadow-neo-sm"
                        >
                            <ShieldX className="h-4 w-4" aria-hidden="true" />
                            Essential Only
                        </button>
                        <button
                            type="button"
                            onClick={acceptAnalytics}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-none bg-[#86efac] hover:bg-[#4ade80] text-black border-2 border-black hover:-translate-y-0.5 hover:shadow-neo active:translate-y-0 active:shadow-none transition-all duration-200 text-xs font-black tracking-wide uppercase px-4 py-2 shadow-neo-sm"
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
