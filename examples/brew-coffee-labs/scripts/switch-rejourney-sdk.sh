#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_PACKAGE_JSON="$APP_DIR/package.json"
PACKAGE_NAME="@rejourneyco/react-native"
LOCAL_PACKAGE_REL_PATH="../../packages/react-native"
LOCAL_PACKAGE_SPEC="file:$LOCAL_PACKAGE_REL_PATH"

usage() {
  echo "Usage:"
  echo "  ./scripts/switch-rejourney-sdk.sh --old   # use latest npm published version"
  echo "  ./scripts/switch-rejourney-sdk.sh --new   # switch back to local package"
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

MODE="$1"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required but not installed."
  exit 1
fi

if [[ ! -f "$APP_PACKAGE_JSON" ]]; then
  echo "Error: Could not find $APP_PACKAGE_JSON"
  exit 1
fi

cd "$APP_DIR"

if [[ "$MODE" == "--old" ]]; then
  echo "Switching to latest published $PACKAGE_NAME from npm..."
  npm uninstall "$PACKAGE_NAME"
  npm install "$PACKAGE_NAME@latest" --save

  echo "Running clean npm install..."
  rm -rf node_modules
  rm -f package-lock.json
  npm install

  if [[ -d "ios" ]]; then
    echo "Running clean pod install..."
    rm -rf ios/Pods ios/build
    rm -f ios/Podfile.lock
    (cd ios && pod install --repo-update)
  else
    echo "Skipping pod install (no ios directory found)."
  fi

  echo "Done. App now uses latest npm version of $PACKAGE_NAME."
  exit 0
fi

if [[ "$MODE" == "--new" ]]; then
  echo "Switching back to local package: $LOCAL_PACKAGE_SPEC"
  npm uninstall "$PACKAGE_NAME"
  npm install "$PACKAGE_NAME@$LOCAL_PACKAGE_SPEC" --save

  echo "Running clean npm install..."
  rm -rf node_modules
  rm -f package-lock.json
  npm install

  if [[ -d "ios" ]]; then
    echo "Running clean pod install..."
    rm -rf ios/Pods ios/build
    rm -f ios/Podfile.lock
    (cd ios && pod install --repo-update)
  else
    echo "Skipping pod install (no ios directory found)."
  fi

  echo "Done. App now uses local package at $LOCAL_PACKAGE_SPEC."
  exit 0
fi

usage
