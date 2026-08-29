import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, REMOTE_CONFIG_TIMEOUT_MS } from '../../sdk/fetchWithTimeout';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows a valid cold mobile response beyond the old one-second cutoff', async () => {
    vi.useFakeTimers();
    const response = { ok: true, status: 200 } as Response;
    const fetchImpl = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const responseTimer = setTimeout(() => resolve(response), 1500);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(responseTimer);
        reject(new Error('aborted'));
      }, { once: true });
    }));

    const request = fetchWithTimeout('https://api.rejourney.co/api/sdk/config', {}, { fetchImpl });
    await vi.advanceTimersByTimeAsync(1500);

    await expect(request).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a hung request at the bounded control-plane deadline', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      capturedSignal = init?.signal ?? undefined;
      capturedSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    const request = fetchWithTimeout('https://api.rejourney.co/api/sdk/config', {}, { fetchImpl });
    const rejection = expect(request).rejects.toThrow('aborted');

    await vi.advanceTimersByTimeAsync(REMOTE_CONFIG_TIMEOUT_MS - 1);
    expect(capturedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses fetch without a signal when AbortController is unavailable', async () => {
    const response = { ok: true, status: 200 } as Response;
    const fetchImpl = vi.fn(async () => response);

    await expect(fetchWithTimeout('https://api.rejourney.co/api/sdk/config', { method: 'GET' }, {
      fetchImpl,
      createAbortController: () => null,
    })).resolves.toBe(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.rejourney.co/api/sdk/config',
      { method: 'GET' }
    );
  });
});
