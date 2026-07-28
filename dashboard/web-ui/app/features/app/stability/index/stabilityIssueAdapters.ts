import type {
    ANRRecord,
    CrashOverviewGroup,
    ErrorOverviewGroup,
    StabilityIssue,
} from '~/shared/api/client';

export type StabilityLegacyGroups = {
    crashGroups: CrashOverviewGroup[];
    errorGroups: ErrorOverviewGroup[];
    anrs: ANRRecord[];
};

export function adaptStabilityIssues(issues: StabilityIssue[]): StabilityLegacyGroups {
    const crashGroups: CrashOverviewGroup[] = [];
    const errorGroups: ErrorOverviewGroup[] = [];
    const anrs: ANRRecord[] = [];

    for (const issue of issues) {
        const occurrence = issue.bestOccurrence;
        if (issue.type === 'crash') {
            crashGroups.push({
                id: issue.fingerprint,
                issueId: issue.id,
                name: issue.title,
                sampleCrashId: occurrence.id,
                sampleSessionId: occurrence.sessionId || '',
                canOpenReplay: occurrence.canOpenReplay,
                count: issue.eventCount,
                users: [],
                userCount: issue.userCount,
                sessionCount: issue.sessionCount,
                firstSeen: issue.firstSeen,
                lastOccurred: issue.lastSeen,
                affectedDevices: issue.affectedDevices,
                affectedVersions: issue.affectedVersions,
                diagnosticState: issue.diagnosticState,
                symbolicationState: issue.symbolicationState,
            });
            continue;
        }

        if (issue.type === 'error') {
            errorGroups.push({
                fingerprint: issue.fingerprint,
                issueId: issue.id,
                errorName: issue.title,
                message: issue.message || 'No error message captured.',
                count: issue.eventCount,
                users: [],
                userCount: issue.userCount,
                sessionCount: issue.sessionCount,
                firstSeen: issue.firstSeen,
                lastOccurred: issue.lastSeen,
                affectedDevices: issue.affectedDevices,
                affectedVersions: issue.affectedVersions,
                screens: occurrence.screenName ? [occurrence.screenName] : [],
                diagnosticState: issue.diagnosticState,
                symbolicationState: issue.symbolicationState,
                sampleError: {
                    id: occurrence.id,
                    sessionId: occurrence.sessionId,
                    timestamp: occurrence.timestamp,
                    deviceModel: occurrence.deviceModel,
                    appVersion: occurrence.appVersion,
                    stack: occurrence.stackTrace,
                    screenName: occurrence.screenName,
                    canOpenReplay: occurrence.canOpenReplay,
                },
            });
            continue;
        }

        anrs.push({
            id: occurrence.id,
            issueId: issue.id,
            sessionId: occurrence.sessionId,
            projectId: occurrence.projectId,
            timestamp: issue.lastSeen,
            durationMs: occurrence.durationMs || 0,
            threadState: occurrence.stackTrace,
            deviceMetadata: {
                ...occurrence.deviceMetadata,
                deviceModel: occurrence.deviceModel || undefined,
                osVersion: occurrence.osVersion || undefined,
                appVersion: occurrence.appVersion || undefined,
                platform: occurrence.platform || undefined,
                sdkVersion: occurrence.sdkVersion || undefined,
            },
            status: issue.status,
            occurrenceCount: issue.eventCount,
            userCount: issue.userCount,
            sessionCount: issue.sessionCount,
            groupKey: issue.id,
            canOpenReplay: occurrence.canOpenReplay,
            diagnosticState: issue.diagnosticState,
            symbolicationState: issue.symbolicationState,
        });
    }

    return { crashGroups, errorGroups, anrs };
}
