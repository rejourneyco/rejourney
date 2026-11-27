/**
 * The single output layer (§6.1 "one output layer", §6.2 "allow-listed output").
 *
 * Every tool result goes through `finalizeToolOutput`, which:
 *   1. walks the tool's strict output schema and keeps only the fields it
 *      names (unknown fields are dropped, database rows cannot pass through),
 *   2. treats every string according to its field kind (scrub, mask, or check
 *      that a server-built value has the expected shape),
 *   3. validates the projected value against the strict schema,
 *   4. enforces the byte cap (64 KB per credit charged) by shortening the
 *      declared list and returning a cursor, never by cutting JSON,
 *   5. stamps `meta` (time taken, credits, truncated, cached) on the result,
 *      the same way for every tool, and
 *   6. returns the MCP result plus the measured size for metering.
 */

import { z } from 'zod';
import { McpToolError } from '../errors.js';
import { stringFieldMeta } from './fields.js';
import type { StringFieldMeta } from './fields.js';
import { REDACTED, scrubText } from './scrub.js';

export const BYTES_PER_CREDIT = 64 * 1024;
/**
 * No result is larger than this, whatever it costs. A result is read by a
 * model: Claude Code sets aside any tool result it counts above 25,000 tokens,
 * and in testing it did so for a 56,700-character result of this JSON (ids and
 * hashes tokenise badly) while accepting 47,600. Lists are shortened to fit
 * and carry a cursor.
 */
export const MAX_RESULT_BYTES = 40 * 1024;

export interface OutputEnv {
    /** Masking switch from the grant: emails, user ids and city go. */
    mask: boolean;
    /** Dashboard base URL without a trailing slash. The only origin a link may point at. */
    linkBase: string;
}

/** How a result may be shortened when it is over the byte cap. */
export interface OutputPaging {
    /** Top-level array field that may be shortened. */
    listKey: string;
    /**
     * Cursor that resumes after the first `kept` items of the list as the tool
     * returned it, or null when nothing follows them.
     */
    cursorAfter: (kept: number) => string | null;
}

/**
 * Present on every tool result. Tools declare it in their output schema with
 * this exact fragment and never fill it in: the output layer does.
 */
export const outputMetaSchema = z.strictObject({
    /** Server-side time for the call in milliseconds, from receiving the arguments to the serialised result. */
    tookMs: z.number(),
    /** Credits charged for the call. */
    credits: z.number(),
    /** True when a list was shortened to fit the size cap; follow nextCursor for the rest. */
    truncated: z.boolean(),
    /** True when the result came from a cache. */
    cached: z.boolean(),
});

export type OutputMeta = z.infer<typeof outputMetaSchema>;

/** `_meta` key on the MCP result carrying the same time. */
export const TOOK_MS_META_KEY = 'rejourney.co/tookMs';

const MAX_MARKDOWN_LENGTH = 60_000;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Bytes held back from the cap for the final `tookMs` digits and the closing text line. */
const META_RESERVE_BYTES = 96;

export interface FinalizeOptions<Schema extends z.ZodType> {
    schema: Schema;
    /** The tool's result, without `meta`. */
    data: unknown;
    env: OutputEnv;
    /** Credits charged for the call. Zero-credit tools get one credit's worth of bytes. */
    credits: number;
    paging?: OutputPaging;
    bytesPerCredit?: number;
    /** Ceiling on the serialised result regardless of credits. Default MAX_RESULT_BYTES. */
    maxResultBytes?: number;
    /**
     * Writes the `markdown` field from the scrubbed, validated result. It
     * sees only what the client will see, so the brief cannot contain
     * anything the structured result does not.
     */
    renderMarkdown?: (result: Record<string, unknown>) => string;
    /** `performance.now()` when the call started. Without it `tookMs` is 0. */
    startedAtMs?: number;
    cached?: boolean;
}

export interface FinalizedOutput {
    structuredContent: Record<string, unknown>;
    content: Array<{ type: 'text'; text: string }>;
    _meta: Record<string, unknown>;
    meta: OutputMeta;
    /** UTF-8 size of the text body, for metering. */
    bytes: number;
    /** True when the list was shortened to fit the byte cap. */
    truncated: boolean;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,600}$/;
const PSEUDONYM_PATTERN = /^[a-f0-9]{8,32}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

function emitString(value: string, meta: StringFieldMeta, env: OutputEnv): string {
    switch (meta.kind) {
        case 'id':
            return ID_PATTERN.test(value) ? value : REDACTED;
        case 'cursor':
            return CURSOR_PATTERN.test(value) ? value : REDACTED;
        case 'timestamp':
            return TIMESTAMP_PATTERN.test(value) ? value : REDACTED;
        case 'link':
            return isDashboardLink(value, env.linkBase) ? value : REDACTED;
        case 'pseudonym':
            if (env.mask) return REDACTED;
            return PSEUDONYM_PATTERN.test(value) ? value : REDACTED;
        case 'userId':
        case 'city':
            if (env.mask) return REDACTED;
            return scrubText(value, { mask: false, maxLength: meta.maxLength });
        case 'stack':
            return scrubText(value, { mask: env.mask, stack: true, maxLength: meta.maxLength });
        case 'untrusted':
            return scrubText(value, { mask: env.mask, maxLength: meta.maxLength });
        case 'derived':
            // Filled in by `derive` after scrubbing; a tool cannot supply it.
            return '';
    }
}

function isDashboardLink(value: string, linkBase: string): boolean {
    if (!value.startsWith(`${linkBase}/`)) return false;
    try {
        const link = new URL(value);
        const base = new URL(linkBase);
        return link.origin === base.origin && !link.username && !link.password;
    } catch {
        return false;
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ZodDef {
    type: string;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
    innerType?: z.ZodType;
}

/**
 * Projects `value` onto `schema`: keeps named fields only and treats strings by
 * kind. Schema nodes outside the small supported set make it throw, so an
 * output schema cannot quietly contain an "anything goes" node.
 */
export function projectOntoSchema(schema: z.ZodType, value: unknown, env: OutputEnv): unknown {
    const def = (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
    switch (def.type) {
        case 'optional':
            return value === undefined ? undefined : projectOntoSchema(def.innerType!, value, env);
        case 'nullable':
            return value === null ? null : projectOntoSchema(def.innerType!, value, env);
        case 'object': {
            if (!isPlainObject(value)) return value;
            const projected: Record<string, unknown> = {};
            for (const [key, child] of Object.entries(def.shape!)) {
                const next = projectOntoSchema(child, value[key], env);
                if (next !== undefined) projected[key] = next;
            }
            return projected;
        }
        case 'array':
            return Array.isArray(value) ? value.map((item) => projectOntoSchema(def.element!, item, env)) : value;
        case 'string': {
            const meta = stringFieldMeta(schema);
            if (meta.kind === 'derived') return '';
            return typeof value === 'string' ? emitString(value, meta, env) : value;
        }
        case 'number':
        case 'boolean':
        case 'enum':
        case 'literal':
        case 'null':
            return value;
        default:
            throw new Error(`Unsupported output schema node: ${def.type}`);
    }
}

function byteLength(text: string): number {
    return Buffer.byteLength(text, 'utf8');
}

function creditsLabel(credits: number): string {
    return `${credits} ${credits === 1 ? 'credit' : 'credits'}`;
}

/**
 * Runs a raw tool result through the output layer. Throws `McpToolError`
 * (`internal` when the result does not fit its schema, `result_too_large` when
 * it cannot be made to fit the byte cap).
 */
export function finalizeToolOutput<Schema extends z.ZodType>(options: FinalizeOptions<Schema>): FinalizedOutput {
    const { schema, env, paging } = options;
    const capBytes = Math.min(Math.max(1, options.credits) * (options.bytesPerCredit ?? BYTES_PER_CREDIT), options.maxResultBytes ?? MAX_RESULT_BYTES) - META_RESERVE_BYTES;
    const meta: OutputMeta = { tookMs: 0, credits: options.credits, truncated: false, cached: options.cached === true };

    if (!isPlainObject(options.data)) throw new McpToolError('internal');
    const projected = projectOntoSchema(schema, { ...options.data, meta }, env);
    const parsed = schema.safeParse(projected);
    if (!parsed.success || !isPlainObject(parsed.data) || !isPlainObject(parsed.data.meta)) {
        // The detail names our own fields only, but the message stays generic anyway.
        throw new McpToolError('internal');
    }

    /** Stamps the time last, so it covers everything above, and serialises once more. */
    const seal = (value: Record<string, unknown>, truncated: boolean): FinalizedOutput => {
        const tookMs = options.startedAtMs === undefined ? 0 : Math.max(0, Math.round(performance.now() - options.startedAtMs));
        const finalMeta: OutputMeta = { ...meta, tookMs, truncated };
        const structuredContent = { ...value, meta: finalMeta };
        const text = `${JSON.stringify(structuredContent)}\n(took ${tookMs} ms, ${creditsLabel(options.credits)})`;
        return {
            structuredContent,
            content: [{ type: 'text', text }],
            _meta: { [TOOK_MS_META_KEY]: tookMs },
            meta: finalMeta,
            bytes: byteLength(text),
            truncated,
        };
    };

    const withMarkdown = (value: Record<string, unknown>): Record<string, unknown> => {
        if (!options.renderMarkdown) return value;
        const markdown = options.renderMarkdown(value).replace(CONTROL_CHARACTERS, '');
        return { ...value, markdown: markdown.length > MAX_MARKDOWN_LENGTH ? `${markdown.slice(0, MAX_MARKDOWN_LENGTH - 1)}\u2026` : markdown };
    };

    const full = withMarkdown(parsed.data as Record<string, unknown>);
    if (byteLength(JSON.stringify(full)) <= capBytes) return seal(full, false);

    const list = paging ? full[paging.listKey] : undefined;
    if (!paging || !Array.isArray(list)) throw new McpToolError('result_too_large');

    const build = (kept: number) => {
        const cursor = paging.cursorAfter(kept);
        if (cursor !== null && !CURSOR_PATTERN.test(cursor)) throw new McpToolError('internal');
        const candidate: Record<string, unknown> = {
            ...full,
            [paging.listKey]: list.slice(0, kept),
            nextCursor: cursor,
            meta: { ...meta, truncated: true },
        };
        // The strings are already scrubbed; only the shape needs checking again
        // (nextCursor must be part of the schema too).
        const checked = schema.safeParse(candidate);
        if (!checked.success || !isPlainObject(checked.data)) throw new McpToolError('internal');
        const value = withMarkdown(checked.data as Record<string, unknown>);
        return { value, bytes: byteLength(JSON.stringify(value)) };
    };

    // Largest non-empty prefix that fits. Sizes grow with `kept`, so binary
    // search. An empty page with a cursor would make a client loop forever, so
    // a first item that does not fit on its own is an error instead.
    let low = 1;
    let high = list.length - 1;
    let best: ReturnType<typeof build> | null = null;
    while (low <= high) {
        const middle = (low + high) >> 1;
        const candidate = build(middle);
        if (candidate.bytes <= capBytes) {
            best = candidate;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    if (!best) throw new McpToolError('result_too_large');

    return seal(best.value, true);
}
