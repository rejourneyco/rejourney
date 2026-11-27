/**
 * Storage seam for the OAuth authorization server.
 *
 * `oidc-provider` persists everything (codes, tokens, grants, sessions,
 * interactions, dynamically registered clients) through one small adapter
 * interface. `adapter.ts` maps that interface onto this store; the spike ships
 * an in-memory implementation and a Postgres one can replace it without
 * touching the provider wiring. A single table is enough:
 *
 *   oauth_records(model text, key text, payload jsonb, grant_id text, uid text,
 *                 user_code text, expires_at timestamptz, consumed_at timestamptz,
 *                 primary key (model, key))
 *
 * `key` is already a SHA-256 hash for bearer credentials (see adapter.ts), so
 * the store never sees a usable token.
 */

export type OAuthPayload = Record<string, unknown>;

export interface OAuthUpsertOptions {
    /** Seconds until the record must stop being returned. */
    expiresInSeconds?: number;
    /** Reject instead of overwriting when an unexpired record exists (replay detection). */
    insertOnly?: boolean;
}

export interface OAuthStore {
    upsert(model: string, key: string, payload: OAuthPayload, options?: OAuthUpsertOptions): Promise<void>;
    /** Returns the payload, with a truthy `consumed` property once consumed. */
    find(model: string, key: string): Promise<OAuthPayload | undefined>;
    findByUid(model: string, uid: string): Promise<OAuthPayload | undefined>;
    findByUserCode(model: string, userCode: string): Promise<OAuthPayload | undefined>;
    /** Atomically marks a record consumed. MUST reject when it already is. */
    consume(model: string, key: string): Promise<void>;
    destroy(model: string, key: string): Promise<void>;
    /** Removes every record of `model` that belongs to the grant. */
    revokeByGrantId(model: string, grantId: string): Promise<void>;
}

interface StoredRecord {
    payload: OAuthPayload;
    expiresAtMs: number | null;
    consumedAt: number | null;
}

export class OAuthRecordConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OAuthRecordConflictError';
    }
}

export class InMemoryOAuthStore implements OAuthStore {
    private readonly records = new Map<string, StoredRecord>();

    constructor(private readonly now: () => number = Date.now) {}

    private id(model: string, key: string): string {
        return `${model}:${key}`;
    }

    private live(id: string): StoredRecord | undefined {
        const record = this.records.get(id);
        if (!record) return undefined;
        if (record.expiresAtMs !== null && record.expiresAtMs <= this.now()) {
            this.records.delete(id);
            return undefined;
        }
        return record;
    }

    private read(record: StoredRecord | undefined): OAuthPayload | undefined {
        if (!record) return undefined;
        return record.consumedAt === null ? { ...record.payload } : { ...record.payload, consumed: record.consumedAt };
    }

    private scan(model: string, match: (payload: OAuthPayload) => boolean): string[] {
        const prefix = `${model}:`;
        const ids: string[] = [];
        for (const id of this.records.keys()) {
            if (!id.startsWith(prefix)) continue;
            const record = this.live(id);
            if (record && match(record.payload)) ids.push(id);
        }
        return ids;
    }

    async upsert(model: string, key: string, payload: OAuthPayload, options: OAuthUpsertOptions = {}): Promise<void> {
        const id = this.id(model, key);
        const existing = this.live(id);
        if (options.insertOnly && existing) {
            throw new OAuthRecordConflictError(`${model} record already exists`);
        }
        this.records.set(id, {
            payload: { ...payload },
            expiresAtMs: options.expiresInSeconds === undefined ? null : this.now() + options.expiresInSeconds * 1000,
            // Re-saving a record (e.g. a session) must not silently un-consume it.
            consumedAt: existing?.consumedAt ?? null,
        });
    }

    async find(model: string, key: string): Promise<OAuthPayload | undefined> {
        return this.read(this.live(this.id(model, key)));
    }

    async findByUid(model: string, uid: string): Promise<OAuthPayload | undefined> {
        const [id] = this.scan(model, (payload) => payload.uid === uid);
        return id ? this.read(this.live(id)) : undefined;
    }

    async findByUserCode(model: string, userCode: string): Promise<OAuthPayload | undefined> {
        const [id] = this.scan(model, (payload) => payload.userCode === userCode);
        return id ? this.read(this.live(id)) : undefined;
    }

    async consume(model: string, key: string): Promise<void> {
        const record = this.live(this.id(model, key));
        if (!record) throw new OAuthRecordConflictError(`${model} record not found`);
        if (record.consumedAt !== null) throw new OAuthRecordConflictError(`${model} record already consumed`);
        record.consumedAt = Math.floor(this.now() / 1000);
    }

    async destroy(model: string, key: string): Promise<void> {
        this.records.delete(this.id(model, key));
    }

    async revokeByGrantId(model: string, grantId: string): Promise<void> {
        for (const id of this.scan(model, (payload) => payload.grantId === grantId)) {
            this.records.delete(id);
        }
    }

    /** Test/introspection helper: every stored key and payload for a model. */
    dump(model: string): Array<{ key: string; payload: OAuthPayload }> {
        const prefix = `${model}:`;
        return this.scan(model, () => true).map((id) => ({
            key: id.slice(prefix.length),
            payload: { ...this.records.get(id)!.payload },
        }));
    }
}
