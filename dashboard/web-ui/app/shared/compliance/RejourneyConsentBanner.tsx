import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Cookie, ShieldCheck, ShieldX } from "lucide-react";
import { useAuth } from "~/shared/providers/AuthContext";
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
            currentTeam: null,
            teams: [],
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
                    currentTeam: null,
                    teams: [],
                });
            })
            .catch(() => {
                // The SDK logs its own startup diagnostics when debug logging is enabled.
            });
    }, [consentState, isWebsiteTelemetryDisabledPath, location.pathname, location.search, startSource, user?.id]);

    useEffect(() => {
        if (consentState !== "accepted") return;
        if (isWebsiteTelemetryDisabledPath) return;

        trackRejourneyRouteView({
            pathname: location.pathname,
            search: location.search,
            userId: user?.id ?? null,
            currentTeam: null,
            teams: [],
        });
    }, [consentState, isWebsiteTelemetryDisabledPath, location.pathname, location.search, user?.id]);

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
            className={`fixed bottom-0 left-0 right-0 z-[90] w-full border-t border-slate-200/80 bg-white/90 backdrop-blur-xl px-4 py-4 sm:px-6 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] transition-all duration-400 ease-out ${
                isMounted ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
            }`}
        >
            <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-4 md:flex-row md:items-center md:gap-8">
                <div className="flex items-center gap-4">
                    <div className="hidden h-10 w-10 shrink-0 items-center justify-center border border-slate-200 bg-slate-50 text-slate-600 shadow-sm sm:flex">
                        <Cookie className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="flex flex-col">
                        <h2 className="text-sm font-semibold text-slate-900">
                            Cookie Preferences
                        </h2>
                        <p className="mt-0.5 text-xs font-medium text-slate-600 sm:text-sm">
                            We use cookies to optimize performance, analytics, and user experience.{' '}
                            <a
                                href="/privacy-policy"
                                className="font-semibold text-slate-500 hover:text-slate-900 underline transition-colors"
                            >
                                Privacy policy
                            </a>
                        </p>
                    </div>
                </div>

                <div className="flex w-full shrink-0 items-center justify-end gap-4 md:w-auto">
                    <button
                        type="button"
                        onClick={rejectAnalytics}
                        className="text-sm font-semibold text-slate-500 hover:text-slate-800 bg-transparent border-0 p-0 cursor-pointer transition-colors"
                    >
                        Essential only
                    </button>

                    <button
                        type="button"
                        onClick={acceptAnalytics}
                        className="inline-flex min-h-10 items-center justify-center gap-1.5 border border-slate-200 bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors"
                    >
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        Allow Cookies
                    </button>
                </div>
            </div>
        </aside>
    );
}
