<template>
  <div>
    <header class="top-nav">
      <strong>Rejourney Nuxt Fixture</strong>
      <nav>
        <NuxtLink to="/">Home</NuxtLink>
        <NuxtLink to="/pricing">Pricing</NuxtLink>
        <NuxtLink to="/checkout">Checkout</NuxtLink>
        <NuxtLink to="/account">Account</NuxtLink>
        <NuxtLink to="/missing-fixture-page">404 test</NuxtLink>
      </nav>
    </header>
    <NuxtPage />
  </div>
</template>

<style>
body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: #f5f7fb;
  color: #1f2937;
}

.top-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 24px;
  border-bottom: 1px solid #d8dee8;
  background: #ffffff;
}

.top-nav nav,
.grid-actions,
.plans {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.top-nav a,
.grid-actions a,
.plans a,
button {
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

.top-nav a {
  background: #ffffff;
  color: #111827;
}

.shell {
  min-height: calc(100vh - 73px);
  display: grid;
  place-items: center;
  padding: 32px;
}

.panel {
  width: min(760px, 100%);
  background: #ffffff;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  padding: 28px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #7c2d12;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 12px;
  font-size: 32px;
}

h2 {
  margin: 0 0 8px;
  font-size: 18px;
}

form,
.status-grid {
  display: grid;
  gap: 14px;
  margin-top: 24px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
}

input,
select {
  min-height: 42px;
  border: 1px solid #b9c2cf;
  border-radius: 6px;
  padding: 0 12px;
  font: inherit;
}

.grid-actions {
  margin-top: 18px;
}

.status-grid,
.plans {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.status-grid {
  display: grid;
}

.status-grid div,
.plans article {
  border: 1px solid #d8dee8;
  border-radius: 6px;
  padding: 14px;
}

dt {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

dd {
  margin: 4px 0 0;
  font-weight: 700;
}

.plans {
  margin-top: 22px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
