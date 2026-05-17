<script lang="ts">
  import { Rejourney } from '@rejourneyco/browser';

  let notifications = true;

  function saveAccount() {
    Rejourney.setMetadata('accountNotifications', notifications);
    Rejourney.logEvent('sveltekit_account_saved', { notifications });
  }
</script>

<main class="shell">
  <section class="panel">
    <p class="eyebrow">Account</p>
    <h1>Account Page</h1>
    <p>This page exercises toggles, metadata, and a second routed view.</p>

    <label class="check-row">
      <input bind:checked={notifications} type="checkbox" />
      Product notifications
    </label>
    <button type="button" on:click={saveAccount}>Save account</button>
  </section>
</main>
