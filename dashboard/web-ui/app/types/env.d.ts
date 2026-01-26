export { };

declare global {
    interface Window {
        ENV: {
            VITE_STRIPE_PUBLISHABLE_KEY?: string;
        };
    }
}
