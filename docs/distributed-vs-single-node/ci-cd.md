# CI/CD & Automated Testing

Rejourney uses GitHub Actions for five separate release surfaces:

- the production app and backend deployment
- the React Native SDK package
- the Flutter SDK package
- the native Swift iOS SDK package
- the Browser/Web SDK package

All workflows run on pull requests to `main`, pushes to `main`, and manual `workflow_dispatch` unless noted below. The production deploy and package publishing steps only run from `main`.

---

## Workflow Map

| Workflow | File | Main responsibility |
| --- | --- | --- |
| Rejourney CI | `.github/workflows/rejourney-ci.yml` | Backend, dashboard, Kubernetes config checks, image builds, and production deploy |
| React Native SDK CI | `.github/workflows/rejourney-sdk.yml` | React Native package validation, bare/Expo integration, npm publish, release tag |
| Flutter SDK CI | `.github/workflows/rejourney-flutter.yml` | Dart, Android, and iOS validation, pub.dev publish, release tag |
| Native iOS CI | `.github/workflows/rejourney-ios.yml` | Swift package validation, iOS builds/tests, native iOS release tag |
| Web SDK CI | `.github/workflows/rejourney-web-sdk.yml` | Browser SDK validation, npm publish, release tag |

---

## Production App Pipeline

The production app pipeline is the `Rejourney CI` workflow.

### Pull Request And Push Checks

| Job | Runs | What it checks |
| --- | --- | --- |
| `backend` | PRs and pushes | Backend install, worker parity, schema/migration guard, lint, full tests, billing tests, billing ESLint |
| `web` | PRs and pushes | Root install, dashboard typecheck, dashboard SSR build |
| `k8s-config` | PRs and pushes | Storage cutover validation and secret-hygiene scanning |

The backend guard runs:

- `scripts/check-worker-parity.mjs`
- `scripts/check-schema-migration.sh`

The Kubernetes/config guard runs:

- `scripts/k8s/validate-storage-cutover.sh`
- `scripts/ci/check-secret-hygiene.sh`

### Image Build

On `main`, after `backend`, `web`, and `k8s-config` pass, CI builds and pushes these images to GitHub Container Registry:

| Image | Dockerfile | Tags |
| --- | --- | --- |
| `api` | `backend/Dockerfile` | `latest`, `${github.sha}` |
| `web` | `dashboard/web-ui/Dockerfile` | `latest`, `${github.sha}` |
| `migration` | `backend/Dockerfile.migration` | `latest`, `${github.sha}` |

The web image receives production build args for the dashboard URL, API URL, docs URL, and Stripe publishable key.

### Deploy Gate

Deployment is intentionally gated. The `check-version` job runs only on `main` and compares:

- local root `package.json` version in the checked-out repo
- remote `/opt/rejourney/package.json` version on the VPS

The deploy job runs only when:

- the workflow is on `main`
- image builds succeeded
- and either the root version changed or the workflow was manually dispatched

### Production Deploy

The deploy job SSHes into the VPS as `root`, ensures `/opt/rejourney` exists, resets it to `origin/main`, then runs:

```bash
bash scripts/k8s/deploy-release.sh "${IMAGE_TAG}" "${GITHUB_REPOSITORY}"
```

The deploy script is the source of truth for production Kubernetes rollout behavior. It:

- renders manifests with the target image tag
- applies namespace, Traefik config, exporters, ingress, and storage-class support
- applies the CloudNativePG Postgres manifest
- verifies `k8s/archive.yaml` is in sync with `scripts/k8s/session-backup.mjs`
- prints migration status before and after setup
- resets and waits for the `db-setup` job
- applies PgBouncer and PodDisruptionBudget manifests
- applies Grafana dashboards with server-side apply
- applies rendered app manifests with Kubernetes prune enabled
- protects/restores the Helm-managed Redis service if prune touches it
- waits for app, worker, and monitoring deployments to roll out
- pins selected workloads to the intended nodes or Postgres primary where required
- patches imported Grafana dashboards and clears stale session-backup jobs

After deployment, the GitHub Actions SSH script also prunes old images, removes completed/failed pods, deletes stale debug pods, and restarts session-backup seed jobs so they pick up the latest script ConfigMap.

---

## React Native SDK Pipeline

The React Native SDK pipeline lives in `Rejourney SDK CI` and validates `packages/react-native`.

### Package Checks

The `sdk` job runs:

- TypeScript check
- lint
- dependency audit
- unit tests
- `prepack` build
- optional peer safety verification
- package content verification
- package structure verification

### Metro Optional-Peer Check

The `metro-optional-peers` job creates a fresh React Native validation app, installs a packed local SDK plus `@react-navigation/native`, configures the app, and runs a Metro bundle. This catches bundling issues in optional navigation peer paths without needing Xcode or Gradle.

### Mobile Integration Matrix

The `mobile-integration` job runs a matrix across:

- `ios` and `android`
- bare React Native and Expo apps

For bare apps, CI runs the SDK install smoke scripts:

- `packages/react-native/scripts/test-ios-install.sh`
- `packages/react-native/scripts/test-android-install.sh`

For Expo apps, CI creates a fresh Expo app, installs the packed local SDK, runs `expo prebuild`, then builds the native project:

- iOS: `xcodebuild` against the simulator workspace
- Android: `./gradlew assembleDebug`

### Publish And Release

On `main`, after integration checks pass, `publish-sdk` builds the package and compares the local `packages/react-native/package.json` version with the npm registry. If the version is different, CI publishes `@rejourneyco/react-native`.

After a successful publish, `release-rn-tag` creates:

- tag: `react-native/vX.Y.Z`
- GitHub release: `React Native SDK vX.Y.Z`

The tag is only created when `packages/react-native/package.json` changed from the previous commit.

---

## Flutter SDK Pipeline

The Flutter SDK pipeline lives in `Rejourney Flutter SDK` and validates `packages/flutter` plus its standalone consumer example.

It runs Dart formatting, analysis, tests, bridge benchmarks, and a pub.dev dry run; builds and tests the Android and iOS plugin examples; and runs native integration tests on an Android emulator and iOS simulator. A tested version bump creates a `flutter-vX.Y.Z` tag, publishes `rejourney` to pub.dev with OIDC, and creates the matching GitHub release.

---

## Native iOS SDK Pipeline

The native Swift SDK pipeline lives in `Rejourney Native iOS CI` and validates the root Swift package plus `packages/ios`.

It runs on:

- pushes to `main`
- pull requests to `main`
- tags matching `v*`
- manual dispatch

The main validation job:

- verifies package boundary files exist
- rejects React Native imports, React bridge names, and non-native-prefixed Objective-C runtime names inside the Swift package
- checks `packages/ios/VERSION` matches `RejourneySDKInfo.swift`
- checks tag version matches the SDK version for `vX.Y.Z` tag builds
- builds the Swift package for iOS Simulator
- builds the Swift package for generic iOS
- runs Swift tests on an available iPhone simulator
- builds the native iOS example project

On direct pushes to `main`, if `packages/ios/VERSION` changed, CI creates:

- tag: `vX.Y.Z`
- GitHub release: `iOS SDK vX.Y.Z`

---

## Web SDK Pipeline

The Browser/Web SDK pipeline lives in `Rejourney Web SDK CI` and validates `packages/browser`.

The `web-sdk` job runs:

- TypeScript check
- unit tests
- `prepack` build
- `npm pack --dry-run`
- package structure verification

On `main`, `web-version` checks whether `packages/browser/package.json` changed. It refuses to publish or tag the bootstrap version `0.0.0`.

If the web package version changed, `publish-web-sdk` compares the local version with npm and publishes `@rejourneyco/browser` when the local version is different.

After a successful publish, `release-browser-tag` creates:

- tag: `browser/vX.Y.Z`
- GitHub release: `Browser SDK vX.Y.Z`

---

## Local CI Parity

Local Kubernetes parity is driven by the root package scripts:

```bash
npm run ci:local
npm run ci:local:fast
npm run ci:local:checks
npm run ci:local:deploy
```

These call `scripts/local-k8s/rejourney-ci.sh`.

| Command | Purpose |
| --- | --- |
| `npm run ci:local` | Full local parity run: install, validate, build images, import into k3d, deploy, migrate, restart host services |
| `npm run ci:local:fast` | Same flow but skips reinstall steps |
| `npm run ci:local:checks` | Validation checks only |
| `npm run ci:local:deploy` | Rebuild/import/deploy local images without rerunning validation |

The local parity runner uses the production-style migration path, not a schema push shortcut. It also runs the worker parity and schema migration guards before local deployment.

---

## Required Secrets

| Secret | Used by | Purpose |
| --- | --- | --- |
| `VPS_SSH_KEY` | `check-version`, `deploy` | SSH key for `root@VPS` |
| `VPS_HOST` | `check-version`, `deploy` | VPS host or Tailscale IP |
| `GITHUB_TOKEN` | release and package workflows | GitHub-provided token for tags/releases/packages |
| `NPM_TOKEN` | React Native and Web SDK publish jobs | npm publish token |
| `VITE_STRIPE_PUBLISHABLE_KEY` | web image build | Dashboard Stripe public key |

---

## Primary Files

- `.github/workflows/rejourney-ci.yml`
- `.github/workflows/rejourney-sdk.yml`
- `.github/workflows/rejourney-flutter.yml`
- `.github/workflows/rejourney-ios.yml`
- `.github/workflows/rejourney-web-sdk.yml`
- `scripts/k8s/deploy-release.sh`
- `scripts/local-k8s/rejourney-ci.sh`
- `scripts/local-k8s/deploy.sh`
