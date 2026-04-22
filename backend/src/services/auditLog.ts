/**
 * Audit Logging Service
 * 
 * Provides a tamper-proof audit trail for security-sensitive operations.
 * All audit logs are immutable once created.
 */

import { db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';
import { logger } from '../logger.js';
import { Request } from 'express';
import { getRequestIp } from '../utils/requestIp.js';

export type AuditAction =
    | 'account_created'
    | 'plan_changed'
    | 'api_key_created'
    | 'api_key_deleted'
    | 'api_key_rotated'
    | 'alert_recipient_added'
    | 'alert_recipient_removed'
    | 'alert_settings_updated'
    | 'billing_checkout_completed'
    | 'project_created'
    | 'project_deleted'
    | 'project_updated'
    | 'team_created'
    | 'team_updated'
    | 'team_deleted'
    | 'team_member_added'
    | 'team_member_removed'
    | 'team_member_role_changed'
    | 'team_invitation_accepted'
    | 'team_invitation_cancelled'
    | 'team_invitation_resent'
    | 'team_invitation_sent'
    | 'user_permissions_changed'
    | 'billing_plan_changed'
    | 'payment_method_added'
    | 'payment_method_removed'
    | 'subscription_cancel_requested'
    | 'login_challenge_requested'
    | 'session_deleted'
    | 'data_export_requested'
    | 'login_success'
    | 'login_failed'
    | 'logout'
    | 'password_reset_requested'
    | 'quota_exceeded'
    | 'recording_disabled'
    | 'recording_enabled';

export type TargetType = 'team' | 'project' | 'session' | 'api_key' | 'user' | 'billing';

export interface AuditLogEntry {
    userId?: string;
    teamId?: string;
    action: AuditAction;
    targetType?: TargetType;
    targetId?: string;
    previousValue?: unknown;
    newValue?: unknown;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
}

export interface AuditFieldChangeSet {
    changedFields: string[];
    previousValue: Record<string, unknown>;
    newValue: Record<string, unknown>;
}

function normalizeAuditValue(value: unknown): unknown {
    if (value === undefined) {
        return undefined;
    }

    if (
        value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
    ) {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map((item) => normalizeAuditValue(item));
    }

    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .map(([key, entryValue]) => [key, normalizeAuditValue(entryValue)] as const)
                .filter(([, entryValue]) => entryValue !== undefined)
        );
    }

    return String(value);
}

function auditValuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(normalizeAuditValue(left)) === JSON.stringify(normalizeAuditValue(right));
}

function getRequestRoute(req: Request): string {
    const routePath = req.route?.path;
    if (typeof routePath === 'string') {
        return `${req.baseUrl || ''}${routePath}`;
    }

    return req.originalUrl?.split('?')[0] || req.path;
}

export function buildAuditFieldChanges(
    previousState: Record<string, unknown>,
    nextState: Record<string, unknown>
): AuditFieldChangeSet {
    const previousValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    const changedFields: string[] = [];
    const fieldNames = new Set([
        ...Object.keys(previousState),
        ...Object.keys(nextState),
    ]);

    for (const fieldName of fieldNames) {
        const previousFieldValue = normalizeAuditValue(previousState[fieldName]);
        const nextFieldValue = normalizeAuditValue(nextState[fieldName]);

        if (auditValuesEqual(previousFieldValue, nextFieldValue)) {
            continue;
        }

        changedFields.push(fieldName);

        if (previousFieldValue !== undefined) {
            previousValue[fieldName] = previousFieldValue;
        }

        if (nextFieldValue !== undefined) {
            newValue[fieldName] = nextFieldValue;
        }
    }

    return {
        changedFields,
        previousValue,
        newValue,
    };
}

export function buildAuditRequestMetadata(req: Request): Record<string, unknown> {
    return {
        actorEmail: (req as any).user?.email,
        requestId: req.headers['x-request-id'] || null,
        requestMethod: req.method,
        requestRoute: getRequestRoute(req),
    };
}

/**
 * Create an audit log entry
 * 
 * @param entry - The audit log data
 * @param req - Optional Express request for extracting IP and user agent
 */
export async function createAuditLog(
    entry: AuditLogEntry,
    req?: Request
): Promise<void> {
    try {
        const ipAddress = entry.ipAddress || (req ? getRequestIp(req) : undefined);
        const userAgent = entry.userAgent || (req ? req.headers['user-agent'] : undefined);
        const metadata = req
            ? {
                ...buildAuditRequestMetadata(req),
                ...(entry.metadata ?? {}),
            }
            : entry.metadata;

        await db.insert(auditLogs).values({
            userId: entry.userId,
            teamId: entry.teamId,
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            previousValue: entry.previousValue,
            newValue: entry.newValue,
            ipAddress,
            userAgent,
            metadata,
        });

        logger.debug({
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            userId: entry.userId,
        }, 'Audit log created');
    } catch (err) {
        // Don't throw - audit logging should never break the main flow
        logger.error({ err, entry }, 'Failed to create audit log');
    }
}

/**
 * Create an audit log for a request with user context
 * 
 * Convenience method that extracts user info from the request
 */
export async function auditFromRequest(
    req: Request,
    action: AuditAction,
    options: {
        targetType?: TargetType;
        targetId?: string;
        teamId?: string;
        previousValue?: unknown;
        newValue?: unknown;
        metadata?: Record<string, unknown>;
    } = {}
): Promise<void> {
    const userId = (req as any).user?.id;
    const teamId = options.teamId
        || (req as any).project?.teamId
        || (req as any).team?.id
        || req.params?.teamId
        || req.body?.teamId;

    await createAuditLog({
        userId,
        teamId,
        action,
        targetType: options.targetType,
        targetId: options.targetId,
        previousValue: options.previousValue,
        newValue: options.newValue,
        metadata: options.metadata,
    }, req);
}
