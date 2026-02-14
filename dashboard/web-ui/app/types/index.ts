export type Plan = "free" | "paid";
export type Platform = "ios" | "android";
export type SessionStatus = "recording" | "processing" | "ready" | "error";

// Time range options for filtering sessions and stats
export type TimeRange = "24h" | "7d" | "30d" | "90d" | "1y" | "all";

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "1y" },
  { value: "all", label: "All time" },
];

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  plan: Plan;
  sessionsUsed: number;
  sessionsLimit: number;
  totalStorageBytes: number;
  storageLimitBytes: number;
}

export interface Project {
  id: string;
  name: string;
  platforms: Platform[];
  bundleId: string;
  packageName?: string;
  teamId?: string;
  publicKey: string;
  rejourneyEnabled?: boolean;
  recordingEnabled: boolean;
  maxRecordingMinutes?: number;
  createdAt: string;
  sessionsLast7Days: number;
  errorsLast7Days: number;
  avgUxScore: number;
}

export interface RecordingSession {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  platform: Platform;
  appVersion: string;
  deviceModel: string;
  osVersion?: string;
  userId?: string;
  anonymousId?: string;
  anonymousDisplayName?: string; // Human-readable name like "FluffyPanda3A8B72"
  deviceId?: string;
  geoLocation?: {
    city?: string;
    region?: string;
    country?: string;
    countryCode?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  } | null;
  totalEvents: number;
  errorCount: number;
  touchCount: number;
  scrollCount: number;
  gestureCount: number;
  inputCount: number;
  apiSuccessCount: number;
  apiErrorCount: number;
  apiTotalCount: number;
  apiAvgResponseMs: number;
  rageTapCount: number;
  deadTapCount?: number;
  screensVisited: string[];
  interactionScore: number;
  explorationScore: number;
  uxScore: number;
  customEventCount: number;
  crashCount: number;
  anrCount: number;
  appStartupTimeMs?: number;
  // Network quality metrics
  networkType?: 'wifi' | 'cellular' | 'wired' | 'none' | 'other';
  cellularGeneration?: '2G' | '3G' | '4G' | '5G' | 'unknown';
  isConstrained?: boolean; // Low data mode
  isExpensive?: boolean; // Metered connection
  status: SessionStatus;
  // Recording deletion fields (recordings are auto-deleted based on retention tier)
  // Metadata is always preserved permanently for analytics
  recordingDeleted?: boolean;
  recordingDeletedAt?: string | null;
  retentionDays?: number;
  // Retention tier: 1=14d(free), 2=30d, 3=90d, 4=365d, 5=unlimited
  retentionTier?: 1 | 2 | 3 | 4 | 5;
  // Computed flag indicating if the replay is expired (S3 objects deleted)
  isReplayExpired?: boolean;
  // Replay promotion status - indicates if visual replay artifacts were uploaded for this session
  // Non-promoted sessions have event data but no visual replay
  replayPromoted?: boolean;
  replayPromotedReason?: string | null;
  // Joined/Hydrated data
  networkRequests?: ApiCall[];
  events?: SessionEvent[];
}



export interface ProjectDailyStats {
  projectId: string;
  date: string;
  totalSessions: number;
  completedSessions: number;
  avgDurationSeconds: number;
  avgInteractionScore: number;
  avgUxScore: number;
  avgApiErrorRate: number;

  p50Duration: number;
  p90Duration: number;
  p50InteractionScore: number;
  p90InteractionScore: number;
}

export interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  scopes: string[];
  maskedKey: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: "navigation" | "touch" | "scroll" | "error" | "api_call" | "gesture" | "input";
  timestamp: string;
  payload: Record<string, any>;
}

export interface ApiCall {
  id: string;
  sessionId: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  timestamp: string;
  error?: string;
}

export interface Issue {
  id: string;
  projectId: string;
  fingerprint: string;
  issueType: 'error' | 'crash' | 'anr' | 'rage_tap' | 'api_latency' | 'ux_friction' | 'performance';
  title: string;
  subtitle?: string;
  culprit?: string;
  status: 'unresolved' | 'resolved' | 'ignored' | 'ongoing';
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  userCount: number;
  events24h: number;
  events90d: number;
  sampleSessionId?: string | null;
  dailyEvents?: Record<string, number>;
  affectedDevices?: Record<string, number>;
  affectedVersions?: Record<string, number>;
}

export interface IssueSession {
  id: string;
  deviceModel: string;
  platform: string;
  durationSeconds: number;
  uxScore: number;
  createdAt: string;
  coverPhotoUrl: string | null;
}
