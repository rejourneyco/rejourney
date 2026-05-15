# 자체 호스팅 백업 및 복구

[Docker Compose 셀프 호스팅](/docs/selfhosted)을 사용하여 Rejourney를 실행하는 경우 이를 **비판적인** 로 처리하여 다음 항목의 복사본을 보관합니다.

- Postgres
- `.env.selfhosted`
- 내장된 MinIO를 사용하는 경우 MinIO 데이터

---

## 빠른 백업

번들 도우미를 사용하세요.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

기능:

- Postgres 덤프
- 사용 가능한 경우 Redis 스냅샷
- `.env.selfhosted` 매번 복사
- `--full`가 사용되고 내장된 MinIO가 활성화된 경우 MinIO 객체 데이터

---

## 무엇을 저장할 것인가

### 항상 저장

- `backups/postgres-*.sql.gz`
- `backups/env-*`

### 내장 MinIO 사용시 저장

- `backups/minio-*.tar.gz`

외부 S3를 사용하는 경우 녹음은 로컬 MinIO 볼륨 대신 해당 버킷에 있으므로 데이터베이스와 `.env.selfhosted`가 최소 로컬 백업입니다.

---

## 복원 순서

### 1. 스택 구성을 다시 생성합니다.

저장된 `.env.selfhosted`를 다시 저장소 루트에 넣습니다.

### 2. 인프라 및 부트스트랩 시작

```bash
./scripts/selfhosted/deploy.sh update
```

이렇게 하면 서비스가 다시 시작되고 저장된 구성에서 `storage_endpoints` 행이 다시 생성됩니다.

### 3. Postgres 복원

```bash
gunzip -c backups/postgres-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted exec -T postgres \
  psql -U rejourney rejourney
```

### 4. 해당하는 경우 MinIO를 복원합니다.

내장된 MinIO를 사용하고 `--full` 백업을 수행한 경우:

```bash
gunzip -c backups/minio-YYYYMMDD-HHMMSS.tar.gz | \
  docker run --rm -i -v rejourney_miniodata:/data alpine tar xf - -C /data
```

### 5. 앱 서비스 다시 시작

```bash
./scripts/selfhosted/deploy.sh update
```

그러면 부트스트랩이 다시 실행되고 복원 후 앱 서비스가 다시 시작됩니다.

---

## 추천 일정

일일 데이터베이스 백업:

```bash
0 3 * * * cd /opt/rejourney && ./scripts/selfhosted/backup.sh >> /var/log/rejourney-backup.log 2>&1
```

MinIO 데이터를 사용한 주간 전체 백업:

```bash
0 4 * * 0 cd /opt/rejourney && ./scripts/selfhosted/backup.sh --full >> /var/log/rejourney-backup.log 2>&1
```

---

## 재해 복구 노트

내장된 MinIO 배포를 완전히 복원하려면 다음이 모두 필요합니다.

- `.env.selfhosted`
- Postgres 백업
- MinIO 백업

`.env.selfhosted`가 없으면 `STORAGE_ENCRYPTION_KEY`가 Postgres에 있으므로 암호화된 저장소 자격 증명에 액세스하지 못할 수 있습니다.

---

## 검증 체크리스트

복원 후:

1. `./scripts/selfhosted/deploy.sh status`를 실행하세요.
2. 대시보드에 로그인
3. 기존 프로젝트 열기
4. 기존 리플레이 열기
5. 하나의 새로운 짧은 세션을 녹음하고 그것이 나타나는지 확인하십시오.

복원 후 재생 수집이 실패하는 경우 다음을 확인하세요.

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
```

---

## 다중 버킷 확인 쿼리

가중치가 적용된 다중 기본 엔드포인트를 활성화하기 전이나 프로젝트 범위 버킷을 변경한 후에는 이러한 SQL 검사를 실행하세요.

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
