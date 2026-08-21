# Contributing to Rejourney

Thanks for helping improve Rejourney. This repository contains the hosted
services, dashboard, four client SDKs, examples, and deployment manifests. Keep
changes focused, include the checks relevant to the area you changed, and call
out any migration or operator impact in the pull request.

## Repository map

| Area | Purpose |
| --- | --- |
| `backend/` | API, ingest relay, workers, database schema, and migrations |
| `dashboard/web-ui/` | React Router dashboard and public site |
| `packages/browser/` | `@rejourneyco/browser` and framework integrations |
| `packages/react-native/` | `@rejourneyco/react-native` |
| `packages/ios/` | Native Swift sources exposed by the root `Package.swift` |
| `packages/rejourney/` | Flutter package and native bridges |
| `examples/` | Standalone SDK integration fixtures |
| `local-k8s/` | Local k3d manifests |
| `k8s/` | Production Kubernetes manifests |
| `local-k8s/` | Local Kubernetes dev environment manifests |

The npm workspaces cover `packages/*`, `backend`, and `dashboard/web-ui`.
Examples remain standalone so they can pin different framework versions.

## Prerequisites

For the full local stack, install:

- Node.js 24 or newer and npm
- Docker Desktop
- `kubectl`
- `k3d`

SDK work may also require:

- Xcode for Swift, iOS, React Native iOS, or Flutter iOS changes
- CocoaPods for React Native iOS examples
- Android Studio and JDK 17 for Android changes
- Flutter 3.22 or newer and a compatible Dart SDK for Flutter changes

Docker Desktop must be running before the local Kubernetes bootstrap.

## First local bootstrap

From the repository root:

```bash
cp local-k8s/env.example .env.k8s.local
```

Fill the required values described in the template. Random local-only values
are appropriate for development secrets; do not commit `.env.k8s.local` or use
production credentials locally.

Then run:

```bash
npm run ci:local
```

This installs dependencies, runs the local CI checks, builds and imports local
images, applies the k3d manifests, runs setup and migrations, and starts the
host-side development services. The primary endpoints are:

- Dashboard: `http://127.0.0.1:8080`
- API: `http://127.0.0.1:3000`
- Upload relay: `http://127.0.0.1:3001`
- MinIO API: `http://127.0.0.1:9000`
- MinIO console: `http://127.0.0.1:9001`

See [local-k8s/README.md](local-k8s/README.md) for physical-device networking,
ports, reset instructions, and ClickHouse parity.

## Daily development

After a successful bootstrap:

```bash
# Start or restart host-side API, upload relay, workers, and dashboard.
npm run dev

# Resume an existing cluster after Docker Desktop restarts.
npm run dev:resume

# Follow host-process logs.
npm run dev:logs

# Stop host-side services while preserving local infrastructure and data.
npm run dev:down
```

Use `npm run ci:local:fast` for a repeat CI/deploy cycle without reinstalling
npm dependencies. Use `npm run ci:local:deploy` only when you need to rebuild
and redeploy images without rerunning validation checks. A full namespace reset
is explicit and destructive to local cluster data:

```bash
./scripts/local-k8s/deploy.sh down
```

## SDK development

Run checks from the repository root unless a command says otherwise.

### Browser

```bash
npm run build:browser
npm --prefix packages/browser test
npm --prefix packages/browser run typecheck
```

Browser examples rebuild the local package when their development command
starts:

```bash
npm run example:web-next
npm run example:web-sveltekit
npm run example:web-nuxt
```

Copy each example's `.env.example`, set its public `rj_...` project key, and add
the example origin to the project's allowed web domains.

### React Native

```bash
npm run build:react-native
npm --prefix packages/react-native test
npm --prefix packages/react-native run typescript
npm --prefix packages/react-native run lint
```

The React Native examples use the local package through a `file:` dependency.
Run one with the root shortcuts:

```bash
npm run example:boilerplate
npm run example:brew
npm run example:bare
```

Use the corresponding `:ios` or `:android` command to rebuild a native app.
Native SDK changes are not picked up by Metro alone.

### Swift iOS

The root `Package.swift` exposes the sources in `packages/ios` as the
`Rejourney` SwiftPM product. A generic simulator build is a useful baseline:

```bash
xcodebuild -scheme Rejourney \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO
```

The full Swift fixture can switch between the released package and this
checkout:

```bash
npm run example:swift:sdk:status
npm run example:swift:sdk:new
npm run example:swift
```

Use `npm run example:swift:sdk:old` when validating the released package.

### Flutter

The Flutter package is `packages/rejourney`; the runnable integration fixture is
`examples/flutter`.

```bash
npm run test:flutter
npm run benchmark:flutter
npm run example:flutter
```

The benchmark is a regression tool, not a general device-performance claim.
Record environment and result details when updating
[benchmarks/flutter/results/latest.md](benchmarks/flutter/results/latest.md).

## Backend and dashboard checks

For backend changes:

```bash
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run build
```

For dashboard changes:

```bash
npm --prefix dashboard/web-ui run typecheck
npm --prefix dashboard/web-ui run build
```

Do not use `drizzle-kit push` as a substitute for a committed production
migration. Keep schema changes and their migrations together, and run the
repository's migration guards through `npm run ci:local`.

## Local Kubernetes manifests

The supported local manifests are:

- Core infrastructure: `namespace.yaml`, `postgres.yaml`, `pgbouncer.yaml`,
  `redis.yaml`, `clickhouse.yaml`, and `minio.yaml`
- Application topology: `api.yaml`, `web.yaml`, `workers.yaml`, and
  `ingress.yaml`
- Manual analytics repair: `clickhouse-backfill-api-rollups.yaml`

Keep local and production behavior aligned where it affects schemas, queues,
service names, or deployment ordering. Keep local-only ports, credentials, and
shortcuts in `local-k8s/`.

## Pull requests

- Explain the user, developer, or operator outcome.
- Keep unrelated formatting and generated output out of the change.
- Add or update tests for behavior changes.
- Update active documentation when commands, environment variables, manifests,
  public APIs, or operational behavior change.
- Identify migrations, data repairs, rollout ordering, or rollback constraints.
- Never commit secrets, customer data, local environment files, build output,
  simulator state, or one-off diagnostic captures.

Client SDKs and examples are Apache-2.0 licensed. Server and dashboard code is
SSPL-1.0 licensed. See [LICENSE-APACHE](LICENSE-APACHE) and
[LICENSE-SSPL](LICENSE-SSPL).
