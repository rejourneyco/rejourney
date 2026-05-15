# Rejourney에 기여

우리는 기여를 환영합니다! 시작하려면 아래 가이드를 참조하세요.

## 프로젝트 구조

npm 작업공간에서 관리하는 모노레포입니다.

## 전제 조건

1. **Node.js** >= 18.0.0
2. **npm** 또는 **yarn**(작업공간은 둘 다에서 작동)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode 및 CocoaPods
7. **Android**: Android Studio 및 JDK 17

## 초기 설정

### 1. 종속성 설치

모노레포의 **뿌리** 에서:

```bash
npm install
```

이는 다음을 수행합니다.
- 모든 작업공간 종속 항목 설치
- SDK 패키지를 자동으로 빌드합니다(루트 `package.json`의 `postinstall` 스크립트를 통해 `npm run build:sdk` 실행).
- 모든 패키지를 올바르게 연결

### 2. SDK 빌드

변경 후 SDK를 다시 빌드해야 하는 경우:

```bash
npm run build:sdk
```

또는 클린 빌드의 경우:

```bash
npm run build:clean
```

## 백엔드 개발(로컬 Kubernetes)

Rejourney는 로컬 개발에 `local-k8s/`를 사용하므로 런타임은 프로덕션 Kubernetes 설정과 비슷하게 유지되면서도 일일 루프를 빠르게 유지합니다.

### 1. `.env.k8s.local` 구성

로컬 Kubernetes 환경 템플릿을 복사합니다.

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. 하이브리드 개발 스택 시작

```bash
npm run dev
```

해당 흐름은 다음과 같습니다.

- 필요한 경우 로컬 `k3d` 클러스터를 생성합니다.
- `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` 및 `minio.yaml`를 적용합니다.
- `.env.k8s.local`를 Kubernetes 보안 비밀로 동기화합니다.
- 호스트 시스템의 소스에서 API, 대시보드 및 작업자를 실행합니다.

전체 클러스터 내 패리티 실행의 경우:

```bash
npm run dev:full
```

로컬 스택을 중지하려면:

```bash
npm run dev:down
```

### 3. IP 주소 구성(물리적 장치 테스트)

동일한 WiFi에 연결된 **물리적 장치**(iOS 또는 Android)에서 테스트하는 경우 SDK와 대시보드가 ​​통신하려면 컴퓨터의 로컬 IP 주소를 알아야 합니다.

#### IP 주소 찾기(Mac)

터미널에서 다음 명령을 실행하세요.

```bash
ipconfig getifaddr en0
```

또는 **시스템 설정 > WiFi > [사용자 네트워크] 세부정보** 에서 찾으세요.

#### `.env.k8s.local` 업데이트

다음 변수 **해야 하다** 는 `localhost` 대신 로컬 IP 주소(예: `http://192.168.1.5:3000`)를 사용합니다.

| 변수 | 키 사용법 |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | 비디오 재생을 위한 MinIO에 대한 공개 액세스 |
| `PUBLIC_DASHBOARD_URL` | 대시보드 UI의 기본 URL |
| `PUBLIC_API_URL` | API의 기본 URL |
| `PUBLIC_INGEST_URL` | SDK 이벤트 수집을 위한 기본 URL |
| `DASHBOARD_ORIGIN` | 대시보드의 CORS 원본 |
| `OAUTH_REDIRECT_BASE` | OAuth 콜백의 기본 URL |




> [!IMPORTANT]
> 이를 올바르게 설정하지 않으면 물리적 장치에 "연결 거부" 오류가 발생하거나 대시보드의 이미지/비디오 링크가 끊어집니다.

`npm run dev`는 `scripts/local-k8s/update-ips.sh`를 통해 이러한 LAN 연결 값을 자동으로 업데이트하고 Expo 앱에서 사용하는 예제 앱 환경 파일도 작성합니다.

#### 구성 예(`.env.k8s.local`)

컴퓨터의 IP 주소가 `192.168.1.100`라고 가정합니다.

```env
# Object storage (host access to local-k8s MinIO)
S3_ENDPOINT=http://127.0.0.1:9000
S3_PUBLIC_ENDPOINT=http://192.168.1.100:9000

# Public URLs
PUBLIC_DASHBOARD_URL=http://192.168.1.100:8080
PUBLIC_API_URL=http://192.168.1.100:3000
PUBLIC_INGEST_URL=http://192.168.1.100:3000
DASHBOARD_ORIGIN=http://192.168.1.100:8080
OAUTH_REDIRECT_BASE=http://192.168.1.100:3000
```

### 4. 로컬 Kubernetes 파일

로컬 Kubernetes 매니페스트는 프로덕션 `k8s/` 레이아웃을 의도적으로 미러링합니다.

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## 예제 앱 실행

### React Native 상용구(Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

또는 예제 디렉토리에서:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### 브루 커피 연구소 (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native 베어

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## 작동 방식

### 작업공간 설정

monorepo는 핵심 패키지에 npm 작업 영역을 사용하지만 예제 앱은 독립형입니다.

1. **루트 `package.json`** 에는 작업공간에 `packages/*`, `backend` 및 `dashboard/web-ui`만 포함됩니다.
2. **예시 앱은 독립형입니다.** - 종속성 충돌을 피하기 위해 자체 `node_modules`가 있습니다.
3. **예시 앱** 는 `"rejourney": "file:../../packages/react-native"`를 사용하여 SDK를 참조합니다.
4. **지하철 구성** 는 SDK 패키지를 올바르게 감시하고 해결하도록 구성되었습니다.

**예제가 작업공간에 없는 이유:**
- 예시 앱은 다양한 Expo/React Native 버전을 사용합니다.
- npm 종속성 중복 제거 충돌을 방지합니다.
- 각 예제에는 자체적인 완전한 종속성 트리가 있을 수 있습니다.

### 메트로 구성

각 예시 앱에는 다음과 같은 `metro.config.js`가 있습니다.

1. **시계** 변경을 위한 SDK 소스 디렉터리(`packages/react-native`)
2. **해결하다** `rejourney` 패키지를 올바른 위치로
3. **블록** 작업공간 루트에서 `react-native` 및 `react` 패키지를 복제합니다.

### Codegen(터보모듈)

React Native의 codegen은 다음과 같은 경우 앱을 빌드할 때 자동으로 실행됩니다.

1. SDK의 `package.json`에는 `codegenConfig`가 정의되어 있습니다 ✅
2. 사양 파일(`NativeRejourney.ts`)은 명명 규칙을 따릅니다 ✅
3. 이 앱에는 SDK 패키지가 포함되어 있습니다 ✅

Codegen은 다음 동안 자동으로 실행됩니다.
- `npm run ios` (iOS 빌드)
- `npm run android` (Android 빌드)

## 프로젝트 구조

```
rejourney/
├── packages/
│   └── react-native/          # SDK package
│       ├── src/                # TypeScript source
│       ├── android/           # Android native code
│       ├── ios/               # iOS native code
│       └── package.json       # Package config with codegenConfig
├── examples/
│   ├── react-native-boilerplate/  # Expo example
│   ├── brew-coffee-labs/          # Expo example
│   └── react-native-bare/         # Bare RN example
└── package.json               # Root workspace config
```

## CI/CD 및 배포

Rejourney는 GitHub Actions를 사용하여 전체 모노레포에서 테스트, 구축 및 배포를 자동화합니다.

테스트 제품군, 기본 통합 테스트 및 자동화된 배포 논리에 대한 자세한 내용은 [CI/CD 및 테스트 문서](/docs/architecture/ci-cd)를 참조하세요.

---

클라우드(K8s)와 셀프 호스팅(Docker)에 대한 자세한 내용은 [아키텍처 비교](/docs/architecture/distributed-vs-single-node)를 살펴보세요.

## 모범 사례

1. 테스트 전 **항상 SDK를 빌드하세요.**: `npm run build:sdk`
2. npm 작업공간용 package.json의 **파일 프로토콜 사용**(`file:../../packages/react-native`)
3. 문제가 있는 경우 **Metro 캐시 지우기**: `npm start -- --reset-cache`
4. SDK 네이티브 코드 변경 후 **네이티브 앱 재구축**
5. 커밋하기 전에 **iOS 및 Android 모두에서 테스트**
