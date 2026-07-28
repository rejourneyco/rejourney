import { describe, expect, it } from 'vitest';
import {
    buildStabilityIssues,
    canonicalizeStabilityOccurrences,
    countCanonicalStabilityOccurrences,
    decodeStabilityCursor,
    encodeStabilityCursor,
    type LegacyStabilityRow,
} from '../services/stabilityAnalytics.js';

const projectId = 'e8451865-0049-4efd-ac13-b8130a889873';

function row(overrides: Partial<LegacyStabilityRow>): LegacyStabilityRow {
    return {
        id: 'occurrence-1',
        type: 'anr',
        projectId,
        sessionId: 'session-1',
        timestamp: new Date('2026-07-27T03:35:02.667Z'),
        name: 'Application Not Responding',
        message: 'Main thread blocked',
        stackTrace: null,
        durationMs: 6_574,
        status: 'open',
        occurrenceCount: 1,
        eventMetadata: null,
        session: {
            platform: 'android',
            deviceModel: 'sdk_gphone64_arm64',
            osVersion: '16',
            appVersion: '6.0.2',
            sdkVersion: '0.1.1',
            anonymousHash: 'anonymous-user',
            replayAvailable: true,
            recordingDeleted: false,
            isReplayExpired: false,
            isSampledIn: true,
        },
        ...overrides,
    };
}

describe('stability analytics canonicalization', () => {
    it('merges the placeholder and rich Android ANR transports into one occurrence', () => {
        const stack = [
            'io.flutter.embedding.engine.FlutterJNI.nativeGetBitmap(FlutterJNI.java:-2)',
            'io.flutter.embedding.engine.FlutterJNI.getBitmap(FlutterJNI.java:512)',
        ].join('\n');
        const occurrences = canonicalizeStabilityOccurrences([
            row({
                id: 'placeholder',
                timestamp: new Date('2026-07-27T03:35:02.704Z'),
                stackTrace: '[]',
                eventMetadata: {},
                source: 'fault_recovery',
            }),
            row({
                id: 'rich',
                timestamp: new Date('2026-07-27T03:35:02.667Z'),
                stackTrace: stack,
                eventMetadata: {
                    deviceModel: 'sdk_gphone64_arm64',
                    osVersion: '16',
                    appVersion: '6.0.2',
                },
                source: 'events_artifact',
            }),
        ]);

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0].sourceIds).toEqual(expect.arrayContaining(['placeholder', 'rich']));
        expect(occurrences[0].stackTrace).toBe(stack);
        expect(occurrences[0].deviceModel).toBe('sdk_gphone64_arm64');
        expect(occurrences[0].appVersion).toBe('6.0.2');
        expect(occurrences[0].occurrenceCount).toBe(1);
        expect(occurrences[0].canOpenReplay).toBe(true);
    });

    it('uses incident IDs to make racing transports idempotent and keeps richer evidence', () => {
        const occurrences = canonicalizeStabilityOccurrences([
            row({
                id: 'fault-route',
                type: 'crash',
                incidentId: 'incident-123',
                name: 'SIGABRT',
                message: 'abort called',
                stackTrace: '0x0000000100000000',
                timestamp: new Date('2026-07-25T07:40:30.559Z'),
                source: 'fault_recovery',
            }),
            row({
                id: 'crash-artifact',
                type: 'crash',
                incidentId: 'incident-123',
                name: 'SIGABRT',
                message: 'abort called',
                stackTrace: '0 rejourney 0x0000000100000000 MyApp.checkout + 44',
                timestamp: new Date('2026-07-25T07:40:31.559Z'),
                source: 'crash_artifact',
            }),
        ]);

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0].incidentId).toBe('incident-123');
        expect(occurrences[0].sourceIds).toHaveLength(2);
        expect(occurrences[0].stackTrace).toContain('MyApp.checkout');
        expect(occurrences[0].occurrenceCount).toBe(1);
    });

    it('keeps V1 research counts compatible while excluding duplicate transports', () => {
        const counts = countCanonicalStabilityOccurrences([
            row({
                id: 'crash-telemetry',
                type: 'crash',
                incidentId: 'incident-crash-1',
                name: 'SIGABRT',
                occurrenceCount: 3,
            }),
            row({
                id: 'crash-artifact',
                type: 'crash',
                incidentId: 'incident-crash-1',
                name: 'SIGABRT',
                occurrenceCount: 3,
                source: 'fault-artifact',
            }),
            row({
                id: 'anr-placeholder',
                type: 'anr',
                incidentId: null,
                name: 'ANR',
                stackTrace: '[]',
                durationMs: 6_574,
                timestamp: new Date('2026-07-26T22:35:02.000Z'),
            }),
            row({
                id: 'anr-stack',
                type: 'anr',
                incidentId: null,
                name: 'ANR',
                stackTrace: 'io.flutter.embedding.engine.FlutterJNI.nativeGetBitmap',
                durationMs: 6_574,
                timestamp: new Date('2026-07-26T22:35:02.037Z'),
            }),
            row({
                id: 'error-1',
                type: 'error',
                name: 'TypeError',
                message: 'Cart is undefined',
                fingerprint: 'error-fingerprint',
                occurrenceCount: 2,
            }),
        ]);

        expect(counts).toEqual({
            crash: 3,
            error: 2,
            anr: 1,
        });
    });

    it('recovers environment fields from the session when the event omitted them', () => {
        const [occurrence] = canonicalizeStabilityOccurrences([
            row({
                id: 'metadata-gap',
                type: 'crash',
                name: 'SIGABRT',
                message: 'abort called',
                stackTrace: 'at MyApp.checkout(Checkout.swift:42)',
                eventMetadata: {},
            }),
        ]);

        expect(occurrence.platform).toBe('android');
        expect(occurrence.deviceModel).toBe('sdk_gphone64_arm64');
        expect(occurrence.osVersion).toBe('16');
        expect(occurrence.appVersion).toBe('6.0.2');
        expect(occurrence.sdkVersion).toBe('0.1.1');
        expect(occurrence.diagnosticState).toBe('complete');
    });

    it('keeps every distinct session occurrence on the grouped issue', () => {
        const issues = buildStabilityIssues([
            row({
                id: 'error-1',
                type: 'error',
                sessionId: 'session-1',
                name: 'StateError',
                message: 'Checkout failed',
                fingerprint: 'checkout-fingerprint',
                stackTrace: '#0 Checkout.submit (checkout.dart:42)',
            }),
            row({
                id: 'error-2',
                type: 'error',
                sessionId: 'session-2',
                name: 'StateError',
                message: 'Checkout failed',
                fingerprint: 'checkout-fingerprint',
                stackTrace: '#0 Checkout.submit (checkout.dart:42)',
                timestamp: new Date('2026-07-27T04:35:02.667Z'),
                session: {
                    platform: 'ios',
                    deviceModel: 'iPad16,3',
                    osVersion: '18.5',
                    appVersion: '6.0.2',
                    userDisplayId: 'user-2',
                    replayAvailable: false,
                },
            }),
        ]);

        expect(issues).toHaveLength(1);
        expect(issues[0].eventCount).toBe(2);
        expect(issues[0].sessionCount).toBe(2);
        expect(issues[0].userCount).toBe(2);
        expect(issues[0].occurrences.map((occurrence) => occurrence.sessionId)).toEqual([
            'session-2',
            'session-1',
        ]);
    });

    it('replaces obfuscated Flutter runtime type names with an informative title', () => {
        const issues = buildStabilityIssues([
            row({
                id: 'flutter-error',
                type: 'error',
                name: '_ta',
                message: 'PlatformException(share_failed, Could not share)',
                stackTrace: '#0 SharePlugin.share (share.dart:81)',
            }),
        ]);

        expect(issues[0].title).toBe('PlatformException');
    });
});

describe('stability cursor', () => {
    it('round trips opaque offsets and rejects malformed cursors', () => {
        expect(decodeStabilityCursor(encodeStabilityCursor(75))).toBe(75);
        expect(decodeStabilityCursor('not-a-cursor')).toBe(0);
        expect(decodeStabilityCursor(undefined)).toBe(0);
    });
});
