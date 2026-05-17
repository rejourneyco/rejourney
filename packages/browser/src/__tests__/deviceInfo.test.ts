import { describe, expect, it } from 'vitest';
import { SDK_VERSION } from '../sdk/constants.js';
import { collectWebDeviceInfo, collectWebDeviceInfoWithHints, detectBrowserInfo, detectOsInfo } from '../sdk/deviceInfo.js';

const chromeMacUa =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.114 Safari/537.36';

describe('web device info', () => {
  it('extracts browser, OS, SDK version, and browser effective network hints', () => {
    const info = collectWebDeviceInfo('visitor_123', {
      userAgent: chromeMacUa,
      language: 'en-US',
      connection: { effectiveType: '4g', saveData: false },
    } as unknown as Navigator);

    expect(info.browser).toBe('Chrome');
    expect(info.browserVersion).toBe('136.0.7103.114');
    expect(info.os).toBe('macOS');
    expect(info.osVersion).toBe('15.6.1');
    expect(info.model).toBe('Chrome on macOS');
    expect(info.appVersion).toBe(SDK_VERSION);
    expect(info.sdkVersion).toBe(SDK_VERSION);
    expect(info.networkType).toBe('effective-4g');
    expect(info.effectiveConnectionType).toBe('4g');
  });

  it('detects mobile Safari and iOS from the user agent', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

    expect(detectBrowserInfo(ua)).toEqual({ name: 'Safari', version: '18.1' });
    expect(detectOsInfo(ua)).toEqual({ name: 'iOS', version: '18.1' });
  });

  it('prefers high entropy client hints for modern macOS versions hidden by reduced UA', async () => {
    const info = await collectWebDeviceInfoWithHints('visitor_123', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.0.0 Safari/537.36',
      language: 'en-US',
      userAgentData: {
        platform: 'macOS',
        brands: [
          { brand: 'Chromium', version: '148' },
          { brand: 'Google Chrome', version: '148' },
        ],
        getHighEntropyValues: async () => ({
          platform: 'macOS',
          platformVersion: '26.3.1',
          fullVersionList: [
            { brand: 'Chromium', version: '148.0.7778.168' },
            { brand: 'Google Chrome', version: '148.0.7778.168' },
          ],
        }),
      },
    } as unknown as Navigator);

    expect(info.browser).toBe('Chrome');
    expect(info.browserVersion).toBe('148.0.7778.168');
    expect(info.os).toBe('macOS');
    expect(info.osVersion).toBe('26.3.1');
    expect(info.model).toBe('Chrome on macOS');
  });
});
