# Hosting mandiri Rejourney

Panduan ini ditujukan untuk **siapa pun** yang menjalankan Rejourney di servernya sendiri (biasanya satu VPS atau mesin khusus) menggunakan tumpukan **Docker Compose** resmi. Anda tidak memerlukan akses ke infrastruktur internal Rejourney atau Kubernetes.

Setelah pengaturan Anda mendapatkan:

- **dasbor web** di domain Anda (HTTPS melalui Let’s Encrypt)
- **API** di subdomain (untuk dasbor dan SDK seluler)
- **menelan (mengunggah) relai** di subdomain lain (pengunggahan sesi dilakukan melalui server Anda, bukan langsung dari ponsel ke penyimpanan objek)
- **PostgreSQL**, **Redis**, dan **MinIO bawaan** atau **penyimpanan S3-compatible Anda sendiri**
- Latar belakang **pekerja** yang memproses sesi, retensi, dan peringatan (peran yang sama seperti dalam penerapan cloud Rejourney)

Semua perintah di bawah ini mengasumsikan Anda berada di **akar repositori** setelah kloning (folder yang berisi `docker-compose.selfhosted.yml`).

---

## Apa yang Anda butuhkan sebelumnya

### pelayan

- **sistem operasi:** Ubuntu 22.04+, Debian 12+, atau Linux lain yang menjalankan Docker dengan baik
- **Docker:** 24 ​​atau lebih baru, dengan **Plugin Docker Compose** (`docker compose version` seharusnya berfungsi)
- **Sumber daya (disarankan):** 4 vCPU, RAM 8 GB, disk 40 GB (lebih banyak jika Anda menyimpan banyak rekaman)
- **Jaringan:** Port **80** dan **443** terbuka untuk internet (diperlukan untuk tantangan Let’s Encrypt HTTP dan HTTPS)

### Domain dan DNS

Anda memerlukan **satu domain dasar** yang Anda kendalikan (misalnya `example.com`). Sebelum menjalankan penginstal, buat catatan DNS **A** (atau **AAAA**) yang menunjuk **semua** dari nama host berikut ke IP publik server Anda:

| Nama host | Tujuan |
|----------|---------|
| `example.com` | Dasbor |
| `www.example.com` | Pengalihan ke dasbor |
| `api.example.com` | API (dan WebSocket jika digunakan) |
| `ingest.example.com` | Relai unggah (SDK menggunakan ini secara otomatis setelah API dikonfigurasi) |

Ganti `example.com` dengan domain asli Anda. Propagasi dapat memakan waktu beberapa menit hingga beberapa jam; Sertifikat TLS tidak akan diterbitkan sampai DNS diselesaikan dengan benar.

### Let’s Encrypt

Anda akan dimintai **alamat email** saat instalasi. Ini digunakan untuk pemberitahuan kedaluwarsa sertifikat dari Let’s Encrypt.

### Peralatan di mesin Anda

- `git` untuk mengkloning repositori
- `openssl` (digunakan oleh skrip instalasi untuk menghasilkan rahasia)
- Sebuah cangkang (bash baik-baik saja)

---

## Instalasi pertama kali

### 1. Kloning repositori

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Tetap di cabang default (atau tag rilis jika proyek mendokumentasikannya untuk hosting mandiri).

### 2. Jalankan penginstal

```bash
./scripts/selfhosted/deploy.sh install
```

Skripnya akan:

1. Minta **domain dasar** Anda (misalnya `example.com` — bukan `https://`, tidak ada jalur).
2. Mintalah **email Let’s Encrypt** Anda.
3. Mintalah **penyimpanan**: penyimpanan **MinIO** bawaan (disarankan) atau **S3-compatible eksternal** (Anda akan memasukkan titik akhir, keranjang, wilayah, dan kunci).
4. Buat **`.env.selfhosted`** di root repo dengan kata sandi dan rahasia yang dihasilkan. **Batasi izin** diterapkan (`chmod 600`).
5. **Menarik** menerbitkan gambar kontainer (API, web, pekerja, database, Traefik, dll.).
6. **Membangun** gambar **bootstrap / migrasi** **dari klonmu** (berisi skrip pengaturan database; tidak diunduh dari registri kontainer).
7. Mulai database, Redis, Traefik, dan (jika dipilih) MinIO.
8. Validasi konektivitas database menggunakan `DATABASE_URL` yang dikonfigurasi sebelum bootstrap dijalankan.
9. Jalankan kontainer **bootstrap** sekali pakai: skema database, seed opsional pertama kali, dan konfigurasi penyimpanan dalam database.
10. Mulai API, unggah relai, dasbor, dan pekerja.

Penginstalan pertama dapat memakan waktu beberapa menit (penarikan gambar dan bootstrap).

### 3. Lindungi `.env.selfhosted`

File ini menyimpan **semua rahasia** untuk penerapan Anda (database, Redis, JWT, enkripsi penyimpanan, kredensial MinIO jika digunakan, dll.). **Cadangkan** ke tempat yang aman (pengelola kata sandi, cadangan terenkripsi). Jika hilang, Anda mungkin kehilangan kemampuan untuk mendekripsi kredensial yang disimpan atau merekonstruksi penerapan yang sama.

Jangan komit ke git (ini harus diabaikan oleh `.gitignore`).

---

## Setelah instalasi

### URL

Pemasang mencetak URL. Umumnya:

- **Dasbor:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **Menelan:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` dialihkan ke dasbor.

### Verifikasi tumpukannya

```bash
./scripts/selfhosted/deploy.sh status
```

Anda akan melihat container berjalan; `api` dan `ingest-upload` akan menjadi **sehat** setelah beberapa saat.

### Login pertama dan rekaman tes

1. Buka dasbor di browser.
2. Buat akun dan proyek.
3. Konfigurasikan Rejourney SDK aplikasi Anda dengan **URL API** (lihat [konfigurasi SDK](#configuring-your-mobile-app) di bawah).
4. Rekam sesi singkat dan konfirmasikan sesi tersebut muncul di Putar Ulang.

Jika sesi tidak pernah muncul di Putar Ulang, lihat [Pemecahan Masalah](/docs/selfhosted/troubleshooting) (unggah relai dan serap log pekerja).

---

## Operasi sehari-hari

Semua ini dijalankan dari root repo.

| Aksi | Perintah |
|--------|---------|
| Status layanan | `./scripts/selfhosted/deploy.sh status` |
| Ikuti semua log | `./scripts/selfhosted/deploy.sh logs` |
| Log untuk satu layanan | `./scripts/selfhosted/deploy.sh logs api` (ganti `api` dengan `web`, `ingest-upload`, `ingest-worker`, dll.) |
| **Meningkatkan** dan jalankan kembali bootstrap | `./scripts/selfhosted/deploy.sh update` |
| Hentikan semuanya **tanpa** menghapus data | `./scripts/selfhosted/deploy.sh stop` |
| Kontainer dan volume **Mengatur ulang** (destruktif) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** mengambil gambar yang lebih baru (jika ada), membangun kembali gambar bootstrap dari klon Anda saat ini, memulai ulang tumpukan, dan menjalankan bootstrap lagi sehingga skema database dan pengaturan penyimpanan tetap selaras dengan `.env.selfhosted` Anda. Itu **bukan** menghapus Postgres atau volume penyimpanan objek.

Sebelum bootstrap, `install` dan `update` memvalidasi konektivitas database dengan kredensial yang dikonfigurasi. Jika kredensial tidak cocok dengan data Postgres yang ada, penerapan akan dihentikan lebih awal dengan panduan pemulihan, bukannya gagal nanti di bootstrap.

**`stop`** hanya menghentikan kontainer; Docker **volume** (data Postgres, data MinIO, dll.) tetap ada hingga Anda menghapusnya secara eksplisit.

**`reset`** menghapus kontainer yang dihosting sendiri dan volume Docker (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) setelah perintah konfirmasi. Ini juga menghapus penampung profil MinIO bahkan ketika `.env.selfhosted` hilang, sehingga data MinIO yang basi tidak menghalangi pemasangan berikutnya. Gunakan ini hanya bila Anda ingin instalasi baru sepenuhnya.

---

## Penyimpanan: MinIO vs S3 eksternal

### MinIO bawaan (default)

- Paling mudah untuk satu server: penyimpanan objek berjalan **di dalam Docker** dan tidak terekspos ke internet publik secara default.
- Byte sesi ditulis oleh layanan **serap-unggah**; perangkat tidak perlu menghubungi MinIO secara langsung.
- Pembuatan bucket ditangani selama instalasi.

### Penyimpanan S3-compatible eksternal

Gunakan AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi, atau S3-compatible API. Selama instalasi, Anda memberikan URL titik akhir, keranjang, wilayah, dan kunci akses.

Contoh gaya URL titik akhir (dokumen penyedia Anda resmi):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

Jika Anda menambahkan **URL publik yang terpisah** untuk unduhan, atur `S3_PUBLIC_ENDPOINT` di `.env.selfhosted` dan jalankan `./scripts/selfhosted/deploy.sh update`.

---

## Konfigurasi penting (`.env.selfhosted`)

Penginstal menghasilkan file ini. Variabel umum meliputi:

- **Domain dan URL publik:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Basis Data:** `DATABASE_URL` (menunjuk pada layanan `postgres` di dalam Compose)
- **Redis:** `REDIS_URL`
- **Penyimpanan:** `STORAGE_BACKEND`, `S3_*`, dan opsional `MINIO_*`
- **Keamanan:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Integrasi opsional (biarkan kosong jika tidak digunakan): Stripe, SMTP, GitHub OAuth, Turnstile, dll.

**Mengubah nilai penyimpanan atau terkait domain:** edit `.env.selfhosted`, lalu jalankan:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Cara kerja pengaturan basis data (boot pertama vs pembaruan selanjutnya)

Anda biasanya melakukan **bukan** perlu menjalankan SQL dengan tangan. Kontainer **bootstrap** menanganinya.

- **Basis data kosong baru:** tumpukan menerapkan skema saat ini dari kode, lalu mencatat versi migrasi mana yang telah dipenuhi sehingga pembaruan di masa mendatang hanya menerapkan migrasi **baru**.
- **Database yang ada (sudah diinisialisasi):** hanya migrasi **tertunda** yang diterapkan. Data Anda tidak dibuat ulang dari awal di setiap `update`.
- Jika database **sudah memiliki tabel** tetapi tabel riwayat migrasi adalah **hilang atau kosong** (misalnya pemulihan sebagian), bootstrap **berhenti karena kesalahan** untuk menghindari kerusakan yang tidak disengaja. Opsi pemulihan tingkat lanjut didokumentasikan dalam [Pemecahan Masalah](/docs/selfhosted/troubleshooting).

---

## Server Apple Silicon dan ARM

Pada mesin **ARM64** (banyak Mac, beberapa instance cloud), skrip penerapan menyetel `DOCKER_DEFAULT_PLATFORM=linux/amd64` untuk pengambilan gambar saat Anda belum menyetelnya sendiri, sehingga gambar bawaan yang hanya menerbitkan `amd64` tetap berjalan. Jika Anda memerlukan perilaku yang berbeda, atur `DOCKER_DEFAULT_PLATFORM` di lingkungan Anda sebelum menjalankan skrip.

Gambar **bootstrap** selalu **dibangun di mesin Anda** dari repositori yang dikloning, sehingga selalu cocok dengan checkout Anda.

---

## Apa yang berjalan di Docker (ikhtisar)

- Sertifikat **Traefik:** HTTPS dan perutean ke dasbor, API, dan penyerapan nama host.
- **Postgres / Redis:** Data dan antrian aplikasi.
- **MinIO:** Penyimpanan objek internal opsional.
- **API:** Utama HTTP API.
- **serap-unggah:** Layanan khusus untuk lalu lintas relai unggahan.
- UI statis dasbor **jaringan:**.
- **Pekerja:** Proses penyerapan antrean, pemutaran ulang artefak, siklus hidup sesi, pekerjaan gaya retensi terjadwal, dan peringatan.

Ada pekerja batch penagihan terpisah **TIDAK** di tumpukan ini; integrasi penagihan didorong oleh Stripe dan API saat Anda mengonfigurasi kunci.

---

## Mengonfigurasi aplikasi seluler Anda

Arahkan SDK ke host **milikmu** API (harus cocok dengan `API_DOMAIN` / `PUBLIC_API_URL`).

### Contoh React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Gunakan URL API asli Anda. URL unggahan diperoleh untuk `ingest.<your-domain>` secara otomatis ketika server dikonfigurasi dengan benar.

---

## Cadangan

Minimal, cadangan **PostgreSQL**, **`.env.selfhosted`**, dan (jika Anda menggunakan MinIO bawaan) **data penyimpanan objek**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Detail: [Pencadangan & Pemulihan](/docs/selfhosted/backup-recovery).

---

## Pemecahan masalah dan dukungan

- [Pemecahan Masalah](/docs/selfhosted/troubleshooting) — kegagalan bootstrap, TLS, Putar Ulang kosong, masalah S3 eksternal.
- [Pencadangan & Pemulihan](/docs/selfhosted/backup-recovery) — memulihkan pesanan dan MinIO.

Untuk mengetahui bug atau perbaikan pada dokumen ini, gunakan pelacak masalah publik proyek di GitHub.

---

## Dokumentasi terkait

- [Cloud terdistribusi vs single-node](/docs/distributed-vs-single-node/distributed-vs-single-node) — perbandingannya dengan tata letak cloud multi-layanan (konseptual).
