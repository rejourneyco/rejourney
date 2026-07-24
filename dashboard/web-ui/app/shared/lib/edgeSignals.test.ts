import { afterEach, describe, expect, it, vi } from 'vitest';

import { trackAccountActivationSignal } from './edgeSignals';
import { GOOGLE_ADS_CONSENT_STORAGE_KEY } from './googleAdsConsent';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function setTestWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
  });
}

function acceptedGoogleAdsStorage() {
  return {
    getItem: (key: string) => key === GOOGLE_ADS_CONSENT_STORAGE_KEY ? 'accepted' : null,
  };
}

function restoreWindow() {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    return;
  }

  delete (globalThis as { window?: unknown }).window;
}

describe('edge signals', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreWindow();
  });

  it('sends account activation through Zaraz when the tracker is ready', async () => {
    const track = vi.fn().mockResolvedValue(undefined);
    setTestWindow({
      ENV: {},
      setTimeout,
      zaraz: { track },
    });

    await trackAccountActivationSignal('otp');

    expect(track).toHaveBeenCalledWith('account_activated', { method: 'otp' });
  });

  it('waits briefly for Zaraz to initialize before giving up', async () => {
    vi.useFakeTimers();
    const track = vi.fn().mockResolvedValue(undefined);
    const testWindow = {
      ENV: {},
      setTimeout,
      zaraz: {},
    };
    setTestWindow(testWindow);

    const signal = trackAccountActivationSignal('github');
    await vi.advanceTimersByTimeAsync(100);
    testWindow.zaraz = { track };
    await vi.advanceTimersByTimeAsync(50);
    await signal;

    expect(track).toHaveBeenCalledWith('account_activated', { method: 'github' });
  });

  it('does not fail login when Zaraz never becomes available', async () => {
    vi.useFakeTimers();
    setTestWindow({
      ENV: {},
      setTimeout,
      zaraz: {},
    });

    const signal = trackAccountActivationSignal('otp');
    await vi.advanceTimersByTimeAsync(3500);

    await expect(signal).resolves.toBeUndefined();
  });

  it('sends the Google Ads signup conversion when the conversion label is configured', async () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: '18175283670',
        VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: 'Rt-7COH-3cccENaj09pD',
      },
      gtag,
      localStorage: acceptedGoogleAdsStorage(),
      setTimeout,
      zaraz: { track: vi.fn().mockResolvedValue(undefined) },
    });

    await trackAccountActivationSignal('otp', {
      userId: 'user-123',
      email: ' Person@Example.com ',
    });

    expect(gtag).toHaveBeenCalledWith('set', 'user_data', {
      email: 'person@example.com',
    });
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: 'AW-18175283670/Rt-7COH-3cccENaj09pD',
      transaction_id: 'signup_completed:user-123',
    });
  });

  it('sends the Google Ads signup conversion only once per page lifecycle', async () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: 'AW-18175283670',
        VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: 'Rt-7COH-3cccENaj09pD',
      },
      gtag,
      localStorage: acceptedGoogleAdsStorage(),
      setTimeout,
      zaraz: { track: vi.fn().mockResolvedValue(undefined) },
    });

    await Promise.all([
      trackAccountActivationSignal('otp'),
      trackAccountActivationSignal('otp'),
    ]);

    expect(gtag).toHaveBeenCalledTimes(1);
  });

  it('does not send a Google Ads conversion when the conversion label is missing', async () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: 'AW-18175283670',
      },
      gtag,
      localStorage: acceptedGoogleAdsStorage(),
      setTimeout,
      zaraz: { track: vi.fn().mockResolvedValue(undefined) },
    });

    await trackAccountActivationSignal('github');

    expect(gtag).not.toHaveBeenCalled();
  });

  it('sends Google Ads conversion without waiting for the telemetry prompt during testing', async () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: 'AW-18175283670',
        VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: 'Rt-7COH-3cccENaj09pD',
      },
      gtag,
      localStorage: { getItem: () => null },
      setTimeout,
      zaraz: { track: vi.fn().mockResolvedValue(undefined) },
    });

    await trackAccountActivationSignal('otp', {
      userId: 'user-123',
      email: 'person@example.com',
    });

    expect(gtag).toHaveBeenCalledWith('set', 'user_data', {
      email: 'person@example.com',
    });
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: 'AW-18175283670/Rt-7COH-3cccENaj09pD',
      transaction_id: 'signup_completed:user-123',
    });
  });

  it('does not fail account activation when gtag is unavailable', async () => {
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: 'AW-18175283670',
        VITE_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL: 'Rt-7COH-3cccENaj09pD',
      },
      setTimeout,
      zaraz: { track: vi.fn().mockResolvedValue(undefined) },
    });

    await expect(trackAccountActivationSignal('github')).resolves.toBeUndefined();
  });
});
