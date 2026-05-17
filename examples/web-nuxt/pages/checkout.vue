<script setup lang="ts">
const cardholder = ref('Masked User');
const { $rejourney } = useNuxtApp();

function submitCheckout() {
  ($rejourney as any)?.logEvent?.('nuxt_checkout_submitted', { method: 'card' });
}
</script>

<template>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">Checkout</p>
      <h1>Checkout Page</h1>
      <p>Use this route to create typed input, button clicks, and a normal page transition.</p>

      <form>
        <label>
          Cardholder
          <input v-model="cardholder" type="text" autocomplete="off">
        </label>
        <label>
          Card number
          <input type="text" value="4242 4242 4242 4242" data-rejourney-mask>
        </label>
        <button type="button" @click="submitCheckout">Submit checkout</button>
      </form>
    </section>
  </main>
</template>
