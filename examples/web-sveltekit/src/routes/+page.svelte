<script lang="ts">
  import { Rejourney } from '@rejourneyco/browser';

  let email = 'masked@example.com';
  let note = 'This text should be masked in replay';
  let plan = 'pro';
  let networkState = 'idle';
  let routeState = 'home';

  function logCustomEvent() {
    Rejourney.logEvent('sveltekit_fixture_custom_event', {
      plan,
      route: routeState,
      source: 'sveltekit-home',
    });
  }

  function setMetadata() {
    Rejourney.setUserIdentity('web_fixture_user');
    Rejourney.setMetadata({
      plan,
      fixture: 'sveltekit',
    });
  }

  async function runNetworkCall() {
    networkState = 'loading';
    try {
      await fetch(`/api/sveltekit-fixture?plan=${encodeURIComponent(plan)}&t=${Date.now()}`);
      networkState = 'success';
    } catch {
      networkState = 'failed';
    }
  }

  function markRoute(route: string) {
    routeState = route;
    Rejourney.trackScreen(route, { fixture: 'sveltekit' });
  }
</script>

<main class="shell">
  <section class="panel">
    <p class="eyebrow">SvelteKit</p>
    <h1>Rejourney web replay fixture</h1>
    <p>This page exercises browser-only startup, form masking, route capture, and click analytics.</p>

    <form>
      <label>
        Email
        <input bind:value={email} type="email" placeholder="masked@example.com" />
      </label>
      <label>
        Private note
        <textarea bind:value={note} data-rj-mask rows="4" placeholder="masked text"></textarea>
      </label>
      <label>
        Plan
        <select bind:value={plan}>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </label>
      <button type="button" on:click={logCustomEvent}>Log custom event</button>
    </form>

    <div class="grid-actions">
      <button type="button" on:click={setMetadata}>Set user metadata</button>
      <button type="button" on:click={runNetworkCall}>Run network call</button>
      <a href="/pricing" on:click={() => markRoute('pricing')}>Pricing Page</a>
      <a href="/checkout" on:click={() => markRoute('checkout')}>Checkout Page</a>
      <a href="/account" on:click={() => markRoute('account')}>Account Page</a>
      <a href="/missing-fixture-page" on:click={() => markRoute('missing')}>404 test</a>
    </div>

    <dl class="status-grid">
      <div>
        <dt>Plan</dt>
        <dd>{plan}</dd>
      </div>
      <div>
        <dt>Network</dt>
        <dd>{networkState}</dd>
      </div>
      <div>
        <dt>Route</dt>
        <dd>{routeState}</dd>
      </div>
    </dl>
  </section>
</main>
