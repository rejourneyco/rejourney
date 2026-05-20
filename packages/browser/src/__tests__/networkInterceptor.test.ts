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

  it('does not ignore non-Rejourney app API traffic on the configured apiUrl host', () => {
    const config = mergeWebConfig('rj_live_test', {
      apiUrl: 'https://app.example.com',
    });

    expect(shouldIgnoreNetworkUrl('https://app.example.com/api/orders', config)).toBe(false);
    expect(shouldIgnoreNetworkUrl('https://app.example.com/api/projects?team=alpha', config)).toBe(false);
    expect(shouldIgnoreNetworkUrl('https://app.example.com/api/sdk/config', config)).toBe(true);
    expect(shouldIgnoreNetworkUrl('https://app.example.com/api/ingest/presign', config)).toBe(true);
  });
});
