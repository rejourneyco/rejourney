#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const filesToCheck = [
  path.join(rootDir, 'lib/module/sdk/autoTracking.js'),
  path.join(rootDir, 'lib/commonjs/sdk/autoTracking.js'),
];

const unsafePatterns = [
  {
    description: "direct require('@react-navigation/native') with string literal (Metro will bundle the optional peer unconditionally)",
    regex: /require\((['"])@react-navigation\/native\1\)/g,
  },
  {
    description: "loader() call used for optional peer loading (must use require() directly so Metro can trace it)",
    regex: /\bloader\s*\(/g,
  },
];

let hasFailure = false;

for (const filePath of filesToCheck) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing build artifact: ${filePath}`);
    hasFailure = true;
    continue;
  }

  const contents = fs.readFileSync(filePath, 'utf8');

  for (const pattern of unsafePatterns) {
    const matches = contents.match(pattern.regex);
    if (!matches || matches.length === 0) continue;

    hasFailure = true;
    console.error(`Unsafe optional peer reference found in ${filePath}`);
    console.error(`  Pattern: ${pattern.description}`);
    console.error(`  Matches: ${matches.join(', ')}`);
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log('Optional peer safety verification passed for built artifacts.');
