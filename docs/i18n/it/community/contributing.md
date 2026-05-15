# Contribuire a Rejourney

Diamo il benvenuto ai contributi! Per iniziare, consulta le guide riportate di seguito.

## Struttura del progetto

Si tratta di un monorepo gestito dalle aree di lavoro npm.

## Prerequisiti

1. **Node.js** >= 18.0.0
2. **npm** o **yarn** (gli spazi di lavoro funzionano con entrambi)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode e CocoaPods
7. **Android**: Android Studio e JDK 17

## Configurazione iniziale

### 1. Installa le dipendenze

Dal **radice** del monorepo:

```bash
npm install
```

Ciò:
- Installa tutte le dipendenze dell'area di lavoro
- Crea automaticamente il pacchetto SDK (esegue `npm run build:sdk` tramite lo script `postinstall` nella root `package.json`)
- Collega correttamente tutti i pacchetti

### 2. Costruisci SDK

Se è necessario ricostruire SDK dopo aver apportato modifiche:

```bash
npm run build:sdk
```

O per una build pulita:

```bash
npm run build:clean
```

## Sviluppo backend (Kubernetes locale)

Rejourney utilizza `local-k8s/` per lo sviluppo locale, quindi il tempo di esecuzione rimane vicino alla configurazione di produzione Kubernetes pur mantenendo veloce il ciclo giornaliero.

### 1. Configurare `.env.k8s.local`

Copia il modello di ambiente locale Kubernetes:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Avvia lo stack di sviluppo ibrido

```bash
npm run dev
```

Quel flusso:

- Crea un cluster `k3d` locale, se necessario
- Si applica a `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` e `minio.yaml`
- Sincronizza `.env.k8s.local` nei segreti Kubernetes
- Esegue API, dashboard e lavoratori dall'origine sul computer host

Per un'esecuzione completa della parità in-cluster:

```bash
npm run dev:full
```

Per arrestare lo stack locale:

```bash
npm run dev:down
```

### 3. Configurazione dell'indirizzo IP (test del dispositivo fisico)

Se stai eseguendo il test su un **dispositivo fisico** (iOS o Android) connesso allo stesso WiFi, SDK e Dashboard devono conoscere l'indirizzo IP locale del tuo computer per comunicare.

#### Trovare il tuo indirizzo IP (Mac)

Esegui il seguente comando nel tuo terminale:

```bash
ipconfig getifaddr en0
```

Oppure trovalo in **Impostazioni di sistema > WiFi > Dettagli [La tua rete].**.

#### Aggiorna `.env.k8s.local`

Le seguenti variabili **DOVERE** utilizzano il tuo indirizzo IP locale (ad esempio, `http://192.168.1.5:3000`) invece di `localhost`:

| Variabile | Utilizzo chiave |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Accesso pubblico a MinIO per replay video |
| `PUBLIC_DASHBOARD_URL` | URL di base per l'interfaccia utente del dashboard |
| `PUBLIC_API_URL` | URL di base per API |
| `PUBLIC_INGEST_URL` | URL di base per l'inserimento di eventi SDK |
| `DASHBOARD_ORIGIN` | Origine CORS per il cruscotto |
| `OAUTH_REDIRECT_BASE` | URL di base per callback OAuth |




> [!IMPORTANT]
> La mancata impostazione corretta di questi comporterà errori di "Connessione rifiutata" sui dispositivi fisici o collegamenti immagine/video interrotti nella dashboard.

`npm run dev` aggiorna automaticamente questi valori rivolti alla LAN tramite `scripts/local-k8s/update-ips.sh` e scrive anche i file env dell'app di esempio utilizzati dalle app Expo.

#### Configurazione di esempio (`.env.k8s.local`)

Supponendo che l'indirizzo IP del tuo computer sia `192.168.1.100`:

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

### 4. File Kubernetes locali

I manifest Kubernetes locali rispecchiano intenzionalmente il layout di produzione `k8s/`:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Esecuzione di app di esempio

### React Native Caldaia (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Oppure dalla directory di esempio:

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

### React Native Nudo

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Come funziona

### Configurazione dell'area di lavoro

Il monorepo utilizza gli spazi di lavoro npm per i pacchetti principali, ma le app di esempio sono autonome:

1. **Radice `package.json`** include solo `packages/*`, `backend` e `dashboard/web-ui` negli spazi di lavoro
2. **Le app di esempio sono autonome**: hanno il proprio `node_modules` per evitare conflitti di dipendenza
3. **App di esempio** fa riferimento a SDK utilizzando `"rejourney": "file:../../packages/react-native"`
4. **Configurazioni della metropolitana** sono configurati per monitorare e risolvere correttamente il pacchetto SDK

**Perché gli esempi non sono negli spazi di lavoro:**
- Le app di esempio utilizzano versioni Expo/React Native diverse
- Previene i conflitti di deduplicazione delle dipendenze npm
- Ogni esempio può avere il proprio albero delle dipendenze completo

### Configurazione della metropolitana

Ogni app di esempio ha un `metro.config.js` che:

1. **Orologi** la directory di origine SDK (`packages/react-native`) per le modifiche
2. **Risolve** il pacchetto `rejourney` nella posizione corretta
3. **Blocchi** duplica i pacchetti `react-native` e `react` dalla radice dell'area di lavoro

### Codegen (TurboModuli)

Il codegen di React Native viene eseguito automaticamente durante la creazione dell'app se:

1. `package.json` di SDK ha `codegenConfig` definito ✅
2. Il file delle specifiche (`NativeRejourney.ts`) segue la convenzione di denominazione ✅
3. L'app include il pacchetto SDK ✅

Codegen viene eseguito automaticamente durante:
- `npm run ios` (build iOS)
- `npm run android` (build Android)

## Struttura del progetto

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

## CI/CD e distribuzione

Rejourney utilizza GitHub Actions per automatizzare test, creazione e distribuzione nell'intero monorepo.

Per un'analisi dettagliata delle nostre suite di test, dei test di integrazione nativa e della logica di distribuzione automatizzata, consultare la [CI/CD e documentazione sui test](/docs/architecture/ci-cd).

---

Esplora il [Confronto tra architetture](/docs/architecture/distributed-vs-single-node) per i dettagli su Cloud (K8) e Self-Hosted (Docker).

## Migliori pratiche

1. **Costruisci sempre SDK** prima del test: `npm run build:sdk`
2. **Utilizza il protocollo file** (`file:../../packages/react-native`) nel pacchetto.json per gli spazi di lavoro npm
3. **Cancella la cache della metropolitana** in caso di problemi: `npm start -- --reset-cache`
4. **Ricostruisci le app native** dopo le modifiche al codice nativo SDK
5. **Testare sia iOS che Android** prima di impegnarsi
