<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney लोगो" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Rejourney Issue Detection" width="100%" />

  <p>
    <strong>AI Funnel Leak Detection और Conversion Acceleration</strong>
    <br />
    Rejourney के साथ funnel और conversion leaks ठीक करें।
  </p>

  <p>
    <a href="https://rejourney.co"><strong>वेबसाइट देखें »</strong></a>
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

## फीचर्स

### Pixel Perfect Capture
![Session Replay Theater](../dashboard/web-ui/public/images/session-replay-preview.png)

True FPS वीडियो प्लेबैक जो हर rendered pixel को capture करता है। प्रतिस्पर्धियों के विपरीत, हम Mapbox (Metal), custom shaders और GPU-accelerated views सहित सब कुछ capture करते हैं।

### AI Leak Detection
![Issues Feed](../dashboard/web-ui/public/images/readme-general-demo.png)

बार-बार होने वाले funnel leaks, rage taps, API failures और replay evidence को fix-ready context packets में rank करता है। Rejourney Marlin द्वारा powered.

### Error/ANR/Crash Detection
![ANR Issues](../dashboard/web-ui/public/images/anr-issues.png)

Application Not Responding events की automatic detection, full thread dumps और main thread analysis के साथ।

### Journey Mapping
![User Journeys](../dashboard/web-ui/public/images/readme-user-journeys.png)

देखें कि users आपके app में कैसे navigate करते हैं। High-friction drop-off points पहचानें और conversion funnels optimize करें।

### Interaction Heat Maps
![Heatmaps](../dashboard/web-ui/public/images/heatmaps.png)

**User engagement को precision के साथ visualize करें।** देखें कि users कहां tap, swipe और scroll करते हैं ताकि UI placement optimize हो सके।

### Global Stability
![Geo Analytics](../dashboard/web-ui/public/images/geo-analytics.png)

अलग-अलग regions में performance और stability monitor करें। Infrastructure issues को global audience पर असर डालने से पहले पहचानें।

### Growth Engines
![Growth Engines](../dashboard/web-ui/public/images/growth-engines.png)
User retention और loyalty segments track करें। समझें कि releases आपके power users बनाम bounce rates को कैसे प्रभावित करते हैं।

## Documentation

Full integration guides और API reference: https://rejourney.co/docs/reactnative/overview

## Contributing

Rejourney में योगदान देना चाहते हैं? हमारा Contributing Guide देखें: https://rejourney.co/docs/community/contributing

## Local Development

Local development [`local-k8s/`](../local-k8s) के जरिए production को mirror करता है। Fresh checkout के लिए `local-k8s/env.example` को `.env.k8s.local` में copy करें, required local secrets भरें, फिर install, validate, build, deploy, migrate और local stack start करने के लिए `npm run ci:local` चलाएं। पहले bootstrap के बाद daily hot-reload workflow के लिए `npm run dev` इस्तेमाल करें।

`docker-compose.selfhosted.yml` official single-node self-hosted deployment path है।

## Benchmarks

Rejourney को रास्ते से बाहर रहने के लिए design किया गया है: छोटा package footprint, कम browser intensity, और mobile capture work जो main thread को clear रखता है। Landing-page benchmark gallery सीधे [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery) पर linkable है।

### Web vs PostHog

तीन web fixtures पर live Chromium benchmark: Next.js, SvelteKit और Nuxt। हर SDK को live project endpoint के खिलाफ framework प्रति 3 iterations के लिए चलाया गया। नीचे हर metric में कम बेहतर है।

**Evidence:** [benchmark report](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [raw results](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [Rejourney live network captures](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [PostHog network captures](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Section | Winner | Margin |
| :--- | :---: | :--- |
| Bundlephobia gzipped package size | Rejourney | `posthog-js` से **3.9x छोटा** |
| Median live SDK upload body | Rejourney | PostHog से **3.0x छोटा** |
| Browser task duration | Rejourney | **1.1x कम** median task time |
| Script execution time | Rejourney | **2.0x कम** median script time |
| Final JS heap | Rejourney | **1.4x कम** median heap |

#### Package Size

Bundlephobia fixed-version package size. Gzip transfer-size segment है; minified gallery में दिखाई गई पूरी bar है।

| Package | Version | Minified | Gzipped | Source |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/browser` | `0.1.0` | **52.3 kB** | **15.9 kB** | [Bundlephobia](https://bundlephobia.com/package/@rejourneyco/browser@0.1.0) |
| `posthog-js` | `1.374.2` | 187.5 kB | 61.5 kB | [Bundlephobia](https://bundlephobia.com/package/posthog-js@1.374.2) |

#### Live Web Benchmark Metrics

| App | Rejourney upload | PostHog upload | Rejourney task | PostHog task | Rejourney script | PostHog script | Rejourney heap | PostHog heap |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next.js | **21.29 KiB** | 45.35 KiB | **417.96 ms** | 449.91 ms | **160.46 ms** | 185.06 ms | **15.81 MiB** | 16.19 MiB |
| SvelteKit | **8.38 KiB** | 24.99 KiB | **268.72 ms** | 304.03 ms | **19.35 ms** | 42.02 ms | **6.63 MiB** | 9.17 MiB |
| Nuxt | **8.40 KiB** | 26.57 KiB | **305.51 ms** | 322.24 ms | **21.12 ms** | 41.17 ms | **11.33 MiB** | 15.44 MiB |

### Mobile vs Sentry

Rejourney Mobile async capture pipeline और run loop gating का उपयोग करता है, इसलिए capture work app के critical rendering path से बाहर हो सकता है और high-interaction periods में automatically pause हो जाता है।

#### React Native Package Size

| Package | Version | Minified | Gzipped | Winner |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **10.2x छोटा minified JS bundle** |
| `@sentry/react-native` | `8.7.0` | 403 kB | 135.3 kB | - |

Sources: [`@rejourneyco/react-native` on Bundlephobia](https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17), [`@sentry/react-native` on Bundlephobia](https://bundlephobia.com/package/@sentry/react-native@8.7.0).

#### Mobile Performance

**Device:** iPhone 15 Pro (iOS 26)
**Environment:** Expo SDK 54, React Native New Architecture
**Test App:** [Merch App](https://merchcampus.com) production build with Mapbox Metal and Firebase
**Test Workload:** 46 complex feed items, Mapbox GL View, 124 API calls, 31 subcomponents, active gesture tracking, and real-time privacy redaction.

| Metric | Avg (ms) | Max (ms) | Min (ms) | Thread |
| :--- | ---: | ---: | ---: | :---: |
| **Main: UIKit + Metal Capture** | **12.4** | 28.2 | 8.1 | Main |
| **BG: Async Image Processing** | 42.5 | 88.0 | 32.4 | Background |
| **BG: Tar+Gzip Compression** | 14.2 | 32.5 | 9.6 | Background |
| **BG: Upload Handshake** | 0.8 | 2.4 | 0.3 | Background |
| **Total Main Thread Impact** | **12.4** | 28.2 | 8.1 | Main |

Total Main Thread Impact इस table में एकमात्र काम है जो app rendering को block करता है।

## Engineering

Engineering decisions और architecture: https://rejourney.co/engineering

## License

Client-side components (SDKs, CLIs) Apache 2.0 के तहत licensed हैं। Server-side components (backend, dashboard) SSPL 1.0 के तहत licensed हैं। Details के लिए [LICENSE-APACHE](../LICENSE-APACHE) और [LICENSE-SSPL](../LICENSE-SSPL) देखें।

---

## Translations

- [Arabic | العربية](README_AR.md)
- [Chinese (Simplified) | 简体中文](README_ZH_CN.md)
- [French | Français](README_FR.md)
- [German | Deutsch](README_DE.md)
- [Hindi | हिन्दी](README_HI.md)
- [Indonesian | Bahasa Indonesia](README_ID.md)
- [Japanese | 日本語](README_JA.md)
- [Korean | 한국어](README_KO.md)
- [Portuguese (Brazil) | Português do Brasil](README_PT_BR.md)
- [Spanish | Español](README_ES.md)
- [Turkish | Türkçe](README_TR.md)
