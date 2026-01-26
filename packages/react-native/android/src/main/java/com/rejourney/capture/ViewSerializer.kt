/**
 * View hierarchy serializer aligned with iOS RJViewSerializer.
 */
package com.rejourney.capture

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.CompoundButton
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.widget.NestedScrollView
import androidx.recyclerview.widget.RecyclerView
import com.rejourney.privacy.PrivacyMask
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.min

class ViewSerializer(private val density: Float) {
    var enabled: Boolean = true
    var maxDepth: Int = 10
    var includeVisualProperties: Boolean = true
    var includeTextContent: Boolean = true

    private val imageViewClass = ImageView::class.java
    private val buttonClass = Button::class.java
    private val scrollViewClass = ScrollView::class.java
    private val textFieldClass = EditText::class.java
    private val textViewClass = TextView::class.java

    fun serializeWindow(
        window: Window,
        scanResult: ViewHierarchyScanResult? = null,
        timestamp: Long = System.currentTimeMillis()
    ): Map<String, Any?> {
        if (!enabled) return emptyMap()

        val rootView = window.decorView ?: return emptyMap()
        val width = sanitizeFloat(rootView.width / density)
        val height = sanitizeFloat(rootView.height / density)
        val scale = sanitizeFloat(density)

        val startTime = SystemClock.elapsedRealtimeNanos()
        val rootNode = serializeViewInternal(rootView, 0, startTime)

        val result = mutableMapOf<String, Any?>(
            "timestamp" to timestamp,
            "screen" to mapOf(
                "width" to width,
                "height" to height,
                "scale" to scale
            ),
            "root" to rootNode
        )

        scanResult?.layoutSignature?.let { result["layoutSignature"] = it }
        return result
    }

    fun serializeView(view: View): Map<String, Any?> {
        if (!enabled) return emptyMap()
        val startTime = SystemClock.elapsedRealtimeNanos()
        return serializeViewInternal(view, 0, startTime)
    }

    private fun serializeViewInternal(view: View, depth: Int, startTime: Long): Map<String, Any?> {
        if (depth > maxDepth) return emptyMap()

        if (SystemClock.elapsedRealtimeNanos() - startTime > VIEW_SERIALIZATION_BUDGET_NS) {
            return mapOf(
                "type" to classNameFor(view.javaClass),
                "bailout" to true
            )
        }

        if (depth > 0 && (!view.isShown || view.alpha <= 0.01f)) return emptyMap()
        if (view.width <= 0 || view.height <= 0) return emptyMap()

        val node = mutableMapOf<String, Any?>()

        node["type"] = classNameFor(view.javaClass)

        val frame = mapOf(
            "x" to sanitizeFloat(view.x / density),
            "y" to sanitizeFloat(view.y / density),
            "w" to sanitizeFloat(view.width / density),
            "h" to sanitizeFloat(view.height / density)
        )
        node["frame"] = frame

        if (view.visibility != View.VISIBLE) {
            node["hidden"] = true
        }
        if (view.alpha < 1.0f) {
            node["alpha"] = view.alpha
        }

        val nativeId = view.getTag(com.facebook.react.R.id.view_tag_native_id)
        if (nativeId is String && nativeId.isNotEmpty()) {
            node["testID"] = nativeId
        }
        val label = view.contentDescription?.toString()
        if (!label.isNullOrEmpty()) {
            node["label"] = label
        }

        if (PrivacyMask.isSensitiveView(view)) {
            node["masked"] = true
        }

        if (includeVisualProperties) {
            val bgColor = extractBackgroundColor(view)
            if (bgColor != null && Color.alpha(bgColor) > 0) {
                node["bg"] = colorToHex(bgColor)
            }
        }

        if (includeTextContent) {
            val text = extractTextFromView(view)
            if (!text.isNullOrEmpty()) {
                node["text"] = maskText(text)
                node["textLength"] = text.length
            }
        }

        if (imageViewClass.isInstance(view)) {
            node["hasImage"] = true
            val imageLabel = view.contentDescription?.toString()
            if (!imageLabel.isNullOrEmpty()) {
                node["imageLabel"] = imageLabel
            }
        }

        if (isInteractiveView(view)) {
            node["interactive"] = true

            if (buttonClass.isInstance(view)) {
                val buttonText = (view as? Button)?.text?.toString()
                if (!buttonText.isNullOrEmpty()) {
                    node["buttonTitle"] = buttonText
                }
                node["enabled"] = view.isEnabled
            }

            if (view is CompoundButton) {
                node["switchOn"] = view.isChecked
            }
        }

        if (scrollViewClass.isInstance(view) || view is HorizontalScrollView || view is NestedScrollView || view is RecyclerView) {
            val (offsetX, offsetY, contentWidth, contentHeight) = scrollMetricsFor(view)
            node["contentOffset"] = mapOf(
                "x" to sanitizeFloat(offsetX / density),
                "y" to sanitizeFloat(offsetY / density)
            )
            node["contentSize"] = mapOf(
                "w" to sanitizeFloat(contentWidth / density),
                "h" to sanitizeFloat(contentHeight / density)
            )
        }

        if (view is ViewGroup) {
            val children = mutableListOf<Map<String, Any?>>()
            val parentWidth = view.width
            val parentHeight = view.height
            for (i in view.childCount - 1 downTo 0) {
                val child = view.getChildAt(i)
                if (!child.isShown || child.alpha <= 0.01f) continue
                if (child.width <= 0 || child.height <= 0) continue

                val childNode = serializeViewInternal(child, depth + 1, startTime)
                if (childNode.isNotEmpty()) {
                    children.add(0, childNode)
                }

                if (child.isOpaque && child.alpha >= 1.0f &&
                    child.left == 0 && child.top == 0 &&
                    child.width == parentWidth && child.height == parentHeight
                ) {
                    break
                }
            }

            if (children.isNotEmpty()) {
                node["children"] = children
            }
        }

        return node
    }

    private fun isInteractiveView(view: View): Boolean {
        if (view.isClickable || view.isLongClickable) return true
        if (textFieldClass.isInstance(view) || textViewClass.isInstance(view)) return true
        return view.hasOnClickListeners() || view.isFocusable
    }

    private fun extractTextFromView(view: View): String? {
        return when (view) {
            is TextView -> view.text?.toString()
            is Button -> view.text?.toString()
            else -> null
        }
    }

    private fun maskText(text: String): String {
        if (text.isEmpty()) return ""
        val maskLength = min(text.length, 12)
        return "*".repeat(maskLength)
    }

    private fun extractBackgroundColor(view: View): Int? {
        val background = view.background ?: return null
        return when (background) {
            is ColorDrawable -> background.color
            else -> null
        }
    }

    private fun colorToHex(color: Int): String {
        val r = Color.red(color)
        val g = Color.green(color)
        val b = Color.blue(color)
        return String.format("#%02X%02X%02X", r, g, b)
    }

    private fun scrollMetricsFor(view: View): ScrollMetrics {
        return when (view) {
            is RecyclerView -> ScrollMetrics(
                view.computeHorizontalScrollOffset(),
                view.computeVerticalScrollOffset(),
                view.computeHorizontalScrollRange(),
                view.computeVerticalScrollRange()
            )
            is ScrollView -> ScrollMetrics(
                view.scrollX,
                view.scrollY,
                view.getChildAt(0)?.width ?: view.width,
                view.getChildAt(0)?.height ?: view.height
            )
            is HorizontalScrollView -> ScrollMetrics(
                view.scrollX,
                view.scrollY,
                view.getChildAt(0)?.width ?: view.width,
                view.getChildAt(0)?.height ?: view.height
            )
            is NestedScrollView -> ScrollMetrics(
                view.scrollX,
                view.scrollY,
                view.getChildAt(0)?.width ?: view.width,
                view.getChildAt(0)?.height ?: view.height
            )
            else -> ScrollMetrics(view.scrollX, view.scrollY, view.width, view.height)
        }
    }

    private fun classNameFor(cls: Class<*>): String {
        return classNameCache[cls] ?: run {
            val name = cls.simpleName
            classNameCache[cls] = name
            name
        }
    }

    private fun sanitizeFloat(value: Float): Float {
        return if (value.isNaN() || value.isInfinite()) 0f else value
    }

    private data class ScrollMetrics(
        val offsetX: Int,
        val offsetY: Int,
        val contentWidth: Int,
        val contentHeight: Int
    )

    companion object {
        private const val VIEW_SERIALIZATION_BUDGET_NS = 10_000_000L
        private val classNameCache = ConcurrentHashMap<Class<*>, String>()
    }
}
