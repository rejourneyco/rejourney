import { describe, expect, it } from 'vitest';
import { mergeWebConfig } from '../sdk/config.js';
import { shouldIgnoreNetworkUrl } from '../sdk/networkInterceptor.js';

describe('web network interceptor ignores Rejourney internals', () => {
  it('ignores ingest routes and upload relay URLs across hosts', () => {
    const config = mergeWebConfig('rj_live_test', {
      apiUrl: 'http://127.0.0.1:3000',
    });

    expect(shouldIgnoreNetworkUrl('http://127.0.0.1:3000/api/ingest/presign', config)).toBe(true);
    expect(shouldIgnoreNetworkUrl('http://192.168.4.33:3001/upload/artifacts/artifact_123?token=secret', config)).toBe(true);
    expect(shouldIgnoreNetworkUrl('/upload/artifacts/artifact_123?token=secret', config)).toBe(true);
  });

  it('keeps app traffic visible unless a custom ignore rule matches it', () => {
    const config = mergeWebConfig('rj_live_test', {
      apiUrl: 'http://127.0.0.1:3000',
      networkIgnoreUrls: [/\/healthz$/],
    });

    expect(shouldIgnoreNetworkUrl('http://app.example.com/api/orders', config)).toBe(false);
    expect(shouldIgnoreNetworkUrl('http://app.example.com/healthz', config)).toBe(true);
  });
});
