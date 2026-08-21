<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney Logo" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Rejourney Issue Detection" width="100%" />

  <p>
    <strong>AI 漏斗泄漏检测与转化加速</strong>
    <br />
    使用 Rejourney 修复漏斗和转化泄漏。
  </p>

  <p>
    <a href="https://rejourney.co"><strong>访问官网 »</strong></a>
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

## 功能

### 像素级精准采集
![Session Replay Theater](../dashboard/web-ui/public/images/session-replay-preview.png)

以真实 FPS 回放视频，捕获每一个渲染像素。不同于竞品，我们会捕获全部内容，包括 Mapbox (Metal)、自定义 shader 和 GPU 加速视图。

### AI Leak Detection
![Issues Feed](../dashboard/web-ui/public/images/readme-general-demo.png)

将重复出现的 funnel leak、rage tap、API failure 和 replay evidence 排序为可直接修复的上下文包。由 Rejourney Marlin 提供支持。

### Error/ANR/Crash Detection
![ANR Issues](../dashboard/web-ui/public/images/anr-issues.png)

自动检测 Application Not Responding 事件，并提供完整 thread dump 和 main thread 分析。

### Journey Mapping
![User Journeys](../dashboard/web-ui/public/images/readme-user-journeys.png)

可视化用户在应用中的导航路径。识别高摩擦 drop-off 点，并优化转化漏斗。

### Interaction Heat Maps
![Heatmaps](../dashboard/web-ui/public/images/heatmaps.png)

**精准可视化用户互动。** 查看用户在哪里点击、滑动和滚动，以优化 UI 布局。

### Global Stability
![Geo Analytics](../dashboard/web-ui/public/images/geo-analytics.png)

监控不同地区的性能和稳定性。在基础设施问题影响全球用户之前发现它们。

### Growth Engines
![Growth Engines](../dashboard/web-ui/public/images/growth-engines.png)
跟踪用户留存和忠诚度分群。了解版本发布如何影响核心用户与跳出率。

## 文档

完整集成指南和 API 参考: https://rejourney.co/docs/reactnative/overview

## 贡献

想为 Rejourney 做贡献？请查看我们的贡献指南: https://rejourney.co/docs/community/contributing

## 本地开发

本地开发通过 [`local-k8s/`](../local-k8s) 镜像生产环境。全新 checkout 后，将 `local-k8s/env.example` 复制为 `.env.k8s.local`，填写所需的本地 secrets，然后运行 `npm run ci:local` 完成安装、校验、构建、部署、迁移并启动本地 stack。首次 bootstrap 后，日常 hot-reload workflow 使用 `npm run dev`。

`docker-compose.selfhosted.yml` 是官方单节点 self-hosted 部署路径。

## Benchmarks

Rejourney 设计为尽量不打扰应用：小 package footprint、低 browser intensity，以及能保持 main thread 空闲的 mobile capture 工作。Landing page benchmark gallery 可直接访问 [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery)。

### Web vs PostHog

在三个 web fixtures 上运行 live Chromium benchmark：Next.js、SvelteKit 和 Nuxt。每个 SDK 针对 live project endpoint，每个 framework 运行 3 次 iteration。下面所有指标都是越低越好。

**Evidence:** [benchmark report](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [raw results](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [Rejourney live network captures](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [PostHog network captures](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Section | Winner | Margin |
| :--- | :---: | :--- |
| Bundlephobia gzipped package size | Rejourney | 比 `posthog-js` **小 3.9x** |
| Median live SDK upload body | Rejourney | 比 PostHog **小 3.0x** |
| Browser task duration | Rejourney | median task time **低 1.1x** |
| Script execution time | Rejourney | median script time **低 2.0x** |
| Final JS heap | Rejourney | median heap **低 1.4x** |

#### Package Size

Bundlephobia fixed-version package size。Gzip 是传输大小部分；minified 是 gallery 中展示的完整条形。

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

Rejourney Mobile 使用带 run loop gating 的异步 capture pipeline，因此 capture work 可以在应用关键渲染路径之外执行，并在高交互时期自动暂停。

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

Total Main Thread Impact 是表中唯一会阻塞应用渲染的工作。

## Engineering

Engineering decisions and architecture: https://rejourney.co/engineering

## 许可证

客户端组件（SDKs、CLIs）采用 Apache 2.0 许可证。服务器端组件（backend、dashboard）采用 SSPL 1.0 许可证。详情请参阅 [LICENSE-APACHE](../LICENSE-APACHE) 和 [LICENSE-SSPL](../LICENSE-SSPL)。

---

## 翻译

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
