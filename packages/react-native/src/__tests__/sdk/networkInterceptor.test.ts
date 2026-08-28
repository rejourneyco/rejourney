import { afterEach, describe, expect, it } from 'vitest';
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
