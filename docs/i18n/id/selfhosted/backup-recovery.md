# Pencadangan dan pemulihan yang dihosting sendiri

Jika Anda menjalankan Rejourney dengan [Docker Compose self-hosting](/docs/selfhosted), perlakukan ini sebagai **kritis** untuk menyimpan salinan:

- Postgres
- `.env.selfhosted`
- Data MinIO jika Anda menggunakan MinIO bawaan

---

## Pencadangan Cepat

Gunakan pembantu yang dibundel:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Kegunaannya:

- Postgres dibuang setiap saat
- Snapshot Redis bila tersedia
- `.env.selfhosted` salin setiap saat
- Data objek MinIO ketika `--full` digunakan dan MinIO bawaan diaktifkan

---

## Apa yang Harus Disimpan

### Selalu simpan

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### Hemat saat menggunakan MinIO bawaan

- `backups/minio-*.tar.gz`

Jika Anda menggunakan S3 eksternal, rekaman Anda akan disimpan di bucket tersebut, bukan di volume MinIO lokal, sehingga database ditambah `.env.selfhosted` adalah cadangan lokal minimum.

---

## Pulihkan Pesanan

### 1. Buat ulang konfigurasi tumpukan

Masukkan kembali `.env.selfhosted` ke root repo.

### 2. Mulai infrastruktur dan bootstrap

```bash
./scripts/selfhosted/deploy.sh update
```

Ini mengembalikan layanan dan membuat ulang baris `storage_endpoints` dari konfigurasi yang Anda simpan.

### 3. Pulihkan Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. Pulihkan MinIO, jika ada

Jika Anda menggunakan MinIO bawaan dan mengambil cadangan `--full`:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. Mulai ulang layanan aplikasi

```bash
./scripts/selfhosted/deploy.sh update
```

Itu menjalankan kembali bootstrap dan memulai ulang layanan aplikasi setelah pemulihan.

---

## Jadwal yang Direkomendasikan

Pencadangan basis data harian:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

Pencadangan penuh mingguan dengan data MinIO:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## Catatan Pemulihan Bencana

Anda memerlukan semua hal berikut untuk sepenuhnya memulihkan penerapan MinIO bawaan:

- `.env.selfhosted`
- Cadangan Postgres
- Cadangan MinIO

Tanpa `.env.selfhosted`, Anda mungkin kehilangan akses ke kredensial penyimpanan terenkripsi di Postgres karena `STORAGE_ENCRYPTION_KEY` berada di sana.

---

## Daftar Periksa Verifikasi

Setelah pemulihan:

1. jalankan `./scripts/selfhosted/deploy.sh status`
2. masuk ke dasbor
3. membuka proyek yang sudah ada
4. buka tayangan ulang yang ada
5. rekam satu sesi pendek baru dan verifikasi kemunculannya

Jika penyerapan pemutaran ulang gagal setelah pemulihan, periksa:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## Kueri Verifikasi Multi-Keranjang

Jalankan pemeriksaan SQL ini sebelum mengaktifkan titik akhir multi-primer berbobot atau setelah mengubah bucket cakupan proyek.

```sql
-- Sessions whose ready artifacts are split across multiple endpoint_ids.
SELECT
  ra.session_id,
  COUNT(DISTINCT COALESCE(ra.endpoint_id, 'global-default')) AS endpoint_count
FROM recording_artifacts ra
WHERE ra.status = 'ready'
GROUP BY ra.session_id
HAVING COUNT(DISTINCT COALESCE(ra.endpoint_id, 'global-default')) > 1
ORDER BY endpoint_count DESC, ra.session_id
LIMIT 200;
```

```sql
-- Ready artifacts with missing/invalid endpoint mapping.
SELECT
  ra.id,
  ra.session_id,
  ra.kind,
  ra.endpoint_id,
  ra.s3_object_key
FROM recording_artifacts ra
LEFT JOIN storage_endpoints se ON se.id = ra.endpoint_id
WHERE ra.status = 'ready'
  AND ra.endpoint_id IS NOT NULL
  AND se.id IS NULL
ORDER BY ra.session_id, ra.kind
LIMIT 500;
```

```sql
-- Backup success ratio by project (uses session_backup_log rows as successful backups).
SELECT
  s.project_id,
  COUNT(*) FILTER (WHERE bl.session_id IS NOT NULL) AS backed_up_sessions,
  COUNT(*) AS eligible_sessions,
  ROUND(
    (COUNT(*) FILTER (WHERE bl.session_id IS NOT NULL)::numeric / NULLIF(COUNT(*), 0)) * 100,
    2
  ) AS backup_coverage_percent
FROM sessions s
LEFT JOIN session_backup_log bl ON bl.session_id = s.id
WHERE s.status IN ('ready', 'completed')
GROUP BY s.project_id
ORDER BY backup_coverage_percent ASC, eligible_sessions DESC;
```
