#!/usr/bin/env node
/**
 * S3 Secret Encryption Tool
 * 
 * Encrypts S3 secret access keys for secure storage in the database.
 * 
 * WORKFLOW FOR MULTI-S3 SCALING:
 * ===============================
 * 
 * 1. Generate encryption key (one-time setup):
 *    openssl rand -hex 32
 *    → Set this as STORAGE_ENCRYPTION_KEY in your environment
 * 
 * 2. For each S3 endpoint, encrypt its secret:
 *    node scripts/prod/encrypt-s3-secret.mjs "your-s3-secret-key"
 *    → This outputs an encrypted string
 * 
 * 3. Store in database (storage_endpoints table):
 *    - accessKeyId: plaintext S3 access key ID
 *    - keyRef: encrypted secret (output from step 2)
 *    - endpointUrl: S3 endpoint URL
 *    - bucket: bucket name
 *    - region: S3 region
 * 
 * 4. The application automatically decrypts keyRef at runtime using
 *    STORAGE_ENCRYPTION_KEY from environment variables.
 * 
 *    WHERE: backend/src/db/s3.ts line 199 (getS3ClientForEndpoint function)
 *    WHEN: Every time the app needs to connect to S3 (upload/download/generate URLs)
 *    HOW: Uses safeDecrypt() which checks if encrypted and decrypts using the master key
 *    WHY SAFE: 
 *      - Decryption happens in server memory only (never logged or exposed)
 *      - Decrypted secret is only used to create AWS S3 client (stays in memory)
 *      - S3 client is cached, so decryption only happens once per endpoint
 *      - Secret never leaves the server or gets sent to clients
 * 
 * BENEFITS FOR MULTI-S3 SCALING:
 * ==============================
 * - Each endpoint can have its own encrypted credentials
 * - Secrets are encrypted at rest in the database
 * - No need to store secrets in environment variables per endpoint
 * - Supports per-project endpoint assignment
 * - Supports shadow endpoints for redundancy
 * 
 * Usage:
 *   node scripts/prod/encrypt-s3-secret.mjs <secret-access-key> [encryption-key]
 * 
 * If encryption-key is omitted, reads STORAGE_ENCRYPTION_KEY from .env
 * 
 * Example:
 *   node scripts/prod/encrypt-s3-secret.mjs "OGgpd1KVwnRBIUy..."
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function encrypt(plaintext, keyHex) {
  if (!keyHex || keyHex.length !== 64) {
    console.error('❌ Encryption key must be 64 hex characters (32 bytes)');
    console.error('   Generate one with: openssl rand -hex 32');
    process.exit(1);
  }

  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

// Try to read encryption key from .env file
function getKeyFromEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/STORAGE_ENCRYPTION_KEY=([^\n\r]+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// Main
const secret = process.argv[2];
let encryptionKey = process.argv[3] || getKeyFromEnv();

if (!secret) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║            S3 Secret Encryption Tool                           ║
╚════════════════════════════════════════════════════════════════╝

Usage: 
  node scripts/encrypt-s3-secret.mjs <s3-secret-key> [encryption-key]

If encryption-key is not provided, reads STORAGE_ENCRYPTION_KEY from .env

Example:
  node scripts/encrypt-s3-secret.mjs "OGgpd1KVwnRBIUy..."
`);
  process.exit(0);
}

if (!encryptionKey) {
  console.error('❌ No encryption key found.');
  console.error('   Either set STORAGE_ENCRYPTION_KEY in .env');
  console.error('   Or pass it as second argument');
  process.exit(1);
}

const encrypted = encrypt(secret, encryptionKey);

console.log(`
╔════════════════════════════════════════════════════════════════╗
║            Encrypted S3 Secret                                 ║
╚════════════════════════════════════════════════════════════════╝

Encrypted value:

${encrypted}
`);
