import { describe, expect, it } from 'vitest';
import { getWebNetworkDisplay, getWebSessionEnvironment } from './webSessionEnvironment';

const chromeMacUa =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.114 Safari/537.36';

describe('web session environment labels', () => {
  it('uses user agent and SDK version when legacy rows only say browser/unknown', () => {
    const environment = getWebSessionEnvironment({
      platform: 'web',
      deviceModel: 'browser',
      appVersion: 'Unknown',
      sdkVersion: '0.0.0',
      osVersion: null,
      deviceInfo: {
        os: 'web',
        userAgent: chromeMacUa,
        networkType: 'effective-4g',
      },
    });

    expect(environment.browserLabel).toBe('Chrome 136');
    expect(environment.osLabel).toBe('macOS 15.6.1');
    expect(environment.sdkVersionLabel).toBe('SDK 0.0.0');
    expect(environment.networkLabel).toBe('Fast');
    expect(environment.networkTitle).toContain('not Wi-Fi vs cellular');
  });

  it('does not show VUNKNOWN as a usable version', () => {
    const environment = getWebSessionEnvironment({
      platform: 'web',
      appVersion: 'VUNKNOWN',
      deviceInfo: {
        browser: 'Safari',
        os: 'iOS',
      },
    });

    expect(environment.browserLabel).toBe('Safari');
    expect(environment.osLabel).toBe('iOS');
    expect(environment.sdkVersionLabel).toBeNull();
  });

  it('labels browser effective 4g as speed, not cellular transport', () => {
    expect(getWebNetworkDisplay('4g')).toMatchObject({
      networkLabel: 'Fast',
      rawNetworkType: '4g',
    });
  });
});
