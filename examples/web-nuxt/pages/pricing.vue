<script setup lang="ts">
const { $rejourney } = useNuxtApp();

function choosePlan(plan: string) {
  ($rejourney as any)?.logEvent?.('nuxt_plan_selected', { plan });
}
</script>

<template>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">Pricing</p>
      <h1>Plan selection</h1>
      <p>This route gives the replay a normal client-side navigation target with repeated controls.</p>

      <div class="plans">
        <article>
          <h2>Starter</h2>
          <p>$29</p>
          <button type="button" @click="choosePlan('starter')">Choose Starter</button>
        </article>
        <article>
          <h2>Pro</h2>
          <p>$99</p>
          <button type="button" @click="choosePlan('pro')">Choose Pro</button>
        </article>
        <article>
          <h2>Enterprise</h2>
          <p>Custom</p>
          <NuxtLink to="/account">View Account</NuxtLink>
        </article>
      </div>
    </section>
  </main>
</template>
