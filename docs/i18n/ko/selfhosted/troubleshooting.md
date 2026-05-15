# 자체 호스팅 문제 해결

[자체 호스팅 Rejourney](/docs/selfhosted)를 팔로우했는데 문제가 발생하거나 이상하게 작동하는 경우 이 페이지를 사용하세요. 명령은 **저장소 루트**(`docker-compose.selfhosted.yml`가 있는 곳)에서 실행됩니다.

---

## 빠른 확인

### 서비스 상태

```bash
./scripts/selfhosted/deploy.sh status
```

### API 로그

```bash
./scripts/selfhosted/deploy.sh logs api
```

### 릴레이 로그 업로드

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### 작업자 로그

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. 부트스트랩 전이나 도중에 설치 또는 업데이트가 실패합니다.

### 증상

- `bootstrap`가 0이 아닌 값으로 종료됩니다.
- 앱 서비스는 결코 건강해지지 않습니다
- `status`는 API 또는 부트스트랩을 기다리는 작업자를 표시합니다.
- 설치 또는 업데이트가 `Database authentication failed before bootstrap.`로 종료됩니다.

### 체크 무늬

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

일반적인 원인:

- 불량 `DATABASE_URL`
- 자격 증명 불일치(예: 이전에 실패한 배포에서 발생)
- `STORAGE_ENCRYPTION_KEY` 누락
- 잘못된 S3 자격 증명
- 손상된 외부 S3 엔드포인트 URL
- **ARM64** 에서 이미지 지원 누락(`DOCKER_DEFAULT_PLATFORM=linux/amd64`를 설정하거나 설정 해제 시 설정하는 `./scripts/selfhosted/deploy.sh` 사용)

회복:

1. 원본 `.env.selfhosted`가 아직 있는 경우 복원하고 다음을 실행하세요.

```bash
./scripts/selfhosted/deploy.sh update
```

2. 이전 데이터가 필요하지 않은 경우 지우고 다시 설치하세요.

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**스키마/마이그레이션 메시지:** 일반 설치에서는 데이터베이스가 비어 있게 시작되고 부트스트랩이 모든 것을 설정합니다. **백업에서 Postgres를 복원했습니다.** 를 새 서버에 넣었지만 마이그레이션 메타데이터가 누락되었거나 **잘못된 데이터베이스** 에서 스택을 가리킨 경우 부트스트랩은 데이터를 덮어쓰는 대신 일관성 없는 데이터베이스에 대한 오류와 함께 종료될 수 있습니다. 고급 복구를 수행하지 않는 한 `DATABASE_URL`를 수정하고 일관된 백업을 복원하거나 클린 볼륨에서 시작하세요. 고의적인 마이그레이션 전용 복구의 경우 일부 설정에서는 `.env.selfhosted`의 `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1`를 사용합니다(이를 사용하기 전에 유지관리자 문서 또는 지원 참조).

### 고치다

1. 원본 `.env.selfhosted`가 있는 경우 복원하고 다시 실행하세요.

```bash
./scripts/selfhosted/deploy.sh update
```

2. 원래 `.env.selfhosted`가 없으면 지우고 다시 설치하십시오.

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update`는 스키마, 시드 및 스토리지 엔드포인트 동기화를 다시 실행합니다. `reset`는 자체 호스팅 컨테이너와 데이터 볼륨을 제거하므로 새로 설치하면 새 자격 증명을 안전하게 생성할 수 있습니다.

---

## 2. 세션은 계산되지만 Replay는 비어 있습니다.

### 이것이 일반적으로 의미하는 바는 무엇입니까?

현재 아키텍처에서는 일반적으로 다음 두 가지 중 하나입니다.

- `ingest-upload`가 아티팩트 바이트를 저장할 수 없습니다.
- `ingest-worker`가 업로드된 아티팩트를 처리할 수 없습니다.

장치는 더 이상 MinIO/S3에 직접 업로드되지 않으므로 전화기의 버킷 연결 가능성은 더 이상 주요 용의자가 아닙니다.

### 체크 무늬

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

다음을 찾으세요:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### 일반적인 원인

- `.env.selfhosted`의 잘못된 S3 자격 증명
- 외부 S3 버킷 누락
- Docker 네트워크에서 외부 S3 엔드포인트에 연결할 수 없습니다.
- 업로드 릴레이 비정상
- 작업자가 실패한 아티팩트를 재시도하는 중에 멈췄습니다.

### 고치다

- `S3_*` 값 확인
- 스토리지 구성을 변경한 경우 다음을 다시 실행하세요.

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. 대시보드가 ​​로드되지만 인증 또는 API 호출이 실패합니다.

### 체크 무늬

- 대시보드 호스트 DNS가 서버를 가리킵니다.
- API 호스트 DNS는 서버를 가리킵니다.
- 수집 호스트 DNS가 서버를 가리킵니다.
- 포트 `80` 및 `443`가 열려 있습니다.
- Let’s Encrypt가 인증서를 발급했습니다.

검사:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS 또는 인증서 문제

Traefik는 인증서를 자동으로 관리합니다.

### 체크 무늬

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

두 이름 모두 스택을 실행하는 서버로 확인되는지 확인하세요.

처음 설치 중에 DNS가 잘못된 경우 DNS를 수정하고 다시 실행하세요.

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. 외부 S3는 CLI에서 작동하지만 Rejourney는 업로드할 수 없습니다.

업로드 경로는 서버측이라는 것을 기억하세요.

중요한 네트워크 경로는 다음과 같습니다.

- `ingest-upload` 컨테이너 -> S3 엔드포인트

릴레이 로그를 검토하고 `.env.selfhosted`에서 엔드포인트/버킷/키를 확인하여 서버에서 테스트합니다.

변경한 경우 다음을 다시 실행하세요.

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. 내장된 MinIO가 설치되었지만 아티팩트가 여전히 실패합니다.

### 체크 무늬

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

`minio-setup` 원샷은 `S3_BUCKET`라는 이름의 버킷을 생성해야 합니다.

처음 설치 후 버킷 이름을 변경한 경우 다음을 실행합니다.

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. 청구 페이지에 비활성화된 청구가 표시됩니다.

이는 Stripe 키가 구성되지 않은 경우 예상됩니다.

스택은 "자체 호스팅"되기 때문에 더 이상 청구를 비활성화하지 않습니다. Stripe가 구성 해제되었기 때문에 청구가 비활성화됩니다.

Stripe 키를 설정하지 않은 경우:

- 청구 UI가 자체 호스팅/무제한 상태로 유지됩니다.
- Stripe 결제 및 웹후크가 비활성화된 상태로 유지됩니다.

---

## 8. `.env.selfhosted`를 변경한 후 Postgres의 스토리지 엔드포인트가 잘못되었습니다.

달리다:

```bash
./scripts/selfhosted/deploy.sh update
```

업데이트 경로는 부트스트랩을 다시 실행하고 활성 `storage_endpoints` 행을 다시 동기화합니다.

---

## 9. 데이터 손실 없이 서비스를 중지해야 함

사용:

```bash
./scripts/selfhosted/deploy.sh stop
```

이렇게 하면 컨테이너만 중지됩니다. 볼륨은 제거되지 않습니다.

---

## 10. 하나의 서비스에 대해 더 깊은 로그가 필요합니다.

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
