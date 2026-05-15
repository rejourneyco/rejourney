# Współtworzenie Rejourney

Zapraszamy do wpłat! Aby rozpocząć, zapoznaj się z poniższymi przewodnikami.

## Struktura projektu

To jest monorepo zarządzane przez obszary robocze npm.

## Warunki wstępne

1. **Node.js** >= 18.0.0
2. **npm** lub **yarn** (obszary robocze współpracują z obydwoma)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode i CocoaPods
7. **Android**: Android Studio i JDK 17

## Konfiguracja wstępna

### 1. Zainstaluj zależności

Z **źródło** monorepo:

```bash
npm install
```

To będzie:
- Zainstaluj wszystkie zależności obszaru roboczego
- Automatycznie zbuduj pakiet SDK (uruchamia `npm run build:sdk` poprzez skrypt `postinstall` w katalogu głównym `package.json`)
- Połącz poprawnie wszystkie pakiety

### 2. Zbuduj SDK

Jeśli po dokonaniu zmian musisz odbudować SDK:

```bash
npm run build:sdk
```

Lub dla czystej kompilacji:

```bash
npm run build:clean
```

## Rozwój zaplecza (lokalny Kubernetes)

Rejourney wykorzystuje `local-k8s/` do lokalnego rozwoju, więc środowisko wykonawcze pozostaje zbliżone do produkcyjnej konfiguracji Kubernetes, jednocześnie utrzymując szybką pętlę dzienną.

### 1. Skonfiguruj `.env.k8s.local`

Skopiuj lokalny szablon środowiska Kubernetes:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Uruchom hybrydowy stos deweloperski

```bash
npm run dev
```

Ten przepływ:

- W razie potrzeby tworzy lokalny klaster `k3d`
- Dotyczy `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` i `minio.yaml`
- Synchronizuje sekrety `.env.k8s.local` z sekretami Kubernetes
- Uruchamia API, pulpit nawigacyjny i procesy robocze ze źródła na komputerze hosta

Aby uzyskać pełny przebieg parzystości w klastrze:

```bash
npm run dev:full
```

Aby zatrzymać stos lokalny:

```bash
npm run dev:down
```

### 3. Konfiguracja adresu IP (testowanie urządzenia fizycznego)

Jeśli przeprowadzasz testy na **urządzenie fizyczne** (iOS lub Android) podłączonym do tej samej sieci Wi-Fi, SDK i pulpit nawigacyjny muszą znać lokalny adres IP Twojego komputera, aby się komunikować.

#### Znajdowanie adresu IP (Mac)

Uruchom następujące polecenie w swoim terminalu:

```bash
ipconfig getifaddr en0
```

Lub znajdź go w **Ustawienia systemowe > Wi-Fi > [Twoja sieć] Szczegóły**.

#### Zaktualizuj `.env.k8s.local`

Następujące zmienne **MUSIEĆ** wykorzystują Twój lokalny adres IP (np. `http://192.168.1.5:3000`) zamiast `localhost`:

| Zmienna | Użycie klucza |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Publiczny dostęp do MinIO w celu powtórek wideo |
| `PUBLIC_DASHBOARD_URL` | Podstawowy adres URL interfejsu panelu |
| `PUBLIC_API_URL` | Podstawowy adres URL dla API |
| `PUBLIC_INGEST_URL` | Podstawowy adres URL dla pozyskiwania zdarzeń SDK |
| `DASHBOARD_ORIGIN` | Pochodzenie CORS deski rozdzielczej |
| `OAUTH_REDIRECT_BASE` | Podstawowy adres URL dla wywołań zwrotnych OAuth |




> [!IMPORTANT]
> Nieprawidłowe ustawienie tych ustawień spowoduje pojawienie się błędów „Odmowa połączenia” na urządzeniach fizycznych lub uszkodzenie łączy do obrazów/wideo na pulpicie nawigacyjnym.

`npm run dev` aktualizuje te wartości skierowane do sieci LAN automatycznie poprzez `scripts/local-k8s/update-ips.sh`, a także zapisuje przykładowe pliki env aplikacji używane przez aplikacje Expo.

#### Przykładowa konfiguracja (`.env.k8s.local`)

Zakładając, że adres IP Twojego komputera to `192.168.1.100`:

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

### 4. Lokalne pliki Kubernetes

Lokalne manifesty Kubernetes celowo odzwierciedlają układ produkcyjny `k8s/`:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Uruchamianie przykładowych aplikacji

### React Native Płyta kotłowa (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Lub z przykładowego katalogu:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Laboratoria parzenia kawy (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Goły

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Jak to działa

### Konfiguracja obszaru roboczego

Monorepo wykorzystuje obszary robocze npm dla pakietów podstawowych, ale przykładowe aplikacje są samodzielne:

1. **Korzeń `package.json`** zawiera tylko `packages/*`, `backend` i `dashboard/web-ui` w obszarach roboczych
2. **Przykładowe aplikacje są samodzielne** - mają własne `node_modules`, aby uniknąć konfliktów zależności
3. **Przykładowe aplikacje** odwołuje się do SDK za pomocą `"rejourney": "file:../../packages/react-native"`
4. **Konfiguracje metra** są skonfigurowane do prawidłowego oglądania i rozwiązywania pakietu SDK

**Dlaczego przykładów nie ma w obszarach roboczych:**
- Przykładowe aplikacje korzystają z różnych wersji Expo/React Native
- Zapobiega konfliktom deduplikacji zależności npm
- Każdy przykład może mieć własne, kompletne drzewo zależności

### Konfiguracja metra

Każda przykładowa aplikacja ma `metro.config.js`, który:

1. **Zegarki** katalog źródłowy SDK (`packages/react-native`) do zmian
2. **Rozwiązuje** pakiet `rejourney` do właściwej lokalizacji
3. **Bloki** zduplikowane pakiety `react-native` i `react` z katalogu głównego obszaru roboczego

### Codegen (TurboModuły)

Codegen React Native uruchamia się automatycznie podczas tworzenia aplikacji, jeśli:

1. SDK `package.json` ma zdefiniowane `codegenConfig` ✅
2. Plik specyfikacji (`NativeRejourney.ts`) jest zgodny z konwencją nazewnictwa ✅
3. Aplikacja zawiera pakiet SDK ✅

Codegen działa automatycznie podczas:
- `npm run ios` (kompilacje iOS)
- `npm run android` (kompilacje Android)

## Struktura projektu

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

## CI/CD i wdrożenie

Rejourney wykorzystuje GitHub Actions do automatyzacji testowania, budowania i wdrażania w całym monorepo.

Aby uzyskać szczegółowy opis naszych zestawów testów, natywnych testów integracyjnych i logiki automatycznego wdrażania, zobacz [CI/CD i dokumentację testowania](/docs/architecture/ci-cd).

---

Zapoznaj się z [Porównaniem architektury](/docs/architecture/distributed-vs-single-node), aby uzyskać szczegółowe informacje na temat chmury (K8s) i samodzielnego hostowania (Docker).

## Najlepsze praktyki

1. **Zawsze buduj SDK** przed testowaniem: `npm run build:sdk`
2. **Użyj protokołu pliku** (`file:../../packages/react-native`) w package.json dla obszarów roboczych npm
3. **Wyczyść pamięć podręczną Metro** w przypadku problemów: `npm start -- --reset-cache`
4. **Odbuduj aplikacje natywne** po zmianach kodu natywnego SDK
5. **Przetestuj zarówno na iOS, jak i Android** przed zatwierdzeniem
