#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const appDir = process.argv[2];

if (!appDir) {
  console.error('Usage: node ./scripts/configure-validation-app.js <validation-app-dir>');
  process.exit(1);
}

const indexPath = path.join(appDir, 'index.js');

if (!fs.existsSync(indexPath)) {
  console.error(`Validation app entrypoint not found: ${indexPath}`);
  process.exit(1);
}

const rejourneyImport = "import '@rejourneyco/react-native';";
const source = fs.readFileSync(indexPath, 'utf8');

if (source.includes(rejourneyImport)) {
  console.log('Validation app already imports @rejourneyco/react-native');
  process.exit(0);
}

fs.writeFileSync(indexPath, `${rejourneyImport}\n${source}`);
console.log(`Prepended @rejourneyco/react-native import to ${indexPath}`);
