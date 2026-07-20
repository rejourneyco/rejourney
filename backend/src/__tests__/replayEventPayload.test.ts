import { describe, expect, it } from 'vitest';
import { normalizeReplayEventPayload } from '../services/replayEventPayload.js';

describe('normalizeReplayEventPayload', () => {
    it('parses native custom-event JSON strings into replay properties', () => {
        const normalized = normalizeReplayEventPayload({
            type: 'custom',
            name: 'sign_in_next_button_pressed',
            payload: '{"button":"Next","screen":"SignInR3Screen"}',
        });

        expect(normalized).toEqual({
            payload: {
                button: 'Next',
                screen: 'SignInR3Screen',
            },
            properties: {
                button: 'Next',
                screen: 'SignInR3Screen',
            },
        });
    });

    it('preserves browser object payloads', () => {
        const properties = {
            sequence: 4,
            route_template: '/login',
            has_query: false,
        };

        const normalized = normalizeReplayEventPayload({
            type: 'custom',
            name: 'website_route_viewed',
            payload: properties,
            properties,
        });

        expect(normalized.payload).toBe(properties);
        expect(normalized.properties).toBe(properties);
    });

    it('retains malformed string payloads without exposing them as properties', () => {
        const normalized = normalizeReplayEventPayload({
            type: 'custom',
            name: 'legacy_event',
            payload: '{"incomplete":',
        });

        expect(normalized).toEqual({
            payload: '{"incomplete":',
            properties: null,
        });
    });

    it('uses object-valued details when the primary payload is not JSON', () => {
        const details = { source: 'legacy-sdk' };
        const normalized = normalizeReplayEventPayload({
            payload: 'plain-text-payload',
            details,
        });

        expect(normalized).toEqual({
            payload: 'plain-text-payload',
            properties: details,
        });
    });
});
