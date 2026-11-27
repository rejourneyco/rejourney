/**
 * `oidc-provider` storage adapter over an {@link OAuthStore}.
 *
 * For opaque tokens `oidc-provider` uses the token VALUE as the storage id and
 * also repeats it inside the payload as `jti`. To keep bearer credentials
 * hashed at rest, this adapter stores them under SHA-256(id) and strips `jti`
 * from the payload, putting it back on read (the caller supplies the id).
 */

import { createHash } from 'node:crypto';
import type { Adapter, AdapterFactory, AdapterPayload } from 'oidc-provider';
import type { OAuthPayload, OAuthStore } from './store.js';

/**
 * Models whose id is a bearer credential presented by a client.
 * `Session` is deliberately absent: `findByUid` must return its `jti` (the
 * cookie value) without the caller supplying it, so it cannot be one-way hashed.
 */
const HASHED_MODELS = new Set([
    'AccessToken',
    'AuthorizationCode',
    'RefreshToken',
    'ClientCredentials',
    'DeviceCode',
    'InitialAccessToken',
    'RegistrationAccessToken',
]);

export function hashOAuthCredential(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

/** The key a record of `model` with oidc-provider id `id` is stored under. */
export function oauthStorageKey(model: string, id: string): string {
    return HASHED_MODELS.has(model) ? hashOAuthCredential(id) : id;
}

class StoreAdapter implements Adapter {
    private readonly hashed: boolean;

    constructor(private readonly model: string, private readonly store: OAuthStore) {
        this.hashed = HASHED_MODELS.has(model);
    }

    async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
        const stored: OAuthPayload = { ...payload };
        if (this.hashed) delete stored.jti;
        await this.store.upsert(this.model, oauthStorageKey(this.model, id), stored, {
            expiresInSeconds: expiresIn,
            insertOnly: this.model === 'ReplayDetection',
        });
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
        const payload = await this.store.find(this.model, oauthStorageKey(this.model, id));
        if (!payload) return undefined;
        return (this.hashed ? { ...payload, jti: id } : payload) as AdapterPayload;
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
        return (await this.store.findByUid(this.model, uid)) as AdapterPayload | undefined;
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
        return (await this.store.findByUserCode(this.model, userCode)) as AdapterPayload | undefined;
    }

    async consume(id: string): Promise<void> {
        await this.store.consume(this.model, oauthStorageKey(this.model, id));
    }

    async destroy(id: string): Promise<void> {
        await this.store.destroy(this.model, oauthStorageKey(this.model, id));
    }

    async revokeByGrantId(grantId: string): Promise<void> {
        await this.store.revokeByGrantId(this.model, grantId);
    }
}

export function createOAuthAdapterFactory(store: OAuthStore): AdapterFactory {
    return (model: string) => new StoreAdapter(model, store);
}
