<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney Logo" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Rejourney Issue Detection" width="100%" />

  <p>
    <strong>KI-Erkennung von Funnel-Leaks und Conversion-Beschleunigung</strong>
    <br />
    Behebe Funnel- und Conversion-Leaks mit Rejourney.
  </p>

  <p>
    <a href="https://rejourney.co"><strong>Website erkunden »</strong></a>
  </p>

  <p>
    <a href="https://reactnative.dev">
      <img src="https://img.shields.io/badge/React%20Native-20232A?style=for-the-badge&amp;logo=react&amp;logoColor=61DAFB" alt="React Native" />
    </a>
    <a href="https://expo.dev">
      <img src="https://img.shields.io/badge/Expo-000020?style=for-the-badge&amp;logo=expo&amp;logoColor=white" alt="Expo" />
    </a>
    <a href="https://www.swift.org">
      <img src="https://img.shields.io/badge/Swift-F05138?style=for-the-badge&amp;logo=swift&amp;logoColor=white" alt="Swift" />
    </a>
  </p>

  <p>
    <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript">
      <img src="https://img.shields.io/badge/Browser%20SDK-F7DF1E?style=for-the-badge&amp;logo=javascript&amp;logoColor=black" alt="Browser SDK" />
    </a>
    <a href="https://nextjs.org">
      <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&amp;logo=nextdotjs&amp;logoColor=white" alt="Next.js" />
    </a>
    <a href="https://vuejs.org">
      <img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&amp;logo=vuedotjs&amp;logoColor=white" alt="Vue.js" />
    </a>
    <a href="https://nuxt.com">
      <img src="https://img.shields.io/badge/Nuxt-00DC82?style=for-the-badge&amp;logo=nuxt&amp;logoColor=white" alt="Nuxt" />
    </a>
  </p>
</div>

## Funktionen

### Pixelgenaue Erfassung
![Session Replay Theater](../dashboard/web-ui/public/images/session-replay-preview.png)

True-FPS-Videowiedergabe, die jeden gerenderten Pixel erfasst. Anders als Wettbewerber erfassen wir alles, inklusive Mapbox (Metal), eigener Shader und GPU-beschleunigter Views.

### KI-Leak-Erkennung
![Issue Feed](../dashboard/web-ui/public/images/readme-general-demo.png)

Ordnet wiederkehrende Funnel-Leaks, Rage Taps, API-Fehler und Replay-Beweise in reparaturfertige Kontextpakete ein. Unterstützt von Rejourney Marlin.

### Fehler-/ANR-/Crash-Erkennung
![ANR Issues](../dashboard/web-ui/public/images/anr-issues.png)

Automatische Erkennung von Application-Not-Responding-Ereignissen mit vollständigen Thread-Dumps und Analyse des Main Threads.

### Journey Mapping
![User Journeys](../dashboard/web-ui/public/images/readme-user-journeys.png)

Visualisiere, wie Nutzer durch deine App navigieren. Erkenne Drop-off-Punkte mit hoher Reibung und optimiere Conversion-Funnels.

### Interaktions-Heatmaps
![Heatmaps](../dashboard/web-ui/public/images/heatmaps.png)

**Visualisiere Nutzerinteraktion präzise.** Sieh, wo Nutzer tippen, wischen und scrollen, um UI-Platzierung zu optimieren.

### Globale Stabilität
![Geo Analytics](../dashboard/web-ui/public/images/geo-analytics.png)

Überwache Performance und Stabilität über Regionen hinweg. Erkenne Infrastrukturprobleme, bevor sie dein globales Publikum treffen.

### Growth Engines
![Growth Engines](../dashboard/web-ui/public/images/growth-engines.png)
Verfolge Nutzerbindung und Loyalitätssegmente. Verstehe, wie Releases Power User im Vergleich zu Bounce-Raten beeinflussen.

## Dokumentation

Vollständige Integrationsleitfäden und API-Referenz: https://rejourney.co/docs/reactnative/overview

## Mitwirken

Du möchtest zu Rejourney beitragen? Sieh dir unseren Contribution Guide an: https://rejourney.co/docs/community/contributing

## Lokale Entwicklung

Die lokale Entwicklung spiegelt Produktion über [`local-k8s/`](../local-k8s). Für einen frischen Checkout kopiere `local-k8s/env.example` nach `.env.k8s.local`, trage die erforderlichen lokalen Secrets ein und führe `npm run ci:local` aus, um zu installieren, validieren, bauen, deployen, migrieren und den lokalen Stack zu starten. Nach diesem ersten Bootstrap nutzt du `npm run dev` für den täglichen Hot-Reload-Workflow.

`docker-compose.selfhosted.yml` ist der offizielle Single-Node-Self-Hosted-Deployment-Pfad.

## Benchmarks

Rejourney ist darauf ausgelegt, nicht im Weg zu sein: kleiner Paketumfang, geringe Browser-Intensität und mobile Erfassung, die den Main Thread frei hält. Die Benchmark-Galerie der Landing Page ist direkt erreichbar unter [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery).

### Web vs. PostHog

Live-Chromium-Benchmark über drei Web-Fixtures: Next.js, SvelteKit und Nuxt. Jedes SDK lief gegen einen Live-Projekt-Endpunkt mit 3 Iterationen pro Framework. Bei allen Metriken ist niedriger besser.

**Nachweise:** [Benchmark-Bericht](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [Rohdaten](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [Live-Netzwerkaufzeichnungen von Rejourney](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [Netzwerkaufzeichnungen von PostHog](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Bereich | Gewinner | Abstand |
| :--- | :---: | :--- |
| Bundlephobia gzipped package size | Rejourney | **3.9x kleiner** als `posthog-js` |
| Median live SDK upload body | Rejourney | **3.0x kleiner** als PostHog |
| Browser task duration | Rejourney | **1.1x niedrigere** mediane Task-Zeit |
| Script execution time | Rejourney | **2.0x niedrigere** mediane Script-Zeit |
| Final JS heap | Rejourney | **1.4x niedrigerer** medianer Heap |

#### Paketgröße

Bundlephobia-Paketgröße mit fester Version. Gzip ist der Transfergrößenanteil; minified ist der vollständige Balken in der Galerie.

| Paket | Version | Minified | Gzipped | Quelle |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/browser` | `0.1.0` | **52.3 kB** | **15.9 kB** | [Bundlephobia](https://bundlephobia.com/package/@rejourneyco/browser@0.1.0) |
| `posthog-js` | `1.374.2` | 187.5 kB | 61.5 kB | [Bundlephobia](https://bundlephobia.com/package/posthog-js@1.374.2) |

#### Live-Web-Benchmark-Metriken

| App | Rejourney Upload | PostHog Upload | Rejourney Task | PostHog Task | Rejourney Script | PostHog Script | Rejourney Heap | PostHog Heap |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next.js | **21.29 KiB** | 45.35 KiB | **417.96 ms** | 449.91 ms | **160.46 ms** | 185.06 ms | **15.81 MiB** | 16.19 MiB |
| SvelteKit | **8.38 KiB** | 24.99 KiB | **268.72 ms** | 304.03 ms | **19.35 ms** | 42.02 ms | **6.63 MiB** | 9.17 MiB |
| Nuxt | **8.40 KiB** | 26.57 KiB | **305.51 ms** | 322.24 ms | **21.12 ms** | 41.17 ms | **11.33 MiB** | 15.44 MiB |

### Mobile vs. Sentry

Rejourney Mobile nutzt eine asynchrone Capture-Pipeline mit Run-Loop-Gating, sodass Capture-Arbeit außerhalb des kritischen Rendering-Pfads stattfinden und während intensiver Interaktion automatisch pausieren kann.

#### React-Native-Paketgröße

| Paket | Version | Minified | Gzipped | Gewinner |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **10.2x kleineres minified JS bundle** |
| `@sentry/react-native` | `8.7.0` | 403 kB | 135.3 kB | - |

Quellen: [`@rejourneyco/react-native` auf Bundlephobia](https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17), [`@sentry/react-native` auf Bundlephobia](https://bundlephobia.com/package/@sentry/react-native@8.7.0).

#### Mobile Performance

**Gerät:** iPhone 15 Pro (iOS 26)
**Umgebung:** Expo SDK 54, React Native New Architecture
**Test-App:** [Merch App](https://merchcampus.com), Produktionsbuild mit Mapbox Metal und Firebase
**Test-Workload:** 46 komplexe Feed-Items, Mapbox GL View, 124 API-Aufrufe, 31 Subkomponenten, aktives Gesture-Tracking und Echtzeit-Privacy-Redaction.

| Metrik | Ø (ms) | Max (ms) | Min (ms) | Thread |
| :--- | ---: | ---: | ---: | :---: |
| **Main: UIKit + Metal Capture** | **12.4** | 28.2 | 8.1 | Main |
| **BG: Async Image Processing** | 42.5 | 88.0 | 32.4 | Background |
| **BG: Tar+Gzip Compression** | 14.2 | 32.5 | 9.6 | Background |
| **BG: Upload Handshake** | 0.8 | 2.4 | 0.3 | Background |
| **Total Main Thread Impact** | **12.4** | 28.2 | 8.1 | Main |

Total Main Thread Impact ist die einzige Arbeit in dieser Tabelle, die das App-Rendering blockiert.

## Engineering

Engineering-Entscheidungen und Architektur: https://rejourney.co/engineering

## Lizenz

Clientseitige Komponenten (SDKs, CLIs) sind unter Apache 2.0 lizenziert. Serverseitige Komponenten (Backend, Dashboard) sind unter SSPL 1.0 lizenziert. Siehe [LICENSE-APACHE](../LICENSE-APACHE) und [LICENSE-SSPL](../LICENSE-SSPL) für Details.

---

## Übersetzungen

- [Arabisch | العربية](README_AR.md)
- [Chinesisch (vereinfacht) | 简体中文](README_ZH_CN.md)
- [Französisch | Français](README_FR.md)
- [Deutsch | Deutsch](README_DE.md)
- [Hindi | हिन्दी](README_HI.md)
- [Indonesisch | Bahasa Indonesia](README_ID.md)
- [Japanisch | 日本語](README_JA.md)
- [Koreanisch | 한국어](README_KO.md)
- [Portugiesisch (Brasilien) | Português do Brasil](README_PT_BR.md)
- [Spanisch | Español](README_ES.md)
- [Türkisch | Türkçe](README_TR.md)
