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

package com.rejourney.recording

import android.app.Activity
import android.content.Context
import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.*
import java.lang.ref.WeakReference
import kotlin.math.roundToInt

/**
 * View hierarchy scanning and serialization
 * Android implementation aligned with iOS ViewHierarchyScanner.swift
 */
class ViewHierarchyScanner private constructor() {

    companion object {
        @Volatile
        private var instance: ViewHierarchyScanner? = null

        val shared: ViewHierarchyScanner
            get() = instance ?: synchronized(this) {
                instance ?: ViewHierarchyScanner().also { instance = it }
            }
    }

    /// Depth cap for the serialized tree.
    ///
    /// This was 12, and measurement showed it doing the cutting rather than
    /// protecting anything: across sampled production hierarchies 76% ended at
    /// exactly 12 -- the signature of truncation, not of trees that happen to
    /// be that deep -- while the 16ms time budget that is the real cost guard
    /// never fired once. Modern React Native trees nest well past 12 through
    /// wrapper views alone. The budget still bounds the work, and unlike this
    /// cap it marks what it cut.
    var maxDepth: Int = 24
    var includeTextContent: Boolean = true
    var includeVisualProperties: Boolean = true

    private val timeBudgetMs: Long = 16 // 16ms to stay under one frame

    private var currentActivity: WeakReference<Activity>? = null

    fun setCurrentActivity(activity: Activity?) {
        currentActivity = if (activity != null) WeakReference(activity) else null
    }

    fun captureHierarchy(): Map<String, Any>? {
        val activity = currentActivity?.get() ?: return null
        val decorView = activity.window?.decorView ?: return null
        return serializeWindow(decorView, activity)
    }

    fun serializeWindow(window: View, activity: Activity): Map<String, Any> {
        val ts = System.currentTimeMillis()
        val displayMetrics = activity.resources.displayMetrics
        val density = displayMetrics.density.takeIf { it > 0f } ?: 1f
        val bounds = Rect().also { window.getWindowVisibleDisplayFrame(it) }
        val startTime = SystemClock.elapsedRealtime()

        val root = serializeView(window, 0, startTime, density) ?: emptyMap()

        val result = mutableMapOf<String, Any>(
            "timestamp" to ts,
            "screen" to mapOf(
                "width" to (bounds.width() / density).roundToInt(),
                "height" to (bounds.height() / density).roundToInt(),
                "scale" to displayMetrics.density
            ),
            "root" to root
        )

        ReplayOrchestrator.shared?.currentScreenName?.let {
            result["screenName"] = it
        }

        return result
    }

    private fun serializeView(view: View, depth: Int, startTime: Long, density: Float): Map<String, Any>? {
        if (depth > maxDepth) return null
        if (SystemClock.elapsedRealtime() - startTime > timeBudgetMs) {
            return mapOf("type" to simpleNameOf(view), "bailout" to true)
        }
        if (depth > 0 && (!view.isShown || view.alpha <= 0.01f || view.width <= 0 || view.height <= 0)) {
            return null
        }

        val node = mutableMapOf<String, Any>()
        node["type"] = simpleNameOf(view)

        val location = IntArray(2)
        view.getLocationInWindow(location)
        node["frame"] = mapOf(
            "x" to location[0] / density,
            "y" to location[1] / density,
            "w" to view.width / density,
            "h" to view.height / density
        )

        if (!view.isShown) node["hidden"] = true
        if (view.alpha < 1.0f) node["alpha"] = view.alpha

        // Get accessibility identifier / test ID
        view.contentDescription?.toString()?.takeIf { it.isNotEmpty() }?.let {
            node["testID"] = it
        }

        // Check for React Native nativeID
        try {
            val nativeId = optionalResourceTag(view, "view_tag_native_id", "com.facebook.react") as? String
            if (!nativeId.isNullOrEmpty()) {
                node["testID"] = nativeId
            }
        } catch (_: Exception) { }

        // Resolved once: isSensitive does a resource-tag lookup and a string
        // allocation, and it used to be asked twice for every view in the tree.
        val sensitive = isSensitive(view)
        if (sensitive) node["masked"] = true

        if (includeVisualProperties) {
            view.background?.let { bg ->
                // Try to get background color
                try {
                    val colorDrawable = bg as? android.graphics.drawable.ColorDrawable
                    colorDrawable?.color?.let { color ->
                        node["bg"] = String.format("#%06X", 0xFFFFFF and color)
                    }
                } catch (_: Exception) { }
            }
        }

        if (includeTextContent) {
            when (view) {
                is TextView -> {
                    val text = view.text?.toString() ?: ""
                    node["text"] = if (sensitive) "***" else maskText(text)
                    node["textLength"] = text.length

                    if (view is EditText) {
                        view.hint?.toString()?.let { node["placeholder"] = it }
                    }
                }
            }
        }

        if (isInteractive(view)) {
            node["interactive"] = true

            when (view) {
                is Button -> {
                    node["buttonTitle"] = view.text?.toString() ?: ""
                    node["enabled"] = view.isEnabled
                }
                is CompoundButton -> {
                    node["checked"] = view.isChecked
                    node["enabled"] = view.isEnabled
                }
            }

            if (view.isEnabled) {
                node["enabled"] = true
            } else {
                node["enabled"] = false
            }
        }

        if (view is ScrollView || view is HorizontalScrollView) {
            node["scrollEnabled"] = true
            node["contentOffset"] = mapOf<String, Any>(
                "x" to (((view as? HorizontalScrollView)?.scrollX ?: (view as? ScrollView)?.scrollX ?: 0) / density),
                "y" to (((view as? HorizontalScrollView)?.scrollY ?: (view as? ScrollView)?.scrollY ?: 0) / density)
            )
        }

        if (view is ImageView) {
            node["hasImage"] = view.drawable != null
        }

        // Process children
        if (view is ViewGroup) {
            if (depth >= maxDepth && view.childCount > 0) {
                // Say so rather than silently presenting a leaf. Budget
                // exhaustion already marks itself; depth truncation did not,
                // which is why it went unnoticed.
                node["truncated"] = true
            }
            val children = mutableListOf<Map<String, Any>>()
            for (i in 0 until view.childCount) {
                val child = view.getChildAt(i)
                if (child.isShown && child.alpha > 0.01f) {
                    serializeView(child, depth + 1, startTime, density)?.let {
                        children.add(it)
                    }
                }
            }
            if (children.isNotEmpty()) {
                node["children"] = children
            }
        }

        return node
    }

    private fun isSensitive(view: View): Boolean {
        if (view.contentDescription?.toString() == "rejourney_occlude") return true

        try {
            // Check for React Native accessibility hint tag
            val hint = optionalResourceTag(view, "accessibility_hint", "com.facebook.react") as? String
            if (hint == "rejourney_occlude") return true
        } catch (_: Exception) {
            // Fail closed. This lookup is how a caller marks a view for
            // occlusion through React Native's accessibility hint, so a failure
            // here means we cannot tell whether they asked for it. Swallowing
            // the error and continuing would answer "not sensitive" and put the
            // content in the replay -- the wrong direction for a privacy check.
            return true
        }

        if (view is EditText) {
            val inputType = view.inputType
            // Check for password input types
            if (inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD != 0 ||
                inputType and android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD != 0 ||
                inputType and android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD != 0) {
                return true
            }
            return ReplayOrchestrator.shared?.maskTextInputsByDefault ?: true
        }
        if ((ReplayOrchestrator.shared?.maskTextInputsByDefault ?: true) && isTextInputClass(view)) return true
        return false
    }

    private fun isTextInputClass(view: View): Boolean {
        val className = simpleNameOf(view)
        return className == "ReactEditText" ||
            className == "RCTEditText" ||
            className.contains("TextInput", ignoreCase = true)
    }

    /// Resource ids are fixed for the life of the process, but getIdentifier
    /// resolves them by string every call. This runs per view per scan, and on
    /// an app without React on the classpath every one of those lookups fails,
    /// so the misses are cached as absent too.
    private val resourceIdCache = java.util.concurrent.ConcurrentHashMap<String, Int>()

    /// Class.getSimpleName() derives the name from the binary name and allocates
    /// on each call, and this is asked two or three times per view on every scan
    /// of the whole tree. An app has a small, fixed set of view classes, so the
    /// cache stays tiny and never needs eviction.
    private val simpleNameCache = java.util.concurrent.ConcurrentHashMap<Class<*>, String>()

    private fun simpleNameOf(view: View): String =
        simpleNameCache.getOrPut(view.javaClass) { view.javaClass.simpleName }

    private fun optionalResourceTag(view: View, name: String, packageName: String): Any? {
        val identifier = resourceIdCache.getOrPut("$packageName:$name") {
            view.resources.getIdentifier(name, "id", packageName)
        }
        return if (identifier == 0) null else view.getTag(identifier)
    }

    private fun isInteractive(view: View): Boolean {
        return view is Button ||
               view is EditText ||
               view is CheckBox ||
               view is RadioButton ||
               view is Switch ||
               view is SeekBar ||
               view is Spinner ||
               view.isClickable
    }

    private fun maskText(text: String): String {
        return if (text.length > 100) text.take(100) + "..." else text
    }
}
