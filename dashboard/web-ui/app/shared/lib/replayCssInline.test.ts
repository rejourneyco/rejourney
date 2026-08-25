import { describe, expect, it } from 'vitest';
import { collectExternalStylesheetLinks, inlineExternalReplayStylesheets } from './replayCssInline';

function snapshotEvent(headChildren: any[]): any {
    return {
        type: 2,
        data: {
            node: {
                tagName: 'html',
                childNodes: [
                    { tagName: 'head', attributes: {}, childNodes: headChildren },
                    { tagName: 'body', attributes: {}, childNodes: [] },
                ],
            },
        },
    };
}

const externalLink = () => ({
    tagName: 'link',
    attributes: { rel: 'stylesheet', href: 'https://site.example.com/app.css' },
    childNodes: [],
});

describe('collectExternalStylesheetLinks', () => {
    it('finds external stylesheet links in full snapshots', () => {
        const events = [snapshotEvent([externalLink()])];
        expect(collectExternalStylesheetLinks(events)).toHaveLength(1);
    });

    it('finds links added by incremental mutations', () => {
        const events = [{
            type: 3,
            data: { source: 0, adds: [{ node: externalLink() }] },
        }];
        expect(collectExternalStylesheetLinks(events)).toHaveLength(1);
    });

    it('ignores links rrweb already inlined', () => {
        const inlined = { tagName: 'link', attributes: { _cssText: 'body{}' }, childNodes: [] };
        expect(collectExternalStylesheetLinks([snapshotEvent([inlined])])).toHaveLength(0);
    });

    it('ignores non-stylesheet links and relative hrefs', () => {
        const events = [snapshotEvent([
            { tagName: 'link', attributes: { rel: 'icon', href: 'https://site.example.com/favicon.png' }, childNodes: [] },
            { tagName: 'link', attributes: { rel: 'modulepreload', href: 'https://site.example.com/x.js' }, childNodes: [] },
            { tagName: 'link', attributes: { rel: 'stylesheet', href: '/relative.css' }, childNodes: [] },
        ])];
        expect(collectExternalStylesheetLinks(events)).toHaveLength(0);
    });
});

describe('inlineExternalReplayStylesheets', () => {
    it('inlines fetched CSS using the same shape rrweb produces', async () => {
        const link = externalLink();
        const events = [snapshotEvent([link])];

        const count = await inlineExternalReplayStylesheets(events, async () => 'body { color: red; }');

        expect(count).toBe(1);
        expect(link.attributes).toEqual({ _cssText: 'body { color: red; }' });
    });

    it('fetches each unique href once and shares the result', async () => {
        const a = externalLink();
        const b = externalLink();
        const calls: string[] = [];
        const events = [snapshotEvent([a]), snapshotEvent([b])];

        await inlineExternalReplayStylesheets(events, async (href) => {
            calls.push(href);
            return '.x{}';
        });

        expect(calls).toHaveLength(1);
        expect(a.attributes).toEqual({ _cssText: '.x{}' });
        expect(b.attributes).toEqual({ _cssText: '.x{}' });
    });

    it('leaves the link untouched when the fetch fails, preserving prior behavior', async () => {
        const link = externalLink();
        const events = [snapshotEvent([link])];

        const count = await inlineExternalReplayStylesheets(events, async () => null);

        expect(count).toBe(0);
        expect(link.attributes).toEqual({ rel: 'stylesheet', href: 'https://site.example.com/app.css' });
    });

    it('is a no-op for events with no external stylesheet links', async () => {
        let fetched = 0;
        const count = await inlineExternalReplayStylesheets([snapshotEvent([])], async () => {
            fetched += 1;
            return '.x{}';
        });
        expect(count).toBe(0);
        expect(fetched).toBe(0);
    });
});
