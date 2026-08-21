<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Logo Rejourney" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="Deteksi masalah Rejourney" width="100%" />

  <p>
    <strong>Deteksi Kebocoran Funnel dengan AI dan Akselerasi Konversi</strong>
    <br />
    Perbaiki kebocoran funnel dan konversi dengan Rejourney.
  </p>

  <p>
    <a href="https://rejourney.co"><strong>Jelajahi situs web »</strong></a>
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

## Fitur

### Capture Pixel Perfect
![Session Replay Theater](../dashboard/web-ui/public/images/session-replay-preview.png)

Pemutaran video FPS nyata yang menangkap setiap piksel yang dirender. Tidak seperti kompetitor, kami menangkap semuanya, termasuk Mapbox (Metal), shader kustom, dan view yang dipercepat GPU.

### Deteksi Leak dengan AI
![Issues Feed](../dashboard/web-ui/public/images/readme-general-demo.png)

Mengurutkan leak funnel berulang, rage tap, kegagalan API, dan bukti replay menjadi paket konteks yang siap diperbaiki. Didukung oleh Rejourney Marlin.

### Deteksi Error/ANR/Crash
![ANR Issues](../dashboard/web-ui/public/images/anr-issues.png)

Deteksi otomatis event Application Not Responding dengan thread dump lengkap dan analisis main thread.

### Journey Mapping
![User Journeys](../dashboard/web-ui/public/images/readme-user-journeys.png)

Visualisasikan cara pengguna menjelajahi aplikasi Anda. Identifikasi titik drop-off dengan friksi tinggi dan optimalkan funnel konversi.

### Heat Map Interaksi
![Heatmaps](../dashboard/web-ui/public/images/heatmaps.png)

**Visualisasikan engagement pengguna secara presisi.** Lihat tempat mereka mengetuk, menggeser, dan menggulir untuk mengoptimalkan penempatan UI.

### Stabilitas Global
![Geo Analytics](../dashboard/web-ui/public/images/geo-analytics.png)

Pantau performa dan stabilitas di berbagai wilayah. Temukan masalah infrastruktur sebelum berdampak pada audiens global Anda.

### Growth Engines
![Growth Engines](../dashboard/web-ui/public/images/growth-engines.png)
Lacak retensi pengguna dan segmen loyalitas. Pahami bagaimana rilis memengaruhi power user dibandingkan bounce rate.

## Dokumentasi

Panduan integrasi lengkap dan referensi API: https://rejourney.co/docs/reactnative/overview

## Berkontribusi

Ingin berkontribusi ke Rejourney? Lihat panduan kontribusi kami: https://rejourney.co/docs/community/contributing

## Pengembangan Lokal

Pengembangan lokal mencerminkan produksi melalui [`local-k8s/`](../local-k8s). Untuk checkout baru, salin `local-k8s/env.example` ke `.env.k8s.local`, isi secret lokal yang diperlukan, lalu jalankan `npm run ci:local` untuk menginstal, memvalidasi, membangun, deploy, migrasi, dan memulai stack lokal. Setelah bootstrap pertama, gunakan `npm run dev` untuk workflow harian dengan hot reload.

`docker-compose.selfhosted.yml` adalah jalur deployment self-hosted single-node resmi.

## Benchmark

Rejourney dirancang agar tidak mengganggu: jejak paket kecil, intensitas browser rendah, dan pekerjaan capture mobile yang menjaga main thread tetap ringan. Galeri benchmark landing page dapat dibuka langsung di [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery).

### Web vs PostHog

Benchmark Chromium live pada tiga fixture web: Next.js, SvelteKit, dan Nuxt. Setiap SDK dijalankan terhadap endpoint proyek live selama 3 iterasi per framework. Lebih rendah lebih baik untuk semua metrik.

**Bukti:** [laporan benchmark](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md), [hasil mentah](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json), [capture jaringan live Rejourney](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json), [capture jaringan PostHog](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| Bagian | Pemenang | Margin |
| :--- | :---: | :--- |
| Ukuran paket gzip Bundlephobia | Rejourney | **3.9x lebih kecil** dari `posthog-js` |
| Median body upload SDK live | Rejourney | **3.0x lebih kecil** dari PostHog |
| Durasi task browser | Rejourney | waktu task median **1.1x lebih rendah** |
| Waktu eksekusi script | Rejourney | waktu script median **2.0x lebih rendah** |
| Heap JS akhir | Rejourney | heap median **1.4x lebih rendah** |

#### Ukuran Paket

Ukuran paket versi tetap dari Bundlephobia. Gzip adalah bagian ukuran transfer; minified adalah bar penuh yang ditampilkan di galeri.

| Paket | Versi | Minified | Gzipped | Sumber |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/browser` | `0.1.0` | **52.3 kB** | **15.9 kB** | [Bundlephobia](https://bundlephobia.com/package/@rejourneyco/browser@0.1.0) |
| `posthog-js` | `1.374.2` | 187.5 kB | 61.5 kB | [Bundlephobia](https://bundlephobia.com/package/posthog-js@1.374.2) |

#### Metrik Benchmark Web Live

| App | Upload Rejourney | Upload PostHog | Task Rejourney | Task PostHog | Script Rejourney | Script PostHog | Heap Rejourney | Heap PostHog |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next.js | **21.29 KiB** | 45.35 KiB | **417.96 ms** | 449.91 ms | **160.46 ms** | 185.06 ms | **15.81 MiB** | 16.19 MiB |
| SvelteKit | **8.38 KiB** | 24.99 KiB | **268.72 ms** | 304.03 ms | **19.35 ms** | 42.02 ms | **6.63 MiB** | 9.17 MiB |
| Nuxt | **8.40 KiB** | 26.57 KiB | **305.51 ms** | 322.24 ms | **21.12 ms** | 41.17 ms | **11.33 MiB** | 15.44 MiB |

### Mobile vs Sentry

Rejourney Mobile menggunakan pipeline capture asinkron dengan run loop gating, sehingga pekerjaan capture dapat berjalan di luar jalur rendering kritis aplikasi dan otomatis berhenti sementara saat interaksi tinggi.

#### Ukuran Paket React Native

| Paket | Versi | Minified | Gzipped | Pemenang |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **bundle JS minified 10.2x lebih kecil** |
| `@sentry/react-native` | `8.7.0` | 403 kB | 135.3 kB | - |

Sumber: [`@rejourneyco/react-native` di Bundlephobia](https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17), [`@sentry/react-native` di Bundlephobia](https://bundlephobia.com/package/@sentry/react-native@8.7.0).

#### Performa Mobile

**Perangkat:** iPhone 15 Pro (iOS 26)
**Lingkungan:** Expo SDK 54, React Native New Architecture
**Aplikasi uji:** [Merch App](https://merchcampus.com) build produksi dengan Mapbox Metal dan Firebase
**Beban uji:** 46 item feed kompleks, Mapbox GL View, 124 panggilan API, 31 subkomponen, tracking gesture aktif, dan redaksi privasi real-time.

| Metrik | Rata-rata (ms) | Maks (ms) | Min (ms) | Thread |
| :--- | ---: | ---: | ---: | :---: |
| **Main: UIKit + Metal Capture** | **12.4** | 28.2 | 8.1 | Main |
| **BG: Async Image Processing** | 42.5 | 88.0 | 32.4 | Background |
| **BG: Tar+Gzip Compression** | 14.2 | 32.5 | 9.6 | Background |
| **BG: Upload Handshake** | 0.8 | 2.4 | 0.3 | Background |
| **Total Main Thread Impact** | **12.4** | 28.2 | 8.1 | Main |

Total Main Thread Impact adalah satu-satunya pekerjaan pada tabel ini yang memblokir rendering aplikasi.

## Engineering

Keputusan engineering dan arsitektur: https://rejourney.co/engineering

## Lisensi

Komponen sisi klien (SDK, CLI) dilisensikan di bawah Apache 2.0. Komponen sisi server (backend, dashboard) dilisensikan di bawah SSPL 1.0. Lihat [LICENSE-APACHE](../LICENSE-APACHE) dan [LICENSE-SSPL](../LICENSE-SSPL) untuk detail.

---

## Terjemahan

- [Arab | العربية](README_AR.md)
- [Tionghoa Sederhana | 简体中文](README_ZH_CN.md)
- [Prancis | Français](README_FR.md)
- [Jerman | Deutsch](README_DE.md)
- [Hindi | हिन्दी](README_HI.md)
- [Indonesia | Bahasa Indonesia](README_ID.md)
- [Jepang | 日本語](README_JA.md)
- [Korea | 한국어](README_KO.md)
- [Portugis (Brasil) | Português do Brasil](README_PT_BR.md)
- [Spanyol | Español](README_ES.md)
- [Turki | Türkçe](README_TR.md)
