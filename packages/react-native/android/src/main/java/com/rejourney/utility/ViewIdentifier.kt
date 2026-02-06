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

package com.rejourney.utility

import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView

/**
 * View identification utilities
 * Android implementation aligned with iOS ViewIdentifier.swift
 */
object ViewIdentifier {
    
    /**
     * Generate a stable identifier for a view based on its position in hierarchy
     */
    fun generateStableId(view: View): String {
        val path = mutableListOf<String>()
        var current: View? = view
        
        while (current != null) {
            val segment = buildSegment(current)
            path.add(0, segment)
            
            current = current.parent as? View
        }
        
        return path.joinToString("/")
    }
    
    /**
     * Generate a short hash identifier
     */
    fun generateShortId(view: View): String {
        val stableId = generateStableId(view)
        return stableId.hashCode().toUInt().toString(16).take(8)
    }
    
    private fun buildSegment(view: View): String {
        val className = view.javaClass.simpleName
        val index = getIndexInParent(view)
        
        // Use resource ID if available
        val resourceId = view.id
        if (resourceId != View.NO_ID) {
            try {
                val resourceName = view.resources.getResourceEntryName(resourceId)
                return "$className[$resourceName]"
            } catch (_: Exception) {
                // Resource name not available
            }
        }
        
        // Use content description if available
        val contentDesc = view.contentDescription?.toString()
        if (!contentDesc.isNullOrBlank() && contentDesc.length < 32) {
            return "$className[\"$contentDesc\"]"
        }
        
        // Use accessibility text for text views
        if (view is TextView) {
            val text = view.text?.toString()?.take(16)
            if (!text.isNullOrBlank()) {
                val sanitized = text.replace(Regex("[^a-zA-Z0-9]"), "_")
                return "$className[\"$sanitized\"]"
            }
        }
        
        return "$className[$index]"
    }
    
    private fun getIndexInParent(view: View): Int {
        val parent = view.parent as? ViewGroup ?: return 0
        
        var index = 0
        val viewClass = view.javaClass
        
        for (i in 0 until parent.childCount) {
            val child = parent.getChildAt(i)
            if (child === view) {
                return index
            }
            if (child.javaClass == viewClass) {
                index++
            }
        }
        
        return 0
    }
    
    /**
     * Find view by stable identifier
     */
    fun findViewByStableId(root: View, stableId: String): View? {
        val segments = stableId.split("/")
        if (segments.isEmpty()) return null
        
        var current: View? = root
        
        for (segment in segments.drop(1)) {
            current = findChildBySegment(current as? ViewGroup ?: return null, segment)
            if (current == null) return null
        }
        
        return current
    }
    
    private fun findChildBySegment(parent: ViewGroup, segment: String): View? {
        // Parse segment: ClassName[identifier]
        val match = Regex("(\\w+)\\[(.+)]").find(segment) ?: return null
        val className = match.groupValues[1]
        val identifier = match.groupValues[2]
        
        // Try to find by resource ID first
        if (!identifier.startsWith("\"") && !identifier.all { it.isDigit() }) {
            val resourceId = parent.resources.getIdentifier(
                identifier,
                "id",
                parent.context.packageName
            )
            if (resourceId != 0) {
                return parent.findViewById(resourceId)
            }
        }
        
        // Find by index
        if (identifier.all { it.isDigit() }) {
            val index = identifier.toIntOrNull() ?: return null
            var count = 0
            
            for (i in 0 until parent.childCount) {
                val child = parent.getChildAt(i)
                if (child.javaClass.simpleName == className) {
                    if (count == index) {
                        return child
                    }
                    count++
                }
            }
        }
        
        return null
    }
}

/**
 * Extension functions for View identification
 */
val View.rjStableId: String
    get() = ViewIdentifier.generateStableId(this)

val View.rjShortId: String
    get() = ViewIdentifier.generateShortId(this)
