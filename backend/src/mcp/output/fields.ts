/**
 * String field kinds for tool output schemas.
 *
 * A tool's output schema is built from these constructors. The kind decides
 * what the output layer does with the value on the way out. A plain
 * `z.string()` with no kind is treated as untrusted text, the strictest
 * treatment, so forgetting a kind can only over-scrub.
 *
 * Kinds live in a WeakMap, not in zod metadata, so they do not show up in the
 * JSON Schema sent to clients.
 */

import { z } from 'zod';

export type StringKind =
    /** End-user or SDK supplied text. Fully scrubbed and markup-neutralised. */
    | 'untrusted'
    /** A stack frame. Scrubbed, but long symbol names are kept. */
    | 'stack'
    /** A Rejourney id (project, session, issue, fault). Must look like one. */
    | 'id'
    /** A dashboard deep link built by the server. Must start with the dashboard base URL. */
    | 'link'
    /** An ISO-8601 instant produced by the server. */
    | 'timestamp'
    /** A pagination cursor produced by the server. */
    | 'cursor'
    /** An end-user identifier. Removed when masking is on. */
    | 'userId'
    /** A short hash standing in for a device id. Removed when masking is on. */
    | 'pseudonym'
    /** City-level location. Removed when masking is on. */
    | 'city'
    /**
     * Text the output layer writes itself from the already scrubbed result
     * (the markdown brief). Whatever a tool puts in such a field is discarded.
     */
    | 'derived';

export interface StringFieldMeta {
    kind: StringKind;
    maxLength: number;
}

const registry = new WeakMap<z.ZodType, StringFieldMeta>();

function field(kind: StringKind, maxLength: number): z.ZodString {
    const schema = z.string();
    registry.set(schema, { kind, maxLength });
    return schema;
}

export const DEFAULT_FIELD_META: StringFieldMeta = { kind: 'untrusted', maxLength: 300 };

export function stringFieldMeta(schema: z.ZodType): StringFieldMeta {
    return registry.get(schema) ?? DEFAULT_FIELD_META;
}

export const out = {
    text: (maxLength = 300) => field('untrusted', maxLength),
    stackFrame: (maxLength = 400) => field('stack', maxLength),
    id: () => field('id', 64),
    link: () => field('link', 400),
    timestamp: () => field('timestamp', 40),
    cursor: () => field('cursor', 600),
    userId: () => field('userId', 200),
    pseudonym: () => field('pseudonym', 32),
    city: () => field('city', 100),
    derived: (maxLength = 60_000) => field('derived', maxLength),
};
