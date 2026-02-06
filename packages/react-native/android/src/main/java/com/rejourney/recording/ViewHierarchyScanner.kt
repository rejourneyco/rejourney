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
    
    var maxDepth: Int = 12
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
        val bounds = Rect().also { window.getWindowVisibleDisplayFrame(it) }
        val startTime = SystemClock.elapsedRealtime()
        
        val root = serializeView(window, 0, startTime) ?: emptyMap()
        
        val result = mutableMapOf<String, Any>(
            "timestamp" to ts,
            "screen" to mapOf(
                "width" to bounds.width(),
                "height" to bounds.height(),
                "scale" to displayMetrics.density
            ),
            "root" to root
        )
        
        ReplayOrchestrator.shared?.currentScreenName?.let {
            result["screenName"] = it
        }
        
        return result
    }
    
    private fun serializeView(view: View, depth: Int, startTime: Long): Map<String, Any>? {
        if (depth > maxDepth) return null
        if (SystemClock.elapsedRealtime() - startTime > timeBudgetMs) {
            return mapOf("type" to view.javaClass.simpleName, "bailout" to true)
        }
        if (depth > 0 && (!view.isShown || view.alpha <= 0.01f || view.width <= 0 || view.height <= 0)) {
            return null
        }
        
        val node = mutableMapOf<String, Any>()
        node["type"] = view.javaClass.simpleName
        
        val location = IntArray(2)
        view.getLocationInWindow(location)
        node["frame"] = mapOf(
            "x" to location[0],
            "y" to location[1],
            "w" to view.width,
            "h" to view.height
        )
        
        if (!view.isShown) node["hidden"] = true
        if (view.alpha < 1.0f) node["alpha"] = view.alpha
        
        // Get accessibility identifier / test ID
        view.contentDescription?.toString()?.takeIf { it.isNotEmpty() }?.let {
            node["testID"] = it
        }
        
        // Check for React Native nativeID
        try {
            val nativeId = view.getTag(com.facebook.react.R.id.view_tag_native_id) as? String
            if (!nativeId.isNullOrEmpty()) {
                node["testID"] = nativeId
            }
        } catch (_: Exception) { }
        
        if (isSensitive(view)) node["masked"] = true
        
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
                    node["text"] = maskText(text)
                    node["textLength"] = text.length
                    
                    if (view is EditText) {
                        node["text"] = "***"
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
                "x" to ((view as? HorizontalScrollView)?.scrollX ?: (view as? ScrollView)?.scrollX ?: 0),
                "y" to ((view as? HorizontalScrollView)?.scrollY ?: (view as? ScrollView)?.scrollY ?: 0)
            )
        }
        
        if (view is ImageView) {
            node["hasImage"] = view.drawable != null
        }
        
        // Process children
        if (view is ViewGroup) {
            val children = mutableListOf<Map<String, Any>>()
            for (i in 0 until view.childCount) {
                val child = view.getChildAt(i)
                if (child.isShown && child.alpha > 0.01f) {
                    serializeView(child, depth + 1, startTime)?.let {
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
        if (view is EditText) {
            val inputType = view.inputType
            // Check for password input types
            if (inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD != 0 ||
                inputType and android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD != 0 ||
                inputType and android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD != 0) {
                return true
            }
        }
        return false
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
