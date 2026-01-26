/**
 * Activity lifecycle tracking for screen changes.
 * Android equivalent of iOS RJViewControllerTracker.
 * 
 * NOTE: Like iOS, native Activity tracking is DISABLED for React Native apps.
 * RN apps run inside a single Activity, so native tracking produces noise.
 * Screen names are tracked via JS-side `screenChanged()`.
 */
package com.rejourney.capture

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.rejourney.core.Logger

/**
 * Callback interface for activity lifecycle events.
 */
interface ActivityTrackerDelegate {
    fun onActivityChanged(activityName: String, previousActivityName: String?)
}

class ActivityTracker private constructor() : Application.ActivityLifecycleCallbacks {
    
    companion object {
        @Volatile
        private var instance: ActivityTracker? = null

        fun getInstance(): ActivityTracker {
            return instance ?: synchronized(this) {
                instance ?: ActivityTracker().also { instance = it }
            }
        }
    }

    var delegate: ActivityTrackerDelegate? = null
    private var isEnabled: Boolean = false
    private var currentActivityName: String? = null
    private var previousActivityName: String? = null
    private var application: Application? = null

    /**
     * Enable activity tracking.
     * NOTE: For React Native apps, this should NOT be called - use JS tracking instead.
     */
    fun enableTracking(application: Application) {
        if (isEnabled) return
        
        this.application = application
        application.registerActivityLifecycleCallbacks(this)
        isEnabled = true
        Logger.debug("Activity tracking enabled (not recommended for React Native)")
    }

    /**
     * Disable activity tracking.
     */
    fun disableTracking() {
        if (!isEnabled) return
        
        application?.unregisterActivityLifecycleCallbacks(this)
        isEnabled = false
        currentActivityName = null
        previousActivityName = null
        Logger.debug("Activity tracking disabled")
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}

    override fun onActivityStarted(activity: Activity) {}

    override fun onActivityResumed(activity: Activity) {
        if (!isEnabled) return

        val activityName = activity.javaClass.simpleName
        
        // Only notify if activity actually changed
        if (activityName != currentActivityName) {
            previousActivityName = currentActivityName
            currentActivityName = activityName
            
            delegate?.onActivityChanged(activityName, previousActivityName)
        }
    }

    override fun onActivityPaused(activity: Activity) {}

    override fun onActivityStopped(activity: Activity) {}

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

    override fun onActivityDestroyed(activity: Activity) {}

    /**
     * Get the current activity name (if tracking is enabled).
     */
    fun getCurrentActivityName(): String? = currentActivityName
}
