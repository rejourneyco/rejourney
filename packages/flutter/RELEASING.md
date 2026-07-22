# Releasing the Flutter package

## One-time pub.dev and GitHub setup

Pub.dev does not permit GitHub OIDC automation to create a package. The first `rejourney` publication must be performed interactively by an authorized uploader, then ownership and trusted publishing can be configured.

1. Create the verified `rejourney.co` publisher on pub.dev, invite at least one additional Rejourney administrator, and confirm that the `rejourney` package name is still available.
2. Run the full Flutter workflow and both example applications.
3. From this directory, run `flutter pub publish --dry-run` and inspect every included file.
4. Publish with `flutter pub publish` from an authenticated workstation.
5. In the package's Admin tab, transfer it to the verified `rejourney.co` publisher. Pub.dev cannot publish a new package directly into a publisher, so this transfer must follow the first upload.
6. In the package's pub.dev Admin tab, enable GitHub Actions publishing with:
   - Repository: `rejourneyco/rejourney`
   - Tag pattern: `flutter-v{{version}}`
   - Required GitHub Actions environment: `pub.dev`
7. In the GitHub repository, create an environment named `pub.dev`. Do not add a required reviewer if version bumps should publish without manual approval. Restrict its deployment tags to `flutter-v*` if repository policy supports deployment tag rules.
8. Create an organization-owned fine-grained GitHub token with access only to `rejourneyco/rejourney` and permission `Contents: read and write`. Save it as the Actions secret `FLUTTER_RELEASE_TOKEN`. This token is only used to create the release tag; pub.dev credentials are never stored in GitHub.
9. For the manually published bootstrap version, push the matching `flutter-v<version>` tag after the package transfer and automated-publishing setup are complete. The tag workflow recognizes that the version already exists on pub.dev, skips a duplicate upload, runs the release gates, and creates the GitHub release.

## Later versions

1. Update the following version declarations together:
   - `pubspec.yaml`
   - `Rejourney.version` in Dart
   - the Android Gradle package version
   - both Android runtime version constants
   - the CocoaPods version
   - the iOS runtime version constant
2. Put a matching `## <version>` entry first in `CHANGELOG.md`. An optional `.github/releases/flutter-<version>.md` file overrides the generated GitHub release notes.
3. Merge the reviewed change to `main`.

The `Rejourney Flutter SDK` workflow compares the new version with the commit at the start of the complete push. If it changed, CI validates version consistency, formatting, analysis, tests, Android and iOS native integration, both example apps, benchmarks, and the pub.dev archive. After every gate passes, CI creates `flutter-v<version>` using `FLUTTER_RELEASE_TOKEN`.

That tag push starts a new, tag-scoped workflow run. It repeats the release gates, verifies that the tag equals the pubspec version, publishes through the Dart team's official reusable workflow using a short-lived pub.dev OIDC token, and creates a GitHub release only after publication succeeds.

Tag runs first query pub.dev for the exact version. This makes the manually published bootstrap tag and workflow reruns idempotent: an existing version is never uploaded twice, but its matching GitHub release can still be created.

Pub.dev explicitly rejects OIDC publications from workflows that were not triggered by a tag push. GitHub also suppresses push workflows caused by the built-in `GITHUB_TOKEN`. That is why `FLUTTER_RELEASE_TOKEN` is required even though no pub.dev secret is stored.

## Recovery

- If a pre-tag validation fails, fix it on `main`; no tag or package version was released.
- If the tag workflow fails before publication, rerun that tag workflow after fixing repository or pub.dev configuration. Do not reuse a published version number.
- If pub.dev succeeds but GitHub release creation fails, rerun the tag workflow; pub.dev publication is immutable, so rerun only the `github-release` job when GitHub offers that option.
