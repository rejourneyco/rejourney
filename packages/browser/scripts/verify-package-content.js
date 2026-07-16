import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const requiredFiles = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/integrations/react.js',
  'dist/integrations/redux.js',
  'dist/integrations/redux.d.ts',
  'dist/integrations/next.js',
  'dist/integrations/vue.js',
  'dist/integrations/nuxt.js',
  'dist/integrations/svelte.js',
  'dist/integrations/angular.js',
  'dist/integrations/remix.js',
  'dist/integrations/astro.js',
  'dist/integrations/gatsby.js',
];

const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));

if (missing.length > 0) {
  console.error(`Missing web package build outputs:\n${missing.map((file) => `- ${file}`).join('\n')}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const reduxExport = packageJson.exports?.['./redux'];
if (
  reduxExport?.import !== './dist/integrations/redux.js'
  || reduxExport?.types !== './dist/integrations/redux.d.ts'
) {
  console.error('Missing or invalid ./redux package export.');
  process.exit(1);
}

console.log('Web package content verified.');
