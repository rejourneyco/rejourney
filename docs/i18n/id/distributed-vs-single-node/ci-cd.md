# CI/CD & Pengujian Otomatis

Rejourney menggunakan GitHub Actions untuk memastikan kualitas kode di seluruh monorepo. Setiap permintaan tarik dan dorong ke cabang utama memicu serangkaian pengujian yang komprehensif.

## Ruang Tes

### 1. Tes API Bagian Belakang
Terletak di direktori `backend/`, pengujian ini memastikan logika inti dan interaksi database stabil.
* **Linting**: Menggunakan ESLint untuk menerapkan gaya kode dan menangkap kesalahan umum.
* **Tes Satuan**: Didukung oleh Vitest, menguji logika layanan, fungsi utilitas, dan pengontrol API.
* **Verifikasi Bangun**: Memastikan sumber TypeScript dikompilasi dengan benar ke dalam distribusi akhir.

### 2. Tes React Native SDK
Terletak di `packages/react-native/`, pengujian ini sangat penting untuk stabilitas lintas platform.
* **TypeScript Periksa**: Memvalidasi tipe di seluruh SDK, menangkap potensi ketidakcocokan jembatan.
* **Linting**: Menerapkan kualitas kode yang konsisten.
* **Verifikasi Bangun**: Menjalankan skrip persiapan untuk memastikan paket dapat dibundel untuk distribusi.

### 3. Tes Dasbor Web
Terletak di `dashboard/web-ui/`, dengan fokus pada antarmuka pengguna dan SSR.
* **TypeScript Periksa**: Termasuk pembuatan tipe React Router untuk memastikan keamanan rute.
* **Pembangunan RSK**: Memverifikasi bahwa seluruh aplikasi Remix/React Router dapat dibuat untuk rendering sisi server.

---

## Pengujian Integrasi Asli
Salah satu bagian paling kuat dari CI/CD kami adalah validasi SDK pada lingkungan platform nyata.

### Integrasi iOS (macos-terbaru)
* **Instal Baru**: CI membuat proyek React Native baru dari awal.
* **Paket Injeksi**: Ini menggabungkan SDK menggunakan `npm pack` dan menginstalnya ke dalam aplikasi pengujian.
* **Verifikasi CocoaPods**: Menjalankan `pod install` untuk memastikan dependensi asli dan podspec tertaut dengan benar.
* **Verifikasi Bangun**: Menjalankan `xcodebuild` untuk memastikan aplikasi pengujian berhasil dikompilasi dengan SDK terintegrasi.

### Integrasi Android (ubuntu-terbaru)
* **Instal Baru**: Mirip dengan iOS, proyek Android baru berbasis React Native diinisialisasi.
* **Verifikasi Bangun**: Menjalankan `./gradlew assembleDebug` untuk memastikan tidak ada konflik nyata atau kesalahan kompilasi dalam kode asli Android.

---

## Logika Penerapan & Penerbitan

### Penerapan Cloud Otomatis (VPS)
Penerapan ke lingkungan produksi kami dibatasi oleh pembuatan versi.
* **Pemeriksaan Versi**: Pekerjaan khusus membandingkan versi root `package.json` dengan penerapan sebelumnya.
* **Pemicu Bersyarat**: Penerapan hanya dilanjutkan jika versi telah ditingkatkan.
* **Peluncuran Otomatis**: Jika dipicu, ini akan menerapkan manifes K8 terbaru dan melakukan restart semua penerapan (api, web, dan pekerja).

### Penerbitan SDK (NPM) Otomatis
Kami menjaga alur penerbitan yang lancar untuk paket `rejourney`.
* **Jalur Sensitif**: Hanya terpicu ketika file di dalam `packages/react-native/` diubah.
* **Pemeriksaan Registri**: Membandingkan versi paket lokal dengan versi terbaru di registri NPM.
* **Publikasikan Otomatis**: Jika versi lokal lebih tinggi, versi baru secara otomatis diterbitkan ke NPM setelah semua pengujian lulus.
