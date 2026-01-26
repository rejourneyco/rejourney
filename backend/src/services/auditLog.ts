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

export type AuditAction =
    | 'plan_changed'
    | 'api_key_created'
    | 'api_key_deleted'
    | 'api_key_rotated'
    | 'project_created'
    | 'project_deleted'
    | 'project_updated'
    | 'team_created'
    | 'team_deleted'
    | 'team_member_added'
    | 'team_member_removed'
    | 'team_member_role_changed'
    | 'user_permissions_changed'
    | 'billing_plan_changed'
    | 'payment_method_added'
    | 'payment_method_removed'
    | 'session_deleted'
    | 'data_export_requested'
    | 'login_success'
    | 'login_failed'
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

/**
 * Extract IP address from request
 */
function extractIpAddress(req: Request): string {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        const ips = (typeof xForwardedFor === 'string' ? xForwardedFor : xForwardedFor[0])
            .split(',')
            .map((ip: string) => ip.trim());
        return ips[0];
    }
    return req.headers['x-real-ip'] as string || req.socket?.remoteAddress || req.ip || '';
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
        const ipAddress = entry.ipAddress || (req ? extractIpAddress(req) : undefined);
        const userAgent = entry.userAgent || (req ? req.headers['user-agent'] : undefined);

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
            metadata: entry.metadata,
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
        previousValue?: unknown;
        newValue?: unknown;
        metadata?: Record<string, unknown>;
    } = {}
): Promise<void> {
    const userId = (req as any).user?.id;
    const teamId = (req as any).project?.teamId || (req as any).team?.id;

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
