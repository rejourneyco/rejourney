<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney ロゴ" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Rejourney Issue Detection" width="100%" />

  <p>
    <strong>AI による Funnel Leak 検出とコンバージョン加速</strong>
    <br />
    Rejourney でファネルとコンバージョンの漏れを修正します。
  </p>

  <p>
    <a href="https://rejourney.co"><strong>Web サイトを見る »</strong></a>
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

## 機能

### Pixel Perfect Capture
![Session Replay Theater](../dashboard/web-ui/public/images/session-replay-preview.png)

レンダリングされたすべてのピクセルをキャプチャする True FPS の動画再生です。競合とは異なり、Mapbox (Metal)、カスタム shader、GPU アクセラレーションされたビューまで含めてすべてキャプチャします。

### AI Leak Detection
![Issues Feed](../dashboard/web-ui/public/images/readme-general-demo.png)

繰り返し発生する funnel leak、rage tap、API 失敗、replay evidence を、修正に使えるコンテキストパケットとして順位付けします。Rejourney Marlin によって強化されています。

### Error/ANR/Crash Detection
![ANR Issues](../dashboard/web-ui/public/images/anr-issues.png)

Application Not Responding イベントを自動検出し、完全な thread dump と main thread 分析を提供します。

### Journey Mapping
![User Journeys](../dashboard/web-ui/public/images/readme-user-journeys.png)

ユーザーがアプリ内をどのように移動しているかを可視化します。摩擦の大きい離脱ポイントを特定し、コンバージョンファネルを最適化します。

### Interaction Heat Maps
![Heatmaps](../dashboard/web-ui/public/images/heatmaps.png)

**ユーザーエンゲージメントを精密に可視化します。** タップ、スワイプ、スクロールの場所を確認し、UI 配置を最適化できます。

### Global Stability
![Geo Analytics](../dashboard/web-ui/public/images/geo-analytics.png)

地域ごとのパフォーマンスと安定性を監視します。インフラの問題がグローバルユーザーに影響する前に発見できます。

### Growth Engines
![Growth Engines](../dashboard/web-ui/public/images/growth-engines.png)
ユーザーリテンションとロイヤルティセグメントを追跡します。リリースがパワーユーザーと bounce rate にどう影響するかを理解できます。

## ドキュメント

完全な統合ガイドと API リファレンス: https://rejourney.co/docs/reactnative/overview

## コントリビューション

Rejourney に貢献したい場合は、Contributing Guide をご覧ください: https://rejourney.co/docs/community/contributing

## ローカル開発

ローカル開発は [`local-k8s/`](../local-k8s) を通じて本番環境をミラーします。新しい checkout では `local-k8s/env.example` を `.env.k8s.local` にコピーし、必要な local secrets を入力してから `npm run ci:local` を実行します。これにより install、validate、build、deploy、migrate、local stack の起動が行われます。初回 bootstrap 後は、日常の hot-reload ワークフローに `npm run dev` を使います。

`docker-compose.selfhosted.yml` は公式の single-node self-hosted deployment path です。

## ベンチマーク

Rejourney は邪魔をしないように設計されています。小さな package footprint、低い browser intensity、そして main thread を空けておく mobile capture work を重視しています。Landing page の benchmark gallery は [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery) から直接開けます。

### Web vs PostHog

Next.js、SvelteKit、Nuxt の 3 つの web fixture に対する live Chromium benchmark です。各 SDK は live project endpoint に対して framework ごとに 3 iterations 実行されました。以下のすべての metric では低いほど良い結果です。

**Evidence:** [benchmark report](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [raw results](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [Rejourney live network captures](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [PostHog network captures](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Section | Winner | Margin |
| :--- | :---: | :--- |
| Bundlephobia gzipped package size | Rejourney | `posthog-js` より **3.9x 小さい** |
| Median live SDK upload body | Rejourney | PostHog より **3.0x 小さい** |
| Browser task duration | Rejourney | median task time が **1.1x 低い** |
| Script execution time | Rejourney | median script time が **2.0x 低い** |
| Final JS heap | Rejourney | median heap が **1.4x 低い** |

#### Package Size

Bundlephobia fixed-version package size。Gzip は転送サイズ部分、minified は gallery に表示される全体の bar です。

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

Rejourney Mobile は run loop gating 付きの非同期 capture pipeline を使うため、capture work はアプリの critical rendering path の外で実行でき、高インタラクション時には自動で pause されます。

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

Total Main Thread Impact は、この表の中でアプリの rendering を block する唯一の作業です。

## Engineering

Engineering decisions and architecture: https://rejourney.co/engineering

## ライセンス

クライアント側コンポーネント (SDKs, CLIs) は Apache 2.0 ライセンスです。サーバー側コンポーネント (backend, dashboard) は SSPL 1.0 ライセンスです。詳細は [LICENSE-APACHE](../LICENSE-APACHE) と [LICENSE-SSPL](../LICENSE-SSPL) を参照してください。

---

## 翻訳

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
