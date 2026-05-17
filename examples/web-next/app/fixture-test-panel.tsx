'use client';

import { useState } from 'react';
import { Rejourney } from '@rejourneyco/browser';

export function FixtureTestPanel() {
  const [plan, setPlan] = useState('pro');
  const [networkState, setNetworkState] = useState('idle');
  const [routeState, setRouteState] = useState('home');
  const [resourceErrorVisible, setResourceErrorVisible] = useState(false);

  function logCustomEvent() {
    Rejourney.logEvent('web_fixture_custom_event', {
      plan,
      source: 'next_fixture',
      clickedAt: new Date().toISOString(),
    });
  }

  function setFixtureMetadata() {
    Rejourney.setUserIdentity('web_fixture_user');
    Rejourney.setMetadata({
      plan,
      example: 'web-next',
      testCase: 'metadata',
    });
  }

  async function runNetworkCase() {
    setNetworkState('loading');
    try {
      const response = await fetch(`/api/fixture?plan=${encodeURIComponent(plan)}&token=secret-test-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, email: 'masked@example.com' }),
      });
      setNetworkState(response.ok ? 'success' : 'failed');
    } catch {
      setNetworkState('failed');
    }
  }

  function runRouteCase() {
    const next = routeState === 'home' ? 'checkout' : 'home';
    setRouteState(next);
    window.history.pushState({}, '', `/${next}?utm_source=fixture&email=masked@example.com`);
    Rejourney.trackScreen(`fixture_${next}`);
  }

  function runErrorCase() {
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Fixture synthetic error',
      error: new Error('Fixture synthetic error'),
      filename: window.location.href,
    }));
  }

  return (
    <section className="panel">
      <p className="eyebrow">Test cases</p>
      <h2>SDK interaction coverage</h2>
      <p>Use these controls to create replay, analytics, network, route, and error signals.</p>

      <form className="fixture-form">
        <label>
          Email
          <input type="email" placeholder="masked@example.com" />
        </label>
        <label>
          Secret note
          <textarea placeholder="This text should be masked in replay" />
        </label>
        <label>
          Plan
          <select value={plan} onChange={(event) => setPlan(event.target.value)}>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
      </form>

      <div className="button-grid">
        <button type="button" onClick={logCustomEvent}>Log custom event</button>
        <button type="button" onClick={setFixtureMetadata}>Set user metadata</button>
        <button type="button" onClick={runNetworkCase}>Run network call</button>
        <button type="button" onClick={runRouteCase}>Change route</button>
        <button type="button" onClick={runErrorCase}>Send error event</button>
        <button type="button" onClick={() => setResourceErrorVisible(true)}>Trigger resource error</button>
      </div>

      <div className="status-grid">
        <div>
          <span>Plan</span>
          <strong>{plan}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong>{networkState}</strong>
        </div>
        <div>
          <span>Route</span>
          <strong>{routeState}</strong>
        </div>
      </div>

      {resourceErrorVisible ? (
        <img
          src="/missing-fixture-image.png"
          alt=""
          width={1}
          height={1}
          style={{ opacity: 0, position: 'absolute', pointerEvents: 'none' }}
        />
      ) : null}
    </section>
  );
}
