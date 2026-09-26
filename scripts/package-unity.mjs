#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'packages/unity');
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
for (const path of ['Plugins/iOS/RejourneyUnity.xcframework/Info.plist', 'Plugins/Android/rejourney-unity.aar']) {
  if (!existsSync(join(source, path))) throw new Error(`Missing native artifact: ${path}. Run Tools~/build-native.sh first.`);
}
execFileSync('node', [join(root, 'scripts/sync-sdk-core.mjs'), '--check'], { stdio: 'inherit' });
execFileSync('node', [join(root, 'scripts/sync-unity-controllers.mjs'), '--check'], { stdio: 'inherit' });
execFileSync('python3', [join(source, 'Tools~/native-manifest.py'), 'check'], { stdio: 'inherit' });
execFileSync('python3', [join(source, 'Tools~/validate-android.py'), join(source, 'Plugins/Android/rejourney-unity.aar')], { stdio: 'pipe' });
const stage = mkdtempSync(join(tmpdir(), 'rejourney-unity-package-'));
const excluded = new Set(['.gradle', '.kotlin', '.cxx', '.build', '.swiftpm', '.DS_Store', 'build', 'local.properties']);
cpSync(source, join(stage, 'package'), { recursive: true, filter: path => !relative(source, path).split('/').some(part => excluded.has(part)) });
const outputDir = resolve(process.argv[2] || join(root, 'artifacts/unity'));
mkdirSync(outputDir, { recursive: true });
const archive = join(outputDir, `${manifest.name}-${manifest.version}.tgz`);
execFileSync('tar', ['-czf', archive, '-C', stage, 'package']);
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${sha256}  ${manifest.name}-${manifest.version}.tgz\n`);
console.log(JSON.stringify({ archive, sha256, version: manifest.version, nativeArtifacts: true }, null, 2));
