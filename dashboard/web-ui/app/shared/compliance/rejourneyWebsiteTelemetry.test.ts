import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  init: vi.fn(), start: vi.fn(async () => false), stop: vi.fn(),
  setConsent: vi.fn(), clearUserIdentity: vi.fn(), setMetadata: vi.fn(), setUserIdentity: vi.fn(),
}));
const load = vi.hoisted(() => vi.fn());
vi.mock('@rejourneyco/browser', () => { load(); return { Rejourney: sdk }; });
const params = { pathname: '/', search: '', userId: null, currentTeam: null, teams: [], source: 'banner_accept' as const };
describe('lazy website recording SDK', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage, innerWidth: 1280, innerHeight: 720 });
    vi.stubGlobal('navigator', { language: 'en', maxTouchPoints: 0 });
    vi.stubGlobal('document', { referrer: '' });
    sdk.init.mockResolvedValue(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('does not load the SDK just to check or reject consent', async () => {
    const telemetry = await import('./rejourneyWebsiteTelemetry');
    telemetry.readStoredRejourneyConsent();
    telemetry.disableRejourneyWebsiteTelemetry();
    expect(load).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
  });
  it('loads only on consented startup and excludes advertising click IDs', async () => {
    const telemetry = await import('./rejourneyWebsiteTelemetry');
    await telemetry.startRejourneyWebsiteTelemetry(params);
    expect(load).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ attribution: { preserveClickIds: false } }));
    expect(sdk.start).toHaveBeenCalledTimes(1);
  });
  it('does not start recording if consent is revoked during initialization', async () => {
    let resolveInit!: (value: boolean) => void;
    sdk.init.mockReturnValue(new Promise<boolean>((resolve) => { resolveInit = resolve; }));
    const telemetry = await import('./rejourneyWebsiteTelemetry');
    const starting = telemetry.startRejourneyWebsiteTelemetry(params);
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    telemetry.writeStoredRejourneyConsent('rejected');
    telemetry.disableRejourneyWebsiteTelemetry();
    resolveInit(true);
    await expect(starting).resolves.toBe(false);
    expect(sdk.start).not.toHaveBeenCalled();
  });
});
