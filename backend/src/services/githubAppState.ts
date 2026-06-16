/**
 * Signed, TTL'd `state` for the GitHub App install redirect (Slice 5).
 *
 * The dashboard mints a state binding the target {projectId, userId} and sends
 * the user to `github.com/apps/<slug>/installations/new?state=<state>`. After
 * install GitHub redirects back to the setup callback with the SAME state, which
 * we verify: recompute the HMAC over the exact payload bytes, enforce a short
 * TTL, and (in the route) require `state.userId === the session user` plus a
 * project-access check before binding. This stops a forged/replayed state from
 * another tenant binding an installation to a project it shouldn't.
 *
 * Format: `base64url(JSON(payload)) + "." + HMAC_SHA256(secret, base64url(...))`.
 */

import crypto from 'node:crypto';
import { hmacSha256Hex } from './internalServiceAuth.js';

export interface SetupStatePayload {
    projectId: string;
    userId: string;
    nonce: string;
    /** Mint time (ms since epoch); checked against the TTL on verify. */
    iat: number;
}

export type VerifySetupStateResult =
    | { ok: true; payload: SetupStatePayload }
    | { ok: false; reason: string };

function encodePayload(payload: SetupStatePayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function signSetupState(payload: SetupStatePayload, secret: string): string {
    const encoded = encodePayload(payload);
    return `${encoded}.${hmacSha256Hex(secret, encoded)}`;
}

export function createSetupState(input: {
    projectId: string;
    userId: string;
    secret: string;
    /** Override for tests; defaults to Date.now(). */
    now?: number;
    /** Override for tests; defaults to a random uuid. */
    nonce?: string;
}): string {
    const payload: SetupStatePayload = {
        projectId: input.projectId,
        userId: input.userId,
        nonce: input.nonce ?? crypto.randomUUID(),
        iat: input.now ?? Date.now(),
    };
    return signSetupState(payload, input.secret);
}

export function verifySetupState(
    token: string,
    secret: string,
    opts: { maxAgeMs: number; now?: number },
): VerifySetupStateResult {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
    const encoded = token.slice(0, dot);
    const providedSig = token.slice(dot + 1);

    const expectedSig = hmacSha256Hex(secret, encoded);
    if (!timingSafeEqualHex(providedSig, expectedSig)) return { ok: false, reason: 'bad_signature' };

    let payload: SetupStatePayload;
    try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SetupStatePayload;
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    if (
        typeof payload?.projectId !== 'string' ||
        typeof payload?.userId !== 'string' ||
        typeof payload?.iat !== 'number'
    ) {
        return { ok: false, reason: 'malformed' };
    }

    const now = opts.now ?? Date.now();
    if (Math.abs(now - payload.iat) > opts.maxAgeMs) return { ok: false, reason: 'expired' };

    return { ok: true, payload };
}

function timingSafeEqualHex(a: string, b: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
