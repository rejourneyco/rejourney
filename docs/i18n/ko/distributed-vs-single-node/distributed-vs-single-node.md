# 분산 vs 단일 노드 클라우드

Rejourney는 두 가지 공식적인 자체 호스팅 배포 형태를 지원합니다.

- 서버 1대용 **단일 노드 Docker Compose** 또는 VPS
- 프로덕션 클러스터 및 수평적 확장을 위한 **분산형 K3s**

이제 둘 다 동일한 코어 백엔드 모델을 사용합니다.

- 스토리지 엔드포인트는 데이터베이스를 기반으로 합니다.
- 수집 업로드는 백엔드 소유 업로드 릴레이를 통과합니다.
- 작업자는 검증된 아티팩트를 처리합니다.
- 재생 가시성은 아티팩트 중심입니다.

---

## 기능 비교

| 기능 | 분산 클라우드 | 단일 노드 클라우드 |
|---------|--------------------|-------------------|
| 플랫폼 | K3s | Docker Compose |
| 규모 | 다중 노드 | 단일 노드 |
| 공개 진입점 | Traefik 수신 | Traefik 컨테이너 |
| 업로드 경로 | API + 수집-업로드 서비스 | API + 수집-업로드 서비스 |
| 스토리지 정보 소스 | `storage_endpoints` 테이블 | `storage_endpoints` 테이블 |
| 기본 객체 스토리지 | 외부 S3 | 내장 MinIO |
| 외부 S3 지원 | 예 | 예 |
| 비밀 암호화 | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| 업데이트 흐름 | k8s 배포 + 작업 | `deploy.sh update` |

---

## 공유 스토리지 모델

두 배포 모델 모두에서 런타임 스토리지 구성은 환경 폴백이 아닌 Postgres에서 제공됩니다.

이는 다음을 의미합니다.

- 활성 객체 스토리지 엔드포인트는 `storage_endpoints`에 저장됩니다.
- 비밀 액세스 키는 `key_ref`로 암호화됩니다.
- 런타임은 데이터베이스 행을 읽습니다.
- 부트스트랩/설치 스크립트는 `.env` 입력을 데이터베이스 행에 동기화하는 역할을 담당합니다.

이로 인해 자체 호스팅 Docker가 이전 폴백 모델보다 프로덕션 및 local-k8s에 훨씬 더 가까워졌습니다.

---

## 단일 노드 Docker Compose를 선택해야 하는 경우

다음과 같은 경우 Docker Compose를 선택하세요.

- 하나의 VPS 또는 베어메탈 호스트에 배포 중입니다.
- 가장 빠른 설치 경로를 원합니다
- 기본적으로 내장 MinIO를 원합니다.
- 다중 노드 확장이나 Kubernetes 작업이 필요하지 않습니다.

공식 진입점:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## 분산형 K3s를 선택하는 경우

다음과 같은 경우 K3s를 선택하세요.

- 여러 노드가 필요합니다
- Kubernetes 기본 작전 및 비밀 처리를 원합니다.
- API, 업로드 및 작업자 서비스를 독립적으로 확장하려는 경우
- 롤링 배포와 더욱 강력한 인프라 격리를 원하는 경우

K3s 경로는 `k8s/` 및 `scripts/k8s/` 아래에 있습니다.

---

## 운영상의 차이

주요 차이점은 더 이상 데이터 모델이 아닙니다. 작동 형태는 다음과 같습니다.

- Compose: 기계 1개, Docker 네트워크 1개, 운영자 스크립트 1개
- K3s: 여러 포드, 네임스페이스, 클러스터 수신, Kubernetes 작업 및 비밀

---

## 실용적인 지침

빠르게 자체 호스팅하려면 단일 노드 Compose로 시작하세요.

다음이 필요할 때 K3s로 이동하세요.

- 더 많은 처리량
- 롤링 클러스터 배포
- 수평 확장
- 보다 탄력적인 인프라 분리

---

## 내부 아키텍처 문서

최신 내부 엔지니어링 영상과 운영자에 대한 심층적인 세부정보를 확인하려면:

- `dev_docs/ingest-session-recording-lifecycle.md`(세션 수명주기 다이어그램)
- `dev_docs/storage-and-endpoints.md`(다중 버킷 토폴로지 다이어그램)
- `dev_docs/allthingscloud.md`(k3s 클라우드 설정 다이어그램)

### 세션 수명주기

![세션 수명주기 아키텍처](./assets/session-lifecycle.svg)

### 다중 버킷 토폴로지

![멀티 버킷 스토리지 토폴로지](./assets/multi-bucket-topology.svg)

### K3s 클라우드 설정

![K3s 분산 클라우드 아키텍처](./assets/k3s-cloud-setup.svg)
