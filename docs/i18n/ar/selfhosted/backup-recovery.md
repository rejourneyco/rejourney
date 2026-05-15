# النسخ الاحتياطي والاسترداد المستضاف ذاتيا

إذا قمت بتشغيل Rejourney باستخدام [Docker Compose الاستضافة الذاتية](/docs/selfhosted)، فتعامل مع هذه العناصر على أنها **شديد الأهمية** للاحتفاظ بنسخ من:

- Postgres
- `.env.selfhosted`
- بيانات MinIO إذا كنت تستخدم MinIO المدمج

---

## النسخ الاحتياطي السريع

استخدم المساعد المجمع:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

ماذا يفعل:

- Postgres تفريغ في كل مرة
- لقطة Redis عند توفرها
- نسخ `.env.selfhosted` في كل مرة
- بيانات الكائن MinIO عند استخدام `--full` وتمكين MinIO المدمج

---

## ما يجب حفظه

### احفظ دائمًا

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### يمكنك الحفظ عند استخدام MinIO المدمج

- `backups/minio-*.tar.gz`

إذا كنت تستخدم S3 خارجيًا، فستعيش تسجيلاتك في تلك المجموعة بدلاً من وحدة تخزين MinIO المحلية، وبالتالي فإن قاعدة البيانات بالإضافة إلى `.env.selfhosted` هي الحد الأدنى من النسخ الاحتياطية المحلية.

---

## استعادة النظام

### 1. أعد إنشاء تكوين المكدس

ضع `.env.selfhosted` المحفوظة مرة أخرى في جذر الريبو.

### 2. بدء البنية التحتية والتمهيد

```bash
./scripts/selfhosted/deploy.sh update
```

يؤدي ذلك إلى إعادة الخدمات وإعادة إنشاء صف `storage_endpoints` من التكوين المحفوظ.

### 3. استعادة Postgres

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. قم باستعادة MinIO، إن أمكن

إذا كنت تستخدم MinIO المدمج وقمت بأخذ نسخة احتياطية من `--full`:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. أعد تشغيل خدمات التطبيق

```bash
./scripts/selfhosted/deploy.sh update
```

يؤدي ذلك إلى إعادة تشغيل bootstrap وإعادة تشغيل خدمات التطبيق بعد الاستعادة.

---

## الجدول الزمني الموصى به

النسخ الاحتياطي اليومي لقاعدة البيانات:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

النسخ الاحتياطي الكامل الأسبوعي لبيانات MinIO:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## ملاحظات التعافي من الكوارث

تحتاج إلى كل ما يلي لاستعادة نشر MinIO المضمن بشكل كامل:

- `.env.selfhosted`
- النسخ الاحتياطي Postgres
- النسخ الاحتياطي MinIO

بدون `.env.selfhosted`، قد تفقد إمكانية الوصول إلى بيانات اعتماد التخزين المشفرة في Postgres لأن `STORAGE_ENCRYPTION_KEY` موجود هناك.

---

## قائمة التحقق

بعد الاستعادة:

1. قم بتشغيل `./scripts/selfhosted/deploy.sh status`
2. تسجيل الدخول إلى لوحة القيادة
3. فتح مشروع موجود
4. فتح الإعادة الموجودة
5. سجل جلسة قصيرة جديدة وتحقق من ظهورها

إذا فشل عرض إعادة التشغيل بعد الاستعادة، فتحقق مما يلي:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## استعلامات التحقق متعددة الجرافات

قم بتشغيل عمليات فحص SQL هذه قبل تمكين نقاط النهاية المرجحة المتعددة الأساسية أو بعد تغيير مجموعات نطاق المشروع.

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
