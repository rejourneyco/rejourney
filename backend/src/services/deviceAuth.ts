/**
 * Device Authentication Service
 * 
 * ECDSA P-256 based device authentication with Redis-backed scalability
 */

import crypto from 'crypto';
import { promisify } from 'util';

const generateRandomBytes = promisify(crypto.randomBytes);

export interface DeviceRegistration {
    id: string;
    deviceCredentialId: string;
    projectId: string;
    bundleId: string;
    platform: 'ios' | 'android' | 'web';
    sdkVersion: string;
    devicePublicKey: string;
    registeredAt: Date;
    lastSeenAt: Date;
    revokedAt?: Date;
}

/**
 * Convert raw EC P-256 public key (65 bytes) to SPKI PEM format
 * This is needed because iOS SecKeyCopyExternalRepresentation returns raw EC point
 */
function convertRawECToSPKI(publicKeyPEM: string): string {
    // Extract base64 content from PEM
    const pemLines = publicKeyPEM.split('\n');
    let base64Content = '';
    let inKey = false;
    for (const line of pemLines) {
        if (line.includes('BEGIN')) {
            inKey = true;
            continue;
        }
        if (line.includes('END')) {
            break;
        }
        if (inKey) {
            base64Content += line.trim();
        }
    }

    const rawKeyData = Buffer.from(base64Content, 'base64');

    // Check if it's raw EC P-256 public key (65 bytes: 0x04 + 32 bytes X + 32 bytes Y)
    if (rawKeyData.length !== 65 || rawKeyData[0] !== 0x04) {
        // It's already in a different format, return as-is
        return publicKeyPEM;
    }

    // SPKI header for EC P-256 public key
    // This is the fixed ASN.1 prefix for EC P-256 SPKI
    const spkiHeader = Buffer.from([
        0x30, 0x59, // SEQUENCE, 89 bytes
        0x30, 0x13, // SEQUENCE, 19 bytes (AlgorithmIdentifier)
        0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID: ecPublicKey
        0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // OID: prime256v1
        0x03, 0x42, 0x00 // BIT STRING, 66 bytes (including leading 0x00)
    ]);

    // Combine header and raw public key
    const spkiData = Buffer.concat([spkiHeader, rawKeyData]);

    // Convert to PEM format
    const base64SPKI = spkiData.toString('base64').match(/.{1,64}/g)?.join('\n') || '';
    return `-----BEGIN PUBLIC KEY-----\n${base64SPKI}\n-----END PUBLIC KEY-----`;
}

/**
 * Verify ECDSA signature with device's public key
 * @param publicKeyPEM - PEM-format ECDSA P-256 public key (raw or SPKI format)
 * @param challenge - Challenge string that was signed (base64)
 * @param signatureBase64 - Base64-encoded signature
 * @returns true if signature is valid
 */
export function verifySignature(
    publicKeyPEM: string,
    challenge: string,
    signatureBase64: string
): boolean {
    try {
        // Convert raw EC key to SPKI if needed
        const normalizedKey = convertRawECToSPKI(publicKeyPEM);

        // The challenge was sent as base64, so we verify against the base64 bytes
        const challengeData = Buffer.from(challenge, 'base64');

        const verify = crypto.createVerify('SHA256');
        verify.update(challengeData);
        verify.end();

        const signature = Buffer.from(signatureBase64, 'base64');
        return verify.verify(normalizedKey, signature);
    } catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
}

/**
 * Generate a random challenge for client to sign
 * Uses 32 bytes of randomness for strong security
 */
export async function generateChallenge(): Promise<string> {
    const bytes = await generateRandomBytes(32);
    return bytes.toString('base64');
}

/**
 * Generate opaque device credential ID
 * Format: dc_<base64url> for easy identification
 */
export async function generateCredentialId(): Promise<string> {
    const bytes = await generateRandomBytes(32);
    return `dc_${bytes.toString('base64url')}`;
}

/**
 * Validate and normalize ECDSA public key format
 * Accepts both SPKI PEM format and raw EC public key format
 * @param publicKeyPEM - PEM-format public key (may be raw or SPKI)
 * @returns true if valid P-256 ECDSA public key
 */
export function validatePublicKey(publicKeyPEM: string): boolean {
    try {
        // Try to parse directly first
        try {
            const key = crypto.createPublicKey(publicKeyPEM);
            const keyDetails = key.asymmetricKeyDetails;
            return (
                key.asymmetricKeyType === 'ec' &&
                keyDetails?.namedCurve === 'prime256v1'
            );
        } catch {
            // If direct parsing fails, try converting from raw EC format
        }

        // Extract base64 content from PEM
        const pemLines = publicKeyPEM.split('\n');
        let base64Content = '';
        let inKey = false;
        for (const line of pemLines) {
            if (line.includes('BEGIN')) {
                inKey = true;
                continue;
            }
            if (line.includes('END')) {
                break;
            }
            if (inKey) {
                base64Content += line.trim();
            }
        }

        if (!base64Content) {
            return false;
        }

        const rawKeyData = Buffer.from(base64Content, 'base64');

        // Check if it's raw EC P-256 public key (65 bytes: 0x04 + 32 bytes X + 32 bytes Y)
        if (rawKeyData.length === 65 && rawKeyData[0] === 0x04) {
            // It's a raw EC point, we need to wrap it in SPKI format
            // This is valid for signature verification
            return true;
        }

        // Try to parse as DER
        const key = crypto.createPublicKey({
            key: rawKeyData,
            format: 'der',
            type: 'spki',
        });
        const keyDetails = key.asymmetricKeyDetails;
        return (
            key.asymmetricKeyType === 'ec' &&
            keyDetails?.namedCurve === 'prime256v1'
        );
    } catch (error) {
        console.error('Public key validation error:', error);
        return false;
    }
}

/**
 * Calculate trust score based on abuse signals
 * Score from 0.0 (completely untrusted) to 1.0 (fully trusted)
 */
export function calculateTrustScore(flags: {
    timing_anomaly?: boolean;
    entropy_low?: boolean;
    replay_detected?: boolean;
    cloud_ip?: boolean;
    rapid_geo_change?: boolean;
}): number {
    let score = 1.0;

    // Deduct points for each flag
    if (flags.timing_anomaly) score -= 0.2;
    if (flags.entropy_low) score -= 0.3;
    if (flags.replay_detected) score -= 0.5; // Severe
    if (flags.cloud_ip) score -= 0.1;
    if (flags.rapid_geo_change) score -= 0.15;

    return Math.max(0, Math.min(1, score));
}

/**
 * Get security configuration based on mode
 */
export function getSecurityConfig(mode: 'STRICT' | 'BALANCED' | 'PERMISSIVE' = 'BALANCED') {
    const configs = {
        STRICT: {
            requireDeviceSignatures: true,
            enforceTimingChecks: true,
            enforceHardCaps: true,
            minTrustScore: 0.7,
            maxRegistrationsPerIP: 5,
            maxRegistrationsPerHour: 10,
            challengeTTL: 300, // 5 minutes
            uploadTokenTTL: 900, // 15 minutes
        },
        BALANCED: {
            requireDeviceSignatures: true,
            enforceTimingChecks: true,
            enforceHardCaps: true,
            minTrustScore: 0.5,
            maxRegistrationsPerIP: 20,
            maxRegistrationsPerHour: 50,
            challengeTTL: 300,
            uploadTokenTTL: 900,
        },
        PERMISSIVE: {
            requireDeviceSignatures: false,
            enforceTimingChecks: false,
            enforceHardCaps: false,
            minTrustScore: 0.0,
            maxRegistrationsPerIP: 1000,
            maxRegistrationsPerHour: 1000,
            challengeTTL: 600,
            uploadTokenTTL: 1800,
        },
    };

    return configs[mode];
}
