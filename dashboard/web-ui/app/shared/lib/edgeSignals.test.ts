import { afterEach, describe, expect, it, vi } from 'vitest';

import { trackAccountActivationSignal } from './edgeSignals';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function setTestWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
  });
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
      setTimeout,
      zaraz: { track: vi.fn().mockResolvedValue(undefined) },
    });

    await trackAccountActivationSignal('otp');

    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: 'AW-18175283670/Rt-7COH-3cccENaj09pD',
    });
  });

  it('sends the Reddit signup conversion when the pixel is bootstrapped', async () => {
    const rdt = vi.fn();
    setTestWindow({
      ENV: {},
      rdt,
      setTimeout,
      zaraz: { track: vi.fn().mockResolvedValue(undefined) },
    });

    await trackAccountActivationSignal('github');

    expect(rdt).toHaveBeenCalledWith('track', 'SignUp');
  });

  it('falls back to a dashboard page view for URL-based Google Ads conversion actions', async () => {
    const gtag = vi.fn();
    setTestWindow({
      ENV: {
        VITE_GOOGLE_ADS_CONVERSION_ID: 'AW-18175283670',
      },
      gtag,
      location: { origin: 'https://rejourney.co' },
      setTimeout,
      zaraz: { track: vi.fn().mockResolvedValue(undefined) },
    });

    await trackAccountActivationSignal('github');

    expect(gtag).toHaveBeenCalledWith('config', 'AW-18175283670', {
      page_location: 'https://rejourney.co/dashboard/',
      page_path: '/dashboard/',
      page_title: 'Rejourney Dashboard',
    });
  });
});
