/**
 * The single output layer: strict schema projection, string kinds, scrubbing,
 * masking, markdown neutralisation, the byte cap with a cursor, and `meta`.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpToolError } from '../mcp/errors.js';
import { BYTES_PER_CREDIT, MAX_RESULT_BYTES, TOOK_MS_META_KEY, finalizeToolOutput, outputMetaSchema, projectOntoSchema } from '../mcp/output/emit.js';
import { out } from '../mcp/output/fields.js';
import { REDACTED, neutralizeMarkup, passesLuhn, reduceUrl, scrubText } from '../mcp/output/scrub.js';

/**
 * Credential-shaped test values, assembled at runtime so the literal strings
 * never appear in this public repo (its secret check would rightly refuse them).
 */
const FAKE = {
    stripeLive: ['sk', 'live', 'abcdefgh12345678'].join('_'),
    github: ['ghp', 'abcdefghijklmnopqrstuvwx'].join('_'),
    aws: ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
};

const env = { mask: false, linkBase: 'https://dashboard.example.test' };
const scrub = (text: string, mask = false) => scrubText(text, { mask, maxLength: 2000 });

describe('scrubText', () => {
    it('reduces URLs to host and path: scheme, credentials, query and fragment go', () => {
        expect(scrub('POST https://user:pw@api.example.com:8443/v1/checkout?token=abc123&cart=4#frag failed')).toBe('POST api.example.com:8443/v1/checkout failed');
        expect(scrub('see http://example.com.')).toBe('see example.com.');
        expect(scrub('myapp://open/product/42?ref=email')).toBe('open/product/42');
        expect(reduceUrl('https://')).toBe(REDACTED);
    });

    it('drops query strings from scheme-less paths', () => {
        expect(scrub('GET /v1/cart?session=abcdef')).toBe('GET /v1/cart');
        expect(scrub('api.example.com/pay?card=1 next')).toBe('api.example.com/pay next');
    });

    it('replaces bearer and basic credentials', () => {
        expect(scrub('Authorization: Bearer abc.DEF_123-xyz')).not.toContain('abc.DEF_123-xyz');
        expect(scrub('sent Bearer abcdefgh12345678')).toBe(`sent Bearer ${REDACTED}`);
        expect(scrub('Basic dXNlcjpwYXNzd29yZA==')).toBe(`Basic ${REDACTED}`);
        expect(scrub('Authorization: Bearer abcdefgh12345678 end')).toBe(`Authorization: Bearer ${REDACTED} end`);
        // Our own marker survives the markdown rules, even twice in a row.
        expect(scrub(`jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl ${FAKE.stripeLive}`)).toBe(`jwt ${REDACTED} ${REDACTED}`);
    });

    it('replaces JWT-shaped strings', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2';
        expect(scrub(`jwt ${jwt} end`)).toBe(`jwt ${REDACTED} end`);
    });

    it('replaces secret-named key/value pairs', () => {
        expect(scrub('password=hunter2 ok')).toBe(`password=${REDACTED} ok`);
        expect(scrub('api_key: "abc" ok')).toBe(`api_key: ${REDACTED} ok`);
        expect(scrub('?token=abc')).toBe(`?token=${REDACTED}`);
    });

    it('replaces vendor keys, Stripe ids and our own tokens', () => {
        for (const secret of [FAKE.stripeLive, 'pk_test_abcdefgh12345678', 'rjm_abcdefgh12345678', 'whsec_abcdefgh1234', FAKE.github, FAKE.aws, 'cus_ABCdef1234567890', 'sub_ABCdef1234567890']) {
            expect(scrub(`x ${secret} y`), secret).toBe(`x ${REDACTED} y`);
        }
    });

    it('replaces long key-shaped strings and UUIDs but keeps ordinary identifiers', () => {
        expect(scrub('key 9f8e7d6c5b4a39281706f5e4d3c2b1a0 end')).toBe(`key ${REDACTED} end`);
        expect(scrub('id 3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b end')).toBe(`id ${REDACTED} end`);
        expect(scrub('blob QWxhZGRpbjpvcGVuIHNlc2FtZQ1234567890abcdefABCDEFGHIJ== end')).toBe(`blob ${REDACTED} end`);
        expect(scrub('checkout_step_2_payment_method_selected_v3')).toBe('checkout_step_2_payment_method_selected_v3');
        expect(scrub('/users/profile/settings/notifications/email/preferences')).toBe('/users/profile/settings/notifications/email/preferences');
    });

    it('keeps long symbol names in stack frames but still removes named secrets', () => {
        const frame = 'at $s7Example14ViewControllerC11viewDidLoadyyF0123456789abcdefgh (Bearer abcdefgh12345678)';
        const scrubbed = scrubText(frame, { mask: false, stack: true });
        expect(scrubbed).toContain('$s7Example14ViewControllerC11viewDidLoadyyF0123456789abcdefgh');
        expect(scrubbed).not.toContain('abcdefgh12345678)');
        expect(scrub(frame)).not.toContain('viewDidLoadyyF0123456789abcdefgh');
    });

    it('replaces card-shaped digit runs that pass the Luhn check, and only those', () => {
        expect(passesLuhn('4242424242424242')).toBe(true);
        expect(scrub('card 4242 4242 4242 4242 used')).toBe(`card ${REDACTED} used`);
        expect(scrub('card 4242-4242-4242-4242 used')).toBe(`card ${REDACTED} used`);
        expect(scrub('at 1763400000000 ms')).toBe('at 1763400000000 ms');
    });

    it('masks emails only when masking is on', () => {
        expect(scrub('mail jane.doe+x@example.co.uk now')).toBe('mail jane.doe+x@example.co.uk now');
        expect(scrub('mail jane.doe+x@example.co.uk now', true)).toBe(`mail ${REDACTED} now`);
    });

    it('neutralises markdown links, images, reference links and HTML tags', () => {
        expect(scrub('![promo](https://evil.example/p.png?c=secret)')).toBe('promo (evil.example/p.png)');
        expect(scrub('[click](javascript:alert(1))')).not.toMatch(/\]\(/);
        expect(neutralizeMarkup('[a][b]')).toBe('a b');
        expect(neutralizeMarkup('[ref]: target')).toBe('[ref] : target');
        expect(neutralizeMarkup('![x] (y)')).not.toContain('![');
        expect(scrub('<img src="x"> hi <b>')).toBe('‹img src="x"› hi ‹b›');
        // Objective-C selectors are not link syntax and survive.
        expect(scrub('-[CartItem price]: unrecognized selector')).toBe('-[CartItem price]: unrecognized selector');
    });

    it('strips control, zero-width and bidi characters and caps the length', () => {
        expect(scrub('a\u0000b\u200Bc\u202Ed')).toBe('abcd');
        expect(scrubText('x'.repeat(50), { mask: false, maxLength: 10 })).toBe(`${'x'.repeat(9)}…`);
    });
});

const schema = z.strictObject({
    id: out.id(),
    label: out.text(),
    plain: z.string(),
    userId: out.userId().nullable(),
    deviceHash: out.pseudonym().nullable(),
    city: out.city().nullable(),
    at: out.timestamp(),
    link: out.link(),
    frames: z.array(out.stackFrame()),
    nested: z.strictObject({ count: z.number(), note: out.text().optional() }),
    meta: outputMetaSchema,
});

const raw = {
    id: 'session_1771045973773_f81477f8042b4b299ba7de872bf5c0d2',
    label: 'Tap ![x](https://evil.example/a?b=c)',
    plain: 'token=abcdef',
    userId: 'jane@example.com',
    deviceHash: 'a1b2c3d4e5f6',
    city: 'Lisbon',
    at: '2026-11-20T12:00:00.000Z',
    link: 'https://dashboard.example.test/dashboard/sessions/abc?seekToTimestamp=1',
    frames: ['at com.example.Foo.bar(Foo.kt:1)'],
    nested: { count: 2, note: 'ok', secretColumn: 'dropped' },
    s3ObjectKey: 'tenants/x/y.json.gz',
    extra: { anything: true },
};

describe('finalizeToolOutput', () => {
    it('keeps only schema fields: unknown fields are dropped at every level', () => {
        const result = finalizeToolOutput({ schema, data: raw, env, credits: 1 });
        expect(Object.keys(result.structuredContent).sort()).toEqual(['at', 'city', 'deviceHash', 'frames', 'id', 'label', 'link', 'meta', 'nested', 'plain', 'userId']);
        expect(result.structuredContent.nested).toEqual({ count: 2, note: 'ok' });
        expect(JSON.stringify(result.structuredContent)).not.toContain('s3ObjectKey');
    });

    it('treats strings by kind, and unmarked strings as untrusted', () => {
        const { structuredContent: value } = finalizeToolOutput({ schema, data: raw, env, credits: 1 });
        expect(value.id).toBe(raw.id);
        expect(value.label).toBe('Tap x (evil.example/a)');
        expect(value.plain).toBe(`token=${REDACTED}`);
        expect(value.link).toBe(raw.link);
        expect(value.userId).toBe('jane@example.com');
        expect(value.deviceHash).toBe('a1b2c3d4e5f6');
        expect(value.city).toBe('Lisbon');
    });

    it('masking removes user ids, device hashes, city and emails', () => {
        const { structuredContent: value } = finalizeToolOutput({ schema, data: { ...raw, label: 'mail bob@example.com' }, env: { ...env, mask: true }, credits: 1 });
        expect(value).toMatchObject({ userId: REDACTED, deviceHash: REDACTED, city: REDACTED, label: `mail ${REDACTED}` });
    });

    it('refuses server-built values with the wrong shape instead of passing them on', () => {
        const { structuredContent: value } = finalizeToolOutput({
            schema,
            data: { ...raw, id: 'not an id!', link: 'https://evil.example/dashboard', at: 'yesterday', deviceHash: 'RAW-DEVICE-ID' },
            env,
            credits: 1,
        });
        expect(value).toMatchObject({ id: REDACTED, link: REDACTED, at: REDACTED, deviceHash: REDACTED });
        expect(finalizeToolOutput({ schema, data: { ...raw, link: 'https://dashboard.example.test.evil.example/x' }, env, credits: 1 }).structuredContent.link).toBe(REDACTED);
    });

    it('fails closed when the result does not fit the schema or the schema has an unsupported node', () => {
        expect(() => finalizeToolOutput({ schema, data: { ...raw, nested: { count: 'two' } }, env, credits: 1 })).toThrow(McpToolError);
        expect(() => projectOntoSchema(z.strictObject({ any: z.unknown() }), { any: 1 }, env)).toThrow(/Unsupported output schema node/);
        expect(() => projectOntoSchema(z.strictObject({ r: z.record(z.string(), z.number()) }), { r: {} }, env)).toThrow(/Unsupported/);
    });

    it('stamps meta, appends the timing line to the text and sets _meta', () => {
        const result = finalizeToolOutput({ schema, data: raw, env, credits: 1, startedAtMs: performance.now() - 42 });
        expect(result.meta).toMatchObject({ credits: 1, truncated: false, cached: false });
        expect(result.meta.tookMs).toBeGreaterThanOrEqual(42);
        expect(result.structuredContent.meta).toEqual(result.meta);
        expect(result._meta[TOOK_MS_META_KEY]).toBe(result.meta.tookMs);
        const [json, line] = result.content[0].text.split('\n');
        expect(JSON.parse(json)).toEqual(result.structuredContent);
        expect(line).toBe(`(took ${result.meta.tookMs} ms, 1 credit)`);
        expect(result.bytes).toBe(Buffer.byteLength(result.content[0].text, 'utf8'));
        expect(finalizeToolOutput({ schema, data: raw, env, credits: 4 }).content[0].text).toMatch(/\(took 0 ms, 4 credits\)$/);
    });

    it('a tool cannot supply meta or a derived field itself', () => {
        const withMarkdown = z.strictObject({ title: out.text(), markdown: out.derived(), meta: outputMetaSchema });
        const result = finalizeToolOutput({
            schema: withMarkdown,
            data: { title: 'Bearer abcdefgh12345678', markdown: 'INJECTED', meta: { tookMs: 1, credits: 99, truncated: true, cached: true } },
            env,
            credits: 2,
            renderMarkdown: (value) => `# ${String(value.title)}`,
        });
        expect(result.structuredContent.meta).toMatchObject({ credits: 2, truncated: false, cached: false });
        // Rendered from the scrubbed result, so the secret is already gone.
        expect(result.structuredContent.markdown).toBe(`# Bearer ${REDACTED}`);
    });
});

describe('byte cap', () => {
    const listSchema = z.strictObject({
        items: z.array(z.strictObject({ n: z.number(), text: out.text(400) })),
        nextCursor: out.cursor().nullable(),
        meta: outputMetaSchema,
    });
    const items = Array.from({ length: 400 }, (_unused, n) => ({ n, text: 'lorem ipsum dolor sit amet '.repeat(8) }));
    const paging = { listKey: 'items', cursorAfter: (kept: number) => (kept >= items.length ? null : `after${kept}`) };

    it('is 64 KB per credit, never more than a client can read, and leaves small results alone', () => {
        expect(BYTES_PER_CREDIT).toBe(65_536);
        // Clients set aside results beyond about 25,000 tokens; this stays well inside that.
        expect(MAX_RESULT_BYTES).toBeLessThanOrEqual(44_000);
        const small = finalizeToolOutput({ schema: listSchema, data: { items: items.slice(0, 5), nextCursor: null }, env, credits: 1, paging });
        expect(small.truncated).toBe(false);
        expect(small.structuredContent.nextCursor).toBeNull();
    });

    it('shortens the list to fit, returns a cursor for the rest, and never cuts JSON', () => {
        const result = finalizeToolOutput({ schema: listSchema, data: { items, nextCursor: null }, env, credits: 1, paging });
        const kept = (result.structuredContent.items as unknown[]).length;
        expect(result.bytes).toBeLessThanOrEqual(MAX_RESULT_BYTES);
        expect(kept).toBeGreaterThan(0);
        expect(kept).toBeLessThan(items.length);
        expect(result.structuredContent.nextCursor).toBe(`after${kept}`);
        expect(result.meta.truncated).toBe(true);
        expect(() => JSON.parse(result.content[0].text.split('\n')[0])).not.toThrow();
        // One more item would not have fitted.
        expect(Buffer.byteLength(JSON.stringify({ ...result.structuredContent, items: items.slice(0, kept + 1) }), 'utf8')).toBeGreaterThan(MAX_RESULT_BYTES - 200);
    });

    it('scales with the credits charged, up to the ceiling', () => {
        const sized = { schema: listSchema, data: { items, nextCursor: null }, env, paging, bytesPerCredit: 8_000 };
        const one = finalizeToolOutput({ ...sized, credits: 1 });
        const three = finalizeToolOutput({ ...sized, credits: 3 });
        expect(one.bytes).toBeLessThanOrEqual(8_000);
        expect(three.bytes).toBeLessThanOrEqual(24_000);
        expect((three.structuredContent.items as unknown[]).length).toBeGreaterThan((one.structuredContent.items as unknown[]).length);

        // More credits never lift the ceiling.
        const many = finalizeToolOutput({ schema: listSchema, data: { items, nextCursor: null }, env, paging, credits: 6 });
        expect(many.bytes).toBeLessThanOrEqual(MAX_RESULT_BYTES);
        expect(many.meta.truncated).toBe(true);
        // A caller that knows its client reads more can raise it.
        const raised = finalizeToolOutput({ schema: listSchema, data: { items, nextCursor: null }, env, paging, credits: 6, maxResultBytes: 200_000 });
        expect(raised.meta.truncated).toBe(false);
    });

    it('errors rather than returning an empty page or an oversized object', () => {
        const tiny = { schema: listSchema, data: { items, nextCursor: null }, env, credits: 1, bytesPerCredit: 300 };
        expect(() => finalizeToolOutput({ ...tiny, paging })).toThrow(expect.objectContaining({ code: 'result_too_large' }));
        expect(() => finalizeToolOutput({ ...tiny })).toThrow(expect.objectContaining({ code: 'result_too_large' }));
        expect(() => finalizeToolOutput({ ...tiny, bytesPerCredit: 2000, paging: { listKey: 'items', cursorAfter: () => 'not a cursor!' } })).toThrow(expect.objectContaining({ code: 'internal' }));
    });
});
