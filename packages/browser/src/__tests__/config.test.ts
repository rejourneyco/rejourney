import { describe, expect, it } from 'vitest';
import { applyRemoteConfig, isDomainAllowed, isSampledIn, mergeWebConfig } from '../sdk/config.js';

describe('web config', () => {
  it('merges defaults without touching browser globals', () => {
    const config = mergeWebConfig('rj_live_test', {
      apiUrl: 'http://api.localtest.me/',
      rrweb: { recordCanvas: true },
    });

    expect(config.publicKey).toBe('rj_live_test');
    expect(config.apiUrl).toBe('http://api.localtest.me');
    expect('ingestUrl' in config).toBe(false);
    expect(config.maskAllInputs).toBe(true);
    expect(config.maxSessionDuration).toBe(1_800_000);
    expect(config.idleTimeout).toBe(60_000);
    expect(config.rrweb?.recordCanvas).toBe(true);
    expect(config.rrweb?.captureAssets?.objectURLs).toBe(false);
  });

  it('applies remote recording and duration gates', () => {
    const local = mergeWebConfig('rj_live_test', { captureReplay: true });
    const config = applyRemoteConfig(local, {
      rejourneyEnabled: true,
      recordingEnabled: false,
      maxRecordingMinutes: 3,
      webMaxObservabilityMinutes: 4,
    });

    expect(config.enabled).toBe(true);
    expect(config.captureReplay).toBe(false);
    expect(config.maxSessionDuration).toBe(240_000);
  });

  it('falls back to mobile duration until the API sends the web duration', () => {
    const local = mergeWebConfig('rj_live_test', { captureReplay: true });
    const config = applyRemoteConfig(local, {
      rejourneyEnabled: true,
      recordingEnabled: true,
      maxRecordingMinutes: 3,
    });

    expect(config.maxSessionDuration).toBe(180_000);
  });

  it('accepts a 30 minute remote web session duration', () => {
    const local = mergeWebConfig('rj_live_test', { captureReplay: true });
    const config = applyRemoteConfig(local, {
      rejourneyEnabled: true,
      recordingEnabled: true,
      maxRecordingMinutes: 10,
      webMaxObservabilityMinutes: 30,
    });

    expect(config.maxSessionDuration).toBe(1_800_000);
  });

  it('applies remote web domain allowlists', () => {
    const local = mergeWebConfig('rj_live_test', { allowedDomains: ['local.example.com'] });
    const config = applyRemoteConfig(local, {
      webAllowedDomains: ['https://app.example.com/path', '*.shop.example.com'],
    });

    expect(config.allowedDomains).toEqual(['app.example.com', '*.shop.example.com']);
    expect(isDomainAllowed('app.example.com', config.allowedDomains)).toBe(true);
    expect(isDomainAllowed('checkout.shop.example.com', config.allowedDomains)).toBe(true);
    expect(isDomainAllowed('example.net', config.allowedDomains)).toBe(false);
  });

  it('applies remote secure-only text input masking', () => {
    const local = mergeWebConfig('rj_live_test');
    const config = applyRemoteConfig(local, {
      textInputMasking: 'secure_only',
    });

    expect(config.maskAllInputs).toBe(false);
    expect(config.maskInputOptions?.password).toBe(true);
    expect(config.maskInputOptions?.email).toBe(true);
    expect(config.maskInputOptions?.text).toBe(false);
  });

  it('denies browser domains when no allowlist is configured', () => {
    expect(isDomainAllowed('app.example.com', [])).toBe(false);
  });

  it('samples deterministic edges', () => {
    expect(isSampledIn(100)).toBe(true);
    expect(isSampledIn(0)).toBe(false);
  });
});
