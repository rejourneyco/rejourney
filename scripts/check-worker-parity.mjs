#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const prodPath = path.join(rootDir, 'k8s', 'workers.yaml');
const localPath = path.join(rootDir, 'local-k8s', 'workers.yaml');

const requiredDeployments = ['ingest-worker', 'replay-worker', 'alert-worker'];
const mirroredEnvKeys = {
  'ingest-worker': [
    'RJ_WORKER_NAME',
    'RJ_INGEST_ALLOWED_KINDS',
    'RJ_INGEST_KIND_PRIORITY',
    'RJ_INGEST_JOB_CONCURRENCY',
    'RJ_INGEST_BATCH_SIZE',
    'RJ_INGEST_MAX_RUNNABLE_PER_SESSION',
  ],
  'replay-worker': [
    'RJ_WORKER_NAME',
    'RJ_INGEST_ALLOWED_KINDS',
    'RJ_INGEST_KIND_PRIORITY',
    'RJ_INGEST_JOB_CONCURRENCY',
    'RJ_INGEST_BATCH_SIZE',
    'RJ_INGEST_MAX_RUNNABLE_PER_SESSION',
  ],
};

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function splitDocuments(yaml) {
  return yaml
    .split(/^---\s*$/m)
    .map((document) => document.trim())
    .filter(Boolean);
}

function getDeploymentDocument(yaml, deploymentName) {
  return splitDocuments(yaml).find((document) => {
    return /kind:\s*Deployment/.test(document)
      && new RegExp(`name:\\s*${deploymentName}\\b`).test(document);
  }) ?? null;
}

function getEnvValue(document, envName) {
  const pattern = new RegExp(`- name:\\s*${envName}\\s*\\n\\s+value:\\s*"?([^"\\n]+)"?`, 'm');
  const match = document.match(pattern);
  return match?.[1]?.trim() ?? null;
}

const prodYaml = read(prodPath);
const localYaml = read(localPath);
const errors = [];

for (const deploymentName of requiredDeployments) {
  const prodDocument = getDeploymentDocument(prodYaml, deploymentName);
  const localDocument = getDeploymentDocument(localYaml, deploymentName);

  if (!prodDocument) {
    errors.push(`Production manifest is missing deployment "${deploymentName}" in k8s/workers.yaml`);
    continue;
  }

  if (!localDocument) {
    errors.push(`Local manifest is missing deployment "${deploymentName}" in local-k8s/workers.yaml`);
    continue;
  }

  for (const envName of mirroredEnvKeys[deploymentName] ?? []) {
    const prodValue = getEnvValue(prodDocument, envName);
    const localValue = getEnvValue(localDocument, envName);
    if (prodValue !== localValue) {
      errors.push(
        `${deploymentName} env ${envName} differs (prod=${JSON.stringify(prodValue)}, local=${JSON.stringify(localValue)})`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error('[worker-parity] Local worker manifests drifted from production:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('[worker-parity] Local and production worker manifests are aligned.');
