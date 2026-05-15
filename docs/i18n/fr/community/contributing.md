# Contribuer à Rejourney

Nous apprécions les contributions ! Veuillez consulter les guides ci-dessous pour commencer.

## Structure du projet

Il s'agit d'un monorepo géré par les espaces de travail npm.

## Conditions préalables

1. **Node.js** >= 18.0.0
2. **npm** ou **yarn** (les espaces de travail fonctionnent avec les deux)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS** : Xcode et CocoaPods
7. **Android** : Android Studio et JDK 17

## Configuration initiale

### 1. Installer les dépendances

Depuis le **racine** du monorepo :

```bash
npm install
```

Cela va :
- Installer toutes les dépendances de l'espace de travail
- Créez automatiquement le package SDK (exécute `npm run build:sdk` via le script `postinstall` à la racine `package.json`)
- Liez correctement tous les packages

### 2. Construisez le SDK

Si vous devez reconstruire le SDK après avoir apporté des modifications :

```bash
npm run build:sdk
```

Ou pour une construction propre :

```bash
npm run build:clean
```

## Développement back-end (local Kubernetes)

Rejourney utilise `local-k8s/` pour le développement local afin que le temps d'exécution reste proche de la configuration de production de Kubernetes tout en gardant la boucle quotidienne rapide.

### 1. Configurez `.env.k8s.local`

Copiez le modèle d'environnement local Kubernetes :

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Démarrez la pile de développement hybride

```bash
npm run dev
```

Ce flux :

- Crée un cluster `k3d` local si nécessaire
- S'applique aux `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` et `minio.yaml`.
- Synchronise `.env.k8s.local` dans les secrets Kubernetes
- Exécute le API, le tableau de bord et les nœuds de calcul à partir de la source sur votre machine hôte

Pour une exécution complète de la parité au sein du cluster :

```bash
npm run dev:full
```

Pour arrêter la pile locale :

```bash
npm run dev:down
```

### 3. Configuration de l'adresse IP (test des appareils physiques)

Si vous testez sur un **appareil physique** (iOS ou Android) connecté au même WiFi, le SDK et le tableau de bord doivent connaître l'adresse IP locale de votre ordinateur pour communiquer.

#### Trouver votre adresse IP (Mac)

Exécutez la commande suivante dans votre terminal :

```bash
ipconfig getifaddr en0
```

Ou trouvez-le dans **Paramètres système > WiFi > [Votre réseau] Détails**.

#### Mise à jour `.env.k8s.local`

Les variables suivantes **DOIT** utilisent votre adresse IP locale (par exemple, `http://192.168.1.5:3000`) au lieu de `localhost` :

| Variables | Utilisation des clés |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Accès public à MinIO pour les rediffusions vidéo |
| `PUBLIC_DASHBOARD_URL` | URL de base pour l'interface utilisateur du tableau de bord |
| `PUBLIC_API_URL` | URL de base pour le API |
| `PUBLIC_INGEST_URL` | URL de base pour l'ingestion d'événements SDK |
| `DASHBOARD_ORIGIN` | Origine CORS pour le tableau de bord |
| `OAUTH_REDIRECT_BASE` | URL de base pour les rappels OAuth |




> [!IMPORTANT]
> Si vous ne les configurez pas correctement, des erreurs de « Connexion refusée » se produiront sur les appareils physiques ou des liens image/vidéo rompus dans le tableau de bord.

`npm run dev` met automatiquement à jour ces valeurs orientées LAN via `scripts/local-k8s/update-ips.sh` et écrit également les exemples de fichiers d'environnement d'application utilisés par les applications Expo.

#### Exemple de configuration (`.env.k8s.local`)

En supposant que l'adresse IP de votre ordinateur est `192.168.1.100` :

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

### 4. Fichiers locaux Kubernetes

Les manifestes locaux Kubernetes reflètent intentionnellement la disposition de production `k8s/` :

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Exécution d'exemples d'applications

### Plaque passe-partout React Native (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Ou depuis le répertoire exemple :

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Laboratoires de préparation du café (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Nu

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Comment ça marche

### Configuration de l'espace de travail

Le monorepo utilise les espaces de travail npm pour les packages principaux, mais les exemples d'applications sont autonomes :

1. **Racine `package.json`** inclut uniquement `packages/*`, `backend` et `dashboard/web-ui` dans les espaces de travail
2. **Les exemples d'applications sont autonomes** - ils ont leur propre `node_modules` pour éviter les conflits de dépendances
3. **Exemples d'applications** fait référence au SDK en utilisant `"rejourney": "file:../../packages/react-native"`
4. Les **Configurations métro** sont configurés pour surveiller et résoudre correctement le package SDK.

**Pourquoi les exemples ne figurent pas dans les espaces de travail :**
- Les exemples d'applications utilisent différentes versions de Expo/React Native
- Empêche les conflits de déduplication de dépendance npm
- Chaque exemple peut avoir son propre arbre de dépendances complet

### Configuration du métro

Chaque exemple d'application possède un `metro.config.js` qui :

1. **Montres** le répertoire source SDK (`packages/react-native`) pour les modifications
2. **Résout** le package `rejourney` au bon emplacement
3. **Blocs** duplique les packages `react-native` et `react` à partir de la racine de l'espace de travail

### Codegen (TurboModules)

Le codegen de React Native s'exécute automatiquement lors de la création de l'application si :

1. Le `package.json` du SDK a défini `codegenConfig` ✅
2. Le fichier de spécifications (`NativeRejourney.ts`) suit la convention de dénomination ✅
3. L'application comprend le package SDK ✅

Codegen s'exécute automatiquement pendant :
- `npm run ios` (versions iOS)
- `npm run android` (versions Android)

## Structure du projet

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

## CI/CD et déploiement

Rejourney utilise GitHub Actions pour automatiser les tests, la création et le déploiement sur l'ensemble du monorepo.

Pour une présentation détaillée de nos suites de tests, des tests d'intégration natifs et de la logique de déploiement automatisée, veuillez consulter la [CI/CD & Documentation de tests](/docs/architecture/ci-cd).

---

Explorez la [Comparaison d'architecture](/docs/architecture/distributed-vs-single-node) pour plus de détails sur le cloud (K8s) et l'auto-hébergé (Docker).

## Meilleures pratiques

1. **Construisez toujours le SDK** avant le test : `npm run build:sdk`
2. **Utiliser le protocole de fichier** (`file:../../packages/react-native`) dans package.json pour les espaces de travail npm
3. **Vider le cache Metro** en cas de problèmes : `npm start -- --reset-cache`
4. **Reconstruire les applications natives** après les modifications du code natif de SDK
5. **Test sur iOS et Android** avant de vous engager
