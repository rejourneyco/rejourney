import { describe, expect, it, vi } from 'vitest';

import {
  buildBillingCheckoutReturnUrls,
  launchBillingCheckout,
  parseBillingCheckoutSearchParams,
} from './checkoutFlow';

describe('checkoutFlow', () => {
  it('opens checkout in a centered popup when the browser allows it', () => {
    const focus = vi.fn();
    const popup = { focus } as unknown as Window;
    const openWindow = vi.fn().mockReturnValue(popup);
    const assignLocation = vi.fn();

    const mode = launchBillingCheckout('https://checkout.stripe.com/test', {
      openWindow,
      assignLocation,
      screenWidth: 1440,
      screenHeight: 900,
    });

    expect(mode).toBe('popup');
    expect(openWindow).toHaveBeenCalledWith(
      'https://checkout.stripe.com/test',
      'stripeCheckout',
      expect.stringContaining('width=520'),
    );
    expect(openWindow).toHaveBeenCalledWith(
      'https://checkout.stripe.com/test',
      'stripeCheckout',
      expect.stringContaining('height=760'),
    );
    expect(assignLocation).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it('falls back to same-tab navigation when the popup is blocked', () => {
    const openWindow = vi.fn().mockReturnValue(null);
    const assignLocation = vi.fn();

    const mode = launchBillingCheckout('https://checkout.stripe.com/test', {
      openWindow,
      assignLocation,
      screenWidth: 1280,
      screenHeight: 800,
    });

    expect(mode).toBe('redirect');
    expect(assignLocation).toHaveBeenCalledWith('https://checkout.stripe.com/test');
  });

  it('builds checkout return URLs that land on the shared billing return route', () => {
    const urls = buildBillingCheckoutReturnUrls('https://app.rejourney.test', '/dashboard');

    expect(urls.successUrl).toContain('/dashboard/billing/return');
    expect(urls.successUrl).toContain('flow=checkout');
    expect(urls.successUrl).toContain('status=success');
    expect(urls.successUrl).toContain('session_id={CHECKOUT_SESSION_ID}');
    expect(urls.cancelUrl).toContain('status=canceled');
  });

  it('parses checkout return params and ignores unrelated values', () => {
    const successParams = new URLSearchParams('checkout=success&session_id=cs_test_123');
    expect(parseBillingCheckoutSearchParams(successParams)).toEqual({
      status: 'success',
      sessionId: 'cs_test_123',
    });

    const unrelatedParams = new URLSearchParams('checkout=maybe');
    expect(parseBillingCheckoutSearchParams(unrelatedParams)).toEqual({
      status: null,
      sessionId: null,
    });

    const unresolvedTokenParams = new URLSearchParams('checkout=success&session_id=%7BCHECKOUT_SESSION_ID%7D');
    expect(parseBillingCheckoutSearchParams(unresolvedTokenParams)).toEqual({
      status: 'success',
      sessionId: null,
    });
  });
});
