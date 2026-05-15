# Cloud Terdistribusi vs Cloud Node Tunggal

Rejourney mendukung dua bentuk penerapan resmi yang dihosting sendiri:

- **Docker Compose simpul tunggal** untuk satu server atau VPS
- **Didistribusikan K3s** untuk cluster produksi dan penskalaan horizontal

Keduanya sekarang menggunakan model backend inti yang sama:

- titik akhir penyimpanan didukung database
- unggahan yang diserap melalui relai unggahan milik backend
- pekerja memproses artefak terverifikasi
- visibilitas pemutaran ulang didorong oleh artefak

---

## Perbandingan Fitur

| Fitur | Awan Terdistribusi | Cloud Node Tunggal |
|---------|--------------------|-------------------|
| Peron | K3s | Docker Compose |
| Skala | Multi-simpul | Node tunggal |
| Titik masuk publik | Traefik masuknya | Wadah Traefik |
| Jalur unggah | API + layanan unggahan penyerapan | API + layanan unggahan penyerapan |
| Sumber kebenaran penyimpanan | Tabel `storage_endpoints` | Tabel `storage_endpoints` |
| Penyimpanan objek default | S3 eksternal | MinIO bawaan |
| Dukungan S3 eksternal | Ya | Ya |
| Enkripsi rahasia | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Alur pembaruan | k8s penerapan + pekerjaan | `deploy.sh update` |

---

## Model Penyimpanan Bersama

Di kedua model penerapan, konfigurasi penyimpanan runtime berasal dari Postgres, bukan dari fallback env.

Artinya:

- titik akhir penyimpanan objek aktif disimpan di `storage_endpoints`
- kunci akses rahasia dienkripsi menjadi `key_ref`
- runtime membaca baris database
- skrip bootstrap/install bertanggung jawab untuk menyinkronkan input `.env` ke baris database

Hal ini membuat Docker yang dihosting sendiri lebih mirip dengan prod dan local-k8s dibandingkan model fallback lama.

---

## Kapan Memilih Node Tunggal Docker Compose

Pilih Docker Compose ketika:

- Anda menerapkan ke satu VPS atau host bare-metal
- Anda menginginkan jalur pemasangan tercepat
- Anda ingin MinIO bawaan secara default
- Anda tidak memerlukan penskalaan multi-node atau operasi Kubernetes

Titik masuk resmi:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Kapan Memilih K3s Terdistribusi

Pilih K3s ketika:

- Anda memerlukan banyak node
- Anda menginginkan operasi asli dan penanganan rahasia Kubernetes
- Anda ingin menskalakan API, mengunggah, dan layanan pekerja secara mandiri
- Anda ingin penerapan bergulir dan isolasi infra yang lebih kuat

Jalur K3s berada di bawah `k8s/` dan `scripts/k8s/`.

---

## Perbedaan Operasional

Perbedaan utamanya bukan lagi model datanya. Ini adalah bentuk operasional:

- Compose: satu mesin, satu jaringan Docker, satu skrip operator
- K3s: beberapa pod, namespace, masuknya cluster, pekerjaan dan rahasia Kubernetes

---

## Panduan Praktis

Mulailah dengan node tunggal Compose jika Anda ingin melakukan self-host dengan cepat.

Pindah ke K3s saat Anda membutuhkan:

- throughput yang lebih banyak
- penyebaran cluster bergulir
- penskalaan horizontal
- pemisahan infrastruktur yang lebih tangguh

---

## Dokumen Arsitektur Internal

Untuk visual teknik internal terbaru dan detail operator yang lebih mendalam:

- `dev_docs/ingest-session-recording-lifecycle.md` (diagram siklus hidup sesi)
- `dev_docs/storage-and-endpoints.md` (diagram topologi multi-bucket)
- `dev_docs/allthingscloud.md` (diagram pengaturan cloud k3s)

### Siklus Hidup Sesi

![Arsitektur siklus hidup sesi](./assets/session-lifecycle.svg)

### Topologi Multi-Keranjang

![Topologi penyimpanan multi-bucket](./assets/multi-bucket-topology.svg)

### Pengaturan Awan K3s

![K3s arsitektur cloud terdistribusi](./assets/k3s-cloud-setup.svg)
