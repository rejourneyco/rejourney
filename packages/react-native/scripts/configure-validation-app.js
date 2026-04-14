#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const appDir = process.argv[2];
const withNavPeer = process.argv.includes('--with-nav-peer');
const withExpoRouter = process.argv.includes('--with-expo-router');

if (!appDir) {
  console.error('Usage: node ./scripts/configure-validation-app.js <validation-app-dir> [--with-nav-peer] [--with-expo-router]');
  process.exit(1);
}

const indexPath = path.join(appDir, 'index.js');

if (!fs.existsSync(indexPath)) {
  console.error(`Validation app entrypoint not found: ${indexPath}`);
  process.exit(1);
}

// Build the validation block based on which optional peers are present.
// Each import forces Metro to trace through the corresponding code path at
// bundle time, catching Metro-incompatible require() patterns before they
// reach users.
const lines = [];
lines.push("import '@rejourneyco/react-native';");

if (withNavPeer) {
  // Importing useNavigationTracking forces Metro to trace through
  // loadReactNavigationNative() → require('@react-navigation/native').
  // This is the exact path that contained the loader-abstraction Metro bug.
  lines.push("import { useNavigationTracking } from '@rejourneyco/react-native';");
  lines.push('void useNavigationTracking;');
}

if (withExpoRouter) {
  lines.push("import { useExpoRouterTracking } from '@rejourneyco/react-native';");
  lines.push('void useExpoRouterTracking;');
}

const injection = lines.join('\n');
const source = fs.readFileSync(indexPath, 'utf8');

if (source.includes(injection)) {
  console.log('Validation app already contains the required imports');
  process.exit(0);
}

// Strip any previous injection so re-runs are idempotent.
const strippedSource = source.replace(/^import '@rejourneyco\/react-native';\n[\s\S]*?(?=\n(?!import|void))/m, '').trimStart();
fs.writeFileSync(indexPath, `${injection}\n${strippedSource}`);

const flags = [withNavPeer && '--with-nav-peer', withExpoRouter && '--with-expo-router'].filter(Boolean);
console.log(`Configured validation app at ${indexPath}${flags.length ? ` (${flags.join(', ')})` : ''}`);
