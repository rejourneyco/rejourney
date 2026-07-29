import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Cookie, ShieldCheck, ShieldX } from "lucide-react";
import { useAuth } from "~/shared/providers/AuthContext";
import { useSafeTeam } from "~/shared/providers/TeamContext";
import {
    captureGoogleAdsAttribution,
    clearGoogleAdsAttribution,
    grantGoogleAdsAttributionConsent,
} from "~/shared/lib/googleAdsAttribution";
import {
    hasGoogleAdsConsent,
    isGoogleAdsConsentPromptRequired,
    updateGoogleAdsConsent,
} from "~/shared/lib/googleAdsConsent";
import {
    getGoogleAdsPageConversionRule,
    trackGoogleAdsWebsiteConversion,
} from "~/shared/lib/googleAdsWebsiteConversions";
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
    const isDashboardPath = location.pathname.startsWith("/dashboard");
    const isWebsiteTelemetryDisabledPath = isDashboardPath || location.pathname.startsWith("/demo");

    useEffect(() => {
        if (typeof window === "undefined") return;
        captureGoogleAdsAttribution();

        if (isWebsiteTelemetryDisabledPath) {
            disableRejourneyWebsiteTelemetry();
        }

        if (isDashboardPath) {
            setConsentState("disabled");
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
    }, [isDashboardPath, isWebsiteTelemetryDisabledPath]);

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
        if (isWebsiteTelemetryDisabledPath) return;

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
    }, [consentState, currentTeam, isWebsiteTelemetryDisabledPath, location.pathname, location.search, startSource, teams, user?.id]);

    useEffect(() => {
        if (consentState !== "accepted") return;
        if (isWebsiteTelemetryDisabledPath) return;

        trackRejourneyRouteView({
            pathname: location.pathname,
            search: location.search,
            userId: user?.id ?? null,
            currentTeam,
            teams,
        });
    }, [consentState, currentTeam, isWebsiteTelemetryDisabledPath, location.pathname, location.search, teams, user?.id]);

    useEffect(() => {
        if (typeof window === "undefined" || !hasGoogleAdsConsent()) return;
        const rule = getGoogleAdsPageConversionRule(location.pathname);
        if (!rule) return;

        let elapsed = false;
        let interacted = !rule.requiresInteraction;
        let fired = false;
        const maybeTrack = () => {
            if (fired || !elapsed || !interacted || document.visibilityState !== "visible") return;
            fired = trackGoogleAdsWebsiteConversion(rule.eventName);
        };
        const onInteraction = () => {
            interacted = true;
            maybeTrack();
        };
        const timer = window.setTimeout(() => {
            elapsed = true;
            maybeTrack();
        }, rule.delayMs);
        const interactionEvents = ["pointerdown", "keydown", "scroll"] as const;
        for (const eventName of interactionEvents) {
            window.addEventListener(eventName, onInteraction, { passive: true });
        }
        document.addEventListener("visibilitychange", maybeTrack);

        return () => {
            window.clearTimeout(timer);
            for (const eventName of interactionEvents) {
                window.removeEventListener(eventName, onInteraction);
            }
            document.removeEventListener("visibilitychange", maybeTrack);
        };
    }, [consentState, location.pathname]);

    const acceptAnalytics = () => {
        writeStoredRejourneyConsent("accepted");
        updateGoogleAdsConsent(true);
        grantGoogleAdsAttributionConsent();
        setStartSource("banner_accept");
        setConsentState("accepted");
    };

    const rejectAnalytics = () => {
        writeStoredRejourneyConsent("rejected");
        if (isGoogleAdsConsentPromptRequired()) {
            updateGoogleAdsConsent(false);
            clearGoogleAdsAttribution();
        }
        setConsentState("rejected");
        disableRejourneyWebsiteTelemetry();
    };

    if (consentState !== "pending") {
        return null;
    }

    return (
        <aside
            data-rejourney-consent-banner
            className={`fixed bottom-4 left-4 right-4 z-[90] md:left-auto md:right-6 md:bottom-6 md:w-full md:max-w-md border-2 border-black bg-white p-4 sm:p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all duration-400 ease-out ${
                isMounted ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 pointer-events-none"
            }`}
        >
            <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-black bg-[#fef08a] text-black shadow-neo-sm">
                        <Cookie className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="text-xs font-black uppercase tracking-wider text-slate-950">
                                Cookie Preferences
                            </h2>
                            <a
                                href="/privacy-policy"
                                className="text-[11px] font-bold text-slate-500 hover:text-slate-950 underline transition-colors"
                            >
                                Privacy policy
                            </a>
                        </div>
                        <p className="mt-1 text-xs font-bold leading-relaxed text-slate-700">
                            We use cookies to optimize performance, analytics, and user experience.
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-black/15 pt-3 mt-1">
                    <button
                        type="button"
                        onClick={rejectAnalytics}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800 underline decoration-blue-400 hover:decoration-blue-700 bg-transparent border-0 p-0 cursor-pointer transition-colors"
                    >
                        Essential only
                    </button>

                    <button
                        type="button"
                        onClick={acceptAnalytics}
                        className="inline-flex min-h-9 items-center justify-center gap-1.5 border-2 border-black bg-[#86efac] px-4 py-1.5 font-mono text-xs font-black uppercase tracking-wider text-black shadow-neo-sm hover:bg-[#4ade80] hover:-translate-y-0.5 active:translate-y-0 transition-all"
                    >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Allow Cookies
                    </button>
                </div>
            </div>
        </aside>
    );
}
