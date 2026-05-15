# स्व-होस्टेड बैकअप और पुनर्प्राप्ति

यदि आप Rejourney को [Docker Compose सेल्फ-होस्टिंग](/docs/selfhosted) के साथ चलाते हैं, तो इनकी प्रतियां रखने के लिए इन्हें **गंभीर** मानें:

- Postgres
- `.env.selfhosted`
- यदि आप अंतर्निहित MinIO का उपयोग करते हैं तो MinIO डेटा

---

## त्वरित बैकअप

बंडल किए गए सहायक का उपयोग करें:

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

यह क्या करता है:

- Postgres हर बार डंप होता है
- उपलब्ध होने पर Redis स्नैपशॉट
- `.env.selfhosted` हर बार कॉपी करें
- MinIO ऑब्जेक्ट डेटा जब `--full` का उपयोग किया जाता है और अंतर्निहित MinIO सक्षम होता है

---

## क्या बचाना है

### हमेशा बचाएं

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### अंतर्निहित MinIO का उपयोग करते समय बचत करें

- `backups/minio-*.tar.gz`

यदि आप बाहरी S3 का उपयोग करते हैं, तो आपकी रिकॉर्डिंग स्थानीय MinIO वॉल्यूम के बजाय उस बकेट में रहती है, इसलिए डेटाबेस प्लस `.env.selfhosted` न्यूनतम स्थानीय बैकअप हैं।

---

## व्यवस्था बहाल

### 1. स्टैक कॉन्फ़िगरेशन को फिर से बनाएं

सहेजे गए `.env.selfhosted` को वापस रेपो रूट में डालें।

### 2. बुनियादी ढांचे और बूटस्ट्रैप शुरू करें

```bash
./scripts/selfhosted/deploy.sh update
```

यह सेवाओं को वापस लाता है और आपके सहेजे गए कॉन्फ़िगरेशन से `storage_endpoints` पंक्ति को फिर से बनाता है।

### 3. Postgres को पुनर्स्थापित करें

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. यदि लागू हो तो MinIO को पुनर्स्थापित करें

यदि आप अंतर्निहित MinIO का उपयोग करते हैं और आपने `--full` बैकअप लिया है:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. ऐप सेवाएँ पुनः आरंभ करें

```bash
./scripts/selfhosted/deploy.sh update
```

वह बूटस्ट्रैप को फिर से चलाता है और पुनर्स्थापना के बाद ऐप सेवाओं को पुनरारंभ करता है।

---

## अनुशंसित अनुसूची

दैनिक डेटाबेस बैकअप:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

MinIO डेटा के साथ साप्ताहिक पूर्ण बैकअप:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## आपदा पुनर्प्राप्ति नोट्स

अंतर्निहित MinIO परिनियोजन को पूरी तरह से पुनर्स्थापित करने के लिए आपको निम्नलिखित सभी की आवश्यकता है:

- `.env.selfhosted`
- Postgres बैकअप
- MinIO बैकअप

`.env.selfhosted` के बिना, आप Postgres में एन्क्रिप्टेड स्टोरेज क्रेडेंशियल्स तक पहुंच खो सकते हैं क्योंकि `STORAGE_ENCRYPTION_KEY` वहां रहता है।

---

## सत्यापन चेकलिस्ट

पुनर्स्थापना के बाद:

1. `./scripts/selfhosted/deploy.sh status` चलाएँ
2. डैशबोर्ड में लॉग इन करें
3. एक मौजूदा प्रोजेक्ट खोलें
4. मौजूदा रीप्ले खोलें
5. एक नया लघु सत्र रिकॉर्ड करें और सत्यापित करें कि यह दिखाई दे रहा है

यदि पुनर्स्थापना के बाद रीप्ले अंतर्ग्रहण विफल हो जाता है, तो जाँच करें:

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## मल्टी-बकेट सत्यापन क्वेरीज़

भारित बहु-प्राथमिक समापन बिंदुओं को सक्षम करने से पहले या प्रोजेक्ट-स्कोप बकेट बदलने के बाद ये SQL जाँच चलाएँ।

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
