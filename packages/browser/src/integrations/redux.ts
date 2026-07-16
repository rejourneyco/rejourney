import { Rejourney } from '../sdk/client.js';
import type { RejourneyAPI } from '../sdk/types.js';

export type ReduxStateCapture = 'before-and-after' | 'after' | 'none';

export interface ReduxActionLike {
  type: string;
  [key: string]: unknown;
}

export interface ReduxMiddlewareApi<State> {
  getState: () => State;
  dispatch: (action: any) => any;
}

export type ReduxMiddleware<State = any> = (
  api: ReduxMiddlewareApi<State>,
) => (next: (action: unknown) => unknown) => (action: unknown) => unknown;

export interface RejourneyReduxOptions<State = unknown, Action extends ReduxActionLike = ReduxActionLike> {
  /** Rejourney client to receive transitions. Defaults to the package singleton. */
  client?: Pick<RejourneyAPI, 'logEvent'>;
  /** Which Redux state snapshots to attach to each action. Defaults to both. */
  captureState?: ReduxStateCapture;
  /** Return false to skip an action. Called after the reducer has run. */
  predicate?: (action: Action, previousState: State, nextState: State) => boolean;
  /** Applied before the bounded serializer and default key redaction. */
  actionSanitizer?: (action: Action) => unknown;
  /** Applied independently to the previous and next state snapshots. */
  stateSanitizer?: (state: State) => unknown;
  /** Additional sensitive property names or patterns to redact. */
  redactKeys?: Array<string | RegExp>;
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
  /** Maximum serialized properties size. Defaults to 64 KiB. */
  maxEventBytes?: number;
  /** Observes capture failures without allowing them to break dispatch. */
  onError?: (error: unknown) => void;
}

const DEFAULT_REDACT_KEYS: Array<string | RegExp> = [
  /password/i,
  /passwd/i,
  /token/i,
  /secret/i,
  /authorization/i,
  /cookie/i,
  /credit.?card/i,
  /card.?number/i,
  /(?:^|[_-])cv[cv](?:$|[_-])/i,
  /(?:^|[_-])ssn(?:$|[_-])/i,
];

const REDACTED_VALUE = '[Redacted]';
const OMITTED_VALUE = '[Omitted: Redux event exceeded size limit]';

interface SerializationLimits {
  maxDepth: number;
  maxArrayLength: number;
  maxObjectKeys: number;
  maxStringLength: number;
  redactKeys: Array<string | RegExp>;
}

function matchesRedactedKey(key: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') return key.toLowerCase() === pattern.toLowerCase();
    pattern.lastIndex = 0;
    return pattern.test(key);
  });
}

function boundedSerialize(value: unknown, limits: SerializationLimits): unknown {
  const ancestors = new WeakSet<object>();

  const visit = (current: unknown, depth: number, key?: string): unknown => {
    if (key && matchesRedactedKey(key, limits.redactKeys)) return REDACTED_VALUE;
    if (current === null || typeof current === 'boolean' || typeof current === 'number') return current;
    if (typeof current === 'string') {
      return current.length > limits.maxStringLength
        ? `${current.slice(0, limits.maxStringLength)}…[Truncated]`
        : current;
    }
    if (typeof current === 'bigint') return `${current.toString()}n`;
    if (typeof current === 'undefined') return '[Undefined]';
    if (typeof current === 'symbol') return `[Symbol: ${current.description || ''}]`;
    if (typeof current === 'function') return `[Function: ${current.name || 'anonymous'}]`;
    if (typeof current !== 'object') return String(current);
    if (ancestors.has(current)) return '[Circular]';
    if (depth >= limits.maxDepth) return '[Max depth reached]';

    if (current instanceof Date) return Number.isNaN(current.getTime()) ? 'Invalid Date' : current.toISOString();
    if (current instanceof Error) {
      return {
        name: current.name,
        message: visit(current.message, depth + 1),
        stack: visit(current.stack, depth + 1),
      };
    }

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const items = current.slice(0, limits.maxArrayLength).map((item) => visit(item, depth + 1));
        if (current.length > limits.maxArrayLength) {
          items.push(`[${current.length - limits.maxArrayLength} more items]`);
        }
        return items;
      }

      if (current instanceof Map) {
        return visit(Object.fromEntries(Array.from(current.entries()).slice(0, limits.maxObjectKeys)), depth + 1);
      }
      if (current instanceof Set) {
        return visit(Array.from(current.values()), depth + 1);
      }

      const output: Record<string, unknown> = {};
      const entries = Object.entries(current).slice(0, limits.maxObjectKeys);
      for (const [childKey, childValue] of entries) {
        output[childKey] = visit(childValue, depth + 1, childKey);
      }
      const totalKeys = Object.keys(current).length;
      if (totalKeys > limits.maxObjectKeys) {
        output.__rejourney_truncated__ = `${totalKeys - limits.maxObjectKeys} more properties`;
      }
      return output;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value, 0);
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function fitToEventLimit(properties: Record<string, unknown>, maxEventBytes: number): Record<string, unknown> {
  if (serializedByteLength(properties) <= maxEventBytes) return properties;

  const compact: Record<string, unknown> = { ...properties, truncated: true };
  for (const key of ['previousState', 'action', 'nextState'] as const) {
    if (!(key in compact)) continue;
    compact[key] = OMITTED_VALUE;
    if (serializedByteLength(compact) <= maxEventBytes) return compact;
  }

  return {
    source: 'redux',
    actionType: String(properties.actionType || 'unknown').slice(0, 256),
    sequence: properties.sequence,
    durationMs: properties.durationMs,
    truncated: true,
    detail: OMITTED_VALUE,
  };
}

function isReduxAction(value: unknown): value is ReduxActionLike {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string');
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Captures Redux/Redux Toolkit action and state transitions as replay timeline
 * events. The middleware is dependency-free and structurally compatible with
 * Redux 4/5 and Redux Toolkit 1/2.
 */
export function createRejourneyReduxMiddleware<
  State = any,
  Action extends ReduxActionLike = ReduxActionLike,
>(options: RejourneyReduxOptions<State, Action> = {}): ReduxMiddleware<State> {
  const client = options.client ?? Rejourney;
  const captureState = options.captureState ?? 'before-and-after';
  const limits: SerializationLimits = {
    maxDepth: Math.max(1, options.maxDepth ?? 10),
    maxArrayLength: Math.max(1, options.maxArrayLength ?? 100),
    maxObjectKeys: Math.max(1, options.maxObjectKeys ?? 100),
    maxStringLength: Math.max(16, options.maxStringLength ?? 2_000),
    redactKeys: [...DEFAULT_REDACT_KEYS, ...(options.redactKeys ?? [])],
  };
  const maxEventBytes = Math.max(1_024, options.maxEventBytes ?? 64 * 1_024);
  let sequence = 0;

  return (api) => (next) => (action) => {
    const previousState = api.getState();
    const startedAt = now();
    const result = next(action);
    const durationMs = Math.max(0, now() - startedAt);

    if (!isReduxAction(action)) return result;

    try {
      const nextState = api.getState();
      const typedAction = action as Action;
      if (options.predicate && !options.predicate(typedAction, previousState, nextState)) return result;

      const sanitizedAction = options.actionSanitizer ? options.actionSanitizer(typedAction) : typedAction;
      const properties: Record<string, unknown> = {
        source: 'redux',
        actionType: typedAction.type,
        action: boundedSerialize(sanitizedAction, limits),
        sequence: sequence++,
        durationMs: Math.round(durationMs * 1_000) / 1_000,
      };

      if (captureState === 'before-and-after') {
        const state = options.stateSanitizer ? options.stateSanitizer(previousState) : previousState;
        properties.previousState = boundedSerialize(state, limits);
      }
      if (captureState !== 'none') {
        const state = options.stateSanitizer ? options.stateSanitizer(nextState) : nextState;
        properties.nextState = boundedSerialize(state, limits);
      }

      client.logEvent('$redux_action', fitToEventLimit(properties, maxEventBytes));
    } catch (error) {
      options.onError?.(error);
    }

    return result;
  };
}
