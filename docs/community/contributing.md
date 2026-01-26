# Contributing to Rejourney

We welcome contributions! Please see the guides below to get started.

## Project Structure

This is a monorepo managed by npm workspaces.

## Prerequisites

1. **Node.js** >= 18.0.0
2. **npm** or **yarn** (workspaces work with both)
3. **iOS**: Xcode and CocoaPods
4. **Android**: Android Studio and JDK 17

## Initial Setup

### 1. Install Dependencies

From the **root** of the monorepo:

```bash
npm install
```

This will:
- Install all workspace dependencies
- Build the SDK package automatically (runs `npm run build:sdk` via the `postinstall` script in the root `package.json`)
- Link all packages correctly

### 2. Build the SDK

If you need to rebuild the SDK after making changes:

```bash
npm run build:sdk
```

Or for a clean build:

```bash
npm run build:clean
```

## Backend Development (Local Docker)

Rejourney uses Docker to run the backend and its dependencies (PostgreSQL, Redis, MinIO) locally.

### 1. Configure `.env.local`

Copy the example environment file and update it with your settings:

```bash
cp .env.example .env.local
```

### 2. Start Services

You can use the provided local scripts:

- **Start/Rebuild**: `./scripts/local/rebuild.sh`
- **Stop**: `./scripts/local/stop.sh`

### 3. IP Address Configuration (Physical Device Testing)

If you are testing on a **physical device** (iOS or Android) connected to the same WiFi, the SDK and Dashboard need to know your computer's local IP address to communicate.

#### Finding your IP Address (Mac)

Run the following command in your terminal:

```bash
ipconfig getifaddr en0
```

Or find it in **System Settings > WiFi > [Your Network] Details**.

#### Update `.env.local`

The following variables **MUST** use your local IP address (e.g., `http://192.168.1.5:3000`) instead of `localhost`:

| Variable                 | Key Usage                                      |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT`     | Public access to MinIO for video replays       |
| `PUBLIC_DASHBOARD_URL`   | Base URL for the dashboard UI                  |
| `PUBLIC_API_URL`         | Base URL for the API                           |
| `PUBLIC_INGEST_URL`       | Base URL for SDK event ingestion               |
| `DASHBOARD_ORIGIN`       | CORS origin for the dashboard                  |
| `OAUTH_REDIRECT_BASE`    | Base URL for OAuth callbacks                   |

> [!IMPORTANT]
> Failure to set these correctly will result in "Connection Refused" errors on physical devices or broken image/video links in the dashboard.

#### Example Configuration (`.env.local`)

Assuming your computer's IP address is `192.168.1.100`:

```env
# Object storage (MinIO local - accessible from physical devices)
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://192.168.1.100:9000

# Public URLs
PUBLIC_DASHBOARD_URL=http://192.168.1.100:8080
PUBLIC_API_URL=http://192.168.1.100:3000
PUBLIC_INGEST_URL=http://192.168.1.100:3000
DASHBOARD_ORIGIN=http://192.168.1.100:8080
OAUTH_REDIRECT_BASE=http://192.168.1.100:3000
```

## Running Example Apps

### React Native Boilerplate (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Or from the example directory:

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

### React Native Bare

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## How It Works

### Workspace Setup

The monorepo uses npm workspaces for core packages, but example apps are standalone:

1. **Root `package.json`** includes only `packages/*`, `backend`, and `dashboard/web-ui` in workspaces
2. **Example apps are standalone** - they have their own `node_modules` to avoid dependency conflicts
3. **Example apps** reference the SDK using `"rejourney": "file:../../packages/react-native"`
4. **Metro configs** are configured to watch and resolve the SDK package correctly

**Why examples are not in workspaces:**
- Example apps use different Expo/React Native versions
- Prevents npm dependency deduplication conflicts
- Each example can have its own complete dependency tree

### Metro Configuration

Each example app has a `metro.config.js` that:

1. **Watches** the SDK source directory (`packages/react-native`) for changes
2. **Resolves** the `rejourney` package to the correct location
3. **Blocks** duplicate `react-native` and `react` packages from the workspace root

### Codegen (TurboModules)

React Native's codegen automatically runs when building the app if:

1. The SDK's `package.json` has `codegenConfig` defined ✅
2. The spec file (`NativeRejourney.ts`) follows the naming convention ✅
3. The app includes the SDK package ✅

Codegen runs automatically during:
- `npm run ios` (iOS builds)
- `npm run android` (Android builds)

## Project Structure

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

## CI/CD & Deployment

Rejourney uses GitHub Actions to automate testing, building, and deployment across the entire monorepo.

For a detailed breakdown of our test suites, native integration testing, and automated deployment logic, please see the [CI/CD & Testing Documentation](/docs/architecture/ci-cd).

---

Explore the [Architecture Comparison](/docs/architecture/distributed-vs-single-node) for details on Cloud (K8s) vs. Self-Hosted (Docker).

## Best Practices

1. **Always build the SDK** before testing: `npm run build:sdk`
2. **Use file protocol** (`file:../../packages/react-native`) in package.json for npm workspaces
3. **Clear Metro cache** when having issues: `npm start -- --reset-cache`
4. **Rebuild native apps** after SDK native code changes
5. **Test on both iOS and Android** before committing
