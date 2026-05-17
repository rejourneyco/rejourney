<script setup lang="ts">
const { $rejourney } = useNuxtApp();

function markBackHome() {
  ($rejourney as any)?.trackScreen?.('home-from-missing', { fixture: 'nuxt' });
}
</script>

<template>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">404</p>
      <h1>Missing fixture page</h1>
      <p>This catch-all route is deliberate. Use Back or the link below to verify the same tab session survives route recovery.</p>

      <div class="grid-actions">
        <NuxtLink to="/" @click="markBackHome">Back home</NuxtLink>
        <NuxtLink to="/checkout">Checkout</NuxtLink>
      </div>
    </section>
  </main>
</template>
