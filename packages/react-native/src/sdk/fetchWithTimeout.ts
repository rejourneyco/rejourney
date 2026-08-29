/**
 * Remote configuration is a startup control-plane request. One second proved
 * too short for a cold React Native request even when the production endpoint
 * itself was healthy. Three seconds remains far below the native networking
 * defaults while avoiding fail-open startup on ordinary mobile latency.
 */
export const REMOTE_CONFIG_TIMEOUT_MS = 3000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type TimedFetchOptions = {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  createAbortController?: () => AbortController | null;
};

export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  options: TimedFetchOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? REMOTE_CONFIG_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const createAbortController = options.createAbortController
    ?? (() => typeof AbortController === 'undefined' ? null : new AbortController());
  const controller = createAbortController();

  if (!controller) {
    return fetchImpl(input, init);
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
