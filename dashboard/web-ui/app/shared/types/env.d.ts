export { };

declare global {
    interface Window {
        ENV: {
            VITE_STRIPE_PUBLISHABLE_KEY?: string;
            VITE_MAPBOX_TOKEN?: string;
            VITE_TURNSTILE_SITE_KEY?: string;
            VITE_GOOGLE_ADS_CONVERSION_ID?: string;
            VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL?: string;
            VITE_GOOGLE_ADS_DEMO_OPENED_CONVERSION_LABEL?: string;
            VITE_GOOGLE_ADS_PRICING_VIEWED_CONVERSION_LABEL?: string;
            VITE_GOOGLE_ADS_DOCS_OPENED_CONVERSION_LABEL?: string;
            VITE_GOOGLE_ADS_CONSENT_BYPASS_FOR_INITIAL_TESTING?: string;
            VITE_REDDIT_PIXEL_ID?: string;
            SHOW_ISSUE_DETECTION_UI?: string;
        };
        dataLayer?: unknown[];
        gtag?: (...args: unknown[]) => void;
    }
}
