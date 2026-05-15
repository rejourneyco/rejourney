# 자체 호스팅 Rejourney

이 가이드는 공식 **Docker Compose** 스택을 사용하여 자체 서버(일반적으로 단일 VPS 또는 전용 시스템)에서 Rejourney를 실행하는 **누구나** 용입니다. Rejourney의 내부 인프라 또는 Kubernetes에 액세스할 필요가 없습니다.

설정 후에는 다음을 얻을 수 있습니다.

- 도메인의 **웹 대시보드**(Let’s Encrypt를 통한 HTTPS)
- 하위 도메인의 **API**(대시보드 및 모바일 SDK용)
- 다른 하위 도메인의 **수집(업로드) 릴레이**(세션 업로드는 전화기에서 객체 스토리지로 직접 이동하지 않고 서버를 통해 이동함)
- **PostgreSQL**, **Redis** 및 **내장 MinIO** 또는 **나만의 S3-compatible 스토리지**
- 세션, 보존 및 경고를 처리하는 배경 **노동자**(Rejourney의 클라우드 배포와 동일한 역할)

아래의 모든 명령은 복제 후 **저장소 루트**(`docker-compose.selfhosted.yml`가 포함된 폴더)에 있다고 가정합니다.

---

## 사전에 필요한 것

### 섬기는 사람

- **운영체제:** Ubuntu 22.04+, Debian 12+ 또는 Docker를 잘 실행하는 다른 Linux
- **Docker:** 24 ​​이상, **Docker Compose 플러그인** 포함(`docker compose version`가 작동해야 함)
- **리소스(권장):** vCPU 4개, 8GB RAM, 40GB 디스크(녹화를 많이 보관하는 경우 더 많음)
- **회로망:** 포트 **80** 및 **443** 는 인터넷에 열려 있습니다(Let’s Encrypt HTTP 챌린지 및 HTTPS에 필요함).

### 도메인 및 DNS

귀하가 제어하는 ​​ **하나의 기본 도메인** 가 필요합니다(예: `example.com`). 설치 프로그램을 실행하기 전에 서버의 공용 IP에서 다음 호스트 이름의 **모두** 를 가리키는 **에이** **에이**(또는 **AAAA**) 레코드를 만듭니다.

| 호스트 이름 | 목적 |
|----------|---------|
| `example.com` | 대시보드 |
| `www.example.com` | 대시보드로 리디렉션 |
| `api.example.com` | API(및 사용되는 경우 WebSocket) |
| `ingest.example.com` | 업로드 릴레이(API가 구성되면 SDK는 이를 자동으로 사용함) |

`example.com`를 실제 도메인으로 바꾸세요. 전파에는 몇 분에서 몇 시간이 걸릴 수 있습니다. TLS 인증서는 DNS가 올바르게 해결될 때까지 발급되지 않습니다.

### Let’s Encrypt

설치 중에 **이메일 주소** 를 묻는 메시지가 표시됩니다. Let’s Encrypt의 인증서 만료 알림에 사용됩니다.

### 컴퓨터의 도구

- 저장소를 복제하는 `git`
- `openssl`(설치 스크립트에서 비밀을 생성하는 데 사용됨)
- 쉘(bash는 괜찮습니다)

---

## 최초 설치

### 1. 저장소 복제

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

기본 분기(또는 프로젝트에 자체 호스팅용으로 문서화된 경우 릴리스 태그)를 유지하세요.

### 2. 설치 프로그램 실행

```bash
./scripts/selfhosted/deploy.sh install
```

스크립트는 다음을 수행합니다.

1. **기본 도메인** 를 요청하세요(예: `example.com` — `https://` 아님, 경로 없음).
2. **Let’s Encrypt 이메일** 를 요청하세요.
3. **저장** 를 요청하세요. 내장형 **MinIO**(권장) 또는 **외부 S3-compatible** 스토리지(엔드포인트, 버킷, 지역 및 키를 입력합니다).
4. 생성된 비밀번호와 비밀을 사용하여 저장소 루트에 **`.env.selfhosted`** 를 생성합니다. **권한 제한** 가 적용됩니다(`chmod 600`).
5. **당기다** 는 컨테이너 이미지(API, 웹, 작업자, 데이터베이스, Traefik 등)를 게시했습니다.
6. **짓다** **부트스트랩/마이그레이션** 이미지 **당신의 클론에서**(데이터베이스 설정 스크립트가 포함되어 있으며 컨테이너 레지스트리에서 다운로드되지 않음)
7. 데이터베이스 Redis, Traefik 및 (선택한 경우) MinIO를 시작합니다.
8. 부트스트랩이 실행되기 전에 구성된 `DATABASE_URL`를 사용하여 데이터베이스 연결을 검증합니다.
9. 일회성 **부트스트랩** 컨테이너(데이터베이스 스키마, 선택적 최초 시드 및 데이터베이스의 스토리지 구성)를 실행합니다.
10. API를 시작하고 릴레이, 대시보드 및 작업자를 업로드합니다.

처음 설치하는 데는 몇 분 정도 걸릴 수 있습니다(이미지 가져오기 및 부트스트랩).

### 3. `.env.selfhosted`를 보호하세요

이 파일에는 배포용 **모든 비밀** 가 들어 있습니다(데이터베이스, Redis, JWT, 스토리지 암호화, 사용된 경우 MinIO 자격 증명 등). **백업하세요** 를 안전한 장소(비밀번호 관리자, 암호화된 백업)로 복사하세요. 이를 분실하면 저장된 자격 증명을 해독하거나 동일한 배포를 재구성하는 기능을 잃을 수 있습니다.

git에 커밋하지 마세요(`.gitignore`에서는 무시되어야 함).

---

## 설치 후

### URL

설치 프로그램이 URL을 인쇄합니다. 일반적으로:

- **계기반:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **섭취:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>`가 대시보드로 리디렉션됩니다.

### 스택 확인

```bash
./scripts/selfhosted/deploy.sh status
```

실행 중인 컨테이너가 표시되어야 합니다. `api` 및 `ingest-upload`는 잠시 후에 **건강한** 가 되어야 합니다.

### 첫 로그인 및 테스트 녹화

1. 브라우저에서 대시보드를 엽니다.
2. 계정과 프로젝트를 생성합니다.
3. **API URL** 로 앱의 Rejourney SDK를 구성하세요(아래 [SDK 구성](#configuring-your-mobile-app) 참조).
4. 짧은 세션을 녹화하고 재생에 나타나는지 확인합니다.

세션이 Replay에 표시되지 않으면 [문제 해결](/docs/selfhosted/troubleshooting)(릴레이 업로드 및 작업자 로그 수집)을 참조하세요.

---

## 일상적인 운영

이들 모두는 repo 루트에서 실행됩니다.

| 액션 | 명령 |
|--------|---------|
| 서비스현황 | `./scripts/selfhosted/deploy.sh status` |
| 모든 로그 팔로우 | `./scripts/selfhosted/deploy.sh logs` |
| 하나의 서비스에 대한 로그 | `./scripts/selfhosted/deploy.sh logs api`(`api`를 `web`, `ingest-upload`, `ingest-worker` 등으로 교체) |
| **치받이** 이미지 및 부트스트랩 재실행 | `./scripts/selfhosted/deploy.sh update` |
| **없이** 데이터 삭제를 모두 중지하세요 | `./scripts/selfhosted/deploy.sh stop` |
| **다시 놓기** 컨테이너 및 볼륨(파괴적) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** 는 최신 이미지(해당되는 경우)를 가져오고, 현재 클론에서 부트스트랩 이미지를 다시 빌드하고, 스택을 다시 시작한 다음, 부트스트랩을 다시 실행하여 데이터베이스 스키마 및 스토리지 설정이 `.env.selfhosted`와 일치하도록 유지합니다. **~ 아니다** Postgres 또는 객체 스토리지 볼륨을 삭제합니다.

부트스트랩 전에 `install` 및 `update`는 모두 구성된 자격 증명을 사용하여 데이터베이스 연결을 검증합니다. 자격 증명이 지속된 Postgres 데이터와 일치하지 않으면 나중에 부트스트랩에서 실패하는 대신 복구 지침에 따라 배포가 조기에 중지됩니다.

**`stop`** 는 컨테이너만 중지합니다. Docker **볼륨**(Postgres 데이터, MinIO 데이터 등)은 명시적으로 제거할 때까지 유지됩니다.

**`reset`** 는 확인 메시지가 표시된 후 자체 호스팅 컨테이너와 Docker 볼륨(`pgdata`, `redisdata`, `miniodata`, `traefik-certs`)을 제거합니다. 또한 `.env.selfhosted`가 누락된 경우에도 MinIO 프로필 컨테이너를 해체하므로 오래된 MinIO 데이터가 다음 설치를 차단하지 않습니다. 완전히 새로 설치하려는 경우에만 이 옵션을 사용하세요.

---

## 스토리지: MinIO 대 외부 S3

### 내장 MinIO(기본값)

- 단일 서버의 경우 가장 쉬움: 객체 스토리지는 **내부 Docker** 를 실행하며 기본적으로 공용 인터넷에 노출되지 않습니다.
- 세션 바이트는 **수집-업로드** 서비스에 의해 기록됩니다. 장치는 MinIO에 직접 연결할 필요가 없습니다.
- 버킷 생성은 설치 중에 처리됩니다.

### 외부 S3-compatible 스토리지

AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi 또는 모든 S3-compatible API를 사용하세요. 설치하는 동안 엔드포인트 URL, 버킷, 지역 및 액세스 키를 제공합니다.

엔드포인트 URL 스타일의 예(공급업체의 문서는 신뢰할 수 있음):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- 헤츠너: `https://<location>.your-objectstorage.com`

다운로드를 위해 **별도의 공개 URL** 를 추가하는 경우 `.env.selfhosted`에 `S3_PUBLIC_ENDPOINT`를 설정하고 `./scripts/selfhosted/deploy.sh update`를 실행합니다.

---

## 중요 구성(`.env.selfhosted`)

설치 프로그램이 이 파일을 생성합니다. 일반적인 변수는 다음과 같습니다.

- **도메인 및 공개 URL:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **데이터 베이스:** `DATABASE_URL`(Compose 내부의 `postgres` 서비스를 가리킴)
- **Redis:** `REDIS_URL`
- **저장:** `STORAGE_BACKEND`, `S3_*` 및 선택적으로 `MINIO_*`
- **보안:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

선택적 통합(사용하지 않는 경우 공백으로 남겨두기): Stripe, SMTP, GitHub OAuth, Turnstile 등

**저장소 또는 도메인 관련 값 변경:** `.env.selfhosted`를 편집한 후 다음을 실행합니다.

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 데이터베이스 설정 작동 방식(첫 번째 부팅 및 이후 업데이트)

일반적으로 **~ 아니다** 에서는 SQL을 직접 실행해야 합니다. **부트스트랩** 컨테이너가 이를 처리합니다.

- **새로운 빈 데이터베이스:** 스택은 코드의 현재 스키마를 적용한 다음 이미 충족된 마이그레이션 버전을 기록하므로 향후 업데이트는 **새로운** 마이그레이션에만 적용됩니다.
- **기존 데이터베이스(이미 초기화됨):** **보류 중** 마이그레이션만 적용됩니다. 각 `update`에서 데이터가 처음부터 다시 작성되지 않습니다.
- 데이터베이스가 **이미 테이블이 있어요** 이지만 마이그레이션 기록 테이블이 **누락되었거나 비어 있음** 인 경우(예: 부분 복원) 우발적인 손상을 방지하기 위해 **오류로 인해 중지됨** 를 부트스트랩합니다. 고급 복구 옵션은 [문제 해결](/docs/selfhosted/troubleshooting)에 설명되어 있습니다.

---

## Apple Silicon 및 ARM 서버

**ARM64** 머신(많은 Mac, 일부 클라우드 인스턴스)에서 배포 스크립트는 사용자가 직접 설정하지 않은 경우 이미지 가져오기를 위해 `DOCKER_DEFAULT_PLATFORM=linux/amd64`를 설정하므로 `amd64`만 게시하는 사전 빌드된 이미지는 계속 실행됩니다. 다른 동작이 필요한 경우 스크립트를 실행하기 전에 환경에서 `DOCKER_DEFAULT_PLATFORM`를 설정하세요.

**부트스트랩** 이미지는 항상 복제된 저장소의 **당신의 컴퓨터에 구축** 이므로 항상 체크아웃과 일치합니다.

---

## Docker에서 실행되는 내용(개요)

- **Traefik:** HTTPS 인증서 및 대시보드 API로 라우팅하고 호스트 이름을 수집합니다.
- **Postgres / Redis:** 애플리케이션 데이터 및 대기열.
- **MinIO:** 내부 객체 스토리지(옵션)입니다.
- **API:** 메인 HTTP API.
- **수집-업로드:** 업로드 릴레이 트래픽 전용 서비스입니다.
- **편물:** 대시보드 정적 UI.
- **노동자:** 프로세스 수집 대기열, 아티팩트 재생, 세션 수명 주기, 예약된 보존 스타일 작업 및 경고를 처리합니다.

이 스택에는 **아니요** 별도의 청구 일괄 작업자가 있습니다. 결제 통합은 키를 구성할 때 Stripe 및 API에 의해 주도됩니다.

---

## 모바일 앱 구성

**당신의** API 호스트에서 SDK를 가리킵니다(`API_DOMAIN` / `PUBLIC_API_URL`와 일치해야 함).

### React Native 예

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

실제 API URL을 사용하세요. 서버가 올바르게 구성되면 `ingest.<your-domain>`에 대한 업로드 URL이 자동으로 파생됩니다.

---

## 백업

최소한 **PostgreSQL**, **`.env.selfhosted`** 및 (내장 MinIO를 사용하는 경우) **객체 스토리지 데이터** 를 백업하십시오.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

세부정보: [백업 및 복구](/docs/selfhosted/backup-recovery).

---

## 문제 해결 및 지원

- [문제 해결](/docs/selfhosted/troubleshooting) — 부트스트랩 실패, TLS, 빈 재생, 외부 S3 문제.
- [백업 및 복구](/docs/selfhosted/backup-recovery) — 복원 순서 및 MinIO.

이 문서에 대한 버그나 개선 사항이 있는 경우 GitHub에서 프로젝트의 공개 문제 추적기를 사용하세요.

---

## 관련 문서

- [분산형 vs 단일 노드 클라우드](/docs/distributed-vs-single-node/distributed-vs-single-node) — 다중 서비스 클라우드 레이아웃과 비교하는 방법(개념적)
