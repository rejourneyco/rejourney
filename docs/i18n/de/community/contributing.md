# Beitrag zu Rejourney

Wir freuen uns über Beiträge! Bitte sehen Sie sich die folgenden Anleitungen an, um loszulegen.

## Projektstruktur

Dies ist ein Monorepo, das von npm-Arbeitsbereichen verwaltet wird.

## Voraussetzungen

1. **Node.js** >= 18.0.0
2. **npm** oder **yarn** (Arbeitsbereiche funktionieren mit beiden)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode und CocoaPods
7. **Android**: Android Studio und JDK 17

## Ersteinrichtung

### 1. Abhängigkeiten installieren

Aus dem **Wurzel** des Monorepos:

```bash
npm install
```

Dies wird:
- Installieren Sie alle Arbeitsbereichsabhängigkeiten
- Erstellen Sie das SDK-Paket automatisch (führt `npm run build:sdk` über das `postinstall`-Skript im Stammverzeichnis `package.json` aus).
- Verknüpfen Sie alle Pakete korrekt

### 2. Erstellen Sie SDK

Wenn Sie SDK neu erstellen müssen, nachdem Sie Änderungen vorgenommen haben:

```bash
npm run build:sdk
```

Oder für einen sauberen Build:

```bash
npm run build:clean
```

## Backend-Entwicklung (Lokal Kubernetes)

Rejourney verwendet `local-k8s/` für die lokale Entwicklung, sodass die Laufzeit nahe am Produktions-Kubernetes-Setup bleibt und gleichzeitig die tägliche Schleife schnell bleibt.

### 1. Konfigurieren Sie `.env.k8s.local`

Kopieren Sie die lokale Umgebungsvorlage Kubernetes:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Starten Sie den Hybrid Dev Stack

```bash
npm run dev
```

Dieser Fluss:

- Erstellt bei Bedarf einen lokalen `k3d`-Cluster
- Gilt für `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` und `minio.yaml`
- Synchronisiert `.env.k8s.local` mit Kubernetes-Geheimnissen
- Führt API, Dashboard und Worker aus der Quelle auf Ihrem Hostcomputer aus

Für einen vollständigen Paritätslauf im Cluster:

```bash
npm run dev:full
```

So stoppen Sie den lokalen Stack:

```bash
npm run dev:down
```

### 3. IP-Adresskonfiguration (Physical Device Testing)

Wenn Sie auf einem **physisches Gerät** (iOS oder Android) testen, der mit demselben WLAN verbunden ist, müssen der SDK und das Dashboard die lokale IP-Adresse Ihres Computers kennen, um kommunizieren zu können.

#### Finden Sie Ihre IP-Adresse (Mac)

Führen Sie den folgenden Befehl in Ihrem Terminal aus:

```bash
ipconfig getifaddr en0
```

Oder finden Sie es unter **Systemeinstellungen > WLAN > [Ihr Netzwerk] Details**.

#### Aktualisieren Sie `.env.k8s.local`

Die folgenden Variablen **MUSS** verwenden Ihre lokale IP-Adresse (z. B. `http://192.168.1.5:3000`) anstelle von `localhost`:

| Variable | Schlüsselverwendung |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Öffentlicher Zugriff auf MinIO für Videowiedergaben |
| `PUBLIC_DASHBOARD_URL` | Basis-URL für die Dashboard-Benutzeroberfläche |
| `PUBLIC_API_URL` | Basis-URL für API |
| `PUBLIC_INGEST_URL` | Basis-URL für die Ereignisaufnahme SDK |
| `DASHBOARD_ORIGIN` | CORS-Ursprung für das Dashboard |
| `OAUTH_REDIRECT_BASE` | Basis-URL für OAuth-Rückrufe |




> [!IMPORTANT]
> Wenn diese nicht richtig eingestellt werden, kommt es zu der Fehlermeldung „Verbindung abgelehnt“ auf physischen Geräten oder zu fehlerhaften Bild-/Video-Links im Dashboard.

`npm run dev` aktualisiert diese LAN-bezogenen Werte automatisch über `scripts/local-k8s/update-ips.sh` und schreibt auch die Beispiel-App-Umgebungsdateien, die von den Expo-Apps verwendet werden.

#### Beispielkonfiguration (`.env.k8s.local`)

Angenommen, die IP-Adresse Ihres Computers lautet `192.168.1.100`:

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

### 4. Lokale Kubernetes-Dateien

Die lokalen Kubernetes-Manifeste spiegeln absichtlich das Produktionslayout `k8s/` wider:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Beispiel-Apps ausführen

### React Native Boilerplate (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Oder aus dem Beispielverzeichnis:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Brew Coffee Labs (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Nackt

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Wie es funktioniert

### Arbeitsbereich-Setup

Das Monorepo verwendet npm-Arbeitsbereiche für Kernpakete, Beispiel-Apps sind jedoch eigenständig:

1. **Root `package.json`** umfasst nur `packages/*`, `backend` und `dashboard/web-ui` in Arbeitsbereichen
2. **Beispiel-Apps sind eigenständig** – sie haben ihr eigenes `node_modules`, um Abhängigkeitskonflikte zu vermeiden
3. **Beispiel-Apps** verweist auf SDK mit `"rejourney": "file:../../packages/react-native"`
4. **Metro-Konfigurationen** sind so konfiguriert, dass sie das SDK-Paket korrekt überwachen und auflösen

**Warum Beispiele nicht in Arbeitsbereichen vorhanden sind:**
- Beispiel-Apps verwenden unterschiedliche Expo/React Native-Versionen
- Verhindert Konflikte bei der Abhängigkeitsdeduplizierung npm
- Jedes Beispiel kann seinen eigenen vollständigen Abhängigkeitsbaum haben

### Metro-Konfiguration

Jede Beispiel-App verfügt über einen `metro.config.js`, der:

1. **Uhren** das SDK-Quellverzeichnis (`packages/react-native`) für Änderungen
2. **Löst sich auf** das `rejourney`-Paket an den richtigen Speicherort
3. **Blöcke** dupliziert die Pakete `react-native` und `react` aus dem Arbeitsbereichsstamm

### Codegen (TurboModule)

Der Codegen von React Native wird beim Erstellen der App automatisch ausgeführt, wenn:

1. Für SDK ist für `package.json` `codegenConfig` ✅ definiert
2. Die Spezifikationsdatei (`NativeRejourney.ts`) folgt der Namenskonvention ✅
3. Die App beinhaltet das Paket SDK ✅

Codegen wird automatisch ausgeführt während:
- `npm run ios` (iOS-Builds)
- `npm run android` (Android-Builds)

## Projektstruktur

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

## CI/CD & Bereitstellung

Rejourney verwendet GitHub Actions, um Tests, Erstellung und Bereitstellung im gesamten Monorepo zu automatisieren.

Eine detaillierte Aufschlüsselung unserer Testsuiten, nativen Integrationstests und automatisierten Bereitstellungslogik finden Sie in der [CI/CD & Testdokumentation](/docs/architecture/ci-cd).

---

Entdecken Sie den [Architekturvergleich](/docs/architecture/distributed-vs-single-node) für Details zu Cloud (K8s) vs. Self-Hosted (Docker).

## Best Practices

1. **Erstellen Sie immer den SDK** vor dem Test: `npm run build:sdk`
2. **Dateiprotokoll verwenden** (`file:../../packages/react-native`) in package.json für npm-Arbeitsbereiche
3. **Leeren Sie den Metro-Cache** bei Problemen: `npm start -- --reset-cache`
4. **Erstellen Sie native Apps neu** nach SDK nativen Codeänderungen
5. **Testen Sie sowohl iOS als auch Android** vor dem Festschreiben
