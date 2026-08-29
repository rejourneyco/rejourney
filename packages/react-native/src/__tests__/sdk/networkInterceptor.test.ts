import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disableNetworkInterceptor,
  getNetworkInterceptorStats,
  initNetworkInterceptor,
  registerInternalNetworkUrl,
  restoreNetworkInterceptor,
  shouldIgnoreNetworkUrl,
} from '../../sdk/networkInterceptor';

describe('networkInterceptor lifecycle', () => {
  afterEach(() => {
    restoreNetworkInterceptor();
  });

  it('re-enables interception when init is called after disable', () => {
    initNetworkInterceptor(() => {});
    expect(getNetworkInterceptorStats().enabled).toBe(true);

    disableNetworkInterceptor();
    expect(getNetworkInterceptorStats().enabled).toBe(false);

    initNetworkInterceptor(() => {});
    expect(getNetworkInterceptorStats().enabled).toBe(true);
  });

  it('fully disables interception when restored', () => {
    initNetworkInterceptor(() => {});
    restoreNetworkInterceptor();

    expect(getNetworkInterceptorStats().enabled).toBe(false);
  });

  it('flushes the final pending batch before restoring globals', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 }) as typeof fetch;
    const callback = vi.fn();

    try {
      initNetworkInterceptor(callback);
      await globalThis.fetch('https://app.example.com/final-request');
      expect(callback).not.toHaveBeenCalled();

      restoreNetworkInterceptor();
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      restoreNetworkInterceptor();
      globalThis.fetch = originalFetch;
    }
  });

  it('drops an in-flight completion that arrives while interception is paused', async () => {
    const originalFetch = globalThis.fetch;
    let resolveTransport!: (response: { ok: boolean; status: number }) => void;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => {
      resolveTransport = resolve;
    })) as typeof fetch;
    const callback = vi.fn();

    try {
      initNetworkInterceptor(callback);
      const request = globalThis.fetch('https://app.example.com/finishes-during-pause');

      restoreNetworkInterceptor();
      resolveTransport({ ok: true, status: 204 });
      await request;

      expect(callback).not.toHaveBeenCalled();
      expect(getNetworkInterceptorStats().pendingCount).toBe(0);
    } finally {
      restoreNetworkInterceptor();
      globalThis.fetch = originalFetch;
    }
  });

  it('does not attach a pre-pause request to a resumed capture interval', async () => {
    const originalFetch = globalThis.fetch;
    let resolveTransport!: (response: { ok: boolean; status: number }) => void;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => {
      resolveTransport = resolve;
    })) as typeof fetch;
    const firstCallback = vi.fn();
    const resumedCallback = vi.fn();

    try {
      initNetworkInterceptor(firstCallback);
      const request = globalThis.fetch('https://app.example.com/spans-pause');

      restoreNetworkInterceptor();
      initNetworkInterceptor(resumedCallback);
      resolveTransport({ ok: true, status: 204 });
      await request;
      restoreNetworkInterceptor();

      expect(firstCallback).not.toHaveBeenCalled();
      expect(resumedCallback).not.toHaveBeenCalled();
    } finally {
      restoreNetworkInterceptor();
      globalThis.fetch = originalFetch;
    }
  });

  it('does not overwrite a fetch wrapper installed after Rejourney', async () => {
    const originalFetch = globalThis.fetch;
    const transport = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = transport as typeof fetch;
    const firstCallback = vi.fn();
    let rejourneyFetch: typeof fetch | null = null;

    try {
      initNetworkInterceptor(firstCallback);
      rejourneyFetch = globalThis.fetch;
      const hostWrapper = vi.fn((...args: Parameters<typeof fetch>) => rejourneyFetch!(...args));
      globalThis.fetch = hostWrapper as typeof fetch;

      restoreNetworkInterceptor();
      expect(globalThis.fetch).toBe(hostWrapper);

      await globalThis.fetch('https://app.example.com/while-paused');
      expect(firstCallback).not.toHaveBeenCalled();

      const resumedCallback = vi.fn();
      initNetworkInterceptor(resumedCallback);
      await globalThis.fetch('https://app.example.com/after-resume');
      restoreNetworkInterceptor();
      expect(resumedCallback).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toBe(hostWrapper);
    } finally {
      // Temporarily restore ownership so the module can remove its wrapper and
      // leave no cross-test interceptor state behind.
      if (rejourneyFetch) globalThis.fetch = rejourneyFetch;
      restoreNetworkInterceptor();
      globalThis.fetch = originalFetch;
    }
  });

  it('reattaches after a later fetch owner restores the original transport', async () => {
    const originalFetch = globalThis.fetch;
    const transport = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = transport as typeof fetch;
    let rejourneyFetch: typeof fetch | null = null;

    try {
      initNetworkInterceptor(() => {});
      rejourneyFetch = globalThis.fetch;

      const hostWrapper = vi.fn((...args: Parameters<typeof fetch>) => rejourneyFetch!(...args));
      globalThis.fetch = hostWrapper as typeof fetch;
      restoreNetworkInterceptor();
      expect(globalThis.fetch).toBe(hostWrapper);

      // Simulate the later-installed owner disposing after Rejourney paused.
      globalThis.fetch = transport as typeof fetch;

      const resumedCallback = vi.fn();
      initNetworkInterceptor(resumedCallback);
      expect(globalThis.fetch).toBe(rejourneyFetch);
      await globalThis.fetch('https://app.example.com/after-owner-disposal');
      restoreNetworkInterceptor();

      expect(resumedCallback).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toBe(transport);
    } finally {
      if (rejourneyFetch) globalThis.fetch = rejourneyFetch;
      restoreNetworkInterceptor();
      globalThis.fetch = originalFetch;
    }
  });

  it('restores and reinstalls independently owned XHR hooks', () => {
    const originalXHR = globalThis.XMLHttpRequest;
    const transportOpen = vi.fn();
    const transportSend = vi.fn();
    const FakeXHR = function () {} as unknown as typeof XMLHttpRequest;
    FakeXHR.prototype.open = transportOpen as typeof XMLHttpRequest.prototype.open;
    FakeXHR.prototype.send = transportSend as typeof XMLHttpRequest.prototype.send;
    globalThis.XMLHttpRequest = FakeXHR;
    let rejourneyOpen: typeof XMLHttpRequest.prototype.open | null = null;

    try {
      initNetworkInterceptor(() => {});
      rejourneyOpen = XMLHttpRequest.prototype.open;
      const hostOpen = vi.fn();
      XMLHttpRequest.prototype.open = hostOpen as typeof XMLHttpRequest.prototype.open;

      restoreNetworkInterceptor();
      expect(XMLHttpRequest.prototype.open).toBe(hostOpen);
      expect(XMLHttpRequest.prototype.send).toBe(transportSend);

      initNetworkInterceptor(() => {});
      expect(XMLHttpRequest.prototype.open).toBe(hostOpen);
      expect(XMLHttpRequest.prototype.send).not.toBe(transportSend);
    } finally {
      // Return ownership of the retained open wrapper so module state can be
      // fully reset without overwriting the later host wrapper during the test.
      if (rejourneyOpen) XMLHttpRequest.prototype.open = rejourneyOpen;
      restoreNetworkInterceptor();
      globalThis.XMLHttpRequest = originalXHR;
    }
  });

  it('bounds per-endpoint sampling state for dynamic routes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as typeof fetch;

    try {
      initNetworkInterceptor(() => {});
      await Promise.all(
        Array.from({ length: 1_050 }, (_, index) =>
          globalThis.fetch(`https://app.example.com/items/${index}`)
        )
      );

      expect(getNetworkInterceptorStats().endpointCount).toBe(1_000);
    } finally {
      restoreNetworkInterceptor();
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves Request methods, uses monotonic durations, and assigns unique ids', async () => {
    const originalFetch = globalThis.fetch;
    const transport = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = transport as typeof fetch;
    const callback = vi.fn();
    const performanceSpy = vi.spyOn(globalThis.performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(225);

    try {
      initNetworkInterceptor(callback);
      await globalThis.fetch({
        url: 'https://app.example.com/method-one',
        method: 'PATCH',
      } as Request);
      await globalThis.fetch({
        url: 'https://app.example.com/method-two',
        method: 'DELETE',
      } as Request);
      restoreNetworkInterceptor();

      const events = callback.mock.calls.map(([event]) => event);
      expect(events.map((event) => event.method)).toEqual(['PATCH', 'DELETE']);
      expect(events.map((event) => event.duration)).toEqual([25, 25]);
      expect(new Set(events.map((event) => event.requestId)).size).toBe(2);
    } finally {
      performanceSpy.mockRestore();
      restoreNetworkInterceptor();
      globalThis.fetch = originalFetch;
    }
  });

  it('ignores Rejourney ingest and upload relay URLs across hosts', () => {
    expect(shouldIgnoreNetworkUrl('https://api.rejourney.co/api/sdk/config')).toBe(true);
    expect(shouldIgnoreNetworkUrl('https://api.rejourney.co/api/ingest/presign')).toBe(true);
    expect(shouldIgnoreNetworkUrl('https://ingest.example.com/upload/artifacts/artifact_123?token=secret')).toBe(true);
    expect(shouldIgnoreNetworkUrl('/upload/artifacts/artifact_123?token=secret')).toBe(true);
  });

  it('keeps app API traffic visible unless a custom ignore rule matches', () => {
    expect(shouldIgnoreNetworkUrl('https://app.example.com/api/orders')).toBe(false);
    expect(shouldIgnoreNetworkUrl('https://app.example.com/api/ingestor')).toBe(false);

    expect(shouldIgnoreNetworkUrl('https://app.example.com/api/health', {
      ignoreUrls: ['/api/health'],
    })).toBe(true);

    expect(shouldIgnoreNetworkUrl('https://selfhosted.example.com/rejourney/api/custom', {
      ignoreUrls: ['https://selfhosted.example.com/rejourney'],
    })).toBe(true);

    expect(shouldIgnoreNetworkUrl('https://analytics.example.com/v1/events', {
      ignoreUrls: [/analytics\.example\.com/],
    })).toBe(true);
  });

  it('ignores Rejourney routes under a self-hosted API base path only', () => {
    const options = { apiUrl: 'https://example.com/rejourney/' };

    expect(shouldIgnoreNetworkUrl('https://example.com/rejourney/api/sdk/config', options)).toBe(true);
    expect(shouldIgnoreNetworkUrl('https://example.com/rejourney/api/ingest/presign', options)).toBe(true);
    expect(shouldIgnoreNetworkUrl('https://example.com/rejourney/upload/artifacts/artifact_123', options)).toBe(true);
    expect(shouldIgnoreNetworkUrl('https://example.com/rejourney/api/orders', options)).toBe(false);
    expect(shouldIgnoreNetworkUrl('https://example.com/rejourneyish/api/ingest/presign', options)).toBe(false);
  });

  it('ignores dynamically registered presigned upload URLs', () => {
    const uploadUrl = 'https://s3.example.com/rejourney-bucket/session/events.gz?X-Amz-Signature=abc';

    expect(shouldIgnoreNetworkUrl(uploadUrl)).toBe(false);
    registerInternalNetworkUrl(uploadUrl);
    expect(shouldIgnoreNetworkUrl(uploadUrl)).toBe(true);
  });
});
