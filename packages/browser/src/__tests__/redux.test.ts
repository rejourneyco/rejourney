import { describe, expect, it, vi } from 'vitest';
import { createRejourneyReduxMiddleware } from '../integrations/redux.js';

interface TestState {
  count: number;
  auth?: { token: string; profile: { name: string } };
}

function createHarness(
  initialState: TestState,
  options: Parameters<typeof createRejourneyReduxMiddleware<TestState>>[0] = {},
) {
  let state = initialState;
  const logEvent = vi.fn();
  const middleware = createRejourneyReduxMiddleware<TestState>({
    client: { logEvent },
    ...options,
  });
  const api = {
    getState: () => state,
    dispatch: (action: unknown) => dispatch(action),
  };
  const next = vi.fn((action: unknown) => {
    if (action && typeof action === 'object' && (action as { type?: string }).type === 'counter/increment') {
      state = { ...state, count: state.count + 1 };
    }
    return action;
  });
  const dispatch = middleware(api)(next);

  return { dispatch, getState: () => state, logEvent, next };
}

describe('Rejourney Redux middleware', () => {
  it('captures the action and before/after Redux Toolkit state', () => {
    const harness = createHarness({ count: 0 });

    const result = harness.dispatch({ type: 'counter/increment', payload: { amount: 1 } });

    expect(result).toEqual({ type: 'counter/increment', payload: { amount: 1 } });
    expect(harness.getState()).toEqual({ count: 1 });
    expect(harness.logEvent).toHaveBeenCalledTimes(1);
    expect(harness.logEvent).toHaveBeenCalledWith('$redux_action', expect.objectContaining({
      source: 'redux',
      actionType: 'counter/increment',
      action: { type: 'counter/increment', payload: { amount: 1 } },
      previousState: { count: 0 },
      nextState: { count: 1 },
      sequence: 0,
      durationMs: expect.any(Number),
    }));
  });

  it('redacts common secrets and custom sensitive keys recursively', () => {
    const harness = createHarness(
      { count: 0, auth: { token: 'prod-secret', profile: { name: 'Demo User' } } },
      { redactKeys: ['name'] },
    );

    harness.dispatch({ type: 'profile/save', payload: { password: 'hunter2', paymentToken: 'tok_payment_secret', name: 'Demo User' } });

    const properties = harness.logEvent.mock.calls[0]?.[1];
    expect(properties.action).toEqual({
      type: 'profile/save',
      payload: { password: '[Redacted]', paymentToken: '[Redacted]', name: '[Redacted]' },
    });
    expect(properties.nextState).toEqual({
      count: 0,
      auth: { token: '[Redacted]', profile: { name: '[Redacted]' } },
    });
    expect(JSON.stringify(properties)).not.toContain('prod-secret');
    expect(JSON.stringify(properties)).not.toContain('hunter2');
    expect(JSON.stringify(properties)).not.toContain('tok_payment_secret');
  });

  it('supports predicates, sanitizers, and after-only capture', () => {
    const harness = createHarness({ count: 0 }, {
      captureState: 'after',
      predicate: (action) => action.type.startsWith('counter/'),
      actionSanitizer: (action) => ({ type: action.type }),
      stateSanitizer: (state) => ({ count: state.count }),
    });

    harness.dispatch({ type: 'ignored/action', payload: 'private' });
    harness.dispatch({ type: 'counter/increment', payload: 'discarded' });

    expect(harness.logEvent).toHaveBeenCalledTimes(1);
    expect(harness.logEvent).toHaveBeenCalledWith('$redux_action', expect.objectContaining({
      action: { type: 'counter/increment' },
      nextState: { count: 1 },
    }));
    expect(harness.logEvent.mock.calls[0]?.[1]).not.toHaveProperty('previousState');
  });

  it('bounds circular, deep, long, and oversized values without breaking dispatch', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const harness = createHarness({ count: 0 }, {
      maxDepth: 2,
      maxStringLength: 16,
      maxEventBytes: 1_024,
    });

    expect(() => harness.dispatch({
      type: 'large/action',
      circular,
      long: 'x'.repeat(10_000),
      deep: { one: { two: { three: true } } },
    })).not.toThrow();

    const properties = harness.logEvent.mock.calls[0]?.[1];
    expect(properties.action.circular.self).toBe('[Circular]');
    expect(JSON.stringify(properties).length).toBeLessThanOrEqual(1_024);
  });

  it('never captures thunk-like actions and does not swallow reducer errors', () => {
    const onError = vi.fn();
    const harness = createHarness({ count: 0 }, { onError });

    const thunk = () => undefined;
    harness.dispatch(thunk);

    expect(harness.next).toHaveBeenCalledWith(thunk);
    expect(harness.logEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    const middleware = createRejourneyReduxMiddleware<TestState>({
      client: { logEvent: vi.fn() },
    });
    const dispatch = middleware({ getState: () => ({ count: 0 }), dispatch: vi.fn() })(() => {
      throw new Error('reducer failed');
    });

    expect(() => dispatch({ type: 'counter/increment' })).toThrow('reducer failed');
  });

  it('reports capture errors without affecting the application dispatch result', () => {
    const onError = vi.fn();
    const harness = createHarness({ count: 0 }, {
      onError,
      stateSanitizer: () => {
        throw new Error('sanitize failed');
      },
    });

    expect(harness.dispatch({ type: 'counter/increment' })).toEqual({ type: 'counter/increment' });
    expect(harness.getState()).toEqual({ count: 1 });
    expect(harness.logEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sanitize failed' }));
  });
});
