import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const requiredFiles = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/integrations/react.js',
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

console.log('Web package content verified.');
