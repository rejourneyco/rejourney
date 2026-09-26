#!/usr/bin/env node
// Install the actual tarball into a clean project with optional adapters absent.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const [editorArgument, archiveArgument, projectArgument] = process.argv.slice(2);
if (!editorArgument || !archiveArgument) {
  console.error('Usage: node scripts/test-unity-package.mjs /path/to/Unity /path/to/package.tgz [new-project-directory]');
  process.exit(2);
}
const editor = resolve(editorArgument), archive = resolve(archiveArgument);
if (!existsSync(editor) || !existsSync(archive)) throw new Error('Editor or archive missing.');
const project = projectArgument ? resolve(projectArgument) : mkdtempSync(join(tmpdir(), 'rejourney-unity-release-test-'));
if (existsSync(join(project, 'Assets')) || existsSync(join(project, 'Packages'))) throw new Error('Use a fresh project directory; existing projects are never overwritten.');
for (const directory of ['Assets', 'Packages', 'ProjectSettings']) mkdirSync(join(project, directory), { recursive: true });
writeFileSync(join(project, 'Packages/manifest.json'), JSON.stringify({
  dependencies: { 'co.rejourney.unity': `file:${archive}`, 'com.unity.test-framework': '1.6.0', 'com.unity.modules.physics': '1.0.0' },
  testables: ['co.rejourney.unity'],
}, null, 2) + '\n');
const version = editor.match(/(?:^|\/)(6000\.\d+\.\d+[abfp]\d+)(?:\/|$)/)?.[1];
if (version) writeFileSync(join(project, 'ProjectSettings/ProjectVersion.txt'), `m_EditorVersion: ${version}\n`);
const log = join(project, 'editor-test.log'), results = join(project, 'test-results.xml');
console.log(JSON.stringify({ project, editor, archive, log, results }, null, 2));
const run = spawnSync(editor, ['-batchmode', '-nographics', '-projectPath', project, '-runTests', '-testPlatform', 'EditMode', '-testResults', results, '-logFile', log], { stdio: 'inherit' });
if (run.status !== 0 || !existsSync(results)) throw new Error(`Unity package tests failed; inspect ${log}`);
const header = readFileSync(results, 'utf8').match(/<test-run\b[^>]+>/)?.[0] ?? '';
if (!header.includes('result="Passed"') || !header.includes('failed="0"') || /total="0"/.test(header)) throw new Error(`Unity reported unsuccessful tests: ${header}`);
console.log(header);
