import { afterEach, describe, expect, it } from 'vitest';
import {
  disableNetworkInterceptor,
  getNetworkInterceptorStats,
  initNetworkInterceptor,
  restoreNetworkInterceptor,
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
});
