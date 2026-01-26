# CI/CD & Automated Testing

Rejourney uses GitHub Actions to ensure code quality across the entire monorepo. Every pull request and push to the main branch triggers a comprehensive battery of tests.

## Test Suites

### 1. Backend API Tests
Located in the `backend/` directory, these tests ensure the core logic and database interactions are stable.
* **Linting**: Uses ESLint to enforce code style and catch common errors.
* **Unit Tests**: Powered by Vitest, testing service logic, utility functions, and API controllers.
* **Build Verification**: Ensures the TypeScript source compiles correctly into the final distribution.

### 2. React Native SDK Tests
Located in `packages/react-native/`, these tests are critical for cross-platform stability.
* **TypeScript Check**: Validates types across the entire SDK, catching potential bridge mismatches.
* **Linting**: Enforces consistent code quality.
* **Build Verification**: Runs the prepare script to ensure the package can be bundled for distribution.

### 3. Web Dashboard Tests
Located in `dashboard/web-ui/`, focusing on the user interface and SSR.
* **TypeScript Check**: Includes React Router type generation to ensure route safety.
* **SSR Build**: Verifies that the entire Remix/React Router application can be built for server-side rendering.

---

## Native Integration Testing
One of the most robust parts of our CI/CD is the validation of the SDK on real platform environments.

### iOS Integration (macos-latest)
* **Fresh Install**: The CI creates a brand new React Native project from scratch.
* **Package Injection**: It bundles the local SDK using `npm pack` and installs it into the test app.
* **CocoaPods Verification**: Runs `pod install` to ensure the native dependencies and podspecs are correctly linked.
* **Build Verification**: Executes `xcodebuild` to ensure the test app compiles successfully with the SDK integrated.

### Android Integration (ubuntu-latest)
* **Fresh Install**: Similar to iOS, a fresh Android-based React Native project is initialized.
* **Build Verification**: Runs `./gradlew assembleDebug` to ensure there are no manifest conflicts or compilation errors in the Android native code.

---

## Deployment & Publishing Logic

### Automated Cloud Deployment (VPS)
Deployment to our production environment is gated by versioning.
* **Version Check**: A dedicated job compares the root `package.json` version against the previous commit.
* **Conditional Trigger**: Deployment only proceeds if the version has been incremented.
* **Automated Rollout**: If triggered, it applies the latest K8s manifests and performs a rolling restart of all deployments (api, web, and workers).

### Automated SDK Publishing (NPM)
We maintain a seamless publishing flow for the `rejourney` package.
* **Path Sensitive**: Only triggers when files inside `packages/react-native/` are modified.
* **Registry Check**: Compares the local package version against the latest version on the NPM registry.
* **Auto-Publish**: If the local version is higher, it automatically publishes the new version to NPM after all tests pass.
