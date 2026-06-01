import { normalizeWebAllowedDomains } from '../utils/webAllowedDomains.js';

export type SdkConfigProject = {
    id: string;
    teamId: string;
    name: string;
    webDomain?: string | null;
    webAllowedDomains?: string[] | null;
    rejourneyEnabled: boolean;
    recordingEnabled: boolean;
    textInputMasking?: string | null;
    imageVideoMasking?: string | null;
    recordingFps?: number | null;
    sampleRate?: number | null;
    maxRecordingMinutes?: number | null;
    webMaxObservabilityMinutes?: number | null;
};

type SdkBillingConfig = {
    billingBlocked?: boolean;
    billingReason?: string;
    replayQuotaBillingExhausted?: boolean;
};

export function buildSdkConfigResponse(
    project: SdkConfigProject,
    billing: SdkBillingConfig = {}
) {
    const sampleRate = Math.max(0, Math.min(100, project.sampleRate ?? 100));
    const textInputMasking = project.textInputMasking === 'secure_only' ? 'secure_only' : 'all';
    const imageVideoMasking = project.imageVideoMasking === 'all' ? 'all' : 'none';
    const recordingFps = Math.max(1, Math.min(3, Math.round(project.recordingFps ?? 1)));
    const maxRecordingMinutes = Math.max(
        1,
        Math.min(10, project.maxRecordingMinutes ?? 10)
    );
    const webMaxObservabilityMinutes = Math.max(
        1,
        Math.min(30, project.webMaxObservabilityMinutes ?? 30)
    );
    const billingBlocked = Boolean(billing.billingBlocked);
    const billingReason = typeof billing.billingReason === 'string' ? billing.billingReason : undefined;
    const replayQuotaBillingExhausted = Boolean(billing.replayQuotaBillingExhausted);
    const webAllowedDomains = normalizeWebAllowedDomains([
        ...(project.webAllowedDomains ?? []),
        ...(project.webDomain ? [project.webDomain] : []),
    ]);

    const base = {
        projectId: project.id,
        teamId: project.teamId,
        name: project.name,
        ...(webAllowedDomains.length > 0
            ? {
                webDomain: webAllowedDomains[0],
                webAllowedDomains,
            }
            : {}),
        rejourneyEnabled: project.rejourneyEnabled,
        recordingEnabled: project.recordingEnabled && !replayQuotaBillingExhausted,
        textInputMasking,
        imageVideoMasking,
        recordingFps,
        maxRecordingMinutes,
        webMaxObservabilityMinutes,
        sampleRate,
        billingBlocked,
        billingReason,
        replayQuotaBillingExhausted,
    };

    if (!project.rejourneyEnabled) {
        return {
            ...base,
            rejourneyEnabled: false,
            recordingEnabled: false,
            disabled: true,
            reason: 'Rejourney disabled by project admin',
        };
    }

    return base;
}
