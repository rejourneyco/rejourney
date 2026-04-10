# BREW Coffee Labs SDK Switch Script

This doc explains how to switch the `@rejourneyco/react-native` dependency in `examples/brew-coffee-labs` between:

- the latest published npm version (`--old`)
- the local in-repo package (`--new`)

## Script Location

- `examples/brew-coffee-labs/scripts/switch-rejourney-sdk.sh`

## Quick Commands

Run from `examples/brew-coffee-labs`:

- `npm run sdk:old`
- `npm run sdk:new`

Or run the script directly:

- `bash ./scripts/switch-rejourney-sdk.sh --old`
- `bash ./scripts/switch-rejourney-sdk.sh --new`

## What `--old` Does

`--old` switches the app to the latest version published on npm for `@rejourneyco/react-native`.

Steps:

1. Uninstalls the current package.
2. Installs `@rejourneyco/react-native@latest`.
3. Performs a clean npm install:
   - deletes `node_modules`
   - deletes `package-lock.json`
   - runs `npm install`
4. Performs a clean iOS pod install (if `ios/` exists):
   - deletes `ios/Pods`, `ios/build`, `ios/Podfile.lock`
   - runs `pod install --repo-update`

## What `--new` Does

`--new` switches the app back to the local package path:

- `file:../../packages/react-native`

It then runs the same clean reinstall flow:

1. Uninstalls the current package.
2. Installs `@rejourneyco/react-native@file:../../packages/react-native`.
3. Cleans and reinstalls npm dependencies.
4. Cleans and reinstalls CocoaPods dependencies (if `ios/` exists).

## NPM Scripts Added

In `examples/brew-coffee-labs/package.json`:

- `sdk:old` -> `bash ./scripts/switch-rejourney-sdk.sh --old`
- `sdk:new` -> `bash ./scripts/switch-rejourney-sdk.sh --new`

## Notes

- The script is destructive for local install artifacts (`node_modules`, lockfile, Pods) by design to force a clean environment.
- `pod` must be installed for iOS pod steps.
- Use `--new` after validating published npm behavior so development returns to your local SDK source.
