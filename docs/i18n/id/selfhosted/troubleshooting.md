# Pemecahan masalah yang dihosting sendiri

Gunakan halaman ini jika Anda mengikuti [Rejourney yang dihosting sendiri](/docs/selfhosted) dan ada sesuatu yang gagal atau berperilaku aneh. Perintah dijalankan dari **akar repositori** (tempat `docker-compose.selfhosted.yml` berada).

---

## Pemeriksaan Cepat

### Status layanan

```bash
./scripts/selfhosted/deploy.sh status
```

### log API

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Unggah log relai

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Log pekerja

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. Penginstalan atau pembaruan gagal sebelum atau selama bootstrap

### Gejala

- `bootstrap` keluar bukan nol
- layanan aplikasi tidak pernah menjadi sehat
- `status` menunjukkan API atau pekerja menunggu di bootstrap
- instal atau perbarui pintu keluar dengan `Database authentication failed before bootstrap.`

### Cek

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Penyebab umum:

- `DATABASE_URL` buruk
- ketidakcocokan kredensial (misalnya dari penerapan yang gagal sebelumnya)
- `STORAGE_ENCRYPTION_KEY` hilang
- kredensial S3 tidak valid
- URL titik akhir S3 eksternal rusak
- pada **ARM64**, dukungan gambar tidak ada (setel `DOCKER_DEFAULT_PLATFORM=linux/amd64` atau gunakan `./scripts/selfhosted/deploy.sh`, yang menyetelnya jika tidak disetel)

Pemulihan:

1. Jika Anda masih memiliki `.env.selfhosted` yang asli, pulihkan dan jalankan:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Jika Anda tidak memerlukan data lama, hapus dan instal ulang:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Pesan skema/migrasi:** Pada instalasi normal, database mulai kosong dan bootstrap mengatur semuanya. Jika Anda memasukkan **memulihkan Postgres dari cadangan** ke server baru tetapi metadata migrasi tidak ada, atau Anda mengarahkan tumpukan ke **basis data yang salah**, bootstrap mungkin keluar dengan kesalahan tentang database yang tidak konsisten alih-alih menimpa data Anda. Kecuali Anda melakukan pemulihan tingkat lanjut, perbaiki `DATABASE_URL` dan pulihkan cadangan yang konsisten, atau mulai dari volume bersih. Untuk pemulihan khusus migrasi yang disengaja, beberapa pengaturan menggunakan `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` di `.env.selfhosted` (lihat dokumen atau dukungan pengelola sebelum menggunakan ini).

### Memperbaiki

1. Jika Anda memiliki `.env.selfhosted` asli, pulihkan dan jalankan kembali:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Jika Anda tidak memiliki `.env.selfhosted` yang asli, hapus dan instal ulang:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` menjalankan kembali skema, seed, dan sinkronisasi titik akhir penyimpanan. `reset` menghapus kontainer dan volume data yang dihosting sendiri sehingga instalasi baru dapat menghasilkan kredensial baru dengan aman.

---

## 2. Sesi dihitung tetapi Putar Ulang tetap kosong

### Apa artinya ini biasanya sekarang

Dengan arsitektur saat ini, hal ini biasanya disebabkan oleh salah satu dari dua hal berikut:

- `ingest-upload` tidak dapat menyimpan byte artefak
- `ingest-worker` tidak dapat memproses artefak yang diunggah

Perangkat tidak lagi mengunggah secara langsung ke MinIO/S3, sehingga jangkauan bucket dari ponsel tidak lagi menjadi kendala utama.

### Cek

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Mencari:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Penyebab umum

- kredensial S3 salah di `.env.selfhosted`
- bucket S3 eksternal hilang
- titik akhir S3 eksternal tidak dapat dijangkau dari jaringan Docker
- relai pengunggahan tidak sehat
- pekerja terjebak saat mencoba ulang artefak yang gagal

### Memperbaiki

- verifikasi nilai `S3_*`
- jika Anda mengubah konfigurasi penyimpanan, jalankan kembali:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Dasbor dimuat, tetapi panggilan autentikasi atau API gagal

### Cek

- host dasbor DNS menunjuk ke server
- API host DNS menunjuk ke server
- menyerap poin host DNS ke server
- port `80` dan `443` terbuka
- Let’s Encrypt telah menerbitkan sertifikat

Memeriksa:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS atau masalah sertifikat

Traefik mengelola sertifikat secara otomatis.

### Cek

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Pastikan kedua nama tersebut ditetapkan ke server yang menjalankan tumpukan.

Jika DNS salah saat instalasi pertama, perbaiki DNS dan jalankan kembali:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. S3 eksternal berfungsi di CLI, tetapi Rejourney tidak dapat mengunggah

Ingat jalur unggahan berada di sisi server.

Jalur jaringan yang penting adalah:

- Kontainer `ingest-upload` -> titik akhir S3 Anda

Uji dari server dengan meninjau log relai dan mengonfirmasi titik akhir/bucket/kunci di `.env.selfhosted`.

Jika Anda mengubahnya, jalankan kembali:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Instalasi MinIO bawaan, tetapi artefak masih gagal

### Cek

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

One-shot `minio-setup` akan membuat bucket yang diberi nama `S3_BUCKET`.

Jika Anda mengubah nama bucket setelah instalasi pertama, jalankan:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Halaman penagihan menunjukkan penagihan yang dinonaktifkan

Hal ini diharapkan kecuali kunci Stripe dikonfigurasi.

Tumpukan tidak lagi menonaktifkan penagihan karena “dihosting sendiri”. Ini menonaktifkan penagihan karena Stripe tidak dikonfigurasi.

Jika Anda tidak menyetel kunci Stripe:

- UI penagihan tetap dalam status dihosting sendiri/tidak terbatas
- Stripe checkout dan webhook tetap dinonaktifkan

---

## 8. Titik akhir penyimpanan di Postgres salah setelah mengubah `.env.selfhosted`

Berlari:

```bash
./scripts/selfhosted/deploy.sh update
```

Jalur pembaruan menjalankan kembali bootstrap dan menyinkronkan ulang baris `storage_endpoints` yang aktif.

---

## 9. Perlu menghentikan layanan tanpa kehilangan data

Menggunakan:

```bash
./scripts/selfhosted/deploy.sh stop
```

Ini hanya menghentikan kontainer. Itu tidak menghilangkan volume.

---

## 10. Perlu log yang lebih dalam untuk satu layanan

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
