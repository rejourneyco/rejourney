/**
 * Deletion OTP Service
 *
 * Provides short-lived OTP codes for sensitive destructive actions.
 */

import { createHash, randomBytes } from 'crypto';
import { getRedis } from '../db/redis.js';
import { sendOtpEmail } from './email.js';
import { ApiError } from '../middleware/errorHandler.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

type DeleteOtpScope = 'project' | 'team';

interface DeleteOtpPayload {
    hash: string;
    attempts: number;
    expiresAtMs: number;
}

const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function otpRedisKey(scope: DeleteOtpScope, resourceId: string, userId: string): string {
    return `otp:delete:${scope}:${resourceId}:${userId}`;
}

function generateOtpCode(): string {
    const bytes = randomBytes(10);
    return Array.from(bytes, (byte) => OTP_CHARS[byte % OTP_CHARS.length]).join('');
}

function hashOtp(code: string): string {
    return createHash('sha256').update(code).digest('hex');
}

export async function sendDeletionOtp(params: {
    scope: DeleteOtpScope;
    resourceId: string;
    userId: string;
    userEmail: string;
}): Promise<{ expiresInMinutes: number; devCode?: string }> {
    const code = generateOtpCode();
    const payload: DeleteOtpPayload = {
        hash: hashOtp(code),
        attempts: 0,
        expiresAtMs: Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000,
    };

    const redis = getRedis();
    const key = otpRedisKey(params.scope, params.resourceId, params.userId);
    await redis.set(key, JSON.stringify(payload), 'EX', OTP_EXPIRY_MINUTES * 60);

    try {
        await sendOtpEmail(params.userEmail, code);
    } catch (err) {
        logger.error({ err, scope: params.scope, userId: params.userId }, 'Failed to send deletion OTP email');
        if (config.NODE_ENV !== 'development') {
            throw ApiError.internal('Failed to send OTP email');
        }
    }

    logger.info(
        { scope: params.scope, resourceId: params.resourceId, userId: params.userId },
        'Deletion OTP sent'
    );

    if (config.NODE_ENV === 'development') {
        return { expiresInMinutes: OTP_EXPIRY_MINUTES, devCode: code };
    }

    return { expiresInMinutes: OTP_EXPIRY_MINUTES };
}

export async function verifyDeletionOtp(params: {
    scope: DeleteOtpScope;
    resourceId: string;
    userId: string;
    code: string;
}): Promise<void> {
    const redis = getRedis();
    const key = otpRedisKey(params.scope, params.resourceId, params.userId);
    const raw = await redis.get(key);

    if (!raw) {
        throw ApiError.badRequest('Invalid or expired OTP code');
    }

    let payload: DeleteOtpPayload;
    try {
        payload = JSON.parse(raw) as DeleteOtpPayload;
    } catch {
        await redis.del(key);
        throw ApiError.badRequest('Invalid or expired OTP code');
    }

    if (Date.now() > payload.expiresAtMs) {
        await redis.del(key);
        throw ApiError.badRequest('Invalid or expired OTP code');
    }

    if (payload.attempts >= OTP_MAX_ATTEMPTS) {
        await redis.del(key);
        throw ApiError.tooManyRequests('Too many OTP attempts. Request a new code.');
    }

    const providedHash = hashOtp(params.code);
    if (providedHash !== payload.hash) {
        const nextPayload: DeleteOtpPayload = {
            ...payload,
            attempts: payload.attempts + 1,
        };

        const remainingTtlSeconds = Math.max(
            1,
            Math.ceil((payload.expiresAtMs - Date.now()) / 1000)
        );

        await redis.set(key, JSON.stringify(nextPayload), 'EX', remainingTtlSeconds);
        throw ApiError.badRequest('Invalid OTP code');
    }

    // OTP is single-use.
    await redis.del(key);
}
