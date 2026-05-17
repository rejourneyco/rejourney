<script lang="ts">
  import { Rejourney } from '@rejourneyco/browser';

  function markBackHome() {
    Rejourney.trackScreen('home-from-missing', { fixture: 'sveltekit' });
  }
</script>

<main class="shell">
  <section class="panel">
    <p class="eyebrow">404</p>
    <h1>Missing fixture page</h1>
    <p>This catch-all route is deliberate. Use Back or the link below to verify the same tab session survives route recovery.</p>

    <div class="grid-actions">
      <a href="/" on:click={markBackHome}>Back home</a>
      <a href="/checkout">Checkout</a>
    </div>
  </section>
</main>
