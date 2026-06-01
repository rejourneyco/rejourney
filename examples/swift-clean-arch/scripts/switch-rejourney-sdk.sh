#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"

PACKAGE_SWIFT="$APP_DIR/Package.swift"
XCODE_PROJECT_NAME="CountriesSwiftUI.xcodeproj"
XCODE_PROJECT="$APP_DIR/$XCODE_PROJECT_NAME"
PBXPROJ="$XCODE_PROJECT/project.pbxproj"
XCODE_PACKAGE_RESOLVED="$XCODE_PROJECT/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"

REMOTE_PACKAGE_URL="${REJOURNEY_IOS_PACKAGE_URL:-https://github.com/rejourneyco/rejourney}"
REMOTE_PACKAGE_ID="${REJOURNEY_IOS_PACKAGE_ID:-rejourney}"
LOCAL_PACKAGE_REL_PATH="${REJOURNEY_IOS_LOCAL_PATH:-../..}"
LOCAL_PACKAGE_ID="Rejourney"

# Existing package reference id in CountriesSwiftUI.xcodeproj.
REJOURNEY_XCODE_PACKAGE_REF_ID="88E85BAA8B4E4787A16CAEE1"

NO_RESOLVE=false

usage() {
  echo "Usage:"
  echo "  ./scripts/switch-rejourney-sdk.sh --old [--no-resolve]     # use latest released SwiftPM version"
  echo "  ./scripts/switch-rejourney-sdk.sh --new [--no-resolve]     # switch back to local package"
  echo "  ./scripts/switch-rejourney-sdk.sh --status                 # show current dependency mode"
  echo
  echo "Optional environment variables:"
  echo "  REJOURNEY_IOS_SDK_VERSION=0.3.0                            # pin --old to a version"
  echo "  REJOURNEY_IOS_PACKAGE_URL=https://github.com/.../rejourney  # override remote package URL"
  exit 1
}

die() {
  echo "Error: $*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || die "Could not find $1"
}

normalize_version() {
  local version="$1"
  version="${version#v}"

  if [[ ! "$version" =~ ^[0-9]+[.][0-9]+[.][0-9]+$ ]]; then
    die "Invalid Swift SDK version '$1'. Expected semver like 0.3.0."
  fi

  printf '%s\n' "$version"
}

fallback_version() {
  local version_file="$REPO_ROOT/packages/ios/VERSION"

  if [[ -f "$version_file" ]]; then
    normalize_version "$(tr -d '[:space:]' < "$version_file")"
    return
  fi

  printf '0.3.0\n'
}

latest_released_version() {
  if [[ -n "${REJOURNEY_IOS_SDK_VERSION:-}" ]]; then
    normalize_version "$REJOURNEY_IOS_SDK_VERSION"
    return
  fi

  if ! command -v git >/dev/null 2>&1; then
    fallback_version
    return
  fi

  local version
  version="$(
    git ls-remote --tags --refs "$REMOTE_PACKAGE_URL" 'refs/tags/v*' 2>/dev/null \
      | awk '{print $2}' \
      | sed 's#refs/tags/v##' \
      | grep -E '^[0-9]+[.][0-9]+[.][0-9]+$' \
      | sort -t. -k1,1n -k2,2n -k3,3n \
      | tail -n 1 \
      || true
  )"

  if [[ -n "$version" ]]; then
    normalize_version "$version"
    return
  fi

  echo "Warning: could not find remote release tags for $REMOTE_PACKAGE_URL; using local VERSION fallback." >&2
  fallback_version
}

set_package_swift_dependency() {
  local dependency_line="$1"
  local package_id="$2"

  require_file "$PACKAGE_SWIFT"

  REJOURNEY_PACKAGE_DEPENDENCY_LINE="$dependency_line" \
  REJOURNEY_PRODUCT_PACKAGE_ID="$package_id" \
  perl -0pi -e '
    my $dependency = $ENV{"REJOURNEY_PACKAGE_DEPENDENCY_LINE"};
    my $package_id = $ENV{"REJOURNEY_PRODUCT_PACKAGE_ID"};

    my $dependency_count = s/        \.package\((?:path:\s*"\.\.\/\.\."|url:\s*"[^"]*rejourney[^"]*",\s*from:\s*"[^"]+")\),?/        $dependency/s;
    die "Could not update Rejourney dependency in Package.swift\n" unless $dependency_count == 1;

    my $product_count = s/\.product\(name:\s*"Rejourney",\s*package:\s*"(?:Rejourney|rejourney)"\)/.product(name: "Rejourney", package: "$package_id")/s;
    die "Could not update Rejourney product package in Package.swift\n" unless $product_count == 1;
  ' "$PACKAGE_SWIFT"
}

set_xcode_project_dependency() {
  local mode="$1"
  local version="${2:-}"

  require_file "$PBXPROJ"

  REJOURNEY_XCODE_MODE="$mode" \
  REJOURNEY_XCODE_PACKAGE_REF_ID="$REJOURNEY_XCODE_PACKAGE_REF_ID" \
  REJOURNEY_IOS_PACKAGE_URL="$REMOTE_PACKAGE_URL" \
  REJOURNEY_IOS_PACKAGE_ID="$REMOTE_PACKAGE_ID" \
  REJOURNEY_IOS_LOCAL_PATH="$LOCAL_PACKAGE_REL_PATH" \
  REJOURNEY_IOS_SDK_VERSION="$version" \
  perl -0pi -e '
    my $mode = $ENV{"REJOURNEY_XCODE_MODE"};
    my $id = $ENV{"REJOURNEY_XCODE_PACKAGE_REF_ID"};
    my $url = $ENV{"REJOURNEY_IOS_PACKAGE_URL"};
    my $remote_package_id = $ENV{"REJOURNEY_IOS_PACKAGE_ID"};
    my $local_path = $ENV{"REJOURNEY_IOS_LOCAL_PATH"};
    my $version = $ENV{"REJOURNEY_IOS_SDK_VERSION"};

    my $local_comment = qq{XCLocalSwiftPackageReference "$local_path"};
    my $remote_comment = qq{XCRemoteSwiftPackageReference "$remote_package_id"};
    my $comment = $mode eq "local" ? $local_comment : $remote_comment;

    my $object;
    if ($mode eq "local") {
      $object = "\t\t$id /* $local_comment */ = {\n"
              . "\t\t\tisa = XCLocalSwiftPackageReference;\n"
              . "\t\t\trelativePath = $local_path;\n"
              . "\t\t};\n";
    } else {
      $object = "\t\t$id /* $remote_comment */ = {\n"
              . "\t\t\tisa = XCRemoteSwiftPackageReference;\n"
              . "\t\t\trepositoryURL = \"$url\";\n"
              . "\t\t\trequirement = {\n"
              . "\t\t\t\tkind = upToNextMajorVersion;\n"
              . "\t\t\t\tminimumVersion = $version;\n"
              . "\t\t\t};\n"
              . "\t\t};\n";
    }

    my $removed = s/\t\t\Q$id\E \/\* (?:XCLocalSwiftPackageReference "[^"]+"|XCRemoteSwiftPackageReference "[^"]+") \*\/ = \{\n.*?\n\t\t};\n//s;
    die "Could not find Rejourney package reference object in Xcode project\n" unless $removed == 1;

    if ($mode eq "local") {
      s@(\/\* Begin XCLocalSwiftPackageReference section \*/\n)@$1$object@s
        or die "Could not insert local Rejourney package reference in Xcode project\n";
    } else {
      s@(\/\* End XCRemoteSwiftPackageReference section \*/\n)@$object$1@s
        or die "Could not insert remote Rejourney package reference in Xcode project\n";
    }

    my $comment_count = s/\Q$id\E \/\* (?:XCLocalSwiftPackageReference "[^"]+"|XCRemoteSwiftPackageReference "[^"]+") \*\//$id \/* $comment *\//g;
    die "Could not update Rejourney package reference comments in Xcode project\n" unless $comment_count >= 2;
  ' "$PBXPROJ"
}

clean_swiftpm_artifacts() {
  echo "Cleaning SwiftPM artifacts..."
  rm -rf "$APP_DIR/.build"
  rm -f "$APP_DIR/Package.resolved"
  rm -f "$XCODE_PACKAGE_RESOLVED"
  rm -rf "$APP_DIR/.swiftpm/xcode/package.xcworkspace/xcshareddata/swiftpm"
}

refresh_dependencies() {
  if [[ "$NO_RESOLVE" == true ]]; then
    echo "Skipping cleanup and dependency resolution (--no-resolve)."
    return
  fi

  clean_swiftpm_artifacts

  if command -v swift >/dev/null 2>&1; then
    echo "Resolving SwiftPM dependencies..."
    (cd "$APP_DIR" && swift package resolve)
  else
    echo "Warning: swift is not available; skipping swift package resolve." >&2
  fi

  if command -v xcodebuild >/dev/null 2>&1; then
    echo "Resolving Xcode package dependencies..."
    (
      cd "$APP_DIR"
      xcodebuild -resolvePackageDependencies -project "$XCODE_PROJECT_NAME" -scheme CountriesSwiftUI
    )
  else
    echo "Warning: xcodebuild is not available; skipping Xcode package resolution." >&2
  fi
}

print_status() {
  require_file "$PACKAGE_SWIFT"
  require_file "$PBXPROJ"

  if grep -Fq ".package(path: \"$LOCAL_PACKAGE_REL_PATH\")" "$PACKAGE_SWIFT"; then
    echo "Package.swift: local ($LOCAL_PACKAGE_REL_PATH)"
  elif grep -Eq '\.package\(url: "[^"]*rejourney[^"]*", from:' "$PACKAGE_SWIFT"; then
    local url
    local version
    url="$(sed -n 's/.*\.package(url: "\([^"]*rejourney[^"]*\)", from: "\([^"]*\)").*/\1/p' "$PACKAGE_SWIFT" | tail -n 1)"
    version="$(sed -n 's/.*from: "\([^"]*\)".*/\1/p' "$PACKAGE_SWIFT" | tail -n 1)"
    echo "Package.swift: released ($url, from $version)"
  else
    echo "Package.swift: unknown"
  fi

  if grep -Fq "XCLocalSwiftPackageReference \"$LOCAL_PACKAGE_REL_PATH\"" "$PBXPROJ"; then
    echo "Xcode project: local ($LOCAL_PACKAGE_REL_PATH)"
  elif grep -Eq 'repositoryURL = "[^"]*rejourney[^"]*";' "$PBXPROJ"; then
    local url
    local version
    url="$(sed -n 's/.*repositoryURL = "\([^"]*rejourney[^"]*\)";.*/\1/p' "$PBXPROJ" | tail -n 1)"
    version="$(sed -n 's/.*minimumVersion = \([^;]*\);.*/\1/p' "$PBXPROJ" | tail -n 1)"
    echo "Xcode project: released ($url, from $version)"
  else
    echo "Xcode project: unknown"
  fi
}

if [[ $# -lt 1 ]]; then
  usage
fi

MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --old|--new|--status)
      [[ -z "$MODE" ]] || usage
      MODE="$1"
      ;;
    --no-resolve)
      NO_RESOLVE=true
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      ;;
  esac
  shift
done

case "$MODE" in
  --status)
    print_status
    ;;
  --old)
    version="$(latest_released_version)"
    echo "Switching Swift clean architecture example to released Rejourney SDK $version..."
    set_package_swift_dependency ".package(url: \"$REMOTE_PACKAGE_URL\", from: \"$version\")" "$REMOTE_PACKAGE_ID"
    set_xcode_project_dependency "remote" "$version"
    refresh_dependencies
    echo "Done. App now uses $REMOTE_PACKAGE_URL from $version."
    ;;
  --new)
    echo "Switching Swift clean architecture example back to local package: $LOCAL_PACKAGE_REL_PATH"
    set_package_swift_dependency ".package(path: \"$LOCAL_PACKAGE_REL_PATH\")" "$LOCAL_PACKAGE_ID"
    set_xcode_project_dependency "local"
    refresh_dependencies
    echo "Done. App now uses the local Rejourney package at $LOCAL_PACKAGE_REL_PATH."
    ;;
  *)
    usage
    ;;
esac
