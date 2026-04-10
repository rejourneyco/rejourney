export interface RemoteConfig {
  projectId: string;
  rejourneyEnabled: boolean;
  recordingEnabled: boolean;
  sampleRate: number;
  maxRecordingMinutes: number;
  billingBlocked?: boolean;
  billingReason?: string;
}

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  projectId: 'default',
  rejourneyEnabled: true,
  recordingEnabled: true,
  sampleRate: 100,
  maxRecordingMinutes: 10,
};

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
