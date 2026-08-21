<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney Logosu" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Rejourney Issue Detection" width="100%" />

  <p>
    <strong>Yapay Zeka Destekli Funnel Leak Tespiti ve Dönüşüm Hızlandırma</strong>
    <br />
    Funnel ve dönüşüm kaçaklarını Rejourney ile düzeltin.
  </p>

  <p>
    <a href="https://rejourney.co"><strong>Web sitesini keşfet »</strong></a>
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

## Özellikler

### Pixel Perfect Yakalama
![Session Replay Theater](../dashboard/web-ui/public/images/session-replay-preview.png)

İşlenen her pikseli yakalayan gerçek FPS video oynatma. Rakiplerin aksine Mapbox (Metal), özel shader'lar ve GPU hızlandırmalı görünümler dahil her şeyi yakalarız.

### Yapay Zeka Leak Tespiti
![Issues Feed](../dashboard/web-ui/public/images/readme-general-demo.png)

Tekrarlanan funnel leak'lerini, rage tap'leri, API hatalarını ve replay kanıtlarını düzeltmeye hazır bağlam paketlerine sıralar. Rejourney Marlin tarafından desteklenir.

### Hata/ANR/Crash Tespiti
![ANR Issues](../dashboard/web-ui/public/images/anr-issues.png)

Application Not Responding olaylarını tam thread dump'ları ve main thread analiziyle otomatik olarak tespit eder.

### Journey Mapping
![User Journeys](../dashboard/web-ui/public/images/readme-user-journeys.png)

Kullanıcıların uygulamanızda nasıl gezindiğini görselleştirin. Yüksek sürtünmeli drop-off noktalarını bulun ve dönüşüm funnel'larını optimize edin.

### Etkileşim Isı Haritaları
![Heatmaps](../dashboard/web-ui/public/images/heatmaps.png)

**Kullanıcı etkileşimini hassas biçimde görselleştirin.** UI yerleşimini optimize etmek için nerede dokunduklarını, kaydırdıklarını ve scroll yaptıklarını görün.

### Küresel Stabilite
![Geo Analytics](../dashboard/web-ui/public/images/geo-analytics.png)

Farklı bölgelerde performans ve stabiliteyi izleyin. Altyapı sorunlarını küresel kitlenizi etkilemeden önce yakalayın.

### Growth Engines
![Growth Engines](../dashboard/web-ui/public/images/growth-engines.png)
Kullanıcı tutma ve sadakat segmentlerini takip edin. Sürümlerin power user'larınızı bounce oranlarına kıyasla nasıl etkilediğini anlayın.

## Dokümantasyon

Tam entegrasyon rehberleri ve API referansı: https://rejourney.co/docs/reactnative/overview

## Katkıda bulunma

Rejourney'e katkıda bulunmak ister misiniz? Katkı rehberimize bakın: https://rejourney.co/docs/community/contributing

## Yerel geliştirme

Yerel geliştirme [`local-k8s/`](../local-k8s) üzerinden prod ortamını yansıtır. Yeni bir checkout için `local-k8s/env.example` dosyasını `.env.k8s.local` olarak kopyalayın, gerekli yerel secret'ları doldurun, ardından yerel stack'i kurmak, doğrulamak, derlemek, deploy etmek, migrate etmek ve başlatmak için `npm run ci:local` çalıştırın. İlk bootstrap'ten sonra günlük hot-reload akışı için `npm run dev` kullanın.

`docker-compose.selfhosted.yml`, resmi tek düğümlü self-hosted deployment yoludur.

## Benchmark'lar

Rejourney aradan çekilmek için tasarlanmıştır: küçük paket izi, düşük browser yoğunluğu ve main thread'i boş tutan mobil capture işi. Landing page benchmark galerisine doğrudan [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery) adresinden erişilebilir.

### Web vs PostHog

Üç web fixture'ı üzerinde canlı Chromium benchmark'ı: Next.js, SvelteKit ve Nuxt. Her SDK canlı bir proje endpoint'ine framework başına 3 iterasyonla çalıştırıldı. Aşağıdaki tüm metriklerde daha düşük daha iyidir.

**Kanıt:** [benchmark raporu](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [ham sonuçlar](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [Rejourney canlı ağ kayıtları](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [PostHog ağ kayıtları](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Bölüm | Kazanan | Fark |
| :--- | :---: | :--- |
| Bundlephobia gzipped package size | Rejourney | `posthog-js`'den **3.9x daha küçük** |
| Median live SDK upload body | Rejourney | PostHog'dan **3.0x daha küçük** |
| Browser task duration | Rejourney | medyan task süresi **1.1x daha düşük** |
| Script execution time | Rejourney | medyan script süresi **2.0x daha düşük** |
| Final JS heap | Rejourney | medyan heap **1.4x daha düşük** |

#### Paket boyutu

Bundlephobia sabit sürüm paket boyutu. Gzip aktarım boyutu segmentidir; minified galeride gösterilen tam çubuktur.

| Paket | Sürüm | Minified | Gzipped | Kaynak |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/browser` | `0.1.0` | **52.3 kB** | **15.9 kB** | [Bundlephobia](https://bundlephobia.com/package/@rejourneyco/browser@0.1.0) |
| `posthog-js` | `1.374.2` | 187.5 kB | 61.5 kB | [Bundlephobia](https://bundlephobia.com/package/posthog-js@1.374.2) |

#### Canlı Web Benchmark Metrikleri

| App | Rejourney upload | PostHog upload | Rejourney task | PostHog task | Rejourney script | PostHog script | Rejourney heap | PostHog heap |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next.js | **21.29 KiB** | 45.35 KiB | **417.96 ms** | 449.91 ms | **160.46 ms** | 185.06 ms | **15.81 MiB** | 16.19 MiB |
| SvelteKit | **8.38 KiB** | 24.99 KiB | **268.72 ms** | 304.03 ms | **19.35 ms** | 42.02 ms | **6.63 MiB** | 9.17 MiB |
| Nuxt | **8.40 KiB** | 26.57 KiB | **305.51 ms** | 322.24 ms | **21.12 ms** | 41.17 ms | **11.33 MiB** | 15.44 MiB |

### Mobile vs Sentry

Rejourney Mobile, run loop gating içeren asenkron capture pipeline kullanır; böylece capture işi uygulamanın kritik render yolunun dışında yapılabilir ve yüksek etkileşim dönemlerinde otomatik olarak duraklar.

#### React Native Paket Boyutu

| Paket | Sürüm | Minified | Gzipped | Kazanan |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **10.2x daha küçük minified JS bundle** |
| `@sentry/react-native` | `8.7.0` | 403 kB | 135.3 kB | - |

Kaynaklar: [Bundlephobia'da `@rejourneyco/react-native`](https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17), [Bundlephobia'da `@sentry/react-native`](https://bundlephobia.com/package/@sentry/react-native@8.7.0).

#### Mobil Performans

**Cihaz:** iPhone 15 Pro (iOS 26)
**Ortam:** Expo SDK 54, React Native New Architecture
**Test uygulaması:** [Merch App](https://merchcampus.com) Mapbox Metal ve Firebase içeren production build
**Test iş yükü:** 46 karmaşık feed öğesi, Mapbox GL View, 124 API çağrısı, 31 alt bileşen, aktif gesture tracking ve gerçek zamanlı privacy redaction.

| Metrik | Ort. (ms) | Maks (ms) | Min (ms) | Thread |
| :--- | ---: | ---: | ---: | :---: |
| **Main: UIKit + Metal Capture** | **12.4** | 28.2 | 8.1 | Main |
| **BG: Async Image Processing** | 42.5 | 88.0 | 32.4 | Background |
| **BG: Tar+Gzip Compression** | 14.2 | 32.5 | 9.6 | Background |
| **BG: Upload Handshake** | 0.8 | 2.4 | 0.3 | Background |
| **Total Main Thread Impact** | **12.4** | 28.2 | 8.1 | Main |

Total Main Thread Impact, bu tabloda uygulama render'ını engelleyen tek iştir.

## Mühendislik

Mühendislik kararları ve mimari: https://rejourney.co/engineering

## Lisans

İstemci tarafı bileşenleri (SDK'lar, CLI'lar) Apache 2.0 lisanslıdır. Sunucu tarafı bileşenleri (backend, dashboard) SSPL 1.0 lisanslıdır. Ayrıntılar için [LICENSE-APACHE](../LICENSE-APACHE) ve [LICENSE-SSPL](../LICENSE-SSPL) dosyalarına bakın.

---

## Çeviriler

- [Arapça | العربية](README_AR.md)
- [Basitleştirilmiş Çince | 简体中文](README_ZH_CN.md)
- [Fransızca | Français](README_FR.md)
- [Almanca | Deutsch](README_DE.md)
- [Hintçe | हिन्दी](README_HI.md)
- [Endonezce | Bahasa Indonesia](README_ID.md)
- [Japonca | 日本語](README_JA.md)
- [Korece | 한국어](README_KO.md)
- [Portekizce (Brezilya) | Português do Brasil](README_PT_BR.md)
- [İspanyolca | Español](README_ES.md)
- [Türkçe | Türkçe](README_TR.md)
