/**
 * What a user approved on the consent screen.
 *
 * `oidc-provider`'s Grant model only knows account, client and scopes. The
 * Rejourney-specific part of a grant (which team, which projects) is kept in
 * this side record keyed by the same grant id.
 */

export interface McpGrantRecord {
    grantId: string;
    clientId: string;
    /** The client's display name from its registration or metadata document. */
    clientName?: string;
    userId: string;
    teamId: string;
    projectIds: string[];
    scopes: string[];
    /** Team switch "mask end-user identifiers", copied onto the grant when it is saved. */
    maskIdentifiers?: boolean;
    createdAt: number;
}

export interface McpGrantRecordStore {
    save(record: McpGrantRecord): Promise<void>;
    find(grantId: string): Promise<McpGrantRecord | null>;
    delete(grantId: string, revokedByUserId?: string): Promise<void>;
}

export class InMemoryMcpGrantRecordStore implements McpGrantRecordStore {
    private readonly records = new Map<string, McpGrantRecord>();

    async save(record: McpGrantRecord): Promise<void> {
        this.records.set(record.grantId, { ...record, projectIds: [...record.projectIds], scopes: [...record.scopes] });
    }

    async find(grantId: string): Promise<McpGrantRecord | null> {
        const record = this.records.get(grantId);
        return record ? { ...record, projectIds: [...record.projectIds], scopes: [...record.scopes] } : null;
    }

    async delete(grantId: string): Promise<void> {
        this.records.delete(grantId);
    }

    all(): McpGrantRecord[] {
        return [...this.records.values()];
    }
}
