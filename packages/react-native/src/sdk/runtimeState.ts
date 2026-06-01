export interface RemoteConfig {
  projectId: string;
  rejourneyEnabled: boolean;
  recordingEnabled: boolean;
  textInputMasking: 'all' | 'secure_only';
  imageVideoMasking: 'none' | 'all';
  recordingFps: number;
  sampleRate: number;
  maxRecordingMinutes: number;
  billingBlocked?: boolean;
  billingReason?: string;
}

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  projectId: 'default',
  rejourneyEnabled: true,
  recordingEnabled: true,
  textInputMasking: 'all',
  imageVideoMasking: 'none',
  recordingFps: 1,
  sampleRate: 100,
  maxRecordingMinutes: 10,
};

export function normalizeTextInputMasking(value: unknown): 'all' | 'secure_only' {
  return value === 'secure_only' ? 'secure_only' : 'all';
}

export function normalizeImageVideoMasking(value: unknown): 'none' | 'all' {
  return value === 'all' ? 'all' : 'none';
}

export function normalizeRemoteConfig(config: unknown): RemoteConfig {
  const input = config && typeof config === 'object'
    ? config as Record<string, unknown>
    : {};

  const sampleRate = typeof input.sampleRate === 'number' && Number.isFinite(input.sampleRate)
    ? Math.max(0, Math.min(100, Math.round(input.sampleRate)))
    : DEFAULT_REMOTE_CONFIG.sampleRate;

  const maxRecordingMinutes = typeof input.maxRecordingMinutes === 'number' && Number.isFinite(input.maxRecordingMinutes)
    ? Math.max(1, Math.min(10, Math.round(input.maxRecordingMinutes)))
    : DEFAULT_REMOTE_CONFIG.maxRecordingMinutes;

  const recordingFps = typeof input.recordingFps === 'number' && Number.isFinite(input.recordingFps)
    ? Math.max(1, Math.min(3, Math.round(input.recordingFps)))
    : DEFAULT_REMOTE_CONFIG.recordingFps;

  return {
    projectId: typeof input.projectId === 'string' && input.projectId.length > 0
      ? input.projectId
      : DEFAULT_REMOTE_CONFIG.projectId,
    rejourneyEnabled: typeof input.rejourneyEnabled === 'boolean'
      ? input.rejourneyEnabled
      : DEFAULT_REMOTE_CONFIG.rejourneyEnabled,
    recordingEnabled: typeof input.recordingEnabled === 'boolean'
      ? input.recordingEnabled
      : DEFAULT_REMOTE_CONFIG.recordingEnabled,
    textInputMasking: normalizeTextInputMasking(input.textInputMasking),
    imageVideoMasking: normalizeImageVideoMasking(input.imageVideoMasking),
    recordingFps,
    sampleRate,
    maxRecordingMinutes,
    billingBlocked: typeof input.billingBlocked === 'boolean' ? input.billingBlocked : undefined,
    billingReason: typeof input.billingReason === 'string' ? input.billingReason : undefined,
  };
}

export function deriveRemoteStartState(
  remoteConfig: RemoteConfig | null,
  shouldRecordSessionFn: (sampleRate: number) => boolean
): {
  effectiveRemoteConfig: RemoteConfig;
  sessionSampledOut: boolean;
  blockedReason: 'disabled' | 'billingBlocked' | null;
} {
  if (!remoteConfig) {
    return {
      effectiveRemoteConfig: DEFAULT_REMOTE_CONFIG,
      sessionSampledOut: false,
      blockedReason: null,
    };
  }

  if (!remoteConfig.rejourneyEnabled) {
    return {
      effectiveRemoteConfig: remoteConfig,
      sessionSampledOut: false,
      blockedReason: 'disabled',
    };
  }

  if (remoteConfig.billingBlocked) {
    return {
      effectiveRemoteConfig: remoteConfig,
      sessionSampledOut: false,
      blockedReason: 'billingBlocked',
    };
  }

  return {
    effectiveRemoteConfig: remoteConfig,
    sessionSampledOut: !shouldRecordSessionFn(remoteConfig.sampleRate ?? 100),
    blockedReason: null,
  };
}

export function evaluateInitAttempt(publicRouteKey: unknown): {
  valid: boolean;
  initializationFailed: boolean;
  initialized: boolean;
} {
  const valid = typeof publicRouteKey === 'string' && publicRouteKey.length > 0;
  return {
    valid,
    initializationFailed: !valid,
    initialized: valid,
  };
}
