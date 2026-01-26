/**
 * Privacy masking for sensitive view content.
 * Ported from iOS RJPrivacyMask.
 */
package com.rejourney.privacy

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.EditText
import android.widget.PopupWindow
import com.facebook.react.bridge.ReactApplicationContext
import com.rejourney.core.Logger

object PrivacyMask {

    var maskTextInputs: Boolean = true
    var maskCameraViews: Boolean = true
    var maskWebViews: Boolean = true
    var maskVideoLayers: Boolean = true
    
    private val maskPaint = Paint().apply {
        color = Color.BLACK
        style = Paint.Style.FILL
    }
    
    private val textPaint = Paint().apply {
        color = Color.WHITE
        textSize = 32f
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
        isAntiAlias = true
    }

    private val maskedNativeIDs = mutableSetOf<String>()

    /**
     * Add a nativeID to the manually masked set.
     */
    fun addMaskedNativeID(nativeID: String) {
        if (nativeID.isNotEmpty()) {
            maskedNativeIDs.add(nativeID)
            Logger.debug("PrivacyMask: Added masked nativeID: $nativeID")
        }
    }

    /**
     * Remove a nativeID from the manually masked set.
     */
    fun removeMaskedNativeID(nativeID: String) {
        if (nativeID.isNotEmpty()) {
            maskedNativeIDs.remove(nativeID)
            Logger.debug("PrivacyMask: Removed masked nativeID: $nativeID")
        }
    }

    /**
     * Apply privacy masking to a captured bitmap.
     * Detects and masks sensitive views like text inputs.
     * 
     * @param bitmap The original screen capture
     * @param context Application context
     * @return Masked bitmap (may be the same object if no masking needed)
     */
    fun applyMask(bitmap: Bitmap, context: Context): Bitmap {
        val reactContext = context as? ReactApplicationContext ?: return bitmap
        val rootView = reactContext.currentActivity?.window?.decorView ?: return bitmap
        
        val sensitiveRects = findSensitiveRects(rootView)
        
        return applyMasksToBitmap(bitmap, sensitiveRects, rootView.width, rootView.height)
    }

    /**
     * Apply masks to bitmap using pre-calculated rects.
     * Can be run on background thread.
     */
    fun applyMasksToBitmap(bitmap: Bitmap, sensitiveRects: List<Rect>, rootWidth: Int, rootHeight: Int): Bitmap {
        if (sensitiveRects.isEmpty()) return bitmap

        return try {
            val config = bitmap.config ?: Bitmap.Config.ARGB_8888
            val mutableBitmap = if (bitmap.isMutable) bitmap else bitmap.copy(config, true)
            val canvas = Canvas(mutableBitmap)
            
            val scaleX = mutableBitmap.width.toFloat() / rootWidth
            val scaleY = mutableBitmap.height.toFloat() / rootHeight
            
            for (rect in sensitiveRects) {
                val scaledRect = Rect(
                    (rect.left * scaleX).toInt(),
                    (rect.top * scaleY).toInt(),
                    (rect.right * scaleX).toInt(),
                    (rect.bottom * scaleY).toInt()
                )
                canvas.drawRect(scaledRect, maskPaint)
                
                val centerX = scaledRect.centerX().toFloat()
                val centerY = scaledRect.centerY().toFloat() + (textPaint.textSize / 3) 
                canvas.drawText("********", centerX, centerY, textPaint)
            }
            
            mutableBitmap
        } catch (e: Exception) {
            Logger.error("Failed to apply privacy mask", e)
            bitmap
        }
    }

    /**
     * Find all sensitive views and return their screen coordinates.
     * Must be run on Main Thread.
     */
    fun findSensitiveRects(rootView: View): List<Rect> {
        val rects = mutableListOf<Rect>()

        val rootLocationOnScreen = IntArray(2)
        rootView.getLocationOnScreen(rootLocationOnScreen)

        findSensitiveViewsRecursive(
            view = rootView,
            rects = rects,
            rootLocationOnScreen = rootLocationOnScreen,
            rootWidth = rootView.width,
            rootHeight = rootView.height
        )

        if (rects.isEmpty()) {
            try {
                val focused = rootView.findFocus()
                if (focused != null && focused.isShown && isSensitiveView(focused) &&
                    focused.width > 0 && focused.height > 0
                ) {
                    val focusedLoc = IntArray(2)
                    focused.getLocationOnScreen(focusedLoc)

                    val left = focusedLoc[0] - rootLocationOnScreen[0]
                    val top = focusedLoc[1] - rootLocationOnScreen[1]
                    val right = left + focused.width
                    val bottom = top + focused.height

                    val clipped = Rect(
                        left.coerceAtLeast(0),
                        top.coerceAtLeast(0),
                        right.coerceAtMost(rootView.width),
                        bottom.coerceAtMost(rootView.height)
                    )

                    if (!clipped.isEmpty && clipped.width() > 5 && clipped.height() > 5) {
                        rects.add(clipped)
                        Logger.warning("PrivacyMask: No sensitive rects from scan; masked focused view as fallback")
                    }
                }
            } catch (e: Exception) {
            }
        }
        return rects
    }

    /**
     * Find all sensitive views across ALL visible windows.
     * This includes the main Activity window plus any dialogs, modals, or popup windows.
     * 
     * @param activity The current Activity (to access window and system windows)
     * @param primaryRootView The primary decorView for coordinate reference
     * @return List of sensitive view rects in primaryRootView coordinate space
     */
    fun findSensitiveRectsInAllWindows(activity: Activity, primaryRootView: View): List<Rect> {
        val rects = mutableListOf<Rect>()
        val scannedViews = mutableSetOf<View>()
        var didBailOutEarly = false
        
        val primaryLocationOnScreen = IntArray(2)
        primaryRootView.getLocationOnScreen(primaryLocationOnScreen)
        
        try {
            findSensitiveViewsRecursive(
                view = primaryRootView,
                rects = rects,
                rootLocationOnScreen = primaryLocationOnScreen,
                rootWidth = primaryRootView.width,
                rootHeight = primaryRootView.height
            )
            scannedViews.add(primaryRootView)
            
            val additionalWindows = getAllVisibleWindowRoots(activity)
            
            for (windowRoot in additionalWindows) {
                if (windowRoot == primaryRootView) continue
                if (scannedViews.contains(windowRoot)) continue
                if (!windowRoot.isShown) continue
                if (windowRoot.width <= 0 || windowRoot.height <= 0) continue
                
                scannedViews.add(windowRoot)
                
                val hitLimit = findSensitiveViewsInWindowRelativeTo(
                    windowRoot = windowRoot,
                    rects = rects,
                    primaryLocationOnScreen = primaryLocationOnScreen,
                    primaryWidth = primaryRootView.width,
                    primaryHeight = primaryRootView.height,
                    maxViews = 500
                )
                if (hitLimit) {
                    didBailOutEarly = true
                }
            }
            
            Logger.debug("PrivacyMask: Scanned ${scannedViews.size} windows, found ${rects.size} sensitive views")
            
        } catch (e: Exception) {
            Logger.warning("PrivacyMask: Multi-window scan failed: ${e.message}")
            if (rects.isEmpty()) {
                return findSensitiveRects(primaryRootView)
            }
        }
        
        if (rects.isEmpty() && didBailOutEarly) {
            try {
                for (windowRoot in getAllVisibleWindowRoots(activity)) {
                    if (!windowRoot.isShown) continue
                    if (windowRoot.width <= 0 || windowRoot.height <= 0) continue
                    findSensitiveViewsInWindowRelativeTo(
                        windowRoot = windowRoot,
                        rects = rects,
                        primaryLocationOnScreen = primaryLocationOnScreen,
                        primaryWidth = primaryRootView.width,
                        primaryHeight = primaryRootView.height,
                        maxViews = 2000
                    )
                }
                if (rects.isNotEmpty()) {
                    Logger.warning("PrivacyMask: Fallback scan recovered ${rects.size} sensitive views after early bailout")
                }
            } catch (_: Exception) {
            }
        }

        if (rects.isEmpty()) {
            try {
                val focusedView = activity.currentFocus
                if (focusedView != null && focusedView.isShown && isSensitiveView(focusedView) &&
                    focusedView.width > 0 && focusedView.height > 0
                ) {
                    val focusedLoc = IntArray(2)
                    focusedView.getLocationOnScreen(focusedLoc)

                    val left = focusedLoc[0] - primaryLocationOnScreen[0]
                    val top = focusedLoc[1] - primaryLocationOnScreen[1]
                    val right = left + focusedView.width
                    val bottom = top + focusedView.height

                    val clipped = Rect(
                        left.coerceAtLeast(0),
                        top.coerceAtLeast(0),
                        right.coerceAtMost(primaryRootView.width),
                        bottom.coerceAtMost(primaryRootView.height)
                    )

                    if (!clipped.isEmpty && clipped.width() > 5 && clipped.height() > 5) {
                        rects.add(clipped)
                        Logger.warning("PrivacyMask: Multi-window scan found 0; masked focused view as fallback")
                    }
                }
            } catch (e: Exception) {
            }
        }
        
        return rects
    }
    
    /**
     * Get all visible window roots in the application.
     * Uses reflection to access WindowManager's internal views list.
     */
    @Suppress("UNCHECKED_CAST")
    private fun getAllVisibleWindowRoots(activity: Activity): List<View> {
        val roots = mutableListOf<View>()
        
        try {
            val wmgClass = Class.forName("android.view.WindowManagerGlobal")
            val wmgInstance = wmgClass.getMethod("getInstance").invoke(null)
            
            val viewsField = wmgClass.getDeclaredField("mViews")
            viewsField.isAccessible = true
            val views = viewsField.get(wmgInstance)
            
            if (views is ArrayList<*>) {
                for (view in views) {
                    if (view is View && view.isShown && view.visibility == View.VISIBLE) {
                        roots.add(view)
                    }
                }
            } else if (views is Array<*>) {
                for (view in views) {
                    if (view is View && view.isShown && view.visibility == View.VISIBLE) {
                        roots.add(view)
                    }
                }
            }
            
            Logger.debug("PrivacyMask: Found ${roots.size} window roots via reflection")
            
        } catch (e: Exception) {
            Logger.debug("PrivacyMask: Reflection method failed (${e.message}), using fallback")
            
            try {
                activity.window?.decorView?.let { roots.add(it) }
            } catch (_: Exception) {}
        }
        
        return roots
    }
    
    /**
     * Find sensitive views in a window and convert coordinates relative to primary window.
     */
    private fun findSensitiveViewsInWindowRelativeTo(
        windowRoot: View,
        rects: MutableList<Rect>,
        primaryLocationOnScreen: IntArray,
        primaryWidth: Int,
        primaryHeight: Int,
        maxViews: Int
    ): Boolean {
        val queue = ArrayDeque<View>()
        queue.add(windowRoot)
        var viewsScanned = 0
        var hitLimit = false
        
        while (queue.isNotEmpty() && viewsScanned < maxViews) {
            val view = queue.removeFirst()
            viewsScanned++
            
            if (!view.isShown) continue
            
            if (isSensitiveView(view) && view.width > 0 && view.height > 0) {
                val location = IntArray(2)
                view.getLocationOnScreen(location)
                
                val left = location[0] - primaryLocationOnScreen[0]
                val top = location[1] - primaryLocationOnScreen[1]
                val right = left + view.width
                val bottom = top + view.height
                
                val clipped = Rect(
                    left.coerceAtLeast(0),
                    top.coerceAtLeast(0),
                    right.coerceAtMost(primaryWidth),
                    bottom.coerceAtMost(primaryHeight)
                )
                
                if (!clipped.isEmpty && clipped.width() > 5 && clipped.height() > 5) {
                    rects.add(clipped)
                }
            }
            
            if (view is ViewGroup) {
                for (i in 0 until view.childCount) {
                    queue.add(view.getChildAt(i))
                }
            }
        }

        if (queue.isNotEmpty() && viewsScanned >= maxViews) {
            hitLimit = true
        }

        return hitLimit
    }

    private fun findSensitiveViewsRecursive(
        view: View,
        rects: MutableList<Rect>,
        rootLocationOnScreen: IntArray,
        rootWidth: Int,
        rootHeight: Int
    ) {
        if (!view.isShown) return

        if (isSensitiveView(view)) {
            if (view.width > 0 && view.height > 0) {
            val location = IntArray(2)
            view.getLocationOnScreen(location)

            val left = location[0] - rootLocationOnScreen[0]
            val top = location[1] - rootLocationOnScreen[1]
            val right = left + view.width
            val bottom = top + view.height

            val clipped = Rect(
                left.coerceAtLeast(0),
                top.coerceAtLeast(0),
                right.coerceAtMost(rootWidth),
                bottom.coerceAtMost(rootHeight)
            )

            if (!clipped.isEmpty && clipped.width() > 5 && clipped.height() > 5) {
                rects.add(clipped)
            }
            }
        }

        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findSensitiveViewsRecursive(
                    view = view.getChildAt(i),
                    rects = rects,
                    rootLocationOnScreen = rootLocationOnScreen,
                    rootWidth = rootWidth,
                    rootHeight = rootHeight
                )
            }
        }
    }

    /**
     * Determine if a view should be masked.
     */
    internal fun isSensitiveView(view: View): Boolean {
        if (hasPrivacyTag(view)) return true

        val viewNativeID = view.getTag(com.facebook.react.R.id.view_tag_native_id)
        if (viewNativeID is String && maskedNativeIDs.contains(viewNativeID)) {
            Logger.debug("PrivacyMask: Found masked nativeID: $viewNativeID")
            return true
        }

        if (view is ViewGroup) {
            for (i in view.childCount - 1 downTo 0) {
                val child = view.getChildAt(i)
                val childNativeID = child.getTag(com.facebook.react.R.id.view_tag_native_id)
                if (childNativeID is String && maskedNativeIDs.contains(childNativeID)) {
                    Logger.debug("PrivacyMask: Found masked nativeID in child: $childNativeID")
                    return true
                }
            }
        }

        if (maskTextInputs && view is EditText) return true

        if (maskWebViews && isWebViewSurface(view)) return true
        if (maskCameraViews && isCameraPreview(view)) return true
        if (maskVideoLayers && isVideoLayerView(view)) return true

        val simpleClassName = view.javaClass.simpleName.lowercase()
        return maskTextInputs && (
            simpleClassName.contains("textinput") ||
                simpleClassName.contains("edittext") ||
                simpleClassName.contains("password") ||
                simpleClassName.contains("securetext")
            )
    }

    internal fun isManuallyMasked(view: View): Boolean {
        if (hasPrivacyTag(view)) return true

        val viewNativeID = view.getTag(com.facebook.react.R.id.view_tag_native_id)
        if (viewNativeID is String && maskedNativeIDs.contains(viewNativeID)) {
            return true
        }

        if (view is ViewGroup) {
            for (i in view.childCount - 1 downTo 0) {
                val child = view.getChildAt(i)
                val childNativeID = child.getTag(com.facebook.react.R.id.view_tag_native_id)
                if (childNativeID is String && maskedNativeIDs.contains(childNativeID)) {
                    return true
                }
            }
        }

        return false
    }

    /**
     * Check if a view has a privacy tag set (for manual marking).
     */
    fun hasPrivacyTag(view: View): Boolean {
        val tag = view.tag
        return tag is String && (tag == "rejourney_occlude" || tag == "privacy_mask")
    }

    private fun isCameraPreview(view: View): Boolean {
        val className = view.javaClass.name.lowercase()
        val simpleName = view.javaClass.simpleName.lowercase()
        return cameraClassNames.any { className.contains(it) } ||
            simpleName.contains("camera") ||
            simpleName.contains("preview") ||
            simpleName.contains("scanner")
    }

    private fun isWebViewSurface(view: View): Boolean {
        val className = view.javaClass.name.lowercase()
        val simpleName = view.javaClass.simpleName.lowercase()
        return webViewClassNames.any { className.contains(it) } ||
            simpleName.contains("webview") ||
            simpleName.contains("rnwebview") ||
            simpleName.contains("rctwebview")
    }

    private fun isVideoLayerView(view: View): Boolean {
        val simpleName = view.javaClass.simpleName.lowercase()
        return simpleName.contains("video") || simpleName.contains("playerview")
    }

    /**
     * Mark a view as sensitive (should be occluded in recordings).
     */
    fun markViewAsSensitive(view: View) {
        view.tag = "rejourney_occlude"
    }

    /**
     * Unmark a view as sensitive.
     */
    fun unmarkViewAsSensitive(view: View) {
        if (view.tag == "rejourney_occlude") {
            view.tag = null
        }
    }

    @Volatile
    private var classesPrewarmed = false
    
    /**
     * Pre-warm class lookups to eliminate first-scan cold-cache penalty.
     * This front-loads ~10-15ms of JVM class loading and reflection costs
     * that would otherwise spike on the first frame capture.
     * 
     * Matches iOS RJViewHierarchyScanner.prewarmClassCaches behavior.
     */
    fun prewarmClassCaches() {
        if (classesPrewarmed) return
        classesPrewarmed = true
        
        try {
            EditText::class.java
            android.widget.TextView::class.java
            android.widget.Button::class.java
            ViewGroup::class.java
            
            val dummyClassNames = listOf(
                "android.webkit.webview",
                "webview",
                "rctwebview", 
                "rnwebview",
                "textinput",
                "edittext",
                "password",
                "securetext"
            )
            dummyClassNames.forEach { it.lowercase() }
            
            try {
                com.facebook.react.R.id.view_tag_native_id
            } catch (_: Exception) {
            }
            
            Logger.debug("PrivacyMask: Class caches pre-warmed")
        } catch (e: Exception) {
            Logger.debug("PrivacyMask: Prewarm warning: ${e.message}")
        }
    }

    private val cameraClassNames = listOf(
        "androidx.camera.view.previewview",
        "com.google.android.cameraview.cameraview",
        "org.reactnative.camera.rncameraview",
        "com.mrousavy.camera.cameraview",
        "expo.modules.camera.cameraview"
    )

    private val webViewClassNames = listOf(
        "android.webkit.webview",
        "com.reactnativecommunity.webview.rncwebview",
        "com.facebook.react.views.webview.reactwebview"
    )
}
