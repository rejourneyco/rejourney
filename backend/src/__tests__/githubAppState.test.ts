/**
 * Slice 5 — the signed, TTL'd `state` carried through GitHub's App-install
 * redirect. It binds an installation to the right Rejourney project + user
 * without trusting the redirect: the setup callback recomputes the HMAC, checks
 * the TTL, and (in the route) requires state.userId === the session user.
 */

import { describe, it, expect } from 'vitest';
import { createSetupState, signSetupState, verifySetupState } from '../services/githubAppState.js';

const SECRET = 'state-secret-0123456789-0123456789';
const PROJECT = '5505c941-a462-4456-a2d9-aefe10252db1';
const USER = 'user_1';

describe('github app setup state', () => {
    it('round-trips a freshly minted state', () => {
        const token = createSetupState({ projectId: PROJECT, userId: USER, secret: SECRET, now: 1_000 });
        const res = verifySetupState(token, SECRET, { maxAgeMs: 10 * 60_000, now: 6_000 });
        expect(res).toMatchObject({ ok: true, payload: { projectId: PROJECT, userId: USER } });
    });

    it('rejects a tampered payload (signature bound to the exact bytes)', () => {
        const token = createSetupState({ projectId: PROJECT, userId: USER, secret: SECRET, now: 1_000 });
        const sig = token.slice(token.indexOf('.') + 1);
        const evilPayload = Buffer.from(
            JSON.stringify({ projectId: 'attacker-project', userId: USER, nonce: 'x', iat: 1_000 }),
            'utf8',
        ).toString('base64url');
        const forged = `${evilPayload}.${sig}`;
        expect(verifySetupState(forged, SECRET, { maxAgeMs: 600_000, now: 2_000 }).ok).toBe(false);
    });

    it('rejects a wrong secret', () => {
        const token = createSetupState({ projectId: PROJECT, userId: USER, secret: SECRET, now: 1_000 });
        expect(verifySetupState(token, 'a-different-secret', { maxAgeMs: 600_000, now: 2_000 }).ok).toBe(false);
    });

    it('rejects an expired state', () => {
        const token = createSetupState({ projectId: PROJECT, userId: USER, secret: SECRET, now: 1_000 });
        expect(verifySetupState(token, SECRET, { maxAgeMs: 10_000, now: 1_000 + 20_000 })).toMatchObject({
            ok: false,
            reason: 'expired',
        });
    });

    it('rejects malformed tokens without throwing', () => {
        expect(verifySetupState('garbage', SECRET, { maxAgeMs: 600_000, now: 2_000 }).ok).toBe(false);
        expect(verifySetupState('', SECRET, { maxAgeMs: 600_000, now: 2_000 }).ok).toBe(false);
        // valid base64url payload but a non-hex signature segment
        const enc = Buffer.from(JSON.stringify({ projectId: PROJECT, userId: USER, nonce: 'n', iat: 2_000 })).toString('base64url');
        expect(verifySetupState(`${enc}.not-a-signature`, SECRET, { maxAgeMs: 600_000, now: 2_000 }).ok).toBe(false);
    });

    it('mints unique nonces for distinct states', () => {
        const a = signSetupState({ projectId: PROJECT, userId: USER, nonce: 'n1', iat: 1 }, SECRET);
        const b = signSetupState({ projectId: PROJECT, userId: USER, nonce: 'n2', iat: 1 }, SECRET);
        expect(a).not.toBe(b);
    });
});
