#!/usr/bin/env node
/**
 * manage-s3-endpoints.mjs
 * 
 * Interactive script to add/manage S3 endpoints in the Rejourney Kubernetes deployment.
 * It handles encryption of the secret key and direct database insertion via kubectl.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'node:readline/promises';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '../..');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function encrypt(plaintext, keyHex) {
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

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        console.log('\n🚀 Rejourney S3 Endpoint Manager (Kubernetes)\n');

        // Load .env
        let encryptionKey = '';
        try {
            const envPath = path.join(ROOT_DIR, '.env');
            if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf8');
                const match = envContent.match(/STORAGE_ENCRYPTION_KEY=([^\n\r]+)/);
                if (match) encryptionKey = match[1].trim();
            }
        } catch (e) {
            console.error('⚠️ Could not read .env file.');
        }

        if (!encryptionKey || encryptionKey.length !== 64) {
            encryptionKey = await rl.question('🔑 Enter STORAGE_ENCRYPTION_KEY (64 hex chars): ');
            if (!encryptionKey || encryptionKey.length !== 64) {
                console.error('❌ Invalid encryption key. Aborting.');
                process.exit(1);
            }
        }

        const endpointUrl = await rl.question('🌐 S3 Endpoint URL (e.g., https://s3.amazonaws.com): ');
        const bucket = await rl.question('🪣 S3 Bucket Name: ');
        const region = await rl.question('🌍 S3 Region (e.g., us-east-1): ');
        const accessKeyId = await rl.question('🆔 S3 Access Key ID: ');
        const secretAccessKey = await rl.question('🔒 S3 Secret Access Key (will be encrypted): ');

        const projectId = await rl.question('📁 Project UUID (leave blank for global): ');
        const priority = await rl.question('⭐ Priority (integer, default 0): ') || '0';
        const isShadowStr = await rl.question('👥 Shadow Endpoint? (y/n, default n): ');
        const isShadow = isShadowStr.toLowerCase() === 'y';

        console.log('\n🔒 Encrypting credentials...');
        const keyRef = encrypt(secretAccessKey, encryptionKey);

        const sql = `INSERT INTO storage_endpoints (
    project_id, 
    endpoint_url, 
    bucket, 
    region, 
    access_key_id, 
    key_ref, 
    priority, 
    active, 
    shadow
  ) VALUES (
    ${projectId ? `'${projectId}'` : 'NULL'},
    '${endpointUrl}',
    '${bucket}',
    '${region}',
    '${accessKeyId}',
    '${keyRef}',
    ${priority},
    true,
    ${isShadow}
  );`;

        console.log('\n📝 SQL to execute:');
        console.log('------------------');
        console.log(sql);
        console.log('------------------\n');

        const confirmStr = await rl.question('🚀 Execute this on the Kubernetes database? (y/n): ');
        const confirm = confirmStr.toLowerCase() === 'y';

        if (confirm) {
            console.log('📡 Sending to Kubernetes (pod: postgres-0, namespace: rejourney)...');

            // We use base64 encoding to avoid any shell escaping issues
            const b64Sql = Buffer.from(sql).toString('base64');
            const cmd = `echo "${b64Sql}" | base64 -d | kubectl exec -i postgres-0 -n rejourney -- psql -U rejourney -d rejourney`;

            execSync(cmd, { stdio: 'inherit' });

            console.log('\n✅ S3 Endpoint added successfully!');
        } else {
            console.log('\n🚫 Operation cancelled.');
        }
    } catch (err) {
        console.error('\n❌ An error occurred:', err.message);
    } finally {
        rl.close();
    }
}

main().catch(console.error);
