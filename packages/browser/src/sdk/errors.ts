import type { RejourneyEvent, RejourneyWebConfig } from './types.js';

let cleanupFns: Array<() => void> = [];
let longTaskObserver: PerformanceObserver | null = null;

export function initErrorTracking(
  config: RejourneyWebConfig,
  callback: (event: RejourneyEvent) => void,
): void {
  if (typeof window === 'undefined') return;
  cleanupErrorTracking();

  const onError = (event: ErrorEvent) => {
    const target = event.target;
    if (config.trackResourceErrors !== false && target instanceof HTMLElement) {
      const resourceUrl = (target as HTMLImageElement).src || (target as HTMLLinkElement).href || '';
      callback({
        type: 'resource_error',
        timestamp: Date.now(),
        message: `Resource failed to load: ${target.tagName.toLowerCase()}`,
        filename: resourceUrl,
      });
      return;
    }

    callback({
      type: 'error',
      timestamp: Date.now(),
      name: event.error?.name || 'Error',
      message: event.message || event.error?.message || 'Unknown error',
      stack: event.error?.stack,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    callback({
      type: 'error',
      timestamp: Date.now(),
      name: 'UnhandledRejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };

  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  cleanupFns.push(() => window.removeEventListener('error', onError, true));
  cleanupFns.push(() => window.removeEventListener('unhandledrejection', onUnhandledRejection));

  if (config.trackLongTasks !== false && typeof PerformanceObserver !== 'undefined') {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          callback({
            type: 'long_task',
            timestamp: Date.now(),
            durationMs: Math.round(entry.duration),
            threadState: 'main_thread_long_task',
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      longTaskObserver = null;
    }
  }
}

export function cleanupErrorTracking(): void {
  cleanupFns.forEach((cleanup) => cleanup());
  cleanupFns = [];
  longTaskObserver?.disconnect();
  longTaskObserver = null;
}
