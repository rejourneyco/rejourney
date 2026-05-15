# Berkontribusi pada Rejourney

Kami menyambut kontribusi! Silakan lihat panduan di bawah ini untuk memulai.

## Struktur Proyek

Ini adalah monorepo yang dikelola oleh ruang kerja npm.

## Prasyarat

1. **Node.js** >= 18.0.0
2. **npm** atau **yarn** (ruang kerja dapat digunakan dengan keduanya)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode dan CocoaPods
7. **Android**: Android Studio dan JDK 17

## Pengaturan Awal

### 1. Instal Dependensi

Dari **akar** dari monorepo:

```bash
npm install
```

Ini akan:
- Instal semua dependensi ruang kerja
- Membangun paket SDK secara otomatis (menjalankan `npm run build:sdk` melalui skrip `postinstall` di root `package.json`)
- Tautkan semua paket dengan benar

### 2. Bangun SDK

Jika Anda perlu membangun kembali SDK setelah melakukan perubahan:

```bash
npm run build:sdk
```

Atau untuk bangunan yang bersih:

```bash
npm run build:clean
```

## Pengembangan Backend (Kubernetes Lokal)

Rejourney menggunakan `local-k8s/` untuk pengembangan lokal sehingga waktu proses tetap mendekati penyiapan produksi Kubernetes sambil tetap menjaga loop harian tetap cepat.

### 1. Konfigurasikan `.env.k8s.local`

Salin templat lingkungan Kubernetes lokal:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Mulai Tumpukan Pengembang Hibrid

```bash
npm run dev
```

Aliran itu:

- Membuat klaster `k3d` lokal jika diperlukan
- Berlaku `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml`, dan `minio.yaml`
- Menyinkronkan `.env.k8s.local` ke rahasia Kubernetes
- Menjalankan API, dasbor, dan pekerja dari sumber di mesin host Anda

Untuk menjalankan paritas dalam klaster penuh:

```bash
npm run dev:full
```

Untuk menghentikan tumpukan lokal:

```bash
npm run dev:down
```

### 3. Konfigurasi Alamat IP (Pengujian Perangkat Fisik)

Jika Anda menguji pada **perangkat fisik** (iOS atau Android) yang terhubung ke WiFi yang sama, SDK dan Dasbor perlu mengetahui alamat IP lokal komputer Anda untuk berkomunikasi.

#### Menemukan Alamat IP Anda (Mac)

Jalankan perintah berikut di terminal Anda:

```bash
ipconfig getifaddr en0
```

Atau temukan di **Pengaturan Sistem > WiFi > Detail [Jaringan Anda].**.

#### Perbarui `.env.k8s.local`

Variabel berikut **HARUS** menggunakan alamat IP lokal Anda (misalnya, `http://192.168.1.5:3000`) dan bukan `localhost`:

| Variabel | Penggunaan Kunci |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Akses publik ke MinIO untuk pemutaran ulang video |
| `PUBLIC_DASHBOARD_URL` | URL dasar untuk UI dasbor |
| `PUBLIC_API_URL` | URL dasar untuk API |
| `PUBLIC_INGEST_URL` | URL dasar untuk penyerapan peristiwa SDK |
| `DASHBOARD_ORIGIN` | Asal CORS untuk dashboard |
| `OAUTH_REDIRECT_BASE` | URL dasar untuk panggilan balik OAuth |




> [!IMPORTANT]
> Kegagalan untuk mengaturnya dengan benar akan mengakibatkan kesalahan "Koneksi Ditolak" pada perangkat fisik atau tautan gambar/video yang rusak di dasbor.

`npm run dev` memperbarui nilai yang menghadap LAN ini secara otomatis melalui `scripts/local-k8s/update-ips.sh`, dan juga menulis contoh file app env yang digunakan oleh aplikasi Expo.

#### Contoh Konfigurasi (`.env.k8s.local`)

Dengan asumsi alamat IP komputer Anda adalah `192.168.1.100`:

```env
# Object storage (host access to local-k8s MinIO)
S3_ENDPOINT=http://127.0.0.1:9000
S3_PUBLIC_ENDPOINT=http://192.168.1.100:9000

# Public URLs
PUBLIC_DASHBOARD_URL=http://192.168.1.100:8080
PUBLIC_API_URL=http://192.168.1.100:3000
PUBLIC_INGEST_URL=http://192.168.1.100:3000
DASHBOARD_ORIGIN=http://192.168.1.100:8080
OAUTH_REDIRECT_BASE=http://192.168.1.100:3000
```

### 4. File Kubernetes Lokal

Manifes Kubernetes lokal sengaja mencerminkan tata letak produksi `k8s/`:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Menjalankan Aplikasi Contoh

### Pelat Boiler React Native (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Atau dari direktori contoh:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Lab Kopi Seduh (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Telanjang

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Cara Kerjanya

### Pengaturan Ruang Kerja

Monorepo menggunakan ruang kerja npm untuk paket inti, tetapi aplikasi contoh bersifat mandiri:

1. **Akar `package.json`** hanya menyertakan `packages/*`, `backend`, dan `dashboard/web-ui` di ruang kerja
2. **Aplikasi contoh bersifat mandiri** - mereka memiliki `node_modules` sendiri untuk menghindari konflik ketergantungan
3. **Contoh aplikasi** mereferensikan SDK menggunakan `"rejourney": "file:../../packages/react-native"`
4. **Konfigurasi metro** dikonfigurasi untuk melihat dan menyelesaikan paket SDK dengan benar

**Mengapa contoh tidak ada di ruang kerja:**
- Contoh aplikasi menggunakan versi Expo/React Native yang berbeda
- Mencegah konflik deduplikasi ketergantungan npm
- Setiap contoh dapat memiliki pohon ketergantungan lengkapnya sendiri

### Konfigurasi Metro

Setiap aplikasi contoh memiliki `metro.config.js` yang:

1. **Jam tangan** direktori sumber SDK (`packages/react-native`) untuk perubahan
2. **Terselesaikan** paket `rejourney` ke lokasi yang benar
3. **Blok** menduplikasi paket `react-native` dan `react` dari root ruang kerja

### Codegen (TurboModul)

Codegen React Native otomatis berjalan saat membuat aplikasi jika:

1. SDK `package.json` telah ditentukan `codegenConfig` ✅
2. File spesifikasi (`NativeRejourney.ts`) mengikuti konvensi penamaan ✅
3. Aplikasi ini mencakup paket SDK ✅

Codegen berjalan secara otomatis selama:
- `npm run ios` (iOS dibuat)
- `npm run android` (Android dibuat)

## Struktur Proyek

```
rejourney/
├── packages/
│   └── react-native/          # SDK package
│       ├── src/                # TypeScript source
│       ├── android/           # Android native code
│       ├── ios/               # iOS native code
│       └── package.json       # Package config with codegenConfig
├── examples/
│   ├── react-native-boilerplate/  # Expo example
│   ├── brew-coffee-labs/          # Expo example
│   └── react-native-bare/         # Bare RN example
└── package.json               # Root workspace config
```

## CI/CD & Penerapan

Rejourney menggunakan GitHub Actions untuk mengotomatiskan pengujian, pembuatan, dan penerapan di seluruh monorepo.

Untuk perincian mendetail tentang rangkaian pengujian kami, pengujian integrasi asli, dan logika penerapan otomatis, silakan lihat [CI/CD & Dokumentasi Pengujian](/docs/architecture/ci-cd).

---

Jelajahi [Perbandingan Arsitektur](/docs/architecture/distributed-vs-single-node) untuk detail tentang Cloud (K8s) vs. Self-Hosted (Docker).

## Praktik Terbaik

1. **Selalu buat SDK** sebelum pengujian: `npm run build:sdk`
2. **Gunakan protokol file** (`file:../../packages/react-native`) di package.json untuk ruang kerja npm
3. **Hapus cache Metro** ketika mengalami masalah: `npm start -- --reset-cache`
4. **Membangun kembali aplikasi asli** setelah kode asli SDK berubah
5. **Uji pada iOS dan Android** sebelum melakukan
