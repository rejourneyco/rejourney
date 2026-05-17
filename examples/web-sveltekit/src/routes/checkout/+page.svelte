<script lang="ts">
  import { Rejourney } from '@rejourneyco/browser';

  let cardholder = 'Masked User';

  function submitCheckout() {
    Rejourney.logEvent('sveltekit_checkout_submitted', { method: 'card' });
  }
</script>

<main class="shell">
  <section class="panel">
    <p class="eyebrow">Checkout</p>
    <h1>Checkout Page</h1>
    <p>Use this route to create typed input, button clicks, and a normal page transition.</p>

    <form>
      <label>
        Cardholder
        <input bind:value={cardholder} type="text" autocomplete="off" />
      </label>
      <label>
        Card number
        <input type="text" value="4242 4242 4242 4242" data-rejourney-mask />
      </label>
      <button type="button" on:click={submitCheckout}>Submit checkout</button>
    </form>
  </section>
</main>
