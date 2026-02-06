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
 * Service to detect when the app is swiped away from recent apps or killed.
 * 
 * This service uses onTaskRemoved() callback which is called when the user
 * swipes the app away from the recent apps screen. By setting stopWithTask="false"
 * in the manifest, this callback will fire even when the app is killed.
 * 
 * IMPORTANT: This is not 100% reliable across all Android versions and OEMs,
 * but it's the best available mechanism for detecting app termination.
 * 
 * ANDROID-SPECIFIC: iOS handles app termination through applicationWillTerminate
 * and doesn't need this service-based approach.
 */
package com.rejourney.platform

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import com.rejourney.engine.DiagnosticLog
import kotlinx.coroutines.*

/**
 * Callback interface for notifying when app is being killed.
 * Defined outside the class for better accessibility.
 * 
 * CRITICAL: This callback is invoked SYNCHRONOUSLY on the main thread.
 * The implementation should complete session end as fast as possible
 * since the process may be killed immediately after this returns.
 */
interface TaskRemovedListener {
    /**
     * Called when the app is being killed/swiped away.
     * Implementation should be as fast as possible and use runBlocking
     * to ensure critical operations complete before process death.
     */
    fun onTaskRemoved()
}

/**
 * Service that detects app termination via onTaskRemoved() callback.
 * 
 * This service must be registered in AndroidManifest.xml with:
 * - android:stopWithTask="false" (critical - allows onTaskRemoved to fire)
 * - android:exported="false" (security - don't allow external apps to start it)
 */
class SessionLifecycleService : Service() {
    
    companion object {
        private const val TAG = "SessionLifecycleService"
        
        @Volatile
        var taskRemovedListener: TaskRemovedListener? = null
        
        @Volatile
        var isRunning = false
            private set
        
        private const val MIN_TIME_BEFORE_TASK_REMOVED_MS = 2000L
    }
    
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    private var serviceStartTime: Long = 0
    
    override fun onCreate() {
        super.onCreate()
        isRunning = true
        serviceStartTime = SystemClock.elapsedRealtime()
        DiagnosticLog.trace("[$TAG] Service created (OEM: ${OEMDetector.getOEM()})")
        DiagnosticLog.trace("[$TAG] ${OEMDetector.getRecommendations()}")
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        serviceStartTime = SystemClock.elapsedRealtime()
        DiagnosticLog.trace("[$TAG] Service started (startId=$startId, OEM: ${OEMDetector.getOEM()})")
        return START_STICKY
    }
    
    /**
     * Called when the user removes a task from the recent apps list.
     * 
     * This is the key callback for detecting app swipe-away/kill events.
     * It fires when:
     * - User swipes the app away from recent apps
     * - User taps "Clear all" in recent apps (on some devices)
     * 
     * NOTE: This may NOT fire in all cases:
     * - Some OEMs suppress this callback
     * - "Clear all" on some devices may not trigger it
     * - System-initiated kills (low memory) may not trigger it
     * - Samsung devices have a bug where this fires on app launch (we filter this)
     * 
     * That's why we also use ApplicationExitInfo (Android 11+) and
     * persistent state checking on next app launch as fallbacks.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val timeSinceStart = SystemClock.elapsedRealtime() - serviceStartTime
        val oem = OEMDetector.getOEM()
        
        DiagnosticLog.notice("[$TAG] ⚠️ onTaskRemoved() called (OEM: $oem, timeSinceStart: ${timeSinceStart}ms)")
        
        // Samsung bug: onTaskRemoved fires incorrectly on app launch
        if (OEMDetector.isSamsung() && timeSinceStart < MIN_TIME_BEFORE_TASK_REMOVED_MS) {
            DiagnosticLog.caution("[$TAG] ⚠️ Ignoring onTaskRemoved() - likely Samsung false positive (fired ${timeSinceStart}ms after start, expected > ${MIN_TIME_BEFORE_TASK_REMOVED_MS}ms)")
            DiagnosticLog.caution("[$TAG] This is a known Samsung bug where onTaskRemoved fires on app launch")
            super.onTaskRemoved(rootIntent)
            return
        }
        
        if (OEMDetector.hasAggressiveTaskKilling()) {
            DiagnosticLog.trace("[$TAG] OEM has aggressive task killing - onTaskRemoved may be unreliable")
        }
        
        DiagnosticLog.notice("[$TAG] ✅ Valid onTaskRemoved() - app is being killed/swiped away")
        
        try {
            DiagnosticLog.trace("[$TAG] Calling listener synchronously...")
            taskRemovedListener?.onTaskRemoved()
            DiagnosticLog.trace("[$TAG] Task removed listener completed")
        } catch (e: Exception) {
            DiagnosticLog.fault("[$TAG] Error notifying task removed listener: ${e.message}")
        }
        
        try {
            stopSelf()
        } catch (e: Exception) {
            DiagnosticLog.caution("[$TAG] Error stopping service: ${e.message}")
        }
        
        super.onTaskRemoved(rootIntent)
    }
    
    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
    
    override fun onDestroy() {
        isRunning = false
        serviceScope.cancel()
        DiagnosticLog.trace("[$TAG] Service destroyed")
        super.onDestroy()
    }
}
