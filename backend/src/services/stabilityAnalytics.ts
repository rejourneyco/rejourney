import { createHash } from 'node:crypto';
import { generateANRFingerprintFromStackTrace } from './anrStack.js';

export type StabilityIssueType = 'crash' | 'error' | 'anr';
export type StabilityDiagnosticState = 'complete' | 'partial' | 'incomplete';
export type StabilitySymbolicationState = 'symbolicated' | 'missing_symbols' | 'raw' | 'not_applicable';
export type StabilityReplayState = 'available' | 'expired' | 'deleted' | 'unsampled' | 'unavailable';

export type LegacyStabilityRow = {
    id: string;
    type: StabilityIssueType;
    projectId: string;
    sessionId: string | null;
    incidentId?: string | null;
    timestamp: Date;
    name: string;
    message?: string | null;
    stackTrace?: string | null;
    fingerprint?: string | null;
    durationMs?: number | null;
    status?: string | null;
    occurrenceCount?: number | null;
    eventMetadata?: Record<string, unknown> | null;
    screenName?: string | null;
    source?: string | null;
    session?: {
        platform?: string | null;
        deviceModel?: string | null;
        osVersion?: string | null;
        appVersion?: string | null;
        sdkVersion?: string | null;
        userDisplayId?: string | null;
        anonymousHash?: string | null;
        deviceId?: string | null;
        replayAvailable?: boolean | null;
        replayRetentionState?: string | null;
        recordingDeleted?: boolean | null;
        isReplayExpired?: boolean | null;
        isSampledIn?: boolean | null;
        observeOnly?: boolean | null;
        replayQuotaBillingExhausted?: boolean | null;
    } | null;
};

export type StabilityOccurrence = {
    id: string;
    sourceIds: string[];
    incidentId: string | null;
    issueId: string;
    type: StabilityIssueType;
    projectId: string;
    sessionId: string | null;
    timestamp: string;
    name: string;
    message: string | null;
    stackTrace: string | null;
    rawStackTrace: string | null;
    durationMs: number | null;
    status: string;
    occurrenceCount: number;
    screenName: string | null;
    platform: string | null;
    deviceModel: string | null;
    osVersion: string | null;
    appVersion: string | null;
    sdkVersion: string | null;
    userId: string | null;
    canOpenReplay: boolean;
    replayState: StabilityReplayState;
    diagnosticState: StabilityDiagnosticState;
    symbolicationState: StabilitySymbolicationState;
    deviceMetadata: Record<string, unknown>;
    transportSources: string[];
    fingerprint: string;
};

export type StabilityIssue = {
    id: string;
    type: StabilityIssueType;
    fingerprint: string;
    title: string;
    culprit: string | null;
    message: string | null;
    status: string;
    firstSeen: string;
    lastSeen: string;
    eventCount: number;
    userCount: number;
    sessionCount: number;
    affectedDevices: Record<string, number>;
    affectedVersions: Record<string, number>;
    affectedPlatforms: Record<string, number>;
    diagnosticState: StabilityDiagnosticState;
    symbolicationState: StabilitySymbolicationState;
    bestOccurrence: StabilityOccurrence;
    occurrences: StabilityOccurrence[];
};

const PLACEHOLDER_STACKS = new Set([
    '',
    '[]',
    '{}',
    'blocked',
    'unknown',
    'main_thread_blocked',
    'main thread blocked',
]);

function cleanString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized ? normalized : null;
}

function readMetadataString(metadata: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = cleanString(metadata[key]);
        if (value) return value;
    }
    return null;
}

export function normalizeStabilityIncidentId(value: unknown): string | null {
    const normalized = cleanString(value);
    if (!normalized) return null;
    if (normalized.length > 128) return normalized.slice(0, 128);
    return normalized;
}

export function normalizeStabilityStack(value: unknown): string | null {
    const normalized = cleanString(value);
    if (!normalized) return null;
    if (PLACEHOLDER_STACKS.has(normalized.toLowerCase())) return null;
    return normalized;
}

function isInternalAnrFrame(frame: string): boolean {
    const normalized = frame.toLowerCase();
    return (
        normalized.includes('rejourney') &&
        (
            normalized.includes('anrsentinel') ||
            normalized.includes('responsivenesswatcher') ||
            normalized.includes('_reportfreeze') ||
            normalized.includes('stabilitymonitor')
        )
    );
}

export function extractMeaningfulStabilityFrames(stackTrace: string | null | undefined): string[] {
    const normalized = normalizeStabilityStack(stackTrace);
    if (!normalized) return [];

    return normalized
        .split('\n')
        .map((frame) => frame.trim())
        .filter(Boolean)
        .filter((frame) => !/^(thread\s+\d+|backtrace|stack trace)[:\s]*$/i.test(frame))
        .filter((frame) => !isInternalAnrFrame(frame));
}

export function scoreStabilityStack(stackTrace: string | null | undefined): number {
    const normalized = normalizeStabilityStack(stackTrace);
    if (!normalized) return 0;

    const meaningfulFrames = extractMeaningfulStabilityFrames(normalized);
    const lineScore = Math.min(meaningfulFrames.length, 40) * 25;
    const symbolScore = meaningfulFrames.filter((frame) => (
        /[A-Za-z_$][\w$]*(?:[.:/][A-Za-z_$][\w$]*)+/.test(frame) &&
        !/^0x[0-9a-f]+$/i.test(frame)
    )).length * 20;
    return normalized.length + lineScore + symbolScore;
}

function mergeMetadata(
    primary: Record<string, unknown>,
    fallback: Record<string, unknown>,
): Record<string, unknown> {
    const merged = { ...fallback };
    for (const [key, value] of Object.entries(primary)) {
        if (value !== null && value !== undefined && value !== '') {
            merged[key] = value;
        }
    }
    return merged;
}

function buildReplayState(row: LegacyStabilityRow): {
    canOpenReplay: boolean;
    replayState: StabilityReplayState;
} {
    const session = row.session || {};
    if (session.recordingDeleted) {
        return { canOpenReplay: false, replayState: 'deleted' };
    }
    if (session.isReplayExpired || session.replayRetentionState === 'expired') {
        return { canOpenReplay: false, replayState: 'expired' };
    }
    if (session.isSampledIn === false || session.observeOnly || session.replayQuotaBillingExhausted) {
        return { canOpenReplay: false, replayState: 'unsampled' };
    }
    if (session.replayAvailable && row.sessionId) {
        return { canOpenReplay: true, replayState: 'available' };
    }
    return { canOpenReplay: false, replayState: 'unavailable' };
}

function inferSymbolicationState(
    type: StabilityIssueType,
    stackTrace: string | null,
): StabilitySymbolicationState {
    if (type === 'error') return stackTrace ? 'not_applicable' : 'raw';
    if (!stackTrace) return 'raw';

    const frames = extractMeaningfulStabilityFrames(stackTrace);
    const addressFrames = frames.filter((frame) => /\b0x[0-9a-f]{6,}\b/i.test(frame));
    const namedFrames = frames.filter((frame) => (
        /(?:\bat\s+[\w.$<>]+\(|[-+]\[[^\]]+\]|[\w.$<>]+(?:\.|::)[\w$<>]+)/.test(frame)
    ));
    if (addressFrames.length > 0 && namedFrames.length === 0) return 'missing_symbols';
    if (namedFrames.length > 0) return 'symbolicated';
    return 'raw';
}

function inferDiagnosticState(
    stackTrace: string | null,
    environmentValues: Array<string | null>,
): StabilityDiagnosticState {
    const environmentCount = environmentValues.filter(Boolean).length;
    if (stackTrace && environmentCount >= 3) return 'complete';
    if (stackTrace || environmentCount >= 2) return 'partial';
    return 'incomplete';
}

function normalizeErrorTitle(name: string, message: string | null): string {
    const normalizedName = name.trim();
    if (!/^_[A-Za-z0-9]{1,5}$/.test(normalizedName)) return normalizedName || 'Runtime error';

    const messageType = message?.match(/\b([A-Za-z][A-Za-z0-9]*(?:Error|Exception))\b/)?.[1];
    return messageType || 'Flutter runtime error';
}

function fingerprintStackFrames(stackTrace: string | null): string {
    return extractMeaningfulStabilityFrames(stackTrace)
        .slice(0, 5)
        .map((frame) => frame
            .replace(/\b0x[0-9a-f]+\b/gi, '0xADDR')
            .replace(/:\d+(?::\d+)?\)?$/g, ':N)')
            .replace(/\+\s*\d+\b/g, '+N')
            .trim())
        .join('|');
}

export function fingerprintStabilityOccurrence(input: {
    type: StabilityIssueType;
    name: string;
    message?: string | null;
    stackTrace?: string | null;
    fingerprint?: string | null;
}): string {
    const explicit = cleanString(input.fingerprint);
    if (explicit) return explicit;

    if (input.type === 'anr') {
        return generateANRFingerprintFromStackTrace(input.stackTrace || '');
    }

    const frames = fingerprintStackFrames(input.stackTrace || null);
    const normalizedMessage = (input.message || '')
        .toLowerCase()
        .replace(/\b\d+\b/g, 'N')
        .replace(/\b0x[0-9a-f]+\b/gi, '0xADDR')
        .slice(0, 180);
    return `${input.type}:${input.name}:${frames || normalizedMessage || input.type}`;
}

function issueIdFor(type: StabilityIssueType, fingerprint: string): string {
    const digest = createHash('sha256').update(`${type}:${fingerprint}`).digest('hex').slice(0, 24);
    return `${type}_${digest}`;
}

function buildCanonicalOccurrence(row: LegacyStabilityRow): StabilityOccurrence {
    const eventMetadata = (
        row.eventMetadata && typeof row.eventMetadata === 'object'
            ? row.eventMetadata
            : {}
    ) as Record<string, unknown>;
    const session = row.session || {};
    const sessionMetadata: Record<string, unknown> = {
        platform: session.platform,
        deviceModel: session.deviceModel,
        model: session.deviceModel,
        osVersion: session.osVersion,
        systemVersion: session.osVersion,
        appVersion: session.appVersion,
        sdkVersion: session.sdkVersion,
    };
    const deviceMetadata = mergeMetadata(eventMetadata, sessionMetadata);
    const platform = readMetadataString(deviceMetadata, ['platform', 'systemName']) || cleanString(session.platform);
    const deviceModel = readMetadataString(deviceMetadata, ['deviceModel', 'model', 'device', 'name']) || cleanString(session.deviceModel);
    const osVersion = readMetadataString(deviceMetadata, ['osVersion', 'systemVersion', 'os']) || cleanString(session.osVersion);
    const appVersion = readMetadataString(deviceMetadata, ['appVersion', 'version', 'buildVersion']) || cleanString(session.appVersion);
    const sdkVersion = readMetadataString(deviceMetadata, ['sdkVersion']) || cleanString(session.sdkVersion);
    const userId = cleanString(session.userDisplayId) || cleanString(session.anonymousHash) || cleanString(session.deviceId);
    const stackTrace = normalizeStabilityStack(row.stackTrace);
    const replay = buildReplayState(row);
    const fingerprint = fingerprintStabilityOccurrence({
        type: row.type,
        name: row.name,
        message: row.message,
        stackTrace,
        fingerprint: row.fingerprint,
    });
    const issueId = issueIdFor(row.type, fingerprint);

    return {
        id: row.id,
        sourceIds: [row.id],
        incidentId: normalizeStabilityIncidentId(row.incidentId),
        issueId,
        type: row.type,
        projectId: row.projectId,
        sessionId: row.sessionId,
        timestamp: row.timestamp.toISOString(),
        name: row.type === 'error' ? normalizeErrorTitle(row.name, row.message || null) : row.name,
        message: cleanString(row.message),
        stackTrace,
        rawStackTrace: stackTrace,
        durationMs: typeof row.durationMs === 'number' ? row.durationMs : null,
        status: cleanString(row.status) || 'open',
        occurrenceCount: Math.max(1, Number(row.occurrenceCount || 1)),
        screenName: cleanString(row.screenName),
        platform,
        deviceModel,
        osVersion,
        appVersion,
        sdkVersion,
        userId,
        canOpenReplay: replay.canOpenReplay,
        replayState: replay.replayState,
        diagnosticState: inferDiagnosticState(stackTrace, [platform, deviceModel, osVersion, appVersion]),
        symbolicationState: inferSymbolicationState(row.type, stackTrace),
        deviceMetadata,
        transportSources: row.source ? [row.source] : [],
        fingerprint,
    };
}

function legacyDedupeKey(occurrence: StabilityOccurrence): string {
    return `${occurrence.type}:${occurrence.sessionId || 'no-session'}`;
}

export function areLikelyDuplicateOccurrences(
    left: StabilityOccurrence,
    right: StabilityOccurrence,
): boolean {
    if (left.type !== right.type || left.projectId !== right.projectId) return false;
    if (left.incidentId && right.incidentId) return left.incidentId === right.incidentId;
    if (!left.sessionId || left.sessionId !== right.sessionId) return false;

    const deltaMs = Math.abs(new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    if (left.type === 'anr') {
        const leftDuration = left.durationMs || 0;
        const rightDuration = right.durationMs || 0;
        return deltaMs <= 2_000 && Math.abs(leftDuration - rightDuration) <= 500;
    }

    if (left.type === 'crash') {
        return (
            deltaMs <= 1_000 &&
            left.name === right.name &&
            (left.message || '') === (right.message || '')
        );
    }

    return (
        deltaMs <= 250 &&
        left.fingerprint === right.fingerprint &&
        (left.message || '') === (right.message || '')
    );
}

function mergeOccurrences(
    current: StabilityOccurrence,
    incoming: StabilityOccurrence,
): StabilityOccurrence {
    const currentStackScore = scoreStabilityStack(current.stackTrace);
    const incomingStackScore = scoreStabilityStack(incoming.stackTrace);
    const richer = incomingStackScore > currentStackScore ? incoming : current;
    const fallback = richer === incoming ? current : incoming;
    const metadata = mergeMetadata(richer.deviceMetadata, fallback.deviceMetadata);
    const platform = richer.platform || fallback.platform;
    const deviceModel = richer.deviceModel || fallback.deviceModel;
    const osVersion = richer.osVersion || fallback.osVersion;
    const appVersion = richer.appVersion || fallback.appVersion;
    const sdkVersion = richer.sdkVersion || fallback.sdkVersion;
    const stackTrace = richer.stackTrace || fallback.stackTrace;
    const replayWinner = current.canOpenReplay ? current : incoming.canOpenReplay ? incoming : richer;
    const fingerprint = fingerprintStabilityOccurrence({
        type: richer.type,
        name: richer.name,
        message: richer.message || fallback.message,
        stackTrace,
        fingerprint: null,
    });

    return {
        ...richer,
        id: richer.id,
        sourceIds: Array.from(new Set([...current.sourceIds, ...incoming.sourceIds])),
        incidentId: current.incidentId || incoming.incidentId,
        issueId: issueIdFor(richer.type, fingerprint),
        sessionId: richer.sessionId || fallback.sessionId,
        timestamp: new Date(
            Math.min(new Date(current.timestamp).getTime(), new Date(incoming.timestamp).getTime()),
        ).toISOString(),
        message: richer.message || fallback.message,
        stackTrace,
        rawStackTrace: richer.rawStackTrace || fallback.rawStackTrace,
        durationMs: Math.max(current.durationMs || 0, incoming.durationMs || 0) || null,
        occurrenceCount: Math.max(current.occurrenceCount, incoming.occurrenceCount),
        screenName: richer.screenName || fallback.screenName,
        platform,
        deviceModel,
        osVersion,
        appVersion,
        sdkVersion,
        userId: richer.userId || fallback.userId,
        canOpenReplay: replayWinner.canOpenReplay,
        replayState: replayWinner.replayState,
        diagnosticState: inferDiagnosticState(stackTrace, [platform, deviceModel, osVersion, appVersion]),
        symbolicationState: inferSymbolicationState(richer.type, stackTrace),
        deviceMetadata: metadata,
        transportSources: Array.from(new Set([...current.transportSources, ...incoming.transportSources])),
        fingerprint,
    };
}

export function canonicalizeStabilityOccurrences(rows: LegacyStabilityRow[]): StabilityOccurrence[] {
    const occurrences = rows
        .map(buildCanonicalOccurrence)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const deduplicated: StabilityOccurrence[] = [];
    const candidatesByKey = new Map<string, number[]>();
    const candidatesByIncident = new Map<string, number>();

    for (const occurrence of occurrences) {
        const incidentKey = occurrence.incidentId
            ? `${occurrence.type}:${occurrence.projectId}:${occurrence.incidentId}`
            : null;
        const exactIncidentIndex = incidentKey ? candidatesByIncident.get(incidentKey) : undefined;
        if (exactIncidentIndex !== undefined) {
            deduplicated[exactIncidentIndex] = mergeOccurrences(deduplicated[exactIncidentIndex], occurrence);
            continue;
        }

        const key = legacyDedupeKey(occurrence);
        const candidateIndexes = candidatesByKey.get(key) || [];
        let duplicateIndex: number | undefined;
        for (let index = candidateIndexes.length - 1; index >= 0; index -= 1) {
            const candidateIndex = candidateIndexes[index];
            const candidate = deduplicated[candidateIndex];
            const ageMs = new Date(occurrence.timestamp).getTime() - new Date(candidate.timestamp).getTime();
            if (ageMs > 30_000) break;
            if (areLikelyDuplicateOccurrences(candidate, occurrence)) {
                duplicateIndex = candidateIndex;
                break;
            }
        }

        if (duplicateIndex !== undefined) {
            deduplicated[duplicateIndex] = mergeOccurrences(deduplicated[duplicateIndex], occurrence);
            if (incidentKey) candidatesByIncident.set(incidentKey, duplicateIndex);
            continue;
        }

        const nextIndex = deduplicated.length;
        deduplicated.push(occurrence);
        candidateIndexes.push(nextIndex);
        candidatesByKey.set(key, candidateIndexes);
        if (incidentKey) candidatesByIncident.set(incidentKey, nextIndex);
    }

    return deduplicated.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function countCanonicalStabilityOccurrences(
    rows: LegacyStabilityRow[],
): Record<StabilityIssueType, number> {
    const counts: Record<StabilityIssueType, number> = {
        crash: 0,
        error: 0,
        anr: 0,
    };

    for (const occurrence of canonicalizeStabilityOccurrences(rows)) {
        counts[occurrence.type] += Math.max(1, occurrence.occurrenceCount);
    }

    return counts;
}

function incrementBreakdown(target: Record<string, number>, value: string | null, count: number): void {
    const key = value || 'Unknown';
    target[key] = (target[key] || 0) + count;
}

function diagnosticRank(state: StabilityDiagnosticState): number {
    if (state === 'complete') return 3;
    if (state === 'partial') return 2;
    return 1;
}

function symbolicationRank(state: StabilitySymbolicationState): number {
    if (state === 'symbolicated' || state === 'not_applicable') return 3;
    if (state === 'raw') return 2;
    return 1;
}

function chooseBestOccurrence(
    current: StabilityOccurrence,
    incoming: StabilityOccurrence,
): StabilityOccurrence {
    const score = (occurrence: StabilityOccurrence) => (
        scoreStabilityStack(occurrence.stackTrace) * 10 +
        diagnosticRank(occurrence.diagnosticState) * 1_000 +
        symbolicationRank(occurrence.symbolicationState) * 500 +
        (occurrence.canOpenReplay ? 250 : 0) +
        Math.min(new Date(occurrence.timestamp).getTime() / 1_000_000_000, 10_000)
    );
    return score(incoming) > score(current) ? incoming : current;
}

function issueTitle(occurrence: StabilityOccurrence): string {
    if (occurrence.type === 'anr') {
        return extractMeaningfulStabilityFrames(occurrence.stackTrace)[0] || 'Incomplete ANR diagnostics';
    }
    return occurrence.name || (occurrence.type === 'crash' ? 'Native crash' : 'Runtime error');
}

export function groupStabilityIssues(occurrences: StabilityOccurrence[]): StabilityIssue[] {
    const grouped = new Map<string, StabilityIssue>();
    const identities = new Map<string, Set<string>>();
    const sessions = new Map<string, Set<string>>();

    for (const occurrence of occurrences) {
        let issue = grouped.get(occurrence.issueId);
        if (!issue) {
            issue = {
                id: occurrence.issueId,
                type: occurrence.type,
                fingerprint: occurrence.fingerprint,
                title: issueTitle(occurrence),
                culprit: extractMeaningfulStabilityFrames(occurrence.stackTrace)[0] || occurrence.screenName,
                message: occurrence.message,
                status: occurrence.status,
                firstSeen: occurrence.timestamp,
                lastSeen: occurrence.timestamp,
                eventCount: 0,
                userCount: 0,
                sessionCount: 0,
                affectedDevices: {},
                affectedVersions: {},
                affectedPlatforms: {},
                diagnosticState: occurrence.diagnosticState,
                symbolicationState: occurrence.symbolicationState,
                bestOccurrence: occurrence,
                occurrences: [],
            };
            grouped.set(occurrence.issueId, issue);
            identities.set(occurrence.issueId, new Set());
            sessions.set(occurrence.issueId, new Set());
        }

        issue.occurrences.push(occurrence);
        issue.eventCount += occurrence.occurrenceCount;
        issue.firstSeen = new Date(occurrence.timestamp) < new Date(issue.firstSeen) ? occurrence.timestamp : issue.firstSeen;
        issue.lastSeen = new Date(occurrence.timestamp) > new Date(issue.lastSeen) ? occurrence.timestamp : issue.lastSeen;
        issue.bestOccurrence = chooseBestOccurrence(issue.bestOccurrence, occurrence);
        issue.title = issueTitle(issue.bestOccurrence);
        issue.culprit = extractMeaningfulStabilityFrames(issue.bestOccurrence.stackTrace)[0] || issue.bestOccurrence.screenName;
        issue.message = issue.bestOccurrence.message || issue.message;
        issue.diagnosticState = diagnosticRank(occurrence.diagnosticState) > diagnosticRank(issue.diagnosticState)
            ? occurrence.diagnosticState
            : issue.diagnosticState;
        issue.symbolicationState = symbolicationRank(occurrence.symbolicationState) > symbolicationRank(issue.symbolicationState)
            ? occurrence.symbolicationState
            : issue.symbolicationState;

        const count = occurrence.occurrenceCount;
        incrementBreakdown(issue.affectedDevices, occurrence.deviceModel, count);
        incrementBreakdown(issue.affectedVersions, occurrence.appVersion, count);
        incrementBreakdown(issue.affectedPlatforms, occurrence.platform, count);

        const identity = occurrence.userId || occurrence.sessionId || occurrence.id;
        identities.get(occurrence.issueId)!.add(identity);
        if (occurrence.sessionId) sessions.get(occurrence.issueId)!.add(occurrence.sessionId);
    }

    for (const issue of grouped.values()) {
        issue.userCount = identities.get(issue.id)!.size;
        issue.sessionCount = sessions.get(issue.id)!.size;
        issue.occurrences.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    return Array.from(grouped.values())
        .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}

export function buildStabilityIssues(rows: LegacyStabilityRow[]): StabilityIssue[] {
    return groupStabilityIssues(canonicalizeStabilityOccurrences(rows));
}

export function encodeStabilityCursor(offset: number): string {
    return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

export function decodeStabilityCursor(value: unknown): number {
    if (typeof value !== 'string' || !value) return 0;
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { offset?: unknown };
        const offset = Number(parsed.offset);
        return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    } catch {
        return 0;
    }
}
