<script setup lang="ts">
const notifications = ref(true);
const { $rejourney } = useNuxtApp();

function saveAccount() {
  ($rejourney as any)?.setMetadata?.('accountNotifications', notifications.value);
  ($rejourney as any)?.logEvent?.('nuxt_account_saved', { notifications: notifications.value });
}
</script>

<template>
  <main class="shell">
    <section class="panel">
      <p class="eyebrow">Account</p>
      <h1>Account Page</h1>
      <p>This page exercises toggles, metadata, and a second routed view.</p>

      <label class="check-row">
        <input v-model="notifications" type="checkbox">
        Product notifications
      </label>
      <button type="button" @click="saveAccount">Save account</button>
    </section>
  </main>
</template>
