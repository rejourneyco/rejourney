# Rejourney Examples

This folder contains example applications demonstrating how to integrate the Rejourney SDKs.

Start the local stack first if you want example telemetry to hit your local API:

```bash
npm run ci:local
```

Web examples:

- `web-next`: Next.js App Router with `@rejourneyco/browser/next` on `http://127.0.0.1:3100`
- `web-sveltekit`: SvelteKit with `@rejourneyco/browser/svelte` on `http://127.0.0.1:3101`
- `web-nuxt`: Nuxt client plugin with `@rejourneyco/browser/nuxt` on `http://127.0.0.1:3102`
- `web-redux`: multi-page Redux Toolkit replay fixture with `@rejourneyco/browser/redux` on `http://127.0.0.1:4173`

Swift examples:

- `swift-clean-arch`: full SwiftUI fixture that can switch between the released SwiftPM package and the local package
- `ios-native`: small SwiftUI app that always consumes the root Swift package by local path

React Native examples:

- `react-native-boilerplate`
- `react-native-bare`
- `brew-coffee-labs`

Useful root commands:

```bash
npm run example:web-next
npm run example:web-sveltekit
npm run example:web-nuxt
npm run example:swift:sdk:new
npm run example:swift
npm run example:boilerplate
```
