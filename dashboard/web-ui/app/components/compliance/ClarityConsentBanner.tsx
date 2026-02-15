import { useEffect, useState } from "react";

const CLARITY_PROJECT_ID = "vhjw8g6djc";
const CONSENT_STORAGE_KEY = "rejourney.clarityConsent.v1";
const CLARITY_SCRIPT_ID = "rejourney-clarity-script";

type ConsentState = "loading" | "pending" | "accepted" | "rejected";

function loadClarityScript(): void {
    if (typeof window === "undefined") {
        return;
    }

    // Initialize the clarity queue if it doesn't exist
    // @ts-ignore
    window.clarity = window.clarity || function () {
        // @ts-ignore
        (window.clarity.q = window.clarity.q || []).push(arguments);
    };

    if (document.getElementById(CLARITY_SCRIPT_ID)) {
        return;
    }

    const script = document.createElement("script");
    script.id = CLARITY_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
    document.head.appendChild(script);
}

export function ClarityConsentBanner() {
    const [consentState, setConsentState] = useState<ConsentState>("loading");

    useEffect(() => {
        const storedValue = window.localStorage.getItem(CONSENT_STORAGE_KEY);

        if (storedValue === "accepted") {
            setConsentState("accepted");
            loadClarityScript();
            return;
        }

        if (storedValue === "rejected") {
            setConsentState("rejected");
            return;
        }

        setConsentState("pending");
    }, []);

    const acceptAnalytics = () => {
        window.localStorage.setItem(CONSENT_STORAGE_KEY, "accepted");
        setConsentState("accepted");
        loadClarityScript();
    };

    const rejectAnalytics = () => {
        window.localStorage.setItem(CONSENT_STORAGE_KEY, "rejected");
        setConsentState("rejected");
    };

    if (consentState !== "pending") {
        return null;
    }

    return (
        <aside className="fixed inset-x-4 bottom-4 z-[90] rounded-xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:max-w-md">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Privacy Controls</p>
            <h2 className="mt-1 text-sm font-bold text-slate-900">Allow Analytics?</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
                We use analytics to understand website usage and improve the product.
                More info in our privacy policy.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={rejectAnalytics}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                    Reject
                </button>
                <button
                    type="button"
                    onClick={acceptAnalytics}
                    className="rounded-md bg-[#5dadec] px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-[#4c9ddd]"
                >
                    Accept
                </button>
                <a
                    href="/privacy-policy"
                    className="ml-auto inline-flex items-center text-xs font-semibold text-slate-600 underline-offset-4 hover:underline"
                >
                    Privacy Policy
                </a>
            </div>
        </aside>
    );
}
