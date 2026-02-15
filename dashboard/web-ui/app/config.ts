// Environment-based configuration
// In Vite, env vars are accessed via import.meta.env

// Detect if we're running in SSR/Docker context (no window or API_URL not set)
const isSSR = typeof window === 'undefined';

export const config = {
    // Dashboard URL - where the console/dashboard is hosted
    dashboardUrl: import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:3456',

    // API URL - backend API
    // In Docker/production, use empty string to use relative paths through the proxy
    // Only use direct API URL in development when running vite dev server
    apiUrl: import.meta.env.VITE_API_URL || '',

    // Stripe publishable key for in-app payment method collection
    stripePublishableKey: (typeof window !== 'undefined' ? window.ENV?.VITE_STRIPE_PUBLISHABLE_KEY : undefined) || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '',

    // GitHub repo
    githubUrl: 'https://github.com/rejourneyco/rejourney',

    // Docs URL - always /docs on the same domain
    docsUrl: '/docs',
};

// Helper to check if we're in production
export const isProduction = import.meta.env.PROD;

// Centralized API base URL - use this instead of duplicating
// Empty string means use relative URLs (go through the proxy)
// Force empty string for relative URLs in production/docker to avoid CORS/SameSite issues
export const API_BASE_URL = isProduction || typeof window !== 'undefined' ? '' : (config.apiUrl || '');


// Centralized CSRF token getter - use this instead of duplicating
export function getCsrfToken(): string | null {
    if (typeof document === 'undefined') return null;
    const meta = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (meta) return meta;

    // Fallback to cookie
    const match = document.cookie.match(/(^| )csrf=([^;]+)/);
    return match ? match[2] : null;
}
