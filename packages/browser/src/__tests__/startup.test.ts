import { describe, expect, it } from 'vitest';
import { collectWebStartupTiming } from '../sdk/startup.js';

describe('web startup timing', () => {
  it('uses PerformanceNavigationTiming loadEventEnd when the page has finished loading', () => {
    const timing = collectWebStartupTiming({
      now: () => 1600,
      getEntriesByType: () => [{
        startTime: 0,
        type: 'reload',
        responseEnd: 400,
        domContentLoadedEventEnd: 900,
        loadEventEnd: 1234.4,
      }],
    });

    expect(timing).toMatchObject({
      durationMs: 1234,
      source: 'navigation_timing',
      milestone: 'loadEventEnd',
      complete: true,
      navigationType: 'reload',
      domContentLoadedMs: 900,
      responseEndMs: 400,
    });
  });

  it('falls back to the best current navigation milestone before load finishes', () => {
    const timing = collectWebStartupTiming({
      now: () => 1100,
      getEntriesByType: () => [{
        startTime: 0,
        type: 'navigate',
        responseEnd: 300,
        domContentLoadedEventEnd: 840,
        loadEventEnd: 0,
      }],
    });

    expect(timing).toMatchObject({
      durationMs: 840,
      milestone: 'domContentLoadedEventEnd',
      complete: false,
    });
  });

  it('uses current high resolution time when no navigation milestones are ready yet', () => {
    const timing = collectWebStartupTiming({
      now: () => 88.8,
      getEntriesByType: () => [{
        startTime: 0,
        type: 'navigate',
        responseEnd: 0,
        domContentLoadedEventEnd: 0,
        loadEventEnd: 0,
      }],
    });

    expect(timing).toMatchObject({
      durationMs: 89,
      milestone: 'now',
      complete: false,
    });
  });

  it('falls back to legacy performance timing when navigation entries are unavailable', () => {
    const timing = collectWebStartupTiming({
      getEntriesByType: () => [],
      timing: {
        navigationStart: 1_000,
        responseEnd: 1_350,
        domContentLoadedEventEnd: 1_800,
        loadEventEnd: 2_210,
      },
    }, 2_500);

    expect(timing).toMatchObject({
      durationMs: 1210,
      source: 'legacy_performance_timing',
      milestone: 'loadEventEnd',
      complete: true,
      domContentLoadedMs: 800,
      responseEndMs: 350,
    });
  });
});
