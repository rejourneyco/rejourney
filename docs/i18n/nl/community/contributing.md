# Bijdragen aan Rejourney

Wij zijn blij met bijdragen! Raadpleeg de onderstaande handleidingen om aan de slag te gaan.

## Projectstructuur

Dit is een monorepo die wordt beheerd door npm-werkruimten.

## Vereisten

1. **Node.js** >= 18.0.0
2. **npm** of **yarn** (werkruimten werken met beide)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode en CocoaPods
7. **Android**: Android Studio en JDK 17

## Initiële installatie

### 1. Installeer afhankelijkheden

Van de **wortel** van de monorepo:

```bash
npm install
```

Dit zal:
- Installeer alle afhankelijkheden van de werkruimte
- Bouw het SDK-pakket automatisch (voert `npm run build:sdk` uit via het `postinstall`-script in de root `package.json`)
- Koppel alle pakketten correct

### 2. Bouw de SDK

Als u de SDK opnieuw moet opbouwen nadat u wijzigingen heeft aangebracht:

```bash
npm run build:sdk
```

Of voor een schone build:

```bash
npm run build:clean
```

## Backend-ontwikkeling (lokaal Kubernetes)

Rejourney gebruikt `local-k8s/` voor lokale ontwikkeling, zodat de looptijd dicht bij de productie-Kubernetes-opstelling blijft, terwijl de dagelijkse lus toch snel blijft.

### 1. Configureer `.env.k8s.local`

Kopieer de lokale Kubernetes-omgevingssjabloon:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Start de Hybrid Dev Stack

```bash
npm run dev
```

Die stroom:

- Creëert indien nodig een lokaal `k3d`-cluster
- Geldt voor `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` en `minio.yaml`
- Synchroniseert `.env.k8s.local` met Kubernetes-geheimen
- Voert de API, het dashboard en de werkrollen uit vanaf de broncode op uw hostcomputer

Voor een volledige pariteitsrun binnen het cluster:

```bash
npm run dev:full
```

Om de lokale stapel te stoppen:

```bash
npm run dev:down
```

### 3. IP-adresconfiguratie (testen van fysieke apparaten)

Als u test op een **fysiek apparaat** (iOS of Android) die is aangesloten op dezelfde WiFi, moeten de SDK en het Dashboard het lokale IP-adres van uw computer kennen om te kunnen communiceren.

#### Uw IP-adres vinden (Mac)

Voer de volgende opdracht uit in uw terminal:

```bash
ipconfig getifaddr en0
```

Of zoek het in **Systeeminstellingen > WiFi > [Uw netwerk] details**.

#### `.env.k8s.local` bijwerken

De volgende variabelen **MOETEN** gebruiken uw lokale IP-adres (bijvoorbeeld `http://192.168.1.5:3000`) in plaats van `localhost`:

| Variabel | Sleutelgebruik |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Openbare toegang tot MinIO voor videoherhalingen |
| `PUBLIC_DASHBOARD_URL` | Basis-URL voor de dashboard-UI |
| `PUBLIC_API_URL` | Basis-URL voor de API |
| `PUBLIC_INGEST_URL` | Basis-URL voor opname van SDK-gebeurtenis |
| `DASHBOARD_ORIGIN` | CORS-oorsprong voor het dashboard |
| `OAUTH_REDIRECT_BASE` | Basis-URL voor OAuth-callbacks |




> [!IMPORTANT]
> Als u deze niet correct instelt, resulteert dit in 'Verbinding geweigerd'-fouten op fysieke apparaten of verbroken beeld-/videolinks in het dashboard.

`npm run dev` werkt deze LAN-gerichte waarden automatisch bij via `scripts/local-k8s/update-ips.sh`, en schrijft ook de voorbeeldapp-env-bestanden die worden gebruikt door de Expo-apps.

#### Voorbeeldconfiguratie (`.env.k8s.local`)

Ervan uitgaande dat het IP-adres van uw computer `192.168.1.100` is:

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

### 4. Lokale Kubernetes-bestanden

De lokale Kubernetes-manifesten weerspiegelen opzettelijk de productie-`k8s/`-indeling:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Voorbeeld-apps uitvoeren

### React Native Ketelplaat (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Of uit de voorbeeldmap:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Koffiebrouwlaboratoria (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Kaal

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Hoe het werkt

### Werkruimte instellen

De monorepo gebruikt npm-werkruimten voor kernpakketten, maar voorbeeld-apps zijn zelfstandig:

1. **Wortel `package.json`** bevat alleen `packages/*`, `backend` en `dashboard/web-ui` in werkruimten
2. **Voorbeeld-apps zijn standalone** - ze hebben hun eigen `node_modules` om afhankelijkheidsconflicten te voorkomen
3. **Voorbeeld-apps** verwijst naar de SDK met behulp van `"rejourney": "file:../../packages/react-native"`
4. **Metro-configuraties** zijn geconfigureerd om het SDK-pakket correct te bekijken en op te lossen

**Waarom voorbeelden niet in werkruimten staan:**
- Voorbeeld-apps gebruiken verschillende versies van Expo/React Native
- Voorkomt conflicten met deduplicatie van npm-afhankelijkheid
- Elk voorbeeld kan zijn eigen volledige afhankelijkheidsboom hebben

### Metro-configuratie

Elke voorbeeld-app heeft een `metro.config.js` die:

1. **Horloges** de SDK-bronmap (`packages/react-native`) voor wijzigingen
2. **Lost op** het `rejourney`-pakket naar de juiste locatie
3. **Blokken** dupliceer `react-native`- en `react`-pakketten vanuit de hoofdmap van de werkruimte

### Codegen (TurboModules)

De codegen van React Native wordt automatisch uitgevoerd tijdens het bouwen van de app als:

1. De `package.json` van de SDK heeft `codegenConfig` gedefinieerd ✅
2. Het specificatiebestand (`NativeRejourney.ts`) volgt de naamgevingsconventie ✅
3. De app bevat het SDK-pakket ✅

Codegen draait automatisch tijdens:
- `npm run ios` (iOS-builds)
- `npm run android` (Android-builds)

## Projectstructuur

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

## CI/CD en implementatie

Rejourney gebruikt GitHub Actions om het testen, bouwen en implementeren in de gehele monorepo te automatiseren.

Voor een gedetailleerd overzicht van onze testsuites, native integratietests en geautomatiseerde implementatielogica, raadpleegt u de [CI/CD en testdocumentatie](/docs/architecture/ci-cd).

---

Verken de [Architectuurvergelijking](/docs/architecture/distributed-vs-single-node) voor details over Cloud (K8s) versus zelf-hostend (Docker).

## Beste praktijken

1. **Bouw altijd de SDK** vóór testen: `npm run build:sdk`
2. **Gebruik het bestandsprotocol** (`file:../../packages/react-native`) in package.json voor npm-werkruimten
3. **Wis de Metro-cache** bij problemen: `npm start -- --reset-cache`
4. **Herbouw native apps** na wijzigingen in de native code van SDK
5. **Test op zowel iOS als Android** voordat u een commit maakt
