/**
 * Cryptographic utilities for encrypting/decrypting sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard

/**
 * Get the master encryption key from environment
 * Key must be 32 bytes (64 hex characters)
 */
function getMasterKey(): Buffer {
    const keyHex = config.STORAGE_ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error('STORAGE_ENCRYPTION_KEY is not configured');
    }
    if (keyHex.length !== 64) {
        throw new Error('STORAGE_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a plaintext string
 * Returns format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function encrypt(plaintext: string): string {
    const key = getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a ciphertext string
 * Expects format: base64(iv):base64(authTag):base64(ciphertext)
 */
export function decrypt(ciphertext: string): string {
    const key = getMasterKey();
    const parts = ciphertext.split(':');

    if (parts.length !== 3) {
        throw new Error('Invalid encrypted format');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);

    return decrypted.toString('utf8');
}

/**
 * Check if a string is in encrypted format
 */
export function isEncrypted(value: string): boolean {
    const parts = value.split(':');
    if (parts.length !== 3) return false;

    try {
        // Try to decode each part as base64
        Buffer.from(parts[0], 'base64');
        Buffer.from(parts[1], 'base64');
        Buffer.from(parts[2], 'base64');
        return true;
    } catch {
        return false;
    }
}

/**
 * Safely decrypt - returns original value if not encrypted or key not configured
 */
export function safeDecrypt(value: string | null): string | null {
    if (!value) return null;

    // If no encryption key configured, return as-is (for backward compat)
    if (!config.STORAGE_ENCRYPTION_KEY) {
        return value;
    }

    // If not in encrypted format, return as-is
    if (!isEncrypted(value)) {
        return value;
    }

    try {
        return decrypt(value);
    } catch {
        // Log but don't throw - might be plaintext legacy value
        console.warn('Failed to decrypt value, returning as-is');
        return value;
    }
}

/**
 * Encrypt only if not already encrypted and key is configured
 */
export function safeEncrypt(value: string | null): string | null {
    if (!value) return null;

    // If no encryption key configured, return as-is
    if (!config.STORAGE_ENCRYPTION_KEY) {
        return value;
    }

    // If already encrypted, return as-is
    if (isEncrypted(value)) {
        return value;
    }

    return encrypt(value);
}
