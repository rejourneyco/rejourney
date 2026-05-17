<script setup lang="ts">
const email = ref('masked@example.com');
const plan = ref('pro');
const networkState = ref('idle');
const routeState = ref('home');
const { $rejourney } = useNuxtApp();

function client() {
  return $rejourney as any;
}

function logCustomEvent() {
  client()?.logEvent?.('nuxt_fixture_custom_event', {
    plan: plan.value,
    route: routeState.value,
    source: 'nuxt-home',
  });
}

function setMetadata() {
  client()?.setUserIdentity?.('web_fixture_user');
  client()?.setMetadata?.({
    plan: plan.value,
    fixture: 'nuxt',
  });
}

async function runNetworkCall() {
  networkState.value = 'loading';
  try {
    await fetch(`/api/nuxt-fixture?plan=${encodeURIComponent(plan.value)}&t=${Date.now()}`);
    networkState.value = 'success';
  } catch {
    networkState.value = 'failed';
  }
}

function markRoute(route: string) {
  routeState.value = route;
  client()?.trackScreen?.(route, { fixture: 'nuxt' });
}
</script>

<template>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">Nuxt 3</p>
      <h1>Rejourney web replay fixture</h1>
      <p>This client plugin starts the local web SDK after Nuxt hydration.</p>

      <form>
        <label>
          Email
          <input v-model="email" type="email" placeholder="masked@example.com">
        </label>
        <label>
          Plan
          <select v-model="plan">
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
        <button type="button" @click="logCustomEvent">Log custom event</button>
      </form>

      <div class="grid-actions">
        <button type="button" @click="setMetadata">Set user metadata</button>
        <button type="button" @click="runNetworkCall">Run network call</button>
        <NuxtLink to="/pricing" @click="markRoute('pricing')">Pricing Page</NuxtLink>
        <NuxtLink to="/checkout" @click="markRoute('checkout')">Checkout Page</NuxtLink>
        <NuxtLink to="/account" @click="markRoute('account')">Account Page</NuxtLink>
        <NuxtLink to="/missing-fixture-page" @click="markRoute('missing')">404 test</NuxtLink>
      </div>

      <dl class="status-grid">
        <div>
          <dt>Plan</dt>
          <dd>{{ plan }}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{{ networkState }}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>{{ routeState }}</dd>
        </div>
      </dl>
    </section>
  </main>
</template>
