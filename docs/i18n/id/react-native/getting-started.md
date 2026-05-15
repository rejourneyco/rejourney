<!-- AI_PROMPT_SECTION -->
**Menggunakan Cursor, Claude, atau ChatGPT?** Salin perintah integrasi dan tempelkan ke asisten AI Anda untuk membuat kode pengaturan secara otomatis.

<!-- /AI_PROMPT_SECTION -->

## Instalasi

Tambahkan paket Rejourney ke proyek Anda menggunakan npm atau yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney memerlukan kode asli dan tidak kompatibel dengan Expo Go. Gunakan build pengembangan:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## Pengaturan 3 Jalur

Inisialisasi dan mulai Rejourney di bagian atas aplikasi Anda (misalnya di App.tsx atau index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Tidak memerlukan pembungkus penyedia. Perekaman segera dimulai.

## Pengaturan Perekaman Jarak Jauh

Pengaturan Proyek dapat mengontrol default perekaman React Native tanpa mengirimkan build aplikasi baru. Versi SDK yang didukung membaca pengaturan FPS perekaman jarak jauh pada awal sesi; defaultnya adalah 1 FPS, dan admin proyek dapat memilih 1, 2, atau 3 FPS. Jika konfigurasi jarak jauh tidak tersedia, SDK kembali ke perilaku pengambilan lokal/default.

## Pelacakan Layar

Rejourney secara otomatis melacak perubahan layar sehingga Anda dapat melihat lokasi pengguna di aplikasi Anda selama pemutaran ulang. Pilih pengaturan yang cocok dengan perpustakaan navigasi Anda:

### Expo Router (Otomatis)

Jika Anda menggunakan **Expo Router**, pelacakan layar langsung berfungsi. Tidak diperlukan kode tambahan.




> [!TIP]
> **Menggunakan nama layar khusus?** Jika Anda menggunakan Expo Router tetapi ingin memberikan nama layar Anda sendiri secara manual, lihat bagian [Nama Layar Khusus](#custom-screen-names) di bawah.

---

### React Navigation

Jika Anda menggunakan **React Navigation** (`@react-navigation/native`), gunakan kait `useNavigationTracking` di root Anda `NavigationContainer`:

```javascript
import { Rejourney } from '@rejourneyco/react-native';
import { NavigationContainer } from '@react-navigation/native';

function App() {
  const navigationTracking = Rejourney.useNavigationTracking();

  return (
    <NavigationContainer {...navigationTracking}>
      {/* Your screens */}
    </NavigationContainer>
  );
}
```

---

### Nama Layar Khusus

Jika Anda ingin menentukan nama layar secara manual (misalnya, untuk konsistensi analitik atau jika Anda tidak menggunakan pustaka di atas), gunakan metode `trackScreen`.

#### Untuk pengguna Expo Router:
Untuk menggunakan nama khusus dengan Expo Router, Anda harus menonaktifkan pelacakan otomatis terlebih dahulu di konfigurasi Anda:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Panggilan pelacakan manual:
Hubungi `trackScreen` setiap kali terjadi perubahan layar:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Identifikasi Pengguna

Kaitkan sesi dengan ID pengguna internal Anda untuk memfilter dan mencari pengguna tertentu di dasbor.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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
import { Rejourney } from '@rejourneyco/react-native';

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
import { Rejourney } from '@rejourneyco/react-native';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

### Kapan Menggunakan Metadata vs Peristiwa

| Kasus Penggunaan | Gunakan **Metadata** | Gunakan **Acara** |
|---|---|---|
| Paket berlangganan pengguna |  `setMetadata('plan', 'pro')` | |
| Pengguna mengklik tombol | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| Varian pengujian A/B |  `setMetadata('ab_variant', 'v2')` | |
| Pembelian selesai | |  `logEvent('purchase', { amount: 29 })` |
| Peran pengguna |  `setMetadata('role', 'admin')` | |
| Langkah orientasi tercapai | |  `logEvent('onboarding_step', { step: 3 })` |

**Aturan praktisnya:** Jika menjelaskan *siapa pengguna* atau *di negara bagian mana*, gunakan metadata. Jika menggambarkan *sesuatu yang terjadi*, gunakan peristiwa.

## Kontrol Privasi

Input teks dan tampilan kamera secara otomatis ditutupi secara default. Admin proyek dapat mengubah tingkat penyembunyian input teks default di Pengaturan Proyek untuk versi SDK yang didukung; versi SDK yang lebih lama mengabaikan pengaturan jarak jauh tersebut dan mempertahankan perilaku penyembunyian yang ada. Bidang aman/kata sandi, tampilan kamera, dan topeng eksplisit tetap terlindungi.

Untuk menyembunyikan UI sensitif tambahan secara manual, gabungkan komponen dalam komponen `Mask`:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Konten bertopeng muncul sebagai persegi panjang padat dalam pemutaran ulang dan tidak pernah diambil dari sumbernya.

### Persetujuan Pengguna & GDPR




> [!IMPORTANT]
> **Anda adalah Pengontrol Data.** Rejourney bertindak sebagai Pemroses Data atas nama Anda. Anda bertanggung jawab untuk memastikan pengguna akhir Anda mendapat informasi tentang perekaman sesi dan bahwa Anda memiliki dasar hukum yang valid untuk memproses data mereka (misalnya persetujuan atau kepentingan yang sah).

#### Apa yang harus Anda lakukan

1. **Ungkapkan rekaman sesi dalam kebijakan privasi aplikasi Anda.** Sertakan bahasa seperti:

   > * "Kami menggunakan Rejourney untuk merekam tayangan ulang sesi anonim DAN non-anonim dari aktivitas dalam aplikasi Anda untuk membantu kami meningkatkan produk, melacak kerusakan dan masalah, serta mengurangi gesekan produk. Data sesi dapat mencakup interaksi layar, informasi perangkat, dan perkiraan lokasi. Input teks dan elemen UI sensitif secara otomatis ditutupi dan tidak pernah direkam."*

2. **Rekaman gerbang di belakang persetujuan** (direkomendasikan untuk pengguna EEA):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Hormati pilihan untuk tidak ikut serta.** Jika pengguna membatalkan persetujuan, berhenti merekam dan menghapus datanya:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Pengambilan log konsol

Pengambilan log konsol diaktifkan secara default (`trackConsoleLogs: true`). Log konsol dapat berisi PII bergantung pada praktik logging aplikasi Anda. Nonaktifkan jika data sensitif mungkin muncul di log:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Geolokasi

Geolokasi turunan IP (negara, wilayah, kota) dikumpulkan secara default. Jika `collectGeoLocation` adalah `false`, SDK meneruskan tanda ke lapisan asli yang menyembunyikan pencarian geolokasi IP di backend — tidak ada data lokasi yang disimpan untuk sesi tersebut. Nonaktifkan jika Anda tidak memerlukan data lokasi atau ingin meminimalkan pengumpulan data untuk pengguna EEA:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Lembaran asli

Pengambilan lembar asli diaktifkan secara default (`captureNativeSheets: true`) untuk versi SDK yang didukung. Hal ini memungkinkan sheet dan dialog asli milik aplikasi, seperti modal otorisasi pembayaran, muncul dalam pemutaran ulang debug ketika OS mengizinkan pengambilan. Lembar sistem keyboard/input teks dikecualikan ketika input teks disamarkan secara default. Ketika penyembunyian input teks diatur ke bidang aman saja, keyboard hanya merupakan upaya terbaik dan tidak dapat ditangkap dengan andal, terutama ketika OS menjadikannya sebagai permukaan yang terlindungi atau jauh. Lembar berbagi OS juga hanya merupakan upaya terbaik dan tidak dapat ditangkap dengan andal ketika sistem menjadikannya sebagai permukaan yang terlindungi atau jauh.

Nonaktifkan pengambilan sheet asli jika Anda ingin pemutaran ulang visual tetap terbatas pada jendela aplikasi utama:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Mode Hanya Amati (Tanpa Rekaman Visual)

Untuk menangkap kesalahan, kerusakan, ANRs, dan aktivitas jaringan **tanpa** merekam tayangan ulang visual, atur `observeOnly: true`:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Saat diaktifkan, semua telemetri dikumpulkan tetapi tidak ada tangkapan layar yang diambil — sesi TIDAK AKAN muncul di Halaman Pemutaran Ulang Anda tetapi akan ada data analitik/kesalahan/jaringan/kerusakan lengkap. Tidak ada pemutaran ulang. Ini berguna ketika pengguna telah memilih untuk tidak ikut perekaman layar tetapi Anda masih menginginkan visibilitas kesalahan.

> **Catatan:** Ini dapat disetel secara kondisional per pengguna, misalnya berdasarkan preferensi tersimpan atau tanda izin:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
