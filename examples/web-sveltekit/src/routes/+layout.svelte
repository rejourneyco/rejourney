<script lang="ts">
  import { onMount } from 'svelte';
  import { mountRejourney } from '$lib/rejourney';

  onMount(() => mountRejourney());
</script>

<header class="top-nav">
  <strong>Rejourney SvelteKit Fixture</strong>
  <nav>
    <a href="/">Home</a>
    <a href="/pricing">Pricing</a>
    <a href="/checkout">Checkout</a>
    <a href="/account">Account</a>
    <a href="/missing-fixture-page">404 test</a>
  </nav>
</header>

<slot />

<style>
  :global(body) {
    margin: 0;
    font-family: Arial, sans-serif;
    background: #f5f7fb;
    color: #1f2937;
  }

  :global(.top-nav) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 16px 24px;
    border-bottom: 1px solid #d8dee8;
    background: #ffffff;
  }

  :global(.top-nav nav),
  :global(.grid-actions),
  :global(.plans) {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  :global(.top-nav a),
  :global(.grid-actions a),
  :global(.plans a),
  :global(button) {
    min-height: 40px;
    border: 1px solid #b9c2cf;
    border-radius: 6px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #111827;
    color: white;
    cursor: pointer;
    font: inherit;
    text-decoration: none;
  }

  :global(.top-nav a) {
    background: #ffffff;
    color: #111827;
  }

  :global(.shell) {
    min-height: calc(100vh - 73px);
    display: grid;
    place-items: center;
    padding: 32px;
  }

  :global(.panel) {
    width: min(760px, 100%);
    background: #ffffff;
    border: 1px solid #d8dee8;
    border-radius: 8px;
    padding: 28px;
  }

  :global(.eyebrow) {
    margin: 0 0 8px;
    color: #155e75;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
  }

  :global(h1) {
    margin: 0 0 12px;
    font-size: 32px;
  }

  :global(h2) {
    margin: 0 0 8px;
    font-size: 18px;
  }

  :global(form),
  :global(.status-grid) {
    display: grid;
    gap: 14px;
    margin-top: 24px;
  }

  :global(label) {
    display: grid;
    gap: 6px;
    font-size: 14px;
    font-weight: 700;
  }

  :global(input),
  :global(select),
  :global(textarea) {
    border: 1px solid #b9c2c8;
    border-radius: 6px;
    padding: 10px 12px;
    font: inherit;
  }

  :global(.grid-actions) {
    margin-top: 18px;
  }

  :global(.status-grid),
  :global(.plans) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  :global(.status-grid) {
    display: grid;
  }

  :global(.status-grid div),
  :global(.plans article) {
    border: 1px solid #d8dee8;
    border-radius: 6px;
    padding: 14px;
  }

  :global(dt) {
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }

  :global(dd) {
    margin: 4px 0 0;
    font-weight: 700;
  }

  :global(.plans) {
    margin-top: 22px;
  }

  :global(.check-row) {
    display: flex;
    align-items: center;
    gap: 10px;
  }
</style>
