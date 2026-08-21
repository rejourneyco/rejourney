<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney 로고" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Rejourney Issue Detection" width="100%" />

  <p>
    <strong>AI Funnel Leak Detection 및 Conversion Acceleration</strong>
    <br />
    Rejourney로 funnel과 conversion leak을 수정하세요.
  </p>

  <p>
    <a href="https://rejourney.co"><strong>웹사이트 둘러보기 »</strong></a>
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

## 기능

### Pixel Perfect Capture
![Session Replay Theater](../dashboard/web-ui/public/images/session-replay-preview.png)

렌더링된 모든 픽셀을 캡처하는 True FPS 비디오 재생입니다. 경쟁 제품과 달리 Mapbox (Metal), custom shader, GPU 가속 view까지 모두 캡처합니다.

### AI Leak Detection
![Issues Feed](../dashboard/web-ui/public/images/readme-general-demo.png)

반복되는 funnel leak, rage tap, API failure, replay evidence를 수정 가능한 context packet으로 정렬합니다. Rejourney Marlin이 지원합니다.

### Error/ANR/Crash Detection
![ANR Issues](../dashboard/web-ui/public/images/anr-issues.png)

Application Not Responding 이벤트를 자동 감지하고 전체 thread dump와 main thread 분석을 제공합니다.

### Journey Mapping
![User Journeys](../dashboard/web-ui/public/images/readme-user-journeys.png)

사용자가 앱을 어떻게 이동하는지 시각화합니다. 마찰이 큰 drop-off 지점을 찾고 conversion funnel을 최적화하세요.

### Interaction Heat Maps
![Heatmaps](../dashboard/web-ui/public/images/heatmaps.png)

**사용자 참여를 정밀하게 시각화합니다.** 사용자가 어디를 탭하고, 스와이프하고, 스크롤하는지 확인해 UI 배치를 최적화하세요.

### Global Stability
![Geo Analytics](../dashboard/web-ui/public/images/geo-analytics.png)

지역별 성능과 안정성을 모니터링합니다. 글로벌 사용자에게 영향을 주기 전에 인프라 문제를 발견하세요.

### Growth Engines
![Growth Engines](../dashboard/web-ui/public/images/growth-engines.png)
사용자 retention과 loyalty segment를 추적합니다. 릴리스가 power user와 bounce rate에 어떤 영향을 주는지 이해하세요.

## 문서

전체 통합 가이드와 API 레퍼런스: https://rejourney.co/docs/reactnative/overview

## 기여

Rejourney에 기여하고 싶으신가요? Contributing Guide를 확인하세요: https://rejourney.co/docs/community/contributing

## 로컬 개발

로컬 개발은 [`local-k8s/`](../local-k8s)를 통해 production을 미러링합니다. 새 checkout에서는 `local-k8s/env.example`를 `.env.k8s.local`로 복사하고 필요한 local secret을 채운 뒤 `npm run ci:local`을 실행해 install, validate, build, deploy, migrate, local stack 시작을 수행합니다. 첫 bootstrap 이후에는 daily hot-reload workflow에 `npm run dev`를 사용하세요.

`docker-compose.selfhosted.yml`은 공식 single-node self-hosted deployment path입니다.

## Benchmarks

Rejourney는 방해되지 않도록 설계되었습니다. 작은 package footprint, 낮은 browser intensity, main thread를 비워 두는 mobile capture 작업을 제공합니다. Landing page benchmark gallery는 [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery)에서 바로 열 수 있습니다.

### Web vs PostHog

Next.js, SvelteKit, Nuxt 세 가지 web fixture에서 실행한 live Chromium benchmark입니다. 각 SDK는 framework별 3회 iteration 동안 live project endpoint에 대해 실행되었습니다. 아래 모든 metric은 낮을수록 좋습니다.

**Evidence:** [benchmark report](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [raw results](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [Rejourney live network captures](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [PostHog network captures](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Section | Winner | Margin |
| :--- | :---: | :--- |
| Bundlephobia gzipped package size | Rejourney | `posthog-js`보다 **3.9x 작음** |
| Median live SDK upload body | Rejourney | PostHog보다 **3.0x 작음** |
| Browser task duration | Rejourney | median task time **1.1x 낮음** |
| Script execution time | Rejourney | median script time **2.0x 낮음** |
| Final JS heap | Rejourney | median heap **1.4x 낮음** |

#### Package Size

Bundlephobia fixed-version package size입니다. Gzip은 transfer-size segment이고, minified는 gallery에 표시되는 전체 bar입니다.

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

Rejourney Mobile은 run loop gating이 포함된 async capture pipeline을 사용하므로 capture 작업이 앱의 critical rendering path 밖에서 수행되고, 상호작용이 많은 시기에는 자동으로 일시 중지됩니다.

#### React Native Package Size

| Package | Version | Minified | Gzipped | Winner |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **10.2x smaller minified JS bundle** |
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

Total Main Thread Impact는 이 표에서 앱 렌더링을 block하는 유일한 작업입니다.

## Engineering

Engineering decisions and architecture: https://rejourney.co/engineering

## 라이선스

클라이언트 측 구성 요소(SDKs, CLIs)는 Apache 2.0 라이선스를 따릅니다. 서버 측 구성 요소(backend, dashboard)는 SSPL 1.0 라이선스를 따릅니다. 자세한 내용은 [LICENSE-APACHE](../LICENSE-APACHE) 및 [LICENSE-SSPL](../LICENSE-SSPL)을 참조하세요.

---

## 번역

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
