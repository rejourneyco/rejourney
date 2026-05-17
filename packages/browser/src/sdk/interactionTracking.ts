import type { RejourneyEvent } from './types.js';

let cleanupFns: Array<() => void> = [];
let lastScrollAt = 0;
const recentClicks: Array<{ x: number; y: number; timestamp: number }> = [];

export function initInteractionTracking(
  getScreen: () => string | null,
  callback: (event: RejourneyEvent) => void,
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  cleanupInteractionTracking();

  const onClick = (event: MouseEvent) => {
    const timestamp = Date.now();
    const x = event.clientX;
    const y = event.clientY;
    const screenName = getScreen() || undefined;

    callback({
      type: 'tap',
      timestamp,
      x,
      y,
      screen: screenName,
      screenName,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });

    while (recentClicks.length > 0 && timestamp - recentClicks[0]!.timestamp > 500) {
      recentClicks.shift();
    }
    const nearbyClicks = recentClicks.filter((click) => Math.abs(click.x - x) < 50 && Math.abs(click.y - y) < 50);
    recentClicks.push({ x, y, timestamp });

    if (nearbyClicks.length >= 2) {
      callback({
        type: 'rage_tap',
        timestamp,
        x,
        y,
        screen: screenName,
        screenName,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      });
    }
  };

  const onScroll = () => {
    const timestamp = Date.now();
    if (timestamp - lastScrollAt < 500) return;
    lastScrollAt = timestamp;
    callback({
      type: 'scroll',
      timestamp,
      screen: getScreen() || undefined,
      screenName: getScreen() || undefined,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });
  };

  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanupFns = [
    () => document.removeEventListener('click', onClick, true),
    () => window.removeEventListener('scroll', onScroll),
  ];
}

export function cleanupInteractionTracking(): void {
  cleanupFns.forEach((cleanup) => cleanup());
  cleanupFns = [];
  lastScrollAt = 0;
  recentClicks.splice(0, recentClicks.length);
}
