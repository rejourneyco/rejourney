<!-- AI_PROMPT_SECTION -->
**Menggunakan Cursor, Claude, atau ChatGPT?** Salin perintah integrasi dan tempelkan ke asisten AI Anda untuk membuat kode pengaturan secara otomatis.

<!-- /AI_PROMPT_SECTION -->

## Instalasi

Tambahkan paket Rejourney ke proyek Anda menggunakan npm atau yarn.

```bash
npm install @rejourneyco/browser
```

## Pengaturan Dasar

Inisialisasi dan mulai Rejourney di titik masuk aplikasi Anda.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` mengambil konfigurasi jarak jauh proyek Anda dan menyiapkan SDK. `start` memulai sesi, mendaftarkan pengunjung, dan (jika pemutaran ulang diaktifkan) memulai perekam rrweb. Keduanya async dan aman untuk dihubungi tanpa menunggu jika Anda tidak perlu melakukan apa pun setelah selesai.




> [!NOTE]
> `autoStart` adalah `false` secara default. Anda harus memanggil `start()` secara eksplisit, yang memungkinkan Anda melakukan perekaman di balik pemeriksaan izin. Untuk memulai secara otomatis setelah `init`, teruskan `{ autoStart: true }`.

### Integrasi Kerangka

Paket ini mengirimkan titik masuk khusus untuk kerangka kerja populer. Gunakan salah satu yang cocok dengan tumpukan Anda — atau gunakan vanilla API di atas dari kerangka apa pun.

---

#### Bereaksi

```javascript
import { RejourneyProvider, useRejourney } from '@rejourneyco/browser/react';

// Wrap your app root
function App() {
  return (
    <RejourneyProvider publicKey="pk_live_your_public_key" startOnMount>
      <YourApp />
    </RejourneyProvider>
  );
}

// Access the SDK anywhere inside the tree
function MyComponent() {
  const rejourney = useRejourney();

  function handlePurchase() {
    rejourney.logEvent('purchase_completed', { plan: 'pro' });
  }
}
```

`startOnMount` defaultnya adalah `false` di `RejourneyProvider`. Lewati `startOnMount` (atau `startOnMount={true}`) untuk mulai merekam segera setelah komponen dipasang.

---

#### Berikutnya.js

```javascript
// app/layout.tsx (or pages/_app.tsx)
import { RejourneyNext } from '@rejourneyco/browser/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <RejourneyNext publicKey="pk_live_your_public_key" />
        {children}
      </body>
    </html>
  );
}
```

`RejourneyNext` adalah komponen `'use client'` yang merender `null`. `startOnMount` defaultnya adalah `true`. Perubahan rute dilacak secara otomatis melalui History API.

---

#### Lihat

```javascript
// main.ts
import { createApp } from 'vue';
import { createRejourney } from '@rejourneyco/browser/vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createRejourney({
  publicKey: 'pk_live_your_public_key',
  router, // optional — enables per-route screen tracking via router.afterEach
}));

app.use(router).mount('#app');
```

Instans Rejourney tersedia melalui `app.config.globalProperties.$rejourney` dan melalui `inject('rejourney')`. Composable `useRejourney()` juga diekspor demi kenyamanan.

---

#### Selanjutnya

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

Akhiran `.client.ts` memastikan plugin ini hanya berjalan di browser. Instans Rejourney dimasukkan sebagai `$rejourney` dan tersedia melalui `useNuxtApp().$rejourney`.

---

#### Langsing / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` mengembalikan fungsi pembersihan yang memanggil `Rejourney.stop()` — Nilai pengembalian `onMount` Svelte digunakan sebagai callback penghancuran secara otomatis.

---

#### sudut

```javascript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { createRejourneyAppInitializer } from '@rejourneyco/browser/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: () => createRejourneyAppInitializer({ publicKey: 'pk_live_your_public_key' }),
      multi: true,
    },
  ],
};
```

`createRejourneyAppInitializer` mengembalikan pabrik yang menginisialisasi dan memulai Rejourney selama fase bootstrap Angular. Anda juga dapat menyuntikkan `RejourneyService` untuk API berbasis kelas.

---

#### campuran

```javascript
// app/root.tsx
import { RejourneyRemix } from '@rejourneyco/browser/remix';

export default function App() {
  return (
    <html>
      <body>
        <RejourneyRemix publicKey="pk_live_your_public_key" />
        <Outlet />
      </body>
    </html>
  );
}
```

`startOnMount` defaultnya adalah `true`. Perubahan rute dilacak secara otomatis.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` tanpa operasi di lingkungan SSR — ia memeriksa `window` sebelum dijalankan.

---

## Pengaturan Perekaman Jarak Jauh

Pengaturan Proyek dapat mengontrol default perekaman web tanpa penerapan kode. SDK membaca konfigurasi jarak jauh pada setiap panggilan `start()`. Konfigurasi jarak jauh dapat mengaktifkan atau menonaktifkan perekaman sepenuhnya, menyesuaikan daftar domain yang diizinkan, dan mengatur durasi sesi maksimum. Jika konfigurasi jarak jauh tidak tersedia, `start()` tidak akan dilanjutkan — hal ini disengaja untuk mencegah perekaman dalam status proyek yang tidak diketahui.

## Pelacakan Rute

Rejourney secara otomatis melacak perubahan halaman dan rute sehingga Anda dapat melihat konteks navigasi dalam pemutaran ulang. Ini diaktifkan secara default (`autoTrackRoutes: true`) dan bekerja dengan mencegat panggilan Riwayat API (`pushState`, `replaceState`) dan mendengarkan acara `popstate`.

### Nama Rute Khusus

Secara default, `window.location.pathname` digunakan sebagai nama layar. Untuk memberikan logika penamaan Anda sendiri, berikan fungsi `routeName`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Pelacakan Layar Manual

Untuk melacak layar secara manual (misalnya untuk perubahan tab atau transisi tampilan dalam halaman), hubungi `trackScreen` secara langsung:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Untuk menonaktifkan pelacakan rute otomatis dan hanya mengandalkan panggilan manual:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Identifikasi Pengguna

Kaitkan sesi dengan ID pengguna internal Anda untuk memfilter dan mencari pengguna tertentu di dasbor.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Pribadi:** Gunakan ID internal atau UUID. Jika Anda harus menggunakan PII (email, telepon), hash sebelum mengirim.

## Acara Khusus

Lacak tindakan pengguna yang berarti untuk memahami pola perilaku, masalah debug, dan memfilter pemutaran ulang sesi di dasbor.

### Penggunaan Dasar

```javascript
import { Rejourney } from '@rejourneyco/browser';

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties
Rejourney.logEvent('button_clicked', { buttonName: 'signup' });
```

### API

```typescript
Rejourney.logEvent(name: string, properties?: Record<string, unknown>)
```

| Parameter | Ketik | Diperlukan | Deskripsi |
|---|---|---|---|
| `name` | `string` | Ya | Nama acara — gunakan `snake_case` untuk konsistensi |
| `properties` | `object` | Tidak | Pasangan kunci-nilai yang dilampirkan pada kejadian spesifik ini |

### Contoh

```javascript
// E-commerce
Rejourney.logEvent('purchase_completed', {
  plan: 'pro',
  amount: 29.99,
  currency: 'USD'
});

// Onboarding
Rejourney.logEvent('onboarding_step', {
  step: 3,
  stepName: 'profile_setup',
  skipped: false
});

// Feature usage
Rejourney.logEvent('feature_used', {
  feature: 'dark_mode',
  enabled: true
});

// Errors / edge cases
Rejourney.logEvent('payment_failed', {
  errorCode: 'card_declined',
  retryCount: 2
});
```

### Bagaimana Acara Muncul di Dasbor

Peristiwa khusus disimpan per sesi dan terlihat di dua tempat:

1. **Garis Waktu Pemutaran Ulang Sesi** — Peristiwa muncul sebagai penanda pada garis waktu pemutaran ulang sehingga Anda dapat melompat ke momen yang tepat ketika suatu tindakan terjadi.
2. **Filter Arsip Sesi** — Filter daftar sesi berdasarkan:
   - **Nama acara** — Temukan semua sesi yang berisi peristiwa tertentu (mis. `purchase_completed`)
   - **Properti acara** — Mempersempit lebih lanjut berdasarkan kunci properti dan/atau nilai (misalnya `plan = pro`)
   - **Jumlah acara** — Temukan sesi dengan jumlah acara khusus tertentu (misalnya lebih dari 5 acara)

### Praktik Terbaik




> [!TIP]
> - Gunakan penamaan yang konsisten (`snake_case`, misalnya `button_clicked` bukan `Button Clicked`)
> - Jaga agar nilai properti tetap sederhana (string, angka, boolean) — hindari objek bertumpuk
> - Fokus pada tindakan yang penting untuk proses debug atau analisis — jangan mencatat semuanya
> - Properti ditujukan untuk konteks per peristiwa. Untuk atribut tingkat sesi, gunakan **Metadata** sebagai gantinya

---

## Metadata

Lampirkan pasangan nilai kunci tingkat sesi yang menggambarkan konteks pengguna atau sesi. Berbeda dengan peristiwa, metadata disetel satu kali per kunci dan berlaku untuk seluruh sesi.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

Nilai metadata harus `string`, `number`, atau `boolean`. Objek dan array tidak diterima.

### Kapan Menggunakan Metadata vs Peristiwa

| Kasus Penggunaan | Gunakan **Metadata** | Gunakan **Acara** |
|---|---|---|
| Paket berlangganan pengguna | `setMetadata('plan', 'pro')` | |
| Pengguna mengklik tombol | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| Varian pengujian A/B | `setMetadata('ab_variant', 'v2')` | |
| Pembelian selesai | | `logEvent('purchase', { amount: 29 })` |
| Peran pengguna | `setMetadata('role', 'admin')` | |
| Langkah orientasi tercapai | | `logEvent('onboarding_step', { step: 3 })` |

**Aturan praktisnya:** Jika menjelaskan *siapa pengguna* atau *di negara bagian mana*, gunakan metadata. Jika menggambarkan *sesuatu yang terjadi*, gunakan peristiwa.

## Kontrol Privasi

Semua input teks disamarkan secara default (`maskAllInputs: true`). Bidang bertopeng muncul sebagai masukan kosong dalam pemutaran ulang dan nilainya tidak pernah diambil di sumbernya. Kata sandi, email, telepon, dan jenis masukan sensitif lainnya selalu disembunyikan, apa pun pengaturan ini.

### Elemen Pemblokiran

Untuk sepenuhnya mengecualikan elemen DOM dari pemutaran ulang (tampak sebagai pengganti yang solid), tambahkan salah satu dari yang berikut:

- Kelas CSS: `rr-block`
- Atribut data: `data-rj-block` atau `data-rejourney-block`
- Pemilih CSS khusus melalui opsi konfigurasi `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Teks Penyamaran

Untuk menutupi konten teks suatu elemen (teks diganti namun bentuk elemen tetap terlihat), tambahkan salah satu hal berikut:

- Kelas CSS: `rr-mask`
- Atribut data: `data-rj-mask`, `data-rejourney-mask`, `data-private`, atau `data-testid` yang berisi `"password"`
- Pemilih CSS khusus melalui opsi konfigurasi `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Mengabaikan Elemen

Untuk menangkap bentuk elemen namun menyembunyikan semua peristiwa interaksi (klik, masukan) di dalamnya, tambahkan:

- Kelas CSS: `rr-ignore`
- Atribut data: `data-rj-ignore` atau `data-rejourney-ignore`

### Fungsi Masking Kustom

Untuk logika penyembunyian terprogram, gunakan `maskInputFn` atau `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Persetujuan Pengguna & GDPR




> [!IMPORTANT]
> **Anda adalah Pengontrol Data.** Rejourney bertindak sebagai Pemroses Data atas nama Anda. Anda bertanggung jawab untuk memastikan pengguna akhir Anda mendapat informasi tentang perekaman sesi dan bahwa Anda memiliki dasar hukum yang valid untuk memproses data mereka (misalnya persetujuan atau kepentingan yang sah).

#### Apa yang harus Anda lakukan

1. **Ungkapkan rekaman sesi dalam kebijakan privasi Anda.** Sertakan bahasa seperti:

   > * "Kami menggunakan Rejourney untuk merekam pemutaran ulang sesi anonim dan non-anonim dari aktivitas Anda di situs web kami untuk membantu kami meningkatkan produk dan mengurangi gesekan. Data sesi dapat mencakup interaksi halaman, informasi browser, dan perkiraan lokasi. Input teks dan elemen sensitif secara otomatis disembunyikan dan tidak pernah diambil."*

2. **Rekaman gerbang di belakang persetujuan** (direkomendasikan untuk pengguna EEA):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Hormati pilihan untuk tidak ikut serta.** Jika pengguna membatalkan persetujuannya, berhenti merekam dan hapus identitasnya:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Persetujuan terperinci melalui `setConsent`

Untuk kontrol yang lebih baik, gunakan `setConsent` untuk beralih analitik dan memutar ulang secara mandiri:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

Menyetel `analytics: false` dan `replay: false` secara bersamaan akan menghentikan sesi dan menghapus semua data antrean. Menyetel `replay: false` saja akan menghentikan perekam rrweb tetapi tetap menjalankan pelacakan peristiwa.

#### Pengambilan log konsol

Pengambilan log konsol dinonaktifkan secara default (`trackConsoleLogs: false`). Aktifkan hanya jika Anda membutuhkannya, karena log konsol dapat berisi PII bergantung pada praktik logging Anda:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Geolokasi

Geolokasi turunan IP (negara, wilayah, kota) dikumpulkan secara default. Jika `collectGeoLocation` adalah `false`, SDK meneruskan tanda yang menyembunyikan pencarian geolokasi IP di backend — tidak ada data lokasi yang disimpan untuk sesi tersebut:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Mode Hanya Amati (Tanpa Rekaman Visual)

Untuk mencatat kesalahan, tugas panjang, aktivitas jaringan, dan analitik **tanpa** merekam tayangan ulang visual, atur `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Saat diaktifkan, semua telemetri dikumpulkan tetapi tidak ada perekaman rrweb yang berjalan — sesi tidak akan muncul di halaman Pemutaran Ulang Anda, namun analisis lengkap, kesalahan, dan data jaringan masih direkam. Berguna ketika pengguna telah memilih untuk tidak ikut rekaman visual namun Anda masih menginginkan observasi.

> **Catatan:** Anda dapat menyetelnya secara bersyarat per pengguna, misalnya berdasarkan preferensi persetujuan yang disimpan:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Deteksi Bot

Bot dan browser otomatis diabaikan secara default (`ignoreBots: true`). Penulis naskah drama, Dalang, Selenium, dan klien berbasis webdriver lainnya disembunyikan. Untuk merekam sesi otomatisasi (misalnya untuk peralatan internal):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Untuk memberikan pola deteksi bot khusus:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Pengambilan Permintaan Jaringan

Permintaan jaringan (pengambilan dan XHR) dicegat dan dicatat secara default (`autoTrackNetwork: true`). Ukuran isi permintaan dan respons adalah **bukan** yang ditangkap secara default (`networkCaptureSizes: false`). URL, metode, kode status, dan durasi selalu diambil.

Untuk mengecualikan URL tertentu:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Untuk memfilter atau menyunting permintaan sebelum dikirim:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Referensi Konfigurasi

| Pilihan | Ketik | Bawaan | Deskripsi |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Hubungi `start()` secara otomatis setelah `init()` selesai |
| `disableInDev` | `boolean` | `false` | Menekan perekaman pada `localhost` dan `127.0.0.1` |
| `debug` | `boolean` | `false` | Aktifkan logging SDK verbose ke konsol browser |
| `enabled` | `boolean` | `true` | Sakelar pemutus utama — diatur ke `false` untuk mencegah perekaman apa pun |
| `observeOnly` | `boolean` | `false` | Tangkap analitik/kesalahan/jaringan tanpa pemutaran ulang visual |
| `captureReplay` | `boolean` | `true` | Aktifkan pengambilan ulang visual rrweb |
| `allowedDomains` | `string[]` | `[]` | Batasi perekaman pada domain tertentu. Kosong berarti semua domain diperbolehkan. Mendukung wildcard `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | Durasi sesi maksimal dalam milidetik (default: 30 menit) |
| `collectGeoLocation` | `boolean` | `true` | Kumpulkan negara/wilayah/kota yang berasal dari IP |
| `captureAttribution` | `boolean` | `true` | Ambil parameter UTM, perujuk, dan URL entri pada sesi dimulai |
| `ignoreBots` | `boolean` | `true` | Menekan perekaman untuk bot dan driver web yang terdeteksi |
| `recordAutomation` | `boolean` | `false` | Izinkan perekaman sesi Penulis Drama/Dalang/Selenium |
| `autoTrackRoutes` | `boolean` | `true` | Lacak perubahan rute secara otomatis melalui History API |
| `routeName` | `(location: Location) => string` | — | Fungsi khusus untuk mendapatkan nama layar dari `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Mencegat dan mencatat permintaan pengambilan/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URL yang akan dikecualikan dari pelacakan jaringan |
| `networkCaptureSizes` | `boolean` | `false` | Sertakan ukuran isi permintaan/respons dalam log jaringan |
| `trackConsoleLogs` | `boolean` | `false` | Tangkap keluaran `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | Deteksi dan catat tugas yang panjang (blok thread JS > 50 md) |
| `trackResourceErrors` | `boolean` | `true` | Menangkap pemuatan sumber daya yang gagal (gambar, skrip, lembar gaya) |
| `maskAllInputs` | `boolean` | `true` | Sembunyikan semua nilai input teks dalam tayangan ulang |
| `blockClass` | `string \| RegExp` | `'rr-block'` | Kelas CSS untuk sepenuhnya memblokir elemen dari replay |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | Pemilih CSS untuk sepenuhnya memblokir elemen dari replay |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | Kelas CSS untuk mengabaikan peristiwa interaksi pada suatu elemen |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | Pemilih CSS untuk mengabaikan peristiwa interaksi |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | Kelas CSS untuk menutupi konten teks dalam tayangan ulang |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | Pemilih CSS untuk menutupi konten teks |
| `maskInputFn` | `(value, element) => string` | — | Fungsi khusus untuk mengubah nilai masukan sebelum ditangkap |
| `maskTextFn` | `(text, element) => string` | — | Fungsi khusus untuk mengubah konten teks sebelum ditangkap |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Fungsi khusus untuk memutuskan per pemuatan halaman apakah akan merekam |
| `beforeSendEvent` | `(event) => event \| null` | — | Filter atau ubah acara sebelum dimasukkan ke dalam antrean. Kembalikan `null` untuk menjatuhkan |
| `beforeSendNetwork` | `(request) => request \| null` | — | Filter atau ubah entri jaringan sebelum dimasukkan ke dalam antrean. Kembalikan `null` untuk menjatuhkan |
| `onAuthError` | `(error) => void` | — | Dipanggil ketika SDK gagal mengautentikasi dengan backend |

## Menghentikan Perekaman

Panggil `stop()` untuk mengakhiri sesi, menghapus semua acara yang tertunda, dan membersihkan semua pendengar SDK:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` aman untuk dihubungi berkali-kali. Setelah berhenti, panggil lagi `start()` untuk memulai sesi baru.

## ID Sesi

Akses ID sesi saat ini untuk menghubungkan sesi Rejourney dengan log atau alat dukungan Anda sendiri:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Mengembalikan `null` jika tidak ada sesi yang aktif.

## Pembantu Status

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
