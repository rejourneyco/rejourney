/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Rejourney Navigation Utilities
 * 
 * Helper functions for extracting human-readable screen names from
 * React Navigation / Expo Router state.
 * 
 * These functions are used internally by the SDK's automatic navigation
 * detection. You don't need to import or use these directly.
 */

/**
 * Normalize a screen name to be human-readable
 * Handles common patterns from React Native / Expo Router
 * 
 * @param raw - Raw screen name to normalize
 * @returns Cleaned, human-readable screen name
 */
export function normalizeScreenName(raw: string): string {
    if (!raw) return 'Unknown';

    let name = raw;

    name = name.replace(/[^\x20-\x7E\s]/g, '');

    name = name.split(/[-_]/).map(word =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');

    const suffixes = ['Screen', 'Page', 'View', 'Controller', 'ViewController', 'VC'];
    for (const suffix of suffixes) {
        if (name.endsWith(suffix) && name.length > suffix.length) {
            name = name.slice(0, -suffix.length).trim();
        }
    }

    const prefixes = ['RNS', 'RCT', 'RN', 'UI'];
    for (const prefix of prefixes) {
        if (name.startsWith(prefix) && name.length > prefix.length + 2) {
            name = name.slice(prefix.length).trim();
        }
    }

    name = name.replace(/\[([a-zA-Z]+)(?:Id)?\]/g, (_, param) => {
        const clean = param.replace(/Id$/i, '');
        if (clean.length < 2) return '';
        return clean.charAt(0).toUpperCase() + clean.slice(1);
    });

    name = name.replace(/\[\]/g, '');

    name = name.replace(/([a-z])([A-Z])/g, '$1 $2');

    name = name.replace(/\s+/g, ' ').trim();

    if (name.length > 0) {
        name = name.charAt(0).toUpperCase() + name.slice(1);
    }

    return name || 'Unknown';
}

/**
 * Get a human-readable screen name from Expo Router path and segments
 * 
 * @param pathname - The current route pathname
 * @param segments - Route segments from useSegments()
 * @returns Human-readable screen name
 */
export function getScreenNameFromPath(pathname: string, segments: string[]): string {
    if (segments.length > 0) {
        const cleanSegments = segments.filter(s => !s.startsWith('(') && !s.endsWith(')'));

        if (cleanSegments.length > 0) {
            const processedSegments = cleanSegments.map(s => {
                if (s.startsWith('[') && s.endsWith(']')) {
                    const param = s.slice(1, -1);
                    if (param === 'id' || param === 'slug') return null;
                    if (param === 'id' || param === 'slug') return null;
                    const clean = param.replace(/Id$/i, '');
                    return clean.charAt(0).toUpperCase() + clean.slice(1);
                }
                return s.charAt(0).toUpperCase() + s.slice(1);
            }).filter(Boolean);

            if (processedSegments.length > 0) {
                return processedSegments.join(' > ');
            }
        }
    }

    if (!pathname || pathname === '/') {
        return 'Home';
    }
    const cleanPath = pathname
        .replace(/^\/(tabs)?/, '')
        .replace(/\([^)]+\)/g, '')
        .replace(/\[([^\]]+)\]/g, (_, param) => {
            if (param === 'id' || param === 'slug') return '';
            const clean = param.replace(/Id$/i, '');
            return clean.charAt(0).toUpperCase() + clean.slice(1);
        })
        .replace(/\/+/g, '/')
        .replace(/^\//, '')
        .replace(/\/$/, '')
        .replace(/\//g, ' > ')
        .trim();

    if (!cleanPath) {
        return 'Home';
    }

    return cleanPath
        .split(' > ')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .filter(s => s.length > 0)
        .join(' > ') || 'Home';
}

/**
 * Get the current route name from a navigation state object
 * 
 * @param state - React Navigation state object
 * @returns Current route name or null
 */
export function getCurrentRouteFromState(state: any): string | null {
    if (!state || !state.routes) return null;

    const route = state.routes[state.index ?? state.routes.length - 1];
    if (!route) return null;

    if (route.state) {
        return getCurrentRouteFromState(route.state);
    }

    return route.name || null;
}
