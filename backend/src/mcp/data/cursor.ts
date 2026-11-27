/**
 * Opaque pagination cursors: base64url JSON holding a position only (a sort
 * key, an offset). A cursor never carries a project id, so one copied from
 * another connection cannot widen what a call may read; the grant filter is
 * applied again on every call.
 */

import type { z } from 'zod';
import { invalidArgument } from '../errors.js';

export function encodeCursor(value: Record<string, string | number>): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Throws `invalid_argument` unless the cursor decodes to exactly the expected shape. */
export function decodeCursor<Schema extends z.ZodType>(cursor: string, schema: Schema): z.infer<Schema> {
    let decoded: unknown;
    try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        throw invalidArgument('Invalid cursor.');
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) throw invalidArgument('Invalid cursor.');
    return parsed.data;
}
