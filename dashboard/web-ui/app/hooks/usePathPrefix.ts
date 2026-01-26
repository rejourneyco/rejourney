/**
 * usePathPrefix Hook
 * 
 * Returns the current path prefix based on the URL.
 * - /app/* routes return '/app'
 * - /demo/* routes return '/demo'
 * - Other routes return ''
 */

import { useLocation } from 'react-router';

export function usePathPrefix(): string {
    const location = useLocation();

    if (location.pathname.startsWith('/dashboard')) {
        return '/dashboard';
    }
    if (location.pathname.startsWith('/demo')) {
        return '/demo';
    }
    return '';
}

/**
 * Helper to create prefixed paths
 */
export function usePrefixedNavigate() {
    const prefix = usePathPrefix();

    return (path: string) => {
        // Don't prefix absolute external paths or already-prefixed paths
        if (path.startsWith('/dashboard') || path.startsWith('/demo') || path.startsWith('http')) {
            return path;
        }
        // Don't prefix public routes
        if (path === '/' || path.startsWith('/login') || path.startsWith('/docs') ||
            path.startsWith('/pricing') || path.startsWith('/terms') ||
            path.startsWith('/privacy') || path.startsWith('/engineering') ||
            path.startsWith('/invite')) {
            return path;
        }
        return `${prefix}${path}`;
    };
}
