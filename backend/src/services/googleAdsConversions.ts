import { createHash } from 'node:crypto';

import { GoogleAuth } from 'google-auth-library';
import { and, eq, inArray, lte } from 'drizzle-orm';

import { config } from '../config.js';
import {
    db,
    googleAdsConversionEvents,
    projects,
    teams,
    users,
} from '../db/client.js';
import { logger } from '../logger.js';

const DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager';
const DATA_MANAGER_EVENTS_URL = 'https://datamanager.googleapis.com/v1/events:ingest';
const DATA_MANAGER_STATUS_URL = 'https://datamanager.googleapis.com/v1/requestStatus:retrieve';
const ACTIVATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_CLAIM_MS = 15 * 60 * 1000;

export const GOOGLE_ADS_CONSENT_VERSION = 'ads_measurement_v1';

export const GOOGLE_ADS_UPLOAD_EVENT_NAMES = [
    'signup_started',
    'project_created',
    'sdk_setup_opened',
    'first_session_received',
    'setup_completed',
    'first_replay_viewed',
    'activated_account',
    'subscription_started',
] as const;

export const GOOGLE_ADS_INTERNAL_EVENT_NAMES = [
    'first_dashboard_investigation',
] as const;

export type GoogleAdsUploadEventName = (typeof GOOGLE_ADS_UPLOAD_EVENT_NAMES)[number];
export type GoogleAdsInternalEventName = (typeof GOOGLE_ADS_INTERNAL_EVENT_NAMES)[number];
export type GoogleAdsMilestoneName = GoogleAdsUploadEventName | GoogleAdsInternalEventName;
export type GoogleAdsEventSource = 'WEB' | 'APP' | 'OTHER';

type GoogleAdsAttribution = {
    gclid?: string;
    gbraid?: string;
    wbraid?: string;
    capturedAt?: string;
    landingPage?: string;
    [key: string]: unknown;
};

export type RecordGoogleAdsMilestoneInput = {
    eventName: GoogleAdsMilestoneName;
    userId: string;
    teamId?: string | null;
    projectId?: string | null;
    occurredAt?: Date;
    eventSource?: GoogleAdsEventSource;
    transactionId?: string;
    valueCents?: number | null;
    currency?: string | null;
    metadata?: Record<string, unknown>;
};

type ConversionEventRow = typeof googleAdsConversionEvents.$inferSelect;

type DataManagerEvent = {
    destinationReferences: string[];
    transactionId: string;
    eventTimestamp: string;
    userData: {
        userIdentifiers: Array<{ emailAddress: string }>;
    };
    consent: {
        adUserData: 'CONSENT_GRANTED';
        adPersonalization: 'CONSENT_GRANTED';
    };
    adIdentifiers?: {
        gclid?: string;
        gbraid?: string;
        wbraid?: string;
    };
    currency?: string;
    conversionValue?: number;
    conversionCount: number;
    eventSource: GoogleAdsEventSource;
};

type RequestStatusResponse = {
    requestStatusPerDestination?: Array<{
        requestStatus?: 'REQUEST_STATUS_UNKNOWN' | 'SUCCESS' | 'PROCESSING' | 'FAILED' | 'PARTIAL_SUCCESS';
        errorInfo?: unknown;
        warningInfo?: unknown;
        eventsIngestionStatus?: unknown;
    }>;
};

let googleAuth: GoogleAuth | null = null;

export function dataManagerStatusAfterIngest(validateOnly: boolean): 'validated' | 'accepted' {
    // Data Manager validates validate-only uploads synchronously. Google returns
    // a requestId, but its requestStatus endpoint explicitly rejects polling
    // request IDs created with validateOnly=true.
    return validateOnly ? 'validated' : 'accepted';
}

function isUploadEventName(eventName: GoogleAdsMilestoneName): eventName is GoogleAdsUploadEventName {
    return (GOOGLE_ADS_UPLOAD_EVENT_NAMES as readonly string[]).includes(eventName);
}

function normalizeCurrency(value: string | null | undefined): string | null {
    const normalized = value?.trim().toUpperCase();
    return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export function hashGoogleAdsEmail(email: string): string {
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').toUpperCase();
}

export function buildGoogleAdsDataManagerEvent(input: {
    row: Pick<
        ConversionEventRow,
        'eventName' | 'transactionId' | 'occurredAt' | 'eventSource' | 'valueCents' | 'currency'
    >;
    email: string;
    attribution?: GoogleAdsAttribution | null;
}): DataManagerEvent {
    const { row, email, attribution } = input;
    const adIdentifiers = {
        ...(typeof attribution?.gclid === 'string' && attribution.gclid ? { gclid: attribution.gclid } : {}),
        ...(typeof attribution?.gbraid === 'string' && attribution.gbraid ? { gbraid: attribution.gbraid } : {}),
        ...(typeof attribution?.wbraid === 'string' && attribution.wbraid ? { wbraid: attribution.wbraid } : {}),
    };
    const currency = normalizeCurrency(row.currency);

    return {
        destinationReferences: [row.eventName],
        transactionId: row.transactionId,
        eventTimestamp: row.occurredAt.toISOString(),
        userData: {
            userIdentifiers: [{ emailAddress: hashGoogleAdsEmail(email) }],
        },
        consent: {
            adUserData: 'CONSENT_GRANTED',
            adPersonalization: 'CONSENT_GRANTED',
        },
        ...(Object.keys(adIdentifiers).length > 0 ? { adIdentifiers } : {}),
        ...(row.valueCents != null && currency
            ? {
                currency,
                conversionValue: row.valueCents / 100,
            }
            : {}),
        conversionCount: 1,
        eventSource: row.eventSource as GoogleAdsEventSource,
    };
}

export function isWithinGoogleAdsActivationWindow(signupCompletedAt: Date, occurredAt: Date): boolean {
    const elapsed = occurredAt.getTime() - signupCompletedAt.getTime();
    return elapsed >= 0 && elapsed <= ACTIVATION_WINDOW_MS;
}

export function hasGoogleAdsMeasurementConsent(
    consentGrantedAt: Date | null | undefined,
): boolean {
    return config.GOOGLE_ADS_CONSENT_BYPASS_FOR_INITIAL_TESTING || Boolean(consentGrantedAt);
}

function defaultTransactionId(eventName: GoogleAdsMilestoneName, userId: string): string {
    return `${eventName}:${userId}`;
}

async function evaluateActivatedAccount(userId: string): Promise<void> {
    const [user] = await db
        .select({ signupCompletedAt: users.signupCompletedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!user?.signupCompletedAt) return;

    const activationDeadline = new Date(user.signupCompletedAt.getTime() + ACTIVATION_WINDOW_MS);
    const evidence = await db
        .select({
            eventName: googleAdsConversionEvents.eventName,
            occurredAt: googleAdsConversionEvents.occurredAt,
            teamId: googleAdsConversionEvents.teamId,
            projectId: googleAdsConversionEvents.projectId,
        })
        .from(googleAdsConversionEvents)
        .where(and(
            eq(googleAdsConversionEvents.userId, userId),
            inArray(googleAdsConversionEvents.eventName, [
                'first_session_received',
                'first_replay_viewed',
                'first_dashboard_investigation',
            ]),
            lte(googleAdsConversionEvents.occurredAt, activationDeadline),
        ));

    const firstSession = evidence.find((row) => row.eventName === 'first_session_received');
    const investigation = evidence.find((row) =>
        row.eventName === 'first_replay_viewed' || row.eventName === 'first_dashboard_investigation'
    );
    if (!firstSession || !investigation) return;
    if (!isWithinGoogleAdsActivationWindow(user.signupCompletedAt, firstSession.occurredAt)) return;
    if (!isWithinGoogleAdsActivationWindow(user.signupCompletedAt, investigation.occurredAt)) return;

    const occurredAt = firstSession.occurredAt > investigation.occurredAt
        ? firstSession.occurredAt
        : investigation.occurredAt;
    await recordGoogleAdsMilestone({
        eventName: 'activated_account',
        userId,
        teamId: investigation.teamId ?? firstSession.teamId,
        projectId: investigation.projectId ?? firstSession.projectId,
        occurredAt,
        eventSource: 'OTHER',
        metadata: {
            definition: 'first_session_received AND (first_replay_viewed OR first_dashboard_investigation)',
            windowDays: 7,
        },
    });
}

async function evaluateSetupCompleted(userId: string): Promise<void> {
    const evidence = await db
        .select({
            eventName: googleAdsConversionEvents.eventName,
            occurredAt: googleAdsConversionEvents.occurredAt,
            teamId: googleAdsConversionEvents.teamId,
            projectId: googleAdsConversionEvents.projectId,
        })
        .from(googleAdsConversionEvents)
        .where(and(
            eq(googleAdsConversionEvents.userId, userId),
            inArray(googleAdsConversionEvents.eventName, ['project_created', 'first_session_received']),
        ));
    const projectCreated = evidence.find((row) => row.eventName === 'project_created');
    const firstSession = evidence.find((row) => row.eventName === 'first_session_received');
    if (!projectCreated || !firstSession) return;

    await recordGoogleAdsMilestone({
        eventName: 'setup_completed',
        userId,
        teamId: firstSession.teamId ?? projectCreated.teamId,
        projectId: firstSession.projectId ?? projectCreated.projectId,
        occurredAt: firstSession.occurredAt > projectCreated.occurredAt
            ? firstSession.occurredAt
            : projectCreated.occurredAt,
        eventSource: 'OTHER',
        metadata: {
            definition: 'project_created AND first_session_received',
        },
    });
}

export async function recordGoogleAdsMilestone(
    input: RecordGoogleAdsMilestoneInput,
): Promise<ConversionEventRow | null> {
    const occurredAt = input.occurredAt ?? new Date();
    const [user] = await db
        .select({
            consentGrantedAt: users.googleAdsConsentGrantedAt,
        })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
    if (!user) return null;

    const uploadable = isUploadEventName(input.eventName);
    const consentGranted = hasGoogleAdsMeasurementConsent(user.consentGrantedAt);
    const [inserted] = await db
        .insert(googleAdsConversionEvents)
        .values({
            eventName: input.eventName,
            userId: input.userId,
            teamId: input.teamId ?? null,
            projectId: input.projectId ?? null,
            transactionId: input.transactionId ?? defaultTransactionId(input.eventName, input.userId),
            eventSource: input.eventSource ?? 'OTHER',
            occurredAt,
            valueCents: input.valueCents ?? null,
            currency: normalizeCurrency(input.currency),
            consentGranted,
            status: !uploadable ? 'internal' : consentGranted ? 'pending' : 'consent_denied',
            metadata: input.metadata,
        })
        .onConflictDoNothing({ target: googleAdsConversionEvents.transactionId })
        .returning();

    if (inserted && (
        input.eventName === 'first_session_received'
        || input.eventName === 'first_replay_viewed'
        || input.eventName === 'first_dashboard_investigation'
    )) {
        await evaluateActivatedAccount(input.userId);
    }
    if (inserted && (
        input.eventName === 'project_created'
        || input.eventName === 'first_session_received'
    )) {
        await evaluateSetupCompleted(input.userId);
    }

    return inserted ?? null;
}

export async function resolveProjectOwner(projectId: string): Promise<{
    projectId: string;
    teamId: string;
    userId: string;
} | null> {
    const [owner] = await db
        .select({
            projectId: projects.id,
            teamId: teams.id,
            userId: teams.ownerUserId,
        })
        .from(projects)
        .innerJoin(teams, eq(projects.teamId, teams.id))
        .where(eq(projects.id, projectId))
        .limit(1);
    return owner ?? null;
}

export async function recordProjectOwnerMilestone(
    projectId: string,
    eventName: Extract<GoogleAdsMilestoneName, 'first_session_received' | 'first_replay_viewed'>,
    options: {
        occurredAt?: Date;
        eventSource?: GoogleAdsEventSource;
        metadata?: Record<string, unknown>;
    } = {},
): Promise<void> {
    const owner = await resolveProjectOwner(projectId);
    if (!owner) return;
    await recordGoogleAdsMilestone({
        ...owner,
        eventName,
        occurredAt: options.occurredAt,
        eventSource: options.eventSource,
        metadata: options.metadata,
    });
}

function actionIdForEvent(eventName: string): string | null {
    const value = ({
        project_created: config.GOOGLE_ADS_PROJECT_CREATED_ACTION_ID,
        signup_started: config.GOOGLE_ADS_SIGNUP_STARTED_ACTION_ID,
        sdk_setup_opened: config.GOOGLE_ADS_SDK_SETUP_OPENED_ACTION_ID,
        first_session_received: config.GOOGLE_ADS_FIRST_SESSION_RECEIVED_ACTION_ID,
        setup_completed: config.GOOGLE_ADS_SETUP_COMPLETED_ACTION_ID,
        first_replay_viewed: config.GOOGLE_ADS_FIRST_REPLAY_VIEWED_ACTION_ID,
        activated_account: config.GOOGLE_ADS_ACTIVATED_ACCOUNT_ACTION_ID,
        subscription_started: config.GOOGLE_ADS_SUBSCRIPTION_STARTED_ACTION_ID,
    } as Record<string, string | undefined>)[eventName];
    return value?.trim() || null;
}

function getGoogleAuth(): GoogleAuth {
    if (googleAuth) return googleAuth;

    let credentials: Record<string, unknown> | undefined;
    const rawCredentials = config.GOOGLE_ADS_DATA_MANAGER_SERVICE_ACCOUNT_JSON?.trim();
    if (rawCredentials) {
        credentials = JSON.parse(rawCredentials) as Record<string, unknown>;
    }
    googleAuth = new GoogleAuth({
        ...(credentials ? { credentials } : {}),
        scopes: [DATA_MANAGER_SCOPE],
    });
    return googleAuth;
}

async function accessToken(): Promise<string> {
    const client = await getGoogleAuth().getClient();
    const token = await client.getAccessToken();
    const value = typeof token === 'string' ? token : token?.token;
    if (!value) throw new Error('Google Application Default Credentials did not return an access token');
    return value;
}

function googleHeaders(token: string): Record<string, string> {
    const cloudProjectId = config.GOOGLE_ADS_DATA_MANAGER_GOOGLE_CLOUD_PROJECT_ID?.trim();
    if (!cloudProjectId) {
        throw new Error('GOOGLE_ADS_DATA_MANAGER_GOOGLE_CLOUD_PROJECT_ID is required');
    }
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': cloudProjectId,
    };
}

function destinationFor(row: ConversionEventRow, actionId: string) {
    const operatingAccountId = config.GOOGLE_ADS_OPERATING_ACCOUNT_ID?.replace(/\D/g, '');
    const loginAccountId = (config.GOOGLE_ADS_LOGIN_ACCOUNT_ID || operatingAccountId)?.replace(/\D/g, '');
    if (!operatingAccountId || !loginAccountId) {
        throw new Error('GOOGLE_ADS_OPERATING_ACCOUNT_ID and a login account are required');
    }
    return {
        operatingAccount: {
            accountType: 'GOOGLE_ADS',
            accountId: operatingAccountId,
        },
        loginAccount: {
            accountType: 'GOOGLE_ADS',
            accountId: loginAccountId,
        },
        productDestinationId: actionId,
        reference: row.eventName,
    };
}

function retryAt(attempts: number): Date {
    const delayMinutes = Math.min(6 * 60, 2 ** Math.min(attempts, 8));
    return new Date(Date.now() + delayMinutes * 60 * 1000);
}

async function markDeliveryError(row: ConversionEventRow, error: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    await db
        .update(googleAdsConversionEvents)
        .set({
            status: attempts >= config.GOOGLE_ADS_DATA_MANAGER_MAX_ATTEMPTS ? 'failed' : 'pending',
            attempts,
            nextAttemptAt: retryAt(attempts),
            lastAttemptAt: new Date(),
            lastError: error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000),
            updatedAt: new Date(),
        })
        .where(eq(googleAdsConversionEvents.id, row.id));
}

async function uploadOne(row: ConversionEventRow): Promise<void> {
    const actionId = actionIdForEvent(row.eventName);
    if (!actionId) {
        await db
            .update(googleAdsConversionEvents)
            .set({
                status: 'pending',
                nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
                lastError: `Missing Google Ads conversion action ID for ${row.eventName}`,
                updatedAt: new Date(),
            })
            .where(eq(googleAdsConversionEvents.id, row.id));
        return;
    }

    const [identity] = await db
        .select({
            email: users.email,
            attribution: users.googleAdsAttribution,
            consentGrantedAt: users.googleAdsConsentGrantedAt,
        })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
    if (!identity || !hasGoogleAdsMeasurementConsent(identity.consentGrantedAt)) {
        await db
            .update(googleAdsConversionEvents)
            .set({ status: 'consent_denied', updatedAt: new Date() })
            .where(eq(googleAdsConversionEvents.id, row.id));
        return;
    }

    const token = await accessToken();
    const response = await fetch(DATA_MANAGER_EVENTS_URL, {
        method: 'POST',
        headers: googleHeaders(token),
        body: JSON.stringify({
            destinations: [destinationFor(row, actionId)],
            events: [buildGoogleAdsDataManagerEvent({
                row,
                email: identity.email,
                attribution: identity.attribution as GoogleAdsAttribution | null,
            })],
            consent: {
                adUserData: 'CONSENT_GRANTED',
                adPersonalization: 'CONSENT_GRANTED',
            },
            validateOnly: config.GOOGLE_ADS_DATA_MANAGER_VALIDATE_ONLY,
            encoding: 'HEX',
        }),
    });
    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(`Data Manager ingest failed (${response.status}): ${responseText.slice(0, 3000)}`);
    }
    const responseBody = responseText ? JSON.parse(responseText) as { requestId?: string } : {};
    if (!responseBody.requestId) {
        throw new Error('Data Manager ingest response did not include requestId');
    }

    const validateOnly = config.GOOGLE_ADS_DATA_MANAGER_VALIDATE_ONLY;
    const status = dataManagerStatusAfterIngest(validateOnly);
    await db
        .update(googleAdsConversionEvents)
        .set({
            status,
            attempts: row.attempts + 1,
            acceptedAt: new Date(),
            ...(validateOnly ? { processedAt: new Date() } : {}),
            lastAttemptAt: new Date(),
            nextAttemptAt: validateOnly
                ? new Date()
                : new Date(Date.now() + config.GOOGLE_ADS_DATA_MANAGER_POLL_INTERVAL_MS),
            googleRequestId: responseBody.requestId,
            lastError: null,
            diagnostics: {
                validateOnly,
                ...(validateOnly ? { validationStage: 'ingest' } : {}),
            },
            updatedAt: new Date(),
        })
        .where(eq(googleAdsConversionEvents.id, row.id));
}

async function claimUploadRows(): Promise<ConversionEventRow[]> {
    const now = new Date();
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    await db
        .update(googleAdsConversionEvents)
        .set({ status: 'pending', updatedAt: now })
        .where(and(
            eq(googleAdsConversionEvents.status, 'processing'),
            lte(googleAdsConversionEvents.lastAttemptAt, staleBefore),
        ));

    const eligibleStatuses = config.GOOGLE_ADS_DATA_MANAGER_VALIDATE_ONLY
        ? ['pending']
        : ['pending', 'validated'];
    const candidates = await db
        .select()
        .from(googleAdsConversionEvents)
        .where(and(
            inArray(googleAdsConversionEvents.status, eligibleStatuses),
            eq(googleAdsConversionEvents.consentGranted, true),
            lte(googleAdsConversionEvents.nextAttemptAt, now),
        ))
        .orderBy(googleAdsConversionEvents.occurredAt)
        .limit(config.GOOGLE_ADS_DATA_MANAGER_BATCH_SIZE);

    const claimed: ConversionEventRow[] = [];
    for (const candidate of candidates) {
        const [row] = await db
            .update(googleAdsConversionEvents)
            .set({
                status: 'processing',
                lastAttemptAt: now,
                updatedAt: now,
            })
            .where(and(
                eq(googleAdsConversionEvents.id, candidate.id),
                inArray(googleAdsConversionEvents.status, eligibleStatuses),
            ))
            .returning();
        if (row) claimed.push(row);
    }
    return claimed;
}

async function requeueConsentDeniedRowsForInitialTesting(): Promise<void> {
    if (!config.GOOGLE_ADS_CONSENT_BYPASS_FOR_INITIAL_TESTING) return;

    const now = new Date();
    await db
        .update(googleAdsConversionEvents)
        .set({
            consentGranted: true,
            status: 'pending',
            nextAttemptAt: now,
            lastError: null,
            updatedAt: now,
        })
        .where(eq(googleAdsConversionEvents.status, 'consent_denied'));
}

async function pollAcceptedRows(): Promise<void> {
    const rows = await db
        .select()
        .from(googleAdsConversionEvents)
        .where(and(
            eq(googleAdsConversionEvents.status, 'accepted'),
            lte(googleAdsConversionEvents.nextAttemptAt, new Date()),
        ))
        .limit(config.GOOGLE_ADS_DATA_MANAGER_BATCH_SIZE);
    if (rows.length === 0) return;

    const token = await accessToken();
    for (const row of rows) {
        if (!row.googleRequestId) {
            await markDeliveryError(row, new Error('Accepted conversion is missing googleRequestId'));
            continue;
        }
        try {
            const url = new URL(DATA_MANAGER_STATUS_URL);
            url.searchParams.set('requestId', row.googleRequestId);
            const response = await fetch(url, { headers: googleHeaders(token) });
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`Data Manager status failed (${response.status}): ${text.slice(0, 3000)}`);
            }
            const body = (text ? JSON.parse(text) : {}) as RequestStatusResponse;
            const destinationStatus = body.requestStatusPerDestination?.[0];
            const status = destinationStatus?.requestStatus ?? 'REQUEST_STATUS_UNKNOWN';
            if (status === 'PROCESSING' || status === 'REQUEST_STATUS_UNKNOWN') {
                await db
                    .update(googleAdsConversionEvents)
                    .set({
                        nextAttemptAt: new Date(Date.now() + config.GOOGLE_ADS_DATA_MANAGER_POLL_INTERVAL_MS),
                        diagnostics: body as Record<string, unknown>,
                        updatedAt: new Date(),
                    })
                    .where(eq(googleAdsConversionEvents.id, row.id));
                continue;
            }

            const validateOnly = Boolean((row.diagnostics as Record<string, unknown> | null)?.validateOnly);
            const succeeded = status === 'SUCCESS';
            await db
                .update(googleAdsConversionEvents)
                .set({
                    status: succeeded ? (validateOnly ? 'validated' : 'processed') : 'failed',
                    processedAt: new Date(),
                    diagnostics: body as Record<string, unknown>,
                    lastError: succeeded ? null : `Data Manager processing finished with ${status}`,
                    updatedAt: new Date(),
                })
                .where(eq(googleAdsConversionEvents.id, row.id));
        } catch (error) {
            await markDeliveryError(row, error);
        }
    }
}

export async function runGoogleAdsConversionDeliveryCycle(): Promise<{
    enabled: boolean;
    claimed: number;
}> {
    if (!config.GOOGLE_ADS_DATA_MANAGER_ENABLED) {
        return { enabled: false, claimed: 0 };
    }

    await requeueConsentDeniedRowsForInitialTesting();
    await pollAcceptedRows();
    const rows = await claimUploadRows();
    for (const row of rows) {
        try {
            await uploadOne(row);
        } catch (error) {
            logger.error({
                error,
                conversionEventId: row.id,
                eventName: row.eventName,
            }, 'Google Ads Data Manager conversion upload failed');
            await markDeliveryError(row, error);
        }
    }
    return { enabled: true, claimed: rows.length };
}

export async function recordDashboardInvestigation(input: {
    userId: string;
    projectId: string;
    sessionId: string;
}): Promise<void> {
    const owner = await resolveProjectOwner(input.projectId);
    if (!owner || owner.userId !== input.userId) return;
    await recordGoogleAdsMilestone({
        ...owner,
        eventName: 'first_dashboard_investigation',
        eventSource: 'WEB',
        metadata: { firstSessionId: input.sessionId },
    });
}
