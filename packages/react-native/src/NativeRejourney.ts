/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * TurboModule spec for Rejourney SDK
 *
 * This file defines the native module interface for React Native's New Architecture.
 * It follows the official React Native TurboModules pattern for Codegen compatibility.
 *
 * IMPORTANT: This spec file is used by Codegen to generate native bindings.
 * The default export MUST be a direct TurboModuleRegistry.get() call.
 *
 * @see https://reactnative.dev/docs/turbo-native-modules-introduction
 */

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * SDK telemetry metrics for observability
 */
export interface SDKMetrics {
  uploadSuccessCount: number;
  uploadFailureCount: number;
  retryAttemptCount: number;
  circuitBreakerOpenCount: number;
  memoryEvictionCount: number;
  offlinePersistCount: number;
  sessionStartCount: number;
  crashCount: number;
  uploadSuccessRate: number;
  avgUploadDurationMs: number;
  currentQueueDepth: number;
  lastUploadTime: number | null;
  lastRetryTime: number | null;
  totalBytesUploaded: number;
  totalBytesEvicted: number;
}

/**
 * Native Rejourney module specification for TurboModules (New Architecture)
 *
 * This interface defines all methods exposed by the native module.
 * Codegen uses this to generate:
 * - iOS: RejourneySpec.h (protocol) and RejourneySpec-generated.mm (JSI bindings)
 * - Android: NativeRejourneySpec.java (interface)
 */
export interface Spec extends TurboModule {
  /**
   * Start a recording session
   */
  startSession(
    userId: string,
    apiUrl: string,
    publicKey: string
  ): Promise<{
    success: boolean;
    sessionId: string;
    error?: string;
  }>;

  /**
   * Stop the current recording session
   */
  stopSession(): Promise<{
    success: boolean;
    sessionId: string;
    uploadSuccess?: boolean;
    warning?: string;
    error?: string;
  }>;

  /**
   * Log a custom event
   */
  logEvent(
    eventType: string,
    details: Object
  ): Promise<{
    success: boolean;
  }>;

  /**
   * Notify of a screen change
   */
  screenChanged(screenName: string): Promise<{
    success: boolean;
  }>;

  /**
   * Report scroll offset for timeline correlation
   */
  onScroll(offsetY: number): Promise<{
    success: boolean;
  }>;

  /**
   * Mark a visual change that should be captured
   */
  markVisualChange(reason: string, importance: string): Promise<boolean>;

  /**
   * Notify that an external URL is being opened
   */
  onExternalURLOpened(urlScheme: string): Promise<{
    success: boolean;
  }>;

  /**
   * Notify that an OAuth flow is starting
   */
  onOAuthStarted(provider: string): Promise<{
    success: boolean;
  }>;

  /**
   * Notify that an OAuth flow has completed
   */
  onOAuthCompleted(provider: string, success: boolean): Promise<{
    success: boolean;
  }>;

  /**
   * Get SDK telemetry metrics for observability
   */
  getSDKMetrics(): Promise<SDKMetrics>;

  /**
   * Trigger a debug crash (Dev only)
   */
  debugCrash(): void;

  /**
   * Trigger a debug ANR (Dev only)
   * Blocks the main thread for the specified duration
   */
  debugTriggerANR(durationMs: number): void;

  /**
   * Get the current session ID
   */
  getSessionId(): Promise<string | null>;

  /**
   * Mask a view by its nativeID prop (will be occluded in recordings)
   */
  maskViewByNativeID(nativeID: string): Promise<{ success: boolean }>;

  /**
   * Unmask a view by its nativeID prop
   */
  unmaskViewByNativeID(nativeID: string): Promise<{ success: boolean }>;

  setUserIdentity(userId: string): Promise<{ success: boolean }>;

  getUserIdentity(): Promise<string | null>;

  setDebugMode(enabled: boolean): Promise<{ success: boolean }>;

  /**
   * Set SDK version from JS (called during init with version from package.json)
   */
  setSDKVersion(version: string): void;

  getDeviceInfo(): Promise<Object>;

  /**
   * Required for NativeEventEmitter spec compliance (no-ops, dead tap detection is native-side)
   */
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/**
 * Default export for Codegen.
 *
 * CRITICAL: This MUST be a direct TurboModuleRegistry.get() call.
 * Codegen parses this file statically and requires this exact pattern.
 *
 * Using getEnforcing() would throw if module not found.
 * Using get() returns null, which is safer during development/testing.
 */
export default TurboModuleRegistry.get<Spec>('Rejourney');
