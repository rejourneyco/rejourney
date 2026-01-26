/**
 * Error Tracking Module for Rejourney SDK
 * 
 * Handles JS error capture, React Native ErrorUtils, and unhandled promise rejections.
 * Split from autoTracking.ts for better code organization.
 */

import type { ErrorEvent } from '../types';

type OnErrorEventHandler = ((
    event: Event | string,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error
) => boolean | void) | null;

interface PromiseRejectionEvent {
    reason?: any;
    promise?: Promise<any>;
}

const _globalThis = globalThis as typeof globalThis & {
    onerror?: OnErrorEventHandler;
    addEventListener?: (type: string, handler: (event: any) => void) => void;
    removeEventListener?: (type: string, handler: (event: any) => void) => void;
    ErrorUtils?: {
        getGlobalHandler: () => ((error: Error, isFatal: boolean) => void) | undefined;
        setGlobalHandler: (handler: (error: Error, isFatal: boolean) => void) => void;
    };
};

let originalErrorHandler: ((error: Error, isFatal: boolean) => void) | undefined;
let originalOnError: OnErrorEventHandler | null = null;
let originalOnUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null;
let onErrorCallback: ((error: ErrorEvent) => void) | null = null;

let errorCount = 0;

/**
 * Setup error tracking with the given callback
 */
export function setupErrorTracking(
    config: {
        trackJSErrors?: boolean;
        trackPromiseRejections?: boolean;
        trackReactNativeErrors?: boolean;
    },
    onError: (error: ErrorEvent) => void
): void {
    onErrorCallback = onError;
    errorCount = 0;

    if (config.trackReactNativeErrors !== false) {
        setupReactNativeErrorHandler();
    }

    if (config.trackJSErrors !== false && typeof _globalThis !== 'undefined') {
        setupJSErrorHandler();
    }

    if (config.trackPromiseRejections !== false && typeof _globalThis !== 'undefined') {
        setupPromiseRejectionHandler();
    }
}

/**
 * Cleanup error tracking and restore original handlers
 */
export function cleanupErrorTracking(): void {
    if (originalErrorHandler) {
        try {
            const ErrorUtils = _globalThis.ErrorUtils;
            if (ErrorUtils) {
                ErrorUtils.setGlobalHandler(originalErrorHandler);
            }
        } catch {
            // Ignore
        }
        originalErrorHandler = undefined;
    }

    if (originalOnError !== null) {
        _globalThis.onerror = originalOnError;
        originalOnError = null;
    }

    if (originalOnUnhandledRejection && typeof _globalThis.removeEventListener !== 'undefined') {
        _globalThis.removeEventListener!('unhandledrejection', originalOnUnhandledRejection);
        originalOnUnhandledRejection = null;
    }

    onErrorCallback = null;
}

/**
 * Get current error count
 */
export function getErrorCount(): number {
    return errorCount;
}

/**
 * Reset error count
 */
export function resetErrorCount(): void {
    errorCount = 0;
}

/**
 * Manually capture an error
 */
export function captureError(
    message: string,
    stack?: string,
    name?: string
): void {
    trackError({
        type: 'error',
        timestamp: Date.now(),
        message,
        stack,
        name: name || 'Error',
    });
}

/**
 * Track an error internally
 */
function trackError(error: ErrorEvent): void {
    errorCount++;

    if (onErrorCallback) {
        onErrorCallback(error);
    }
}

/**
 * Setup React Native ErrorUtils handler
 */
function setupReactNativeErrorHandler(): void {
    try {
        const ErrorUtils = _globalThis.ErrorUtils;
        if (!ErrorUtils) return;

        originalErrorHandler = ErrorUtils.getGlobalHandler();

        ErrorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
            trackError({
                type: 'error',
                timestamp: Date.now(),
                message: error.message || String(error),
                stack: error.stack,
                name: error.name || 'Error',
            });

            if (originalErrorHandler) {
                originalErrorHandler(error, isFatal);
            }
        });
    } catch {
        // Ignore
    }
}

/**
 * Setup global JS error handler
 */
function setupJSErrorHandler(): void {
    if (typeof _globalThis.onerror !== 'undefined') {
        originalOnError = _globalThis.onerror;

        _globalThis.onerror = (
            message: string | Event,
            source?: string,
            lineno?: number,
            colno?: number,
            error?: Error
        ) => {
            trackError({
                type: 'error',
                timestamp: Date.now(),
                message: typeof message === 'string' ? message : 'Unknown error',
                stack: error?.stack || `${source}:${lineno}:${colno}`,
                name: error?.name || 'Error',
            });

            if (originalOnError) {
                return originalOnError(message, source, lineno, colno, error);
            }
            return false;
        };
    }
}

/**
 * Setup unhandled promise rejection handler
 */
function setupPromiseRejectionHandler(): void {
    if (typeof _globalThis.addEventListener !== 'undefined') {
        const handler = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            trackError({
                type: 'error',
                timestamp: Date.now(),
                message: reason?.message || String(reason) || 'Unhandled Promise Rejection',
                stack: reason?.stack,
                name: reason?.name || 'UnhandledRejection',
            });
        };

        originalOnUnhandledRejection = handler;
        _globalThis.addEventListener!('unhandledrejection', handler);
    }
}
