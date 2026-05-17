export interface LifecycleHandlers {
  onHidden: () => void;
  onVisible: () => void;
  onPageHide: (persisted: boolean) => void;
  onPageShow: (persisted: boolean) => void;
}

let cleanupFns: Array<() => void> = [];

export function initLifecycleTracking(handlers: LifecycleHandlers): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  cleanupLifecycleTracking();

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') handlers.onHidden();
    if (document.visibilityState === 'visible') handlers.onVisible();
  };
  const onPageHide = (event: PageTransitionEvent) => handlers.onPageHide(event.persisted);
  const onPageShow = (event: PageTransitionEvent) => handlers.onPageShow(event.persisted);

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  cleanupFns = [
    () => document.removeEventListener('visibilitychange', onVisibilityChange),
    () => window.removeEventListener('pagehide', onPageHide),
    () => window.removeEventListener('pageshow', onPageShow),
  ];
}

export function cleanupLifecycleTracking(): void {
  cleanupFns.forEach((cleanup) => cleanup());
  cleanupFns = [];
}
