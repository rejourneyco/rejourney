import { describe, expect, it } from 'vitest';
import type { StabilityIssue, StabilityOccurrence } from '~/shared/api/client';
import { adaptStabilityIssues } from './stabilityIssueAdapters';

function occurrence(overrides: Partial<StabilityOccurrence> = {}): StabilityOccurrence {
    return {
        id: 'occurrence-1',
        sourceIds: ['occurrence-1'],
        incidentId: 'incident-1',
        issueId: 'crash_issue',
        type: 'crash',
        projectId: 'project-1',
        sessionId: 'session-1',
        timestamp: '2026-07-27T03:35:02.667Z',
        name: 'SIGABRT',
        message: 'abort called',
        stackTrace: '0 MyApp Checkout.submit + 42',
        rawStackTrace: '0 MyApp Checkout.submit + 42',
        durationMs: null,
        status: 'open',
        occurrenceCount: 1,
        screenName: 'Checkout',
        platform: 'ios',
        deviceModel: 'iPad16,3',
        osVersion: '18.5',
        appVersion: '6.0.2',
        sdkVersion: '0.2.1',
        userId: 'user-1',
        canOpenReplay: true,
        replayState: 'available',
        diagnosticState: 'complete',
        symbolicationState: 'symbolicated',
        deviceMetadata: {},
        transportSources: ['fault_recovery', 'crash_artifact'],
        fingerprint: 'crash-fingerprint',
        ...overrides,
    };
}

function issue(overrides: Partial<StabilityIssue> = {}): StabilityIssue {
    const bestOccurrence = occurrence(overrides.bestOccurrence);
    return {
        id: bestOccurrence.issueId,
        type: bestOccurrence.type,
        fingerprint: bestOccurrence.fingerprint,
        title: bestOccurrence.name,
        culprit: 'Checkout.submit',
        message: bestOccurrence.message,
        status: 'open',
        firstSeen: bestOccurrence.timestamp,
        lastSeen: bestOccurrence.timestamp,
        eventCount: 12,
        userCount: 5,
        sessionCount: 7,
        affectedDevices: { 'iPad16,3': 12 },
        affectedVersions: { '6.0.2': 12 },
        affectedPlatforms: { ios: 12 },
        diagnosticState: bestOccurrence.diagnosticState,
        symbolicationState: bestOccurrence.symbolicationState,
        bestOccurrence,
        ...overrides,
    };
}

describe('adaptStabilityIssues', () => {
    it('preserves accurate user/session counts and the best crash occurrence', () => {
        const adapted = adaptStabilityIssues([issue()]);

        expect(adapted.crashGroups).toHaveLength(1);
        expect(adapted.crashGroups[0]).toMatchObject({
            issueId: 'crash_issue',
            sampleCrashId: 'occurrence-1',
            sampleSessionId: 'session-1',
            count: 12,
            userCount: 5,
            sessionCount: 7,
            canOpenReplay: true,
        });
    });

    it('maps error and ANR diagnostics without dropping stack or environment data', () => {
        const errorOccurrence = occurrence({
            id: 'error-1',
            issueId: 'error_issue',
            type: 'error',
            name: 'PlatformException',
            fingerprint: 'error-fingerprint',
        });
        const anrOccurrence = occurrence({
            id: 'anr-1',
            issueId: 'anr_issue',
            type: 'anr',
            name: 'Application Not Responding',
            fingerprint: 'anr-fingerprint',
            durationMs: 6_574,
        });
        const adapted = adaptStabilityIssues([
            issue({ id: 'error_issue', type: 'error', bestOccurrence: errorOccurrence }),
            issue({ id: 'anr_issue', type: 'anr', bestOccurrence: anrOccurrence }),
        ]);

        expect(adapted.errorGroups[0].sampleError?.stack).toContain('Checkout.submit');
        expect(adapted.errorGroups[0].sampleError?.deviceModel).toBe('iPad16,3');
        expect(adapted.anrs[0].threadState).toContain('Checkout.submit');
        expect(adapted.anrs[0].durationMs).toBe(6_574);
        expect(adapted.anrs[0].deviceMetadata?.appVersion).toBe('6.0.2');
    });
});
